import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, seedEvaluation } from "./helpers.js";

// Suivi des acceptations « sous conditions » (audit éditorial, point n°2) : les
// conditions posées par le comité sont listées, levées une à une (datées,
// tracées), et le passage en production (mise en page) est bloqué tant qu'il en
// reste. La correction — dernière étape éditoriale — porte le garde-fou.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("acceptation sous conditions — suivi des conditions", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Crée un manuscrit directement à une étape donnée, avec un auteur.
  async function manuscriptAt(code: string) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-COND-${rnd()}`, title: "Sous conditions", statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Ada", lastName: "Cond", email: "ada@example.com" } });
    await prisma.workContributor.create({ data: { manuscriptId: m.id, partnerId: partner.id, role: "author", displayOrder: 0 } });
    // Rapport d'évaluation requis pour toute acceptation (garde-fou circuit).
    if (code === "DECISION_EDITORIALE") await seedEvaluation(m.id, adminId);
    return m.id;
  }

  it("à la décision, enregistre les conditions posées et les expose", async () => {
    const id = await manuscriptAt("DECISION_EDITORIALE");
    const res = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "acceptation_conditions", motivation: "Bon potentiel, sous réserve.", conditions: ["Revoir le chapitre 4", "Fournir les autorisations d'illustration"] },
    });
    expect(res.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/acceptance-conditions`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().conditional).toBe(true);
    expect(list.json().total).toBe(2);
    expect(list.json().remaining).toBe(2);
    expect(list.json().items[0].label).toBe("Revoir le chapitre 4");
  });

  it("bloque le passage en production tant qu'une condition n'est pas levée, puis débloque", async () => {
    const id = await manuscriptAt("DECISION_EDITORIALE");
    await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "acceptation_conditions", motivation: "Sous réserve.", conditions: ["Condition unique à lever"] },
    });

    // Placé directement à la correction (dernière étape éditoriale, garde-fou).
    const correction = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    await prisma.manuscript.update({ where: { id }, data: { statusId: correction.id } });

    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("conditions_not_lifted");
    expect(blocked.json().missing).toContain("Condition unique à lever");

    // On lève la condition, puis on retente : le garde-fou « conditions » est
    // levé (un autre garde-fou de correction peut subsister, mais plus celui-ci).
    const cond = await prisma.editorialAcceptanceCondition.findFirstOrThrow({ where: { manuscriptId: id, deletedAt: null } });
    const lift = await app.inject({ method: "POST", url: `/api/v1/acceptance-conditions/${cond.id}/lift`, headers: { cookie }, payload: { note: "Chapitre revu." } });
    expect(lift.statusCode).toBe(200);

    const again = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(again.json().code).not.toBe("conditions_not_lifted");

    const refreshed = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/acceptance-conditions`, headers: { cookie } });
    expect(refreshed.json().remaining).toBe(0);
    expect(refreshed.json().items[0].lifted).toBe(true);
    expect(refreshed.json().items[0].lift_note).toBe("Chapitre revu.");
  });

  it("ajout, réouverture, retrait ; refuse d'ajouter hors acceptation conditionnelle", async () => {
    const id = await manuscriptAt("DECISION_EDITORIALE");
    await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "acceptation_conditions", motivation: "Sous réserve." },
    });

    // Ajout après coup (aucune condition n'avait été listée à la décision).
    const add = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/acceptance-conditions`, headers: { cookie }, payload: { label: "Ajoutée après coup" } });
    expect(add.statusCode).toBe(201);
    const condId = add.json().id;

    await app.inject({ method: "POST", url: `/api/v1/acceptance-conditions/${condId}/lift`, headers: { cookie }, payload: {} });
    const reopen = await app.inject({ method: "POST", url: `/api/v1/acceptance-conditions/${condId}/reopen`, headers: { cookie } });
    expect(reopen.statusCode).toBe(200);
    let list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/acceptance-conditions`, headers: { cookie } });
    expect(list.json().remaining).toBe(1);

    const del = await app.inject({ method: "DELETE", url: `/api/v1/acceptance-conditions/${condId}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/acceptance-conditions`, headers: { cookie } });
    expect(list.json().total).toBe(0);

    // Un manuscrit accepté sans conditions : pas d'ajout de condition possible.
    const plain = await manuscriptAt("DECISION_EDITORIALE");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${plain}/editorial-decision`, headers: { cookie }, payload: { decision: "acceptation", motivation: "OK." } });
    const refused = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${plain}/acceptance-conditions`, headers: { cookie }, payload: { label: "Interdit" } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("not_conditional");
    const plainList = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${plain}/acceptance-conditions`, headers: { cookie } });
    expect(plainList.json().conditional).toBe(false);
  });
});
