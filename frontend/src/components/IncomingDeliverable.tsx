import { useEffect, useState } from "react";
import { getStepDeliverable, stepAttachmentDownloadUrl, type StepDeliverableMeta } from "../api/client";

// Livrable REÇU de l'étape précédente, en LECTURE SEULE : l'acteur de l'étape
// courante récupère ce que l'étape amont lui a remis. Ex. : l'infographe voit la
// MAQUETTE déposée par le maquettiste (format, dos, gabarit) pour caler la
// couverture. Se masque de lui-même s'il n'y a pas de livrable.
export function IncomingDeliverable({ manuscriptId, fromStepCode, title }: { manuscriptId: string; fromStepCode: string; title: string }) {
  const [meta, setMeta] = useState<StepDeliverableMeta | null>(null);

  useEffect(() => {
    let alive = true;
    getStepDeliverable(manuscriptId, fromStepCode)
      .then((m) => { if (alive) setMeta(m); })
      .catch(() => { if (alive) setMeta(null); });
    return () => { alive = false; };
  }, [manuscriptId, fromStepCode]);

  if (!meta?.has_file || !meta.version_id) return null;

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 12 }}>
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>{title}</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</div>
          <a href={stepAttachmentDownloadUrl(manuscriptId, meta.version_id)} download style={{ fontSize: 12, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 600 }}>
            ⬇️ {meta.filename ?? "Télécharger le fichier"}
          </a>
          {meta.created_at && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Déposé le {new Date(meta.created_at).toLocaleDateString("fr-FR")}</div>}
        </div>
      </div>
    </section>
  );
}
