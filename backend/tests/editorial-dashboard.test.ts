import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Tableau de bord éditorial (Lot B) : structure des indicateurs + détection
// d'un dossier en retard, et accès réservé.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("tableau de bord éditorial", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));

    // Le paramètre de délais doit exister (migration/seed) pour calculer le retard.
    await prisma.setting.upsert({
      where: { key: "workflow.step_target_days" },
      update: {},
      create: { key: "workflow.step_target_days", value: { RECEPTION: 2 } },
    });

    const reception = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "RECEPTION" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: {
        manuscriptNumber: `MS-DASH-${rnd()}`,
        title: `Ouvrage tableau ${rnd()}`,
        statusId: reception.id,
        ownerId: admin.id,
        origin: "soumission",
        language: "fr",
        receivedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId } });
    await prisma.stepTransition.deleteMany({ where: { manuscriptId } });
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } });
    await app.close();
  });

  it("renvoie la structure attendue", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/editorial", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(Array.isArray(b.by_status)).toBe(true);
    expect(typeof b.en_retard).toBe("number");
    expect(typeof b.bloques).toBe("number");
    expect(typeof b.contrats_signes).toBe("number");
    expect("taux_acceptation" in b).toBe(true);
    expect("temps_moyen_jours" in b).toBe(true);
    expect(typeof b.en_fabrication).toBe("number");
    expect(typeof b.en_commercialisation).toBe("number");
  });

  it("détecte le dossier en retard (reçu il y a 10 j, délai 2 j)", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/v1/dashboard/editorial", headers: { cookie } })).json();
    expect(b.en_retard).toBeGreaterThanOrEqual(1);
    expect(b.en_retard_list.some((r: { id: string }) => r.id === manuscriptId)).toBe(true);
  });

  it("refuse l'accès sans permission manuscrits (401 sans session)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/editorial" });
    expect(res.statusCode).toBe(401);
  });
});
