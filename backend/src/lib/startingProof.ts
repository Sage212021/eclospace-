import { prisma } from "./prisma.js";

// « Version à corriger » (VC1) — le dossier de départ déposé à l'étape
// Planification du projet, sur lequel le correcteur travaillera. Deux points
// seulement (demande opérateur 26/08/2026) : le manuscrit à corriger, et les
// couvertures à corriger réunies en UN SEUL fichier (1ère + dos + 4ème). Chaque
// emplacement = un document « pièce d'étape » à titre stable, comme le cycle de
// correction — aucune migration, aucune colonne dédiée.

export interface Vc1Slot {
  key: string;
  label: string;
}

export const VC1_SLOTS: Vc1Slot[] = [
  { key: "manuscrit", label: "Manuscrit à corriger" },
  { key: "couvertures", label: "Couvertures à corriger (1ère, dos, 4ème — un seul fichier)" },
];

const KEYS = new Set(VC1_SLOTS.map((s) => s.key));
export function isVc1Slot(key: string): boolean {
  return KEYS.has(key);
}

const PREFIX = "[vc1:";
export function vc1DocTitle(key: string, filename: string): string {
  return `${PREFIX}${key}] ${filename}`.slice(0, 200);
}
export function parseVc1SlotKey(title: string): string | null {
  const m = /^\[vc1:([a-z0-9_]+)\]/.exec(title);
  return m ? m[1] : null;
}

// Repli « dossier » quand aucun VC1 n'a été déposé explicitement : on montre la
// matière RÉELLE déjà au dossier que la correction utilise par défaut (cf.
// aiSourceChain) — le manuscrit déposé à la réception, et un fichier de
// couverture s'il existe. Ainsi le bloc « Version à corriger » n'est jamais
// mystérieusement vide quand la correction a bel et bien eu lieu.
const VC1_FALLBACK_CATEGORY: Record<string, string | null> = {
  manuscrit: "manuscrit",
  couvertures: "couverture",
};

// État des emplacements VC1 d'un manuscrit (dernier dépôt par emplacement).
// Sans dépôt explicite, repli sur le document correspondant déjà au dossier
// (from_dossier = true : lecture seule, pas de retrait depuis ce bloc).
export async function vc1State(manuscriptId: string) {
  const docs = await prisma.document.findMany({
    where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", deletedAt: null, title: { startsWith: PREFIX } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true, createdBy: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, fileSize: true, mimeType: true } } },
  });
  const latestByKey = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    const key = parseVc1SlotKey(d.title);
    if (key && !latestByKey.has(key)) latestByKey.set(key, d);
  }
  const out = [];
  for (const s of VC1_SLOTS) {
    const d = latestByKey.get(s.key);
    if (d) {
      const v = d.versions[0];
      out.push({
        key: s.key,
        label: s.label,
        has_file: Boolean(v),
        from_dossier: false,
        doc_id: d.id,
        uploaded_by: d.createdBy,
        version_id: v?.id ?? null,
        filename: d.title.replace(/^\[vc1:[a-z0-9_]+\]\s*/, ""),
        created_at: d.createdAt,
      });
      continue;
    }
    // Pas de VC1 déposé pour cet emplacement : repli sur le dossier.
    const cat = VC1_FALLBACK_CATEGORY[s.key];
    const fb = cat
      ? await prisma.document.findFirst({
          where: { entityType: "manuscript", entityId: manuscriptId, category: cat as never, deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, createdAt: true, createdBy: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } },
        })
      : null;
    const v = fb?.versions[0];
    out.push({
      key: s.key,
      label: s.label,
      has_file: Boolean(v),
      from_dossier: Boolean(v),
      doc_id: fb?.id ?? null,
      uploaded_by: fb?.createdBy ?? null,
      version_id: v?.id ?? null,
      filename: fb?.title ?? null,
      created_at: fb?.createdAt ?? null,
    });
  }
  return out;
}
