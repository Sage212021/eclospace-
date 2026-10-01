import { prisma } from "./prisma.js";
import type { Prisma, PrismaClient } from "@prisma/client";

// Entité « Cycle de correction éditoriale » (demande opérateur 01/10/2026).
//
// Un cycle reste OUVERT à travers tous les allers-retours (correcteur → éditeur →
// infographe → …) jusqu'à la validation finale de l'étape Correction. Chaque
// échange est historisé comme un MOUVEMENT (pas un nouveau cycle). Un ouvrage =
// un seul cycle actif à la fois ; après clôture, un nouveau cycle (#2…) peut
// être ouvert. La référence (ex. COR-2026-001) identifie le cycle.

type Db = PrismaClient | Prisma.TransactionClient;

export type MovementKind = "opened" | "deposit" | "reassign" | "closed" | "note";

export interface MovementInput {
  kind: MovementKind;
  userId?: string | null;
  userRole?: string | null;
  recipientId?: string | null;
  motive?: string | null;
  observations?: string | null;
  documentVersionId?: string | null;
  stepStatus?: string | null;
}

// Référence lisible COR-AAAA-NNN, NNN = compteur ANNUEL global (tous ouvrages),
// remis à zéro chaque année civile. Immuable une fois attribuée.
async function nextReference(db: Db, when: Date): Promise<string> {
  const year = when.getFullYear();
  const prefix = `COR-${year}-`;
  const last = await db.correctionCycle.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const lastSeq = last ? Number.parseInt(last.reference.slice(prefix.length), 10) : 0;
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// Cycle actif (en_cours) d'un ouvrage, avec ses mouvements (anté-chronologiques).
export function openCorrectionCycle(manuscriptId: string, db: Db = prisma) {
  return db.correctionCycle.findFirst({
    where: { manuscriptId, status: "en_cours" },
    include: { movements: { orderBy: { at: "desc" } } },
  });
}

// Ouvre un cycle si aucun n'est actif, sinon renvoie l'actif. Idempotent :
// garantit « un ouvrage = un seul cycle actif ». Enregistre le mouvement
// d'ouverture lors de la création.
export async function ensureOpenCorrectionCycle(
  manuscriptId: string,
  opener: { userId?: string | null; userRole?: string | null },
  db: Db = prisma,
) {
  const existing = await db.correctionCycle.findFirst({ where: { manuscriptId, status: "en_cours" } });
  if (existing) return existing;

  const now = new Date();
  const agg = await db.correctionCycle.aggregate({ where: { manuscriptId }, _max: { cycleNumber: true } });
  const cycleNumber = (agg._max.cycleNumber ?? 0) + 1;
  const reference = await nextReference(db, now);

  return db.correctionCycle.create({
    data: {
      manuscriptId,
      cycleNumber,
      reference,
      status: "en_cours",
      openedAt: now,
      openedBy: opener.userId ?? null,
      movements: {
        create: {
          kind: "opened",
          at: now,
          userId: opener.userId ?? null,
          userRole: opener.userRole ?? null,
        },
      },
    },
  });
}

// Historise un mouvement sur le cycle ACTIF de l'ouvrage. Ouvre le cycle au
// besoin (premier dépôt). Ne fait rien si le cycle a déjà été clôturé entre-temps
// pour une action d'ouverture — mais un dépôt rouvre toujours un cycle actif.
export async function recordCorrectionMovement(
  manuscriptId: string,
  mv: MovementInput,
  db: Db = prisma,
) {
  const cycle = await ensureOpenCorrectionCycle(
    manuscriptId,
    { userId: mv.userId, userRole: mv.userRole },
    db,
  );
  await db.correctionCycleMovement.create({
    data: {
      cycleId: cycle.id,
      kind: mv.kind,
      userId: mv.userId ?? null,
      userRole: mv.userRole ?? null,
      recipientId: mv.recipientId ?? null,
      motive: mv.motive ?? null,
      observations: mv.observations ?? null,
      documentVersionId: mv.documentVersionId ?? null,
      stepStatus: mv.stepStatus ?? null,
    },
  });
  return cycle;
}

// Historise un mouvement UNIQUEMENT s'il existe déjà un cycle actif ; ne crée
// jamais de cycle. Pour les dépôts de couverture, qui peuvent survenir après la
// clôture de la correction (branche infographe, pendant l'étape Infographie) —
// on ne veut alors PAS rouvrir un cycle de correction fantôme.
export async function recordCorrectionMovementIfOpen(
  manuscriptId: string,
  mv: MovementInput,
  db: Db = prisma,
) {
  const cycle = await db.correctionCycle.findFirst({ where: { manuscriptId, status: "en_cours" } });
  if (!cycle) return null;
  await db.correctionCycleMovement.create({
    data: {
      cycleId: cycle.id,
      kind: mv.kind,
      userId: mv.userId ?? null,
      userRole: mv.userRole ?? null,
      recipientId: mv.recipientId ?? null,
      motive: mv.motive ?? null,
      observations: mv.observations ?? null,
      documentVersionId: mv.documentVersionId ?? null,
      stepStatus: mv.stepStatus ?? null,
    },
  });
  return cycle;
}

// Clôture le cycle actif (validation finale de l'étape Correction). Enregistre le
// mouvement de clôture (qui, quand, version finale, observations) et passe le
// statut à TERMINÉE. Sans effet s'il n'y a pas de cycle actif.
export async function closeCorrectionCycle(
  manuscriptId: string,
  closer: {
    userId?: string | null;
    userRole?: string | null;
    finalVersionId?: string | null;
    closureNote?: string | null;
    stepStatus?: string | null;
  },
  db: Db = prisma,
) {
  const cycle = await db.correctionCycle.findFirst({ where: { manuscriptId, status: "en_cours" } });
  if (!cycle) return null;
  const now = new Date();
  const [updated] = await Promise.all([
    db.correctionCycle.update({
      where: { id: cycle.id },
      data: {
        status: "terminee",
        closedAt: now,
        closedBy: closer.userId ?? null,
        closureNote: closer.closureNote ?? null,
        finalVersionId: closer.finalVersionId ?? null,
      },
    }),
    db.correctionCycleMovement.create({
      data: {
        cycleId: cycle.id,
        kind: "closed",
        at: now,
        userId: closer.userId ?? null,
        userRole: closer.userRole ?? null,
        documentVersionId: closer.finalVersionId ?? null,
        observations: closer.closureNote ?? null,
        stepStatus: closer.stepStatus ?? null,
      },
    }),
  ]);
  return updated;
}

// Tous les cycles d'un ouvrage (le plus récent d'abord) avec mouvements enrichis
// des noms d'utilisateurs/destinataires pour l'affichage.
export async function listCorrectionCycles(manuscriptId: string, db: Db = prisma) {
  const cycles = await db.correctionCycle.findMany({
    where: { manuscriptId },
    orderBy: { cycleNumber: "desc" },
    include: { movements: { orderBy: { at: "asc" } } },
  });

  const userIds = new Set<string>();
  for (const c of cycles) {
    if (c.openedBy) userIds.add(c.openedBy);
    if (c.closedBy) userIds.add(c.closedBy);
    for (const m of c.movements) {
      if (m.userId) userIds.add(m.userId);
      if (m.recipientId) userIds.add(m.recipientId);
    }
  }
  const users = userIds.size
    ? await db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, username: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.username]));
  const label = (id: string | null) => (id ? nameById.get(id) ?? null : null);

  return cycles.map((c) => ({
    id: c.id,
    cycleNumber: c.cycleNumber,
    reference: c.reference,
    status: c.status,
    openedAt: c.openedAt,
    openedBy: c.openedBy,
    openedByName: label(c.openedBy),
    closedAt: c.closedAt,
    closedBy: c.closedBy,
    closedByName: label(c.closedBy),
    closureNote: c.closureNote,
    finalVersionId: c.finalVersionId,
    movements: c.movements.map((m) => ({
      id: m.id,
      at: m.at,
      kind: m.kind,
      userId: m.userId,
      userName: label(m.userId),
      userRole: m.userRole,
      recipientId: m.recipientId,
      recipientName: label(m.recipientId),
      motive: m.motive,
      observations: m.observations,
      documentVersionId: m.documentVersionId,
      stepStatus: m.stepStatus,
    })),
  }));
}
