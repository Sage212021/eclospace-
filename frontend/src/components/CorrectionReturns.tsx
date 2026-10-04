import { useEffect, useState } from "react";
import { getCorrectionCycle, getCoverCorrectionCycle, stepAttachmentDownloadUrl, type CorrectionPhaseState } from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

// Retours de correction, en LECTURE SEULE, consultables sur la fiche globale
// APRÈS l'étape Correction (en production, stock…) : on voit ce que le correcteur
// a produit/transmis — TEXTE (rapport, versions intégrées, VCF) et COUVERTURE
// (rapports, couverture corrigée finale) — avec date, auteur et version, sans
// l'outillage de dépôt. Essentiel pour le maquettiste : texte final + couverture
// finale. Le composant s'efface de lui-même s'il n'y a aucun retour.
export function CorrectionReturns({ manuscriptId }: { manuscriptId: string }) {
  const [phases, setPhases] = useState<{ from: "texte" | "couverture"; p: CorrectionPhaseState }[] | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getCorrectionCycle(manuscriptId).catch(() => [] as CorrectionPhaseState[]),
      getCoverCorrectionCycle(manuscriptId).catch(() => [] as CorrectionPhaseState[]),
    ]).then(([txt, cov]) => {
      if (!alive) return;
      const rows: { from: "texte" | "couverture"; p: CorrectionPhaseState }[] = [];
      for (const p of txt) if (p.has_file) rows.push({ from: "texte", p });
      for (const p of cov) if (p.has_file) rows.push({ from: "couverture", p });
      setPhases(rows);
    });
    return () => { alive = false; };
  }, [manuscriptId]);

  const returns = phases ?? [];
  if (returns.length === 0) return null;

  return (
    <CollapsibleSection
      title="Retours de correction"
      subtitle="Ce que le correcteur a transmis pour cet ouvrage — consultable à tout moment."
      storageKey="fiche:retours-correction"
    >
      <div style={{ display: "grid", gap: 8 }}>
        {returns.map(({ from, p }) => (
          <div key={`${from}:${p.key}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "1px 8px", marginRight: 6, background: from === "couverture" ? "#E7EAF0" : "var(--paper, #FAF8F2)", color: "#5B6472" }}>{from === "couverture" ? "Couverture" : "Texte"}</span>
                {p.label}
              </div>
              <a href={stepAttachmentDownloadUrl(manuscriptId, p.version_id!)} download style={{ fontSize: 12, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 600 }}>
                ⬇️ {p.filename ?? "Télécharger le fichier"}
              </a>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {[
                  p.created_at ? `Transmis le ${new Date(p.created_at).toLocaleDateString("fr-FR")}` : null,
                  p.uploaded_by_name ? `par ${p.uploaded_by_name}` : null,
                  p.version_number ? `v${p.version_number}` : null,
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
