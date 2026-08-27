import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, seedManuscriptSourceFile } from "./helpers.js";

// Réponse à l'auteur à la décision éditoriale (audit éditorial, point n°1) : une
// lettre est adressée à l'auteur pour toute décision terminale, à partir de
// modèles éditables, et l'envoi est tracé sur la décision.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("réponse à l'auteur à la décision éditoriale", () => {
  let app: FastifyInstance;
  let cookie: string;
  let genreId: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app);
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    genreId = (await prisma.genre.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Amène un manuscrit jusqu'à la décision éditoriale, avec un auteur qui a un e-mail.
  async function manuscriptAtDecision(authorEmail: string | null) {
    const create = await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title: `Lettre ${rnd()}`, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais",
        author: { first_name: "Awa", last_name: "Ndiaye", email: authorEmail ?? undefined, id_type: "CNI", id_number: "100200300" } },
    });
    const m = create.json();
    await seedManuscriptSourceFile(m.id);
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/VERIF_ADMIN/validate`, headers: { cookie }, payload: {} });
    const assign = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/reading-assignments`, headers: { cookie }, payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" } });
    const criteria = await prisma.evaluationCriterion.findMany();
    await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assign.json().id}/evaluation`, headers: { cookie }, payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 8 })), recommendation: "accept" } });
    return m.id as string;
  }

  it("expose les modèles de lettres (défauts) et les rend modifiables", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial-decision-letters", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().keys).toEqual(["acceptation", "acceptation_conditions", "refus"]);
    expect(res.json().templates.refus.subject).toContain("{{titre}}");

    const put = await app.inject({ method: "PUT", url: "/api/v1/editorial-decision-letters", headers: { cookie }, payload: { refus: { subject: "Réponse — {{titre}}", body: "Bonjour {{auteur}}, refus pour {{numero}}. {{maison}}" } } });
    expect(put.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/v1/editorial-decision-letters", headers: { cookie } });
    expect(after.json().templates.refus.subject).toBe("Réponse — {{titre}}");
  });

  it("à l'acceptation, adresse une lettre à l'auteur et trace l'envoi", async () => {
    const id = await manuscriptAtDecision("awa@example.com");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie }, payload: { decision: "acceptation", motivation: "Texte prometteur." } });
    expect(res.statusCode).toBe(201);
    expect(res.json().authorNotifiedTo).toBe("awa@example.com");

    const decision = await prisma.editorialDecision.findFirstOrThrow({ where: { manuscriptId: id } });
    expect(decision.authorNotifiedTo).toBe("awa@example.com");
    expect(decision.authorNotifiedAt).toBeTruthy();

    // Aperçu / réimpression de la lettre, avec les balises remplacées.
    const letter = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/decision-letter`, headers: { cookie } });
    expect(letter.statusCode).toBe(200);
    expect(letter.json().subject).not.toContain("{{titre}}");
    expect(letter.json().body).toContain("Awa Ndiaye");
  });

  it("sans e-mail auteur, la décision passe mais aucune lettre n'est adressée", async () => {
    // Dossier placé directement à la décision, avec un auteur SANS e-mail (cas
    // limite : le parcours normal exige les coordonnées auteur plus tôt).
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "DECISION_EDITORIALE" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-NOMAIL-${rnd()}`, title: "Sans e-mail", statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() } });
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Sans", lastName: "Email" } });
    await prisma.workContributor.create({ data: { manuscriptId: m.id, partnerId: partner.id, role: "author", displayOrder: 0 } });

    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/editorial-decision`, headers: { cookie }, payload: { decision: "refus", motivation: "Hors ligne éditoriale." } });
    expect(res.statusCode).toBe(201);
    expect(res.json().authorNotifiedTo).toBeNull();
    const decision = await prisma.editorialDecision.findFirstOrThrow({ where: { manuscriptId: m.id } });
    expect(decision.authorNotifiedTo).toBeNull();
  });
});
