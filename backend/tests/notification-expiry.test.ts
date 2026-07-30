import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Expiration d'affichage des notifications (demande opérateur du 30/07/2026) :
// une notification sans échéance propre disparaît de la cloche 24 h après sa
// création ; avec une échéance, elle reste visible jusqu'à cette date.

const PWD = "Notif123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const HOUR = 60 * 60 * 1000;

describe("expiration des notifications", () => {
  let app: FastifyInstance;
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const u = `notif_${rnd()}`;
    const user = await createUserWithRole(u, "CORRECTEUR", PWD);
    userId = user.id;
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await app.close();
    await prisma.$disconnect();
  });

  async function make(title: string, opts: { createdAgoH: number; expiresAt?: Date | null }) {
    return prisma.notification.create({
      data: {
        userId,
        type: "autre",
        priority: "medium",
        title,
        body: title,
        createdAt: new Date(Date.now() - opts.createdAgoH * HOUR),
        expiresAt: opts.expiresAt ?? null,
      },
    });
  }

  it("masque les notifications sans échéance de plus de 24 h, garde les récentes", async () => {
    await make("recente", { createdAgoH: 2 }); // < 24 h → visible
    await make("ancienne", { createdAgoH: 48 }); // > 24 h, sans échéance → masquée

    const res = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const titles = (res.json() as { title: string }[]).map((n) => n.title);
    expect(titles).toContain("recente");
    expect(titles).not.toContain("ancienne");
  });

  it("respecte une échéance propre : visible tant qu'elle n'est pas dépassée, masquée ensuite", async () => {
    // Ancienne (72 h) mais avec une échéance encore future → doit rester visible.
    await make("avec_echeance_future", { createdAgoH: 72, expiresAt: new Date(Date.now() + 24 * HOUR) });
    // Échéance dépassée → masquée même si récente.
    await make("echeance_passee", { createdAgoH: 1, expiresAt: new Date(Date.now() - 1 * HOUR) });

    const res = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: { cookie } });
    const titles = (res.json() as { title: string }[]).map((n) => n.title);
    expect(titles).toContain("avec_echeance_future");
    expect(titles).not.toContain("echeance_passee");
  });
});
