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

  // Design DISTINCT (accent or + fond ivoire + badge « Reçu ») pour que ce
  // livrable reçu de l'étape amont ne se confonde PAS avec les dépôts libres
  // « Documents de l'étape » (cartes blanches neutres). C'est une pièce ENTRANTE,
  // en lecture seule, qui se démarque visuellement.
  return (
    <section
      style={{
        background: "var(--ivory, #FAF8F2)",
        border: "1px solid var(--eclosion, #D9B21A)",
        borderLeft: "5px solid var(--eclosion, #D9B21A)",
        borderRadius: 10,
        padding: 16,
        marginTop: 12,
        boxShadow: "0 1px 3px rgba(217,178,26,0.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: "#0B0B0C",
            background: "var(--eclosion, #D9B21A)",
            borderRadius: 999,
            padding: "3px 10px",
            whiteSpace: "nowrap",
          }}
        >
          📥 Reçu
        </span>
        <h3 style={{ fontSize: 15, margin: 0, color: "var(--ink)" }}>{title}</h3>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</div>
          <a href={stepAttachmentDownloadUrl(manuscriptId, meta.version_id)} download style={{ fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 700 }}>
            ⬇️ {meta.filename ?? "Télécharger le fichier"}
          </a>
          {meta.created_at && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Déposé le {new Date(meta.created_at).toLocaleDateString("fr-FR")}</div>}
        </div>
      </div>
    </section>
  );
}
