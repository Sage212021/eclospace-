import { prisma } from "./prisma.js";

// ─────────────────────────────────────────────────────────────────────────
// Audit INTERNE du catalogue Éclospace (demande opérateur « Audit du catalogue
// Éclospace », section 15). SAGE passe en revue les fiches réelles de l'ERP et
// SIGNALE les manques et anomalies, sans RIEN inventer et sans RIEN modifier :
// le calcul est 100 % déterministe (lecture seule). Chaque constat nomme
// l'ouvrage, l'information actuelle, la correction proposée, le motif et la
// priorité. Les changements sensibles (prix, ISBN, droits, statut) restent
// soumis à validation humaine. La comparaison avec le site public eclosion.cm
// n'est PAS incluse ici (étape ultérieure, sous réserve de l'accès technique).
// ─────────────────────────────────────────────────────────────────────────

export type AuditPriority = "urgent" | "important" | "mineur";
export type AuditCategory = "urgentes" | "editoriales" | "commerciales" | "presentation" | "a_confirmer";

export interface AuditFinding {
  category: AuditCategory;
  priority: AuditPriority;
  manuscript_id: string;
  manuscript_ref: string;
  manuscript_title: string;
  field: string; // information concernée
  current: string; // information actuelle
  suggestion: string; // modification proposée
  reason: string; // motif
}

export interface CatalogueAudit {
  generated_at: string;
  total_manuscripts: number;
  counts: Record<AuditCategory, number>;
  findings: AuditFinding[];
  note: string;
}

// En dessous de ce seuil, un résumé est jugé trop court pour valoriser l'ouvrage.
const SUMMARY_MIN = 120;

// Normalise un titre pour la détection de doublons (minuscules, sans accents).
function norm(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

function push(list: AuditFinding[], f: AuditFinding): void {
  list.push(f);
}

export async function runCatalogueAudit(): Promise<CatalogueAudit> {
  const manuscripts = await prisma.manuscript.findMany({
    where: { deletedAt: null },
    select: {
      id: true, manuscriptNumber: true, title: true, summary: true, keywords: true,
      genreId: true, publicationDate: true, isBackCatalogue: true,
      workContributors: { where: { role: "author" }, select: { partner: { select: { firstName: true, lastName: true, bio: true } } } },
      isbns: { select: { isbn13: true, status: true, priceList: { select: { id: true }, take: 1 } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Couvertures / visuels déposés par ouvrage (document, suppression logique).
  const coverDocs = await prisma.document.groupBy({
    by: ["entityId"],
    where: { entityType: "manuscript", category: { in: ["couverture", "visuel"] }, deletedAt: null },
    _count: { _all: true },
  });
  const hasCover = new Set(coverDocs.map((d) => d.entityId));

  const findings: AuditFinding[] = [];

  // Index des doublons (titre normalisé identique, ISBN13 attribué partagé).
  const byTitle = new Map<string, { ref: string; title: string; id: string }[]>();
  const byIsbn = new Map<string, { ref: string; title: string; id: string }[]>();

  for (const m of manuscripts) {
    const published = !!m.publicationDate || m.isBackCatalogue;
    const assignedIsbns = m.isbns.filter((i) => i.status === "assigned");
    const base = { manuscript_id: m.id, manuscript_ref: m.manuscriptNumber, manuscript_title: m.title };

    const tk = norm(m.title);
    if (tk) {
      const arr = byTitle.get(tk) ?? [];
      arr.push({ ref: m.manuscriptNumber, title: m.title, id: m.id });
      byTitle.set(tk, arr);
    }
    for (const i of assignedIsbns) {
      const arr = byIsbn.get(i.isbn13) ?? [];
      arr.push({ ref: m.manuscriptNumber, title: m.title, id: m.id });
      byIsbn.set(i.isbn13, arr);
    }

    // Auteur manquant (urgent : une fiche sans auteur est trompeuse).
    if (m.workContributors.length === 0) {
      push(findings, { ...base, category: "urgentes", priority: "urgent", field: "Auteur", current: "Aucun auteur rattaché", suggestion: "Rattacher le ou les auteurs de l'ouvrage.", reason: "Une fiche sans auteur est incomplète et peut induire le lecteur en erreur." });
    }

    // Résumé manquant ou trop court (éditorial).
    const sum = (m.summary ?? "").trim();
    if (!sum) {
      push(findings, { ...base, category: "editoriales", priority: "important", field: "Résumé", current: "Absent", suggestion: "Rédiger un résumé attractif adapté au lectorat cible.", reason: "Le résumé est essentiel à la présentation et à la vente de l'ouvrage." });
    } else if (sum.length < SUMMARY_MIN) {
      push(findings, { ...base, category: "editoriales", priority: "mineur", field: "Résumé", current: `Très court (${sum.length} caractères)`, suggestion: "Enrichir le résumé pour mieux valoriser l'ouvrage.", reason: "Un résumé trop court met mal l'ouvrage en valeur." });
    }

    // Genre / catégorie manquant (éditorial).
    if (!m.genreId) {
      push(findings, { ...base, category: "editoriales", priority: "important", field: "Genre / catégorie", current: "Non renseigné", suggestion: "Classer l'ouvrage dans une catégorie littéraire.", reason: "La catégorie structure le catalogue et la navigation." });
    }

    // Biographie d'auteur manquante (éditorial).
    const missingBio = m.workContributors.filter((w) => !(w.partner.bio ?? "").trim());
    if (m.workContributors.length > 0 && missingBio.length > 0) {
      const names = missingBio.map((w) => `${w.partner.firstName ?? ""} ${w.partner.lastName ?? ""}`.trim() || "auteur").join(", ");
      push(findings, { ...base, category: "editoriales", priority: "mineur", field: "Biographie de l'auteur", current: `Manquante (${names})`, suggestion: "Compléter la biographie de l'auteur.", reason: "La biographie renforce la crédibilité et l'intérêt de la fiche." });
    }

    // Mots-clés absents (présentation / référencement).
    if ((m.keywords ?? []).length === 0) {
      push(findings, { ...base, category: "presentation", priority: "mineur", field: "Mots-clés", current: "Aucun", suggestion: "Ajouter des mots-clés pour le référencement.", reason: "Les mots-clés améliorent la visibilité dans les recherches." });
    }

    // Couverture / visuel manquant (présentation).
    if (!hasCover.has(m.id)) {
      push(findings, { ...base, category: "presentation", priority: published ? "important" : "mineur", field: "Couverture / visuel", current: "Aucune image déposée", suggestion: "Déposer la couverture (ou un visuel) de l'ouvrage.", reason: "La couverture est déterminante pour la présentation et la vente." });
    }

    // Ouvrage paru / au catalogue : vérifications commerciales.
    if (published) {
      if (assignedIsbns.length === 0) {
        push(findings, { ...base, category: "commerciales", priority: "urgent", field: "ISBN", current: "Aucun ISBN attribué alors que l'ouvrage est paru", suggestion: "Attribuer un ISBN (modification sensible : à confirmer par une personne autorisée).", reason: "Un ouvrage commercialisé doit porter un ISBN." });
      } else if (assignedIsbns.every((i) => i.priceList.length === 0)) {
        push(findings, { ...base, category: "commerciales", priority: "important", field: "Prix", current: "Aucun prix enregistré", suggestion: "Enregistrer le prix (modification sensible : validation requise).", reason: "Un ouvrage en vente doit avoir un prix renseigné." });
      }
    } else if (assignedIsbns.length > 0 && !m.publicationDate) {
      // Un ISBN attribué sans date de parution : à confirmer (volontaire ou oubli ?).
      push(findings, { ...base, category: "a_confirmer", priority: "mineur", field: "Date de parution", current: "ISBN attribué mais aucune date de parution", suggestion: "Confirmer si l'ouvrage est paru et renseigner la date, ou laisser en l'état si c'est volontaire.", reason: "Écart possible entre l'attribution d'ISBN et le statut de parution." });
    }
  }

  // Doublons de titre.
  for (const group of byTitle.values()) {
    if (group.length > 1) {
      for (const g of group) {
        const others = group.filter((x) => x.id !== g.id).map((x) => x.ref).join(", ");
        push(findings, { manuscript_id: g.id, manuscript_ref: g.ref, manuscript_title: g.title, category: "urgentes", priority: "urgent", field: "Doublon de titre", current: `Titre identique à : ${others}`, suggestion: "Vérifier s'il s'agit de fiches en double à fusionner ou d'éditions distinctes.", reason: "Des titres identiques peuvent signaler des doublons dans le catalogue." });
      }
    }
  }
  // ISBN partagé entre plusieurs ouvrages.
  for (const [isbn13, group] of byIsbn.entries()) {
    if (group.length > 1) {
      for (const g of group) {
        push(findings, { manuscript_id: g.id, manuscript_ref: g.ref, manuscript_title: g.title, category: "urgentes", priority: "urgent", field: "ISBN partagé", current: `ISBN ${isbn13} attribué à ${group.length} ouvrages`, suggestion: "Un ISBN ne doit identifier qu'un seul ouvrage/format : corriger l'attribution.", reason: "Un ISBN dupliqué est une anomalie bibliographique." });
      }
    }
  }

  const counts: Record<AuditCategory, number> = { urgentes: 0, editoriales: 0, commerciales: 0, presentation: 0, a_confirmer: 0 };
  for (const f of findings) counts[f.category]++;

  // Tri : priorité (urgent → mineur), puis catégorie, puis référence.
  const prioRank: Record<AuditPriority, number> = { urgent: 0, important: 1, mineur: 2 };
  findings.sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || a.category.localeCompare(b.category) || a.manuscript_ref.localeCompare(b.manuscript_ref));

  return {
    generated_at: new Date().toISOString(),
    total_manuscripts: manuscripts.length,
    counts,
    findings,
    note: "Audit INTERNE du catalogue Éclospace (données réelles, lecture seule). Aucune donnée n'a été modifiée ni inventée. Les changements sensibles (prix, ISBN, droits, statut commercial) doivent être confirmés par une personne autorisée. La comparaison avec le site public eclosion.cm n'est pas incluse ici.",
  };
}
