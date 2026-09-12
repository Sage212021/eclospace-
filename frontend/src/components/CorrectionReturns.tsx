import { useEffect, useState } from "react";
import { getCorrectionCycle, stepAttachmentDownloadUrl, type CorrectionPhaseState } from "../api/client";

// Retours de correction, en LECTURE SEULE, consultables sur la fiche globale
// APRÈS l'étape Correction (en production, stock…) : on voit ce que le correcteur
// a produit/transmis — rapport, versions intégrées, VCF — avec date, auteur et
// version, sans l'outillage de dépôt (qui reste dans l'espace de correction).
// Le composant s'efface de lui-même s'il n'y a aucun retour.
export function CorrectionReturns({ manuscriptId }: { manuscriptId: string }) {
  const [phases, setPhases] = useState<CorrectionPhaseState[] | null>(null);

  useEffect(() => {
    let alive = true;
    getCorrectionCycle(manuscriptId)
      .then((p) => { if (alive) setPhases(p); })
      .catch(() => { if (alive) setPhases([]); });
    return () => { alive = false; };
  }, [manuscriptId]);

  const returns = (phases ?? []).filter((p) => p.has_file);
  if (returns.length === 0) return null;

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 12 }}>
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>Retours de correction</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
        Ce que le correcteur a transmis pour cet ouvrage — consultable à tout moment.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {returns.map((p) => (
          <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
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
    </section>
  );
}
