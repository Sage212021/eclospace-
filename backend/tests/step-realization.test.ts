import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, seedStepDeliverable, realizationPayload , seedVc1 } from "./helpers.js";

// Étapes « à option » (Expertise, Réécriture, Projet) — demande opérateur
// 20/08/2026 : l'opérateur choisit « Réaliser » (avec les éléments) ou
// « Passer » (motif), selon le mode défini dans les Paramètres.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function manuscriptAt(code: string) {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-OPT-${rnd()}`, title: `Option ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

describe("étapes « à option » : Réaliser / Passer", () => {
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

  it("expose la méta de décision d'une étape à option (mode + éléments à renseigner)", async () => {
    const m = await manuscriptAt("EXPERTISE");
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/optional-step/EXPERTISE`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_optional).toBe(true);
    expect(res.json().mode).toBe("facultative");
    expect((res.json().fields as { key: string }[]).some((f) => f.key === "expert_opinion")).toBe(true);
  });

  it("une étape ordinaire n'est pas une étape à option", async () => {
    const m = await manuscriptAt("CORRECTION");
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/optional-step/CORRECTION`, headers: { cookie } });
    expect(res.json().is_optional).toBe(false);
  });

  it("Projet (Planification) est OBLIGATOIRE par défaut : « Passer » est refusé", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    await seedVc1(m.id);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`,
      headers: { cookie },
      payload: { step_decision: "passe", skip_reason: "on tente de sauter" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("step_mandatory");
  });

  it("réaliser exige les éléments obligatoires, puis enregistre la décision", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    await seedVc1(m.id);

    // Sans le responsable ni le calendrier → refus.
    const incomplete = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`,
      headers: { cookie },
      payload: { step_decision: "realise", realization: { budget: 500000 } },
    });
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json().code).toBe("realization_incomplete");

    // Complet → OK, décision tracée sur l'étape.
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`,
      headers: { cookie },
      payload: realizationPayload("PLANIFICATION"),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().realization_mode).toBe("realise");
    const step = await prisma.manuscriptStep.findFirstOrThrow({ where: { manuscriptId: m.id, status: { code: "PLANIFICATION" } } });
    expect(step.realizationMode).toBe("realise");
    expect((step.realizationData as { responsible_name?: string }).responsible_name).toBe("Resp. projet");
  });

  it("passer une étape facultative n'exige PAS de livrable (le motif suffit) et trace le motif", async () => {
    const m = await manuscriptAt("EXPERTISE");
    // Aucun livrable déposé : passer doit tout de même réussir.
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/steps/EXPERTISE/validate`,
      headers: { cookie },
      payload: { step_decision: "passe", skip_reason: "Ouvrage non scientifique" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("REECRITURE");
    const step = await prisma.manuscriptStep.findFirstOrThrow({ where: { manuscriptId: m.id, status: { code: "EXPERTISE" } } });
    expect(step.realizationMode).toBe("passe");
    expect(step.skipReason).toBe("Ouvrage non scientifique");
  });

  it("le paramètre « modes d'étape » expose les défauts et applique un changement (facultative → obligatoire)", async () => {
    const get = await app.inject({ method: "GET", url: "/api/v1/workflow-step-modes", headers: { cookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json().modes.EXPERTISE).toBe("facultative");
    expect(get.json().modes.PLANIFICATION).toBe("obligatoire");

    // On rend l'Expertise obligatoire : « Passer » devient alors interdit.
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/workflow-step-modes",
      headers: { cookie },
      payload: { modes: { EXPERTISE: "obligatoire", REECRITURE: "facultative", PLANIFICATION: "obligatoire" } },
    });
    expect(put.statusCode).toBe(200);
    try {
      const m = await manuscriptAt("EXPERTISE");
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/manuscripts/${m.id}/steps/EXPERTISE/validate`,
        headers: { cookie },
        payload: { step_decision: "passe", skip_reason: "tentative" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("step_mandatory");
    } finally {
      // Restaure les défauts pour ne pas contaminer les autres suites.
      await app.inject({
        method: "PUT",
        url: "/api/v1/workflow-step-modes",
        headers: { cookie },
        payload: { modes: { EXPERTISE: "facultative", REECRITURE: "facultative", PLANIFICATION: "obligatoire" } },
      });
    }
  });
});
