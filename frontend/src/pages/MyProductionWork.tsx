import { useEffect, useState } from "react";
import { getMyProductionWork, type MyProductionWork as Work, type ProductionBucket } from "../api/client";

// « Mes travaux de production » (demande opérateur 01/10) — ESPACE UNIQUE du pôle
// Production. Au lieu de multiplier les écrans (Maquette, Infographie, ISBN,
// BAT…), on regroupe ici les ouvrages confiés à l'utilisateur, classés par état,
// avec pour chacun la TÂCHE ACTIVE et la PROGRESSION. On ouvre la fiche de
// l'ouvrage (centrée sur la tâche) ; le workflow existant gère le reste.

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

// Ordre et libellés des bacs. Couleurs charte : or = actif, ambre = en attente
// (sémantique « retard/bloqué »), vert sobre = terminé.
const BUCKETS: { key: ProductionBucket; label: string; hint: string; accent: string; soft: string }[] = [
  { key: "en_cours", label: "En cours", hint: "Travail commencé, à poursuivre.", accent: "var(--eclosion, #D9B21A)", soft: "var(--eclosion-soft, #f6efd8)" },
  { key: "a_traiter", label: "À traiter", hint: "Confié mais pas encore commencé.", accent: "#0B0B0C", soft: "var(--ivory, #FAF8F2)" },
  { key: "en_attente", label: "En attente", hint: "Un préalable manque avant de pouvoir valider.", accent: "#B87400", soft: "#fbf1dd" },
  { key: "termine", label: "Terminés", hint: "Vos tâches de production validées.", accent: "#2F7D4A", soft: "#e9f3ec" },
];

export function MyProductionWork({ onOpenManuscript, canOpen }: { onOpenManuscript: (id: string) => void; canOpen: boolean }) {
  const [rows, setRows] = useState<Work[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyProductionWork()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const byBucket = (b: ProductionBucket) => (rows ?? []).filter((r) => r.bucket === b);

  return (
    <section style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Mes travaux de production</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        Tous les ouvrages qui vous sont confiés en production, regroupés ici. Pour chaque ouvrage, vous voyez la tâche à réaliser et où il en est. Ouvrez-le pour travailler : la fiche s'ouvre sur la tâche en cours.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {rows === null && !error && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}

      {rows !== null && rows.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          Aucun travail de production ne vous est confié pour l'instant. Dès qu'un ouvrage vous sera transmis (mise en page, infographie, références, BAT…), il apparaîtra ici.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ display: "grid", gap: 18 }}>
          {BUCKETS.map((b) => {
            const items = byBucket(b.key);
            if (items.length === 0) return null;
            return (
              <div key={b.key}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: b.accent }}>{b.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{items.length}</span>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· {b.hint}</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((d) => (
                    <WorkCard key={`${d.manuscript_id}-${d.step_code}`} work={d} accent={b.accent} soft={b.soft} canOpen={canOpen} onOpen={() => onOpenManuscript(d.manuscript_id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WorkCard({ work, accent, soft, canOpen, onOpen }: { work: Work; accent: string; soft: string; canOpen: boolean; onOpen: () => void }) {
  const { done, total } = work.progression;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const days = daysSince(work.since);
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{work.title}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{work.manuscript_number}</span>
          <span style={{ display: "inline-block", background: soft, color: accent, borderRadius: 999, padding: "1px 9px", fontWeight: 700 }}>
            {work.bucket === "termine" ? "✓ " : ""}{work.step_label}
          </span>
          <span>· {work.bucket === "termine" ? "validé" : "confié"} {days === 0 ? "aujourd'hui" : `il y a ${days} j`}</span>
        </div>
        {/* Motif d'attente (préalable manquant) — explicite. */}
        {work.blocked_reason && (
          <div style={{ fontSize: 12, color: "#B87400", marginTop: 4 }}>⏳ En attente : {work.blocked_reason}.</div>
        )}
        {/* Progression sur le parcours de production. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <div style={{ flex: 1, maxWidth: 180, height: 6, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: accent }} />
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{done}/{total}</span>
        </div>
      </div>
      {canOpen ? (
        <button onClick={onOpen} style={{ border: "1px solid var(--eclosion, #D9B21A)", background: work.bucket === "termine" ? "#fff" : "var(--eclosion, #D9B21A)", color: work.bucket === "termine" ? "var(--eclosion-dark, #9a7a12)" : "#0B0B0C", borderRadius: 8, padding: "7px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          Ouvrir
        </button>
      ) : (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Consultation seule</span>
      )}
    </div>
  );
}
