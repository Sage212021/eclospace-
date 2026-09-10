import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, createUserWithRole } from "./helpers.js";

// Écran « Doublons potentiels » : GET /manuscripts/duplicates regroupe les
// fiches non supprimées dont le titre normalisé (accents/casse/ponctuation
// ignorés) est partagé. Réservé à l'administration ; marque « sûr à retirer »
// une fiche sans empreinte catalogue/financière.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance, u: string, p: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("doublons potentiels — regroupement par titre normalisé", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  const created: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => {
    await prisma.workContributor.deleteMany({ where: { manuscriptId: { in: created } } });
    await prisma.manuscript.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function rawManuscript(title: string) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "DECISION_EDITORIALE" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-DUP-${rnd()}`, title, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    created.push(m.id);
    return m.id;
  }

  it("regroupe les variantes d'un même titre et exige l'administration", async () => {
    const marker = rnd().toUpperCase();
    // Doublon créé directement (l'API refuserait un titre identique) — comme
    // les doublons historiques antérieurs au renforcement de l'anti-doublon.
    await rawManuscript(`Le Prix du Silence ${marker}`);
    await rawManuscript(`le prix du silence ${marker}`);

    const res = await app.inject({ method: "GET", url: "/api/v1/manuscripts/duplicates", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const groups = res.json() as { title: string; count: number; manuscripts: { safe: boolean }[] }[];
    const mine = groups.find((g) => g.title.includes(marker));
    expect(mine).toBeTruthy();
    expect(mine!.count).toBe(2);
    // Fiches vides → sûres à retirer.
    expect(mine!.manuscripts.every((m) => m.safe)).toBe(true);

    // Un profil sans droit d'administration manuscrits est refusé.
    await createUserWithRole("dup_reader_test", "CORRECTEUR", "Dup123!");
    const readerCookie = await loginCookie(app, "dup_reader_test", "Dup123!");
    const denied = await app.inject({ method: "GET", url: "/api/v1/manuscripts/duplicates", headers: { cookie: readerCookie } });
    expect(denied.statusCode).toBe(403);
  });
});
