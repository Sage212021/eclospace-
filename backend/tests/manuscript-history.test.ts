import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Historique des manuscrits reçus / inscrits, groupés par jour (accordéon).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("historique des manuscrits par jour", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("groupe par jour de réception, du plus récent au plus ancien", async () => {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "RECEPTION" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const tag = rnd();
    // Deux le même jour (2040-03-10), un autre jour (2040-03-11).
    const mk = (num: string, day: string) =>
      prisma.manuscript.create({ data: { manuscriptNumber: num, title: `Hist ${tag} ${num}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date(`${day}T09:00:00.000Z`) } });
    await mk(`MS-H1-${tag}`, "2040-03-10");
    await mk(`MS-H2-${tag}`, "2040-03-10");
    await mk(`MS-H3-${tag}`, "2040-03-11");

    const res = await app.inject({ method: "GET", url: "/api/v1/manuscripts/history-by-day", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const days = res.json() as { date: string; count: number; items: { manuscript_number: string }[] }[];

    const d11 = days.find((d) => d.date === "2040-03-11");
    const d10 = days.find((d) => d.date === "2040-03-10");
    expect(d11).toBeTruthy();
    expect(d10).toBeTruthy();
    expect(d10!.count).toBeGreaterThanOrEqual(2);
    expect(d10!.items.some((i) => i.manuscript_number === `MS-H1-${tag}`)).toBe(true);

    // Ordre décroissant : le 11 vient avant le 10 dans la liste.
    const i11 = days.findIndex((d) => d.date === "2040-03-11");
    const i10 = days.findIndex((d) => d.date === "2040-03-10");
    expect(i11).toBeLessThan(i10);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/manuscripts/history-by-day" });
    expect(res.statusCode).toBe(401);
  });
});
