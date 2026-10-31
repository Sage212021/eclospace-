import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

// ─────────────────────────────────────────────────────────────────────────
// FUSION INTELLIGENTE DE FICHES OUVRAGES
//
// Deux fiches (données anciennes, circuits MS- / LG-CAT…) désignent le MÊME
// ouvrage. On les RÉUNIT sur une seule identité PRINCIPALE, sans perte :
//   • toutes les tables rattachées à l'ouvrage (production, contrats, ISBN,
//     stock via ISBN, finance, droits, marketing, IA, pièces jointes…) sont
//     DÉPLACÉES de la fiche secondaire vers la principale ;
//   • la fiche secondaire n'est PAS détruite : suppression logique + pointeur
//     `mergedIntoId` vers la principale (son ancien numéro reste un alias) ;
//   • les CONFLITS (relations uniques déjà présentes sur la principale, clés
//     uniques composites en collision) ne sont JAMAIS écrasés : la ligne reste
//     sur la fiche secondaire et le conflit est signalé ;
//   • chaque fusion est TRACÉE (qui, quand, détail des lignes déplacées) et
//     ANNULABLE (on sait exactement quoi remettre en arrière).
//
// Les tables sont découvertes AUTOMATIQUEMENT via le DMMF Prisma (tout modèle
// portant `manuscriptId`), pour ne jamais en oublier quand le schéma évolue.
// Le JOURNAL D'AUDIT (append-only) n'est jamais déplacé.
// ─────────────────────────────────────────────────────────────────────────

export class MergeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface MergeDetails {
  moved: Record<string, string[]>; // modèle → ids déplacés vers la principale
  skipped: Record<string, string[]>; // modèle → ids laissés sur la secondaire (conflit)
  polymorphic: Record<string, string[]>; // table polymorphe → ids d'entité re-pointés
  conflicts: { model: string; reason: string }[];
  counts: Record<string, number>;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// Tables polymorphes (entityType/entityId) à re-pointer vers la principale.
// On DÉPLACE les pièces jointes/documents, notifications et exports (continuité) ;
// on NE TOUCHE PAS le journal d'audit (append-only, intégrité §13).
const POLYMORPHIC_MOVE = ["document", "notification"] as const;

// Pré-calcul (une fois) de la stratégie de déplacement par modèle rattaché.
type ModelPlan = {
  model: string;
  delegate: string;
  oneToOne: boolean; // manuscriptId est seul unique → relation 1-à-1
  compositeOtherFields: string[][]; // ensembles d'« autres » champs de clés uniques composites incluant manuscriptId
};

const MODEL_PLANS: ModelPlan[] = Prisma.dmmf.datamodel.models
  .filter((m) => m.fields.some((f) => f.name === "manuscriptId"))
  .map((m) => {
    const uniqueSets: string[][] = [];
    for (const uf of m.uniqueFields as string[][]) if (uf.includes("manuscriptId")) uniqueSets.push([...uf]);
    if (m.fields.find((f) => f.name === "manuscriptId")?.isUnique) uniqueSets.push(["manuscriptId"]);
    if (m.primaryKey?.fields?.includes("manuscriptId")) uniqueSets.push([...m.primaryKey.fields]);
    const oneToOne = uniqueSets.some((s) => s.length === 1 && s[0] === "manuscriptId");
    const compositeOtherFields = uniqueSets
      .filter((s) => s.length > 1)
      .map((s) => s.filter((f) => f !== "manuscriptId"));
    return { model: m.name, delegate: lowerFirst(m.name), oneToOne, compositeOtherFields };
  });

type Tx = Prisma.TransactionClient;
// Accès dynamique aux délégués Prisma (modèle découvert au runtime).
const del = (tx: Tx, name: string): any => (tx as unknown as Record<string, any>)[name]; // eslint-disable-line @typescript-eslint/no-explicit-any

async function moveModel(tx: Tx, plan: ModelPlan, loserId: string, keeperId: string, d: MergeDetails): Promise<void> {
  const delegate = del(tx, plan.delegate);

  // Relation 1-à-1 : si la principale en a déjà une, on garde la sienne et on
  // laisse celle de la secondaire (conflit signalé) ; sinon on déplace.
  if (plan.oneToOne) {
    const keeperHas = await delegate.findFirst({ where: { manuscriptId: keeperId }, select: { id: true } });
    const loserRows: { id: string }[] = await delegate.findMany({ where: { manuscriptId: loserId }, select: { id: true } });
    if (keeperHas) {
      if (loserRows.length) {
        d.skipped[plan.model] = loserRows.map((r) => r.id);
        d.conflicts.push({ model: plan.model, reason: "relation unique déjà présente sur la fiche principale — conservée côté principale, à arbitrer" });
      }
    } else if (loserRows.length) {
      await delegate.updateMany({ where: { manuscriptId: loserId }, data: { manuscriptId: keeperId } });
      d.moved[plan.model] = loserRows.map((r) => r.id);
    }
    return;
  }

  // Clé unique composite (ex. une étape par statut, un contributeur par rôle) :
  // on déplace ligne par ligne, en sautant celles qui entreraient en collision
  // avec une ligne déjà présente sur la principale.
  if (plan.compositeOtherFields.length) {
    const select: Record<string, boolean> = { id: true };
    for (const set of plan.compositeOtherFields) for (const f of set) select[f] = true;
    const loserRows: Record<string, unknown>[] = await delegate.findMany({ where: { manuscriptId: loserId }, select });
    const keeperRows: Record<string, unknown>[] = await delegate.findMany({ where: { manuscriptId: keeperId }, select });
    const keeperKeys = plan.compositeOtherFields.map((set) => new Set(keeperRows.map((r) => JSON.stringify(set.map((f) => r[f])))));
    const moved: string[] = [];
    const skipped: string[] = [];
    for (const row of loserRows) {
      let collides = false;
      for (let i = 0; i < plan.compositeOtherFields.length; i++) {
        const key = JSON.stringify(plan.compositeOtherFields[i].map((f) => row[f]));
        if (keeperKeys[i].has(key)) { collides = true; break; }
      }
      if (collides) skipped.push(row.id as string);
      else { moved.push(row.id as string); plan.compositeOtherFields.forEach((set, i) => keeperKeys[i].add(JSON.stringify(set.map((f) => row[f])))); }
    }
    if (moved.length) { await delegate.updateMany({ where: { id: { in: moved } }, data: { manuscriptId: keeperId } }); d.moved[plan.model] = moved; }
    if (skipped.length) { d.skipped[plan.model] = skipped; d.conflicts.push({ model: plan.model, reason: `${skipped.length} ligne(s) en collision de clé unique — conservée(s) sur la fiche secondaire` }); }
    return;
  }

  // Un-à-plusieurs simple : on déplace tout.
  const rows: { id: string }[] = await delegate.findMany({ where: { manuscriptId: loserId }, select: { id: true } });
  if (rows.length) {
    await delegate.updateMany({ where: { manuscriptId: loserId }, data: { manuscriptId: keeperId } });
    d.moved[plan.model] = rows.map((r) => r.id);
  }
}

// Fusionne la fiche `loserId` DANS `keeperId`. Lève MergeError en cas de refus.
export async function mergeManuscripts(params: { keeperId: string; loserId: string; userId: string }): Promise<{ mergeId: string; details: MergeDetails }> {
  const { keeperId, loserId, userId } = params;
  if (keeperId === loserId) throw new MergeError("same_fiche", "On ne fusionne pas une fiche avec elle-même.");

  const [keeper, loser] = await Promise.all([
    prisma.manuscript.findFirst({ where: { id: keeperId, deletedAt: null }, select: { id: true, sealedAt: true, title: true, manuscriptNumber: true } }),
    prisma.manuscript.findFirst({ where: { id: loserId, deletedAt: null }, select: { id: true, sealedAt: true, title: true, manuscriptNumber: true, mergedIntoId: true } }),
  ]);
  if (!keeper) throw new MergeError("keeper_not_found", "La fiche principale est introuvable (ou déjà supprimée).");
  if (!loser) throw new MergeError("loser_not_found", "La fiche à fusionner est introuvable (ou déjà supprimée/fusionnée).");
  if (keeper.sealedAt || loser.sealedAt) throw new MergeError("sealed", "Une des fiches est scellée (archivage définitif). Rouvrez-la avant de fusionner.");

  const details: MergeDetails = { moved: {}, skipped: {}, polymorphic: {}, conflicts: [], counts: {} };

  const mergeId = await prisma.$transaction(async (tx) => {
    // 1) Toutes les tables rattachées par `manuscriptId` (découvertes au runtime).
    for (const plan of MODEL_PLANS) await moveModel(tx, plan, loserId, keeperId, details);

    // 2) Tables polymorphes à re-pointer (pièces jointes/documents, notifications,
    //    exports) — JAMAIS le journal d'audit (append-only).
    for (const table of POLYMORPHIC_MOVE) {
      const delegate = del(tx, table);
      const rows: { id: string }[] = await delegate.findMany({ where: { entityType: "manuscript", entityId: loserId }, select: { id: true } });
      if (rows.length) {
        await delegate.updateMany({ where: { entityType: "manuscript", entityId: loserId }, data: { entityId: keeperId } });
        details.polymorphic[table] = rows.map((r) => r.id);
      }
    }

    for (const k of Object.keys(details.moved)) details.counts[k] = details.moved[k].length;

    // 3) Fiche secondaire : suppression LOGIQUE + alias vers la principale.
    await tx.manuscript.update({ where: { id: loserId }, data: { deletedAt: new Date(), deletedBy: userId, mergedIntoId: keeperId, updatedBy: userId } });

    // 4) Journal de fusion (traçabilité + annulation).
    const op = await tx.manuscriptMerge.create({ data: { keeperId, loserId, details: details as unknown as Prisma.InputJsonValue, performedBy: userId } });
    return op.id;
  }, { timeout: 30000, maxWait: 10000 });

  return { mergeId, details };
}

// Annule une fusion : remet les lignes déplacées sur la fiche secondaire et la
// réactive. Best-effort sur les ids enregistrés ; réservé à l'administration.
export async function undoManuscriptMerge(mergeId: string, userId: string): Promise<{ loserId: string; keeperId: string }> {
  const op = await prisma.manuscriptMerge.findUnique({ where: { id: mergeId } });
  if (!op) throw new MergeError("merge_not_found", "Fusion introuvable.");
  if (op.undoneAt) throw new MergeError("already_undone", "Cette fusion a déjà été annulée.");
  const d = op.details as unknown as MergeDetails;

  await prisma.$transaction(async (tx) => {
    for (const [model, ids] of Object.entries(d.moved ?? {})) {
      if (!ids.length) continue;
      const delegate = del(tx, lowerFirst(model));
      await delegate.updateMany({ where: { id: { in: ids } }, data: { manuscriptId: op.loserId } });
    }
    for (const [table, ids] of Object.entries(d.polymorphic ?? {})) {
      if (!ids.length) continue;
      await del(tx, table).updateMany({ where: { id: { in: ids } }, data: { entityId: op.loserId } });
    }
    // Réactive la fiche secondaire (retire l'alias et la suppression logique).
    await tx.manuscript.update({ where: { id: op.loserId }, data: { deletedAt: null, deletedBy: null, mergedIntoId: null, updatedBy: userId } });
    await tx.manuscriptMerge.update({ where: { id: mergeId }, data: { undoneAt: new Date(), undoneBy: userId } });
  }, { timeout: 30000, maxWait: 10000 });

  return { loserId: op.loserId, keeperId: op.keeperId };
}
