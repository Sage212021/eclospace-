import { prisma } from "./prisma.js";

// « Version à corriger » (VC1) — le dossier de départ déposé à l'étape Décision
// éditoriale, sur lequel le correcteur travaillera : le fichier manuscrit + les
// textes de couverture (1ère, dos, 4ème). Chaque emplacement = un document
// « pièce d'étape » à titre stable, comme le cycle de correction — aucune
// migration, aucune colonne dédiée.

export interface Vc1Slot {
  key: string;
  label: string;
}

export const VC1_SLOTS: Vc1Slot[] = [
  { key: "manuscrit", label: "Fichier manuscrit (à corriger)" },
  { key: "couv_1", label: "Couverture — 1ère" },
  { key: "couv_dos", label: "Couverture — dos" },
  { key: "couv_4", label: "Couverture — 4ème" },
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

// État des emplacements VC1 d'un manuscrit (dernier dépôt par emplacement).
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
  return VC1_SLOTS.map((s) => {
    const d = latestByKey.get(s.key);
    const v = d?.versions[0];
    const filename = d ? d.title.replace(/^\[vc1:[a-z0-9_]+\]\s*/, "") : null;
    return {
      key: s.key,
      label: s.label,
      has_file: Boolean(v),
      doc_id: d?.id ?? null,
      uploaded_by: d?.createdBy ?? null,
      version_id: v?.id ?? null,
      filename,
      created_at: d?.createdAt ?? null,
    };
  });
}
