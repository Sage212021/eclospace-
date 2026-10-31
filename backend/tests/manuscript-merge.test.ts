import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Fusion intelligente de fiches ouvrages : déplacement sans perte, gestion des
// conflits (relation unique déjà présente, clé composite en collision),
// documents polymorphes re-pointés, alias + annulation.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Fusion de fiches ouvrages", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let statuses: { id: string }[];

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    statuses = await prisma.workflowStatus.findMany({ take: 3, orderBy: { stepOrder: "asc" }, select: { id: true } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const mkManuscript = (title: string) =>
    prisma.manuscript.create({ data: { manuscriptNumber: `MG-${rnd()}${rnd()}`, title, statusId: statuses[0].id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() } });

  it("fusionne sans perte, gère les conflits, pose l'alias — puis s'annule", async () => {
    const keeper = await mkManuscript(`Fusion Principale ${rnd()}`);
    const loser = await mkManuscript(`Fusion Secondaire ${rnd()}`);
    const [SA, SB] = [statuses[1].id, statuses[2].id];

    // KEEPER : une étape (statut SA), une métadonnée (relation 1-à-1).
    await prisma.manuscriptStep.create({ data: { manuscriptId: keeper.id, statusId: SA } });
    await prisma.workMetadata.create({ data: { manuscriptId: keeper.id, summary: "méta principale" } });

    // LOSER : étape SA (collision avec keeper → reste), étape SB (déplaçable),
    // une couverture (1-à-plusieurs → déplacée), une métadonnée (conflit 1-à-1),
    // un document (polymorphe → re-pointé).
    const stepCollide = await prisma.manuscriptStep.create({ data: { manuscriptId: loser.id, statusId: SA } });
    const stepMove = await prisma.manuscriptStep.create({ data: { manuscriptId: loser.id, statusId: SB } });
    const img = await prisma.imageAsset.create({ data: { manuscriptId: loser.id, type: "couverture_1" } });
    const metaLoser = await prisma.workMetadata.create({ data: { manuscriptId: loser.id, summary: "méta secondaire" } });
    const doc = await prisma.document.create({ data: { entityType: "manuscript", entityId: loser.id, category: "piece_etape", title: "Pièce du doublon", createdBy: adminId } });

    // Fusion.
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${keeper.id}/merge`, headers: { cookie }, payload: { loser_id: loser.id } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.merged).toBe(true);
    expect(body.counts.ImageAsset).toBe(1);
    expect(body.counts.ManuscriptStep).toBe(1); // seule l'étape SB a été déplacée
    const conflictModels = (body.conflicts as { model: string }[]).map((c) => c.model);
    expect(conflictModels).toContain("WorkMetadata"); // 1-à-1 déjà présent
    expect(conflictModels).toContain("ManuscriptStep"); // SA en collision

    // Déplacements effectifs.
    expect((await prisma.imageAsset.findUniqueOrThrow({ where: { id: img.id } })).manuscriptId).toBe(keeper.id);
    expect((await prisma.manuscriptStep.findUniqueOrThrow({ where: { id: stepMove.id } })).manuscriptId).toBe(keeper.id);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).entityId).toBe(keeper.id);
    // Conflits conservés sur la secondaire (jamais écrasés).
    expect((await prisma.manuscriptStep.findUniqueOrThrow({ where: { id: stepCollide.id } })).manuscriptId).toBe(loser.id);
    expect((await prisma.workMetadata.findUniqueOrThrow({ where: { id: metaLoser.id } })).manuscriptId).toBe(loser.id);
    // La métadonnée de la principale est intacte.
    expect((await prisma.workMetadata.findFirstOrThrow({ where: { manuscriptId: keeper.id } })).summary).toBe("méta principale");
    // Fiche secondaire : suppression logique + alias.
    const loserAfter = await prisma.manuscript.findUniqueOrThrow({ where: { id: loser.id } });
    expect(loserAfter.deletedAt).not.toBeNull();
    expect(loserAfter.mergedIntoId).toBe(keeper.id);

    // ── Annulation ──
    const undo = await app.inject({ method: "POST", url: `/api/v1/manuscripts/merges/${body.merge_id}/undo`, headers: { cookie } });
    expect(undo.statusCode).toBe(200);
    expect((await prisma.imageAsset.findUniqueOrThrow({ where: { id: img.id } })).manuscriptId).toBe(loser.id);
    expect((await prisma.manuscriptStep.findUniqueOrThrow({ where: { id: stepMove.id } })).manuscriptId).toBe(loser.id);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).entityId).toBe(loser.id);
    const loserRestored = await prisma.manuscript.findUniqueOrThrow({ where: { id: loser.id } });
    expect(loserRestored.deletedAt).toBeNull();
    expect(loserRestored.mergedIntoId).toBeNull();
  });

  it("refuse de fusionner une fiche avec elle-même (409)", async () => {
    const m = await mkManuscript(`Fusion Solo ${rnd()}`);
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/merge`, headers: { cookie }, payload: { loser_id: m.id } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("same_fiche");
  });

  it("refuse si la fiche à fusionner est introuvable (409)", async () => {
    const keeper = await mkManuscript(`Fusion Keeper ${rnd()}`);
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${keeper.id}/merge`, headers: { cookie }, payload: { loser_id: "00000000-0000-0000-0000-000000000000" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("loser_not_found");
  });
});
