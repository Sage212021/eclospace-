import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// « Mes travaux de production » (demande opérateur 01/10) : espace unique listant
// les travaux de production confiés à l'utilisateur, classés par état, avec la
// tâche active et la progression. N'affiche QUE les travaux de l'utilisateur.

const rnd = () => Math.random().toString(36).slice(2, 7);

describe("mes travaux de production", () => {
  let app: FastifyInstance;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function login(u: string, p: string) {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  }
  async function manuscriptAt(code: string, responsibleId: string, opts: { started?: boolean; validatedBy?: string } = {}) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-PW-${rnd()}`, title: `Prod ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({
      data: {
        manuscriptId: m.id, statusId: status.id, responsibleId,
        actualStart: opts.started || opts.validatedBy ? new Date() : null,
        ...(opts.validatedBy ? { validationBy: opts.validatedBy, validatedAt: new Date() } : {}),
      },
    });
    return m;
  }

  it("classe les travaux : à traiter / en cours / terminés, et reste personnel", async () => {
    const maq = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Pwd123!");
    const other = await createUserWithRole(`maq2_${rnd()}`, "MAQUETTISTE", "Pwd123!");
    const cookie = await login(maq.username, "Pwd123!");

    const aTraiter = await manuscriptAt("MISE_EN_PAGE", maq.id, { started: false });
    const enCours = await manuscriptAt("MISE_EN_PAGE", maq.id, { started: true });
    const termine = await manuscriptAt("MISE_EN_PAGE", maq.id, { validatedBy: maq.id });
    const autrui = await manuscriptAt("MISE_EN_PAGE", other.id, { started: true });

    const res = await app.inject({ method: "GET", url: "/api/v1/my-production-work", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { manuscript_id: string; bucket: string; progression: { done: number; total: number } }[];
    const byId = (id: string) => rows.find((r) => r.manuscript_id === id);

    expect(byId(aTraiter.id)?.bucket).toBe("a_traiter");
    expect(byId(enCours.id)?.bucket).toBe("en_cours");
    expect(byId(termine.id)?.bucket).toBe("termine");
    // Un travail confié à quelqu'un d'autre n'apparaît pas.
    expect(byId(autrui.id)).toBeUndefined();
    // Progression : segment de production à 6 étapes ; le terminé en compte 1.
    expect(byId(termine.id)?.progression.total).toBe(6);
    expect(byId(termine.id)?.progression.done).toBe(1);
    expect(byId(aTraiter.id)?.progression.done).toBe(0);
  });

  it("place en « en attente » une infographie dont la convergence n'est pas atteinte", async () => {
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Pwd123!");
    const cookie = await login(info.username, "Pwd123!");
    // Pas de fiche technique ni de couverture conforme → convergence incomplète.
    const m = await manuscriptAt("INFOGRAPHIE", info.id, { started: true });

    const res = await app.inject({ method: "GET", url: "/api/v1/my-production-work", headers: { cookie } });
    const row = (res.json() as { manuscript_id: string; bucket: string; blocked_reason: string | null }[]).find((r) => r.manuscript_id === m.id);
    expect(row?.bucket).toBe("en_attente");
    expect(row?.blocked_reason).toBeTruthy();
  });
});
