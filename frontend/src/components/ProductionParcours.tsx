import type { TimelineStep } from "../api/client";

// « Parcours de production » (Lot B, demande opérateur) — vue verticale, centrée
// sur le segment de production, affichée sur la fiche de l'ouvrage. Montre d'un
// coup d'œil : étapes TERMINÉES (✓), étape EN COURS (→, mise en évidence) et
// étapes FUTURES verrouillées (🔒), avec la progression. Reflète les VRAIES
// étapes du workflow (aucun ordre inventé). Lecture seule : la validation reste
// dans le panneau d'étape existant.

// Segment de production, dans l'ordre réel du workflow. Libellés courts ; on
// préfère toutefois le libellé renvoyé par le workflow quand il est disponible.
const SEGMENT: { code: string; short: string }[] = [
  { code: "MISE_EN_PAGE", short: "Maquette & mise en page" },
  { code: "INFOGRAPHIE", short: "Infographie & couverture" },
  { code: "ATTRIBUTION_REFERENCES", short: "ISBN / références" },
  { code: "VALIDATION_BAT", short: "BAT (vérification finale)" },
  // Décision D-010 : la Contractualisation s'enchaîne juste après la validation
  // du BAT Final et avant l'impression. Elle apparaît donc ici dans le parcours
  // (→ « En cours » pendant l'établissement du contrat, ✓ une fois validée).
  { code: "CONTRACTUALISATION", short: "Contractualisation" },
  { code: "IMPRESSION", short: "Impression" },
  { code: "CONTROLE_QUALITE_IMPRESSION", short: "Contrôle qualité" },
];

type State = "done" | "current" | "locked";

export function ProductionParcours({ timeline, currentStatusCode }: { timeline: TimelineStep[]; currentStatusCode: string }) {
  const byCode = new Map(timeline.map((t) => [t.status_code, t]));
  // On garde les étapes du segment présentes dans le parcours réel de l'ouvrage.
  const steps = SEGMENT.filter((s) => byCode.has(s.code)).map((s) => {
    const t = byCode.get(s.code)!;
    const done = Boolean(t.validated_at) || t.state === "done";
    const current = s.code === currentStatusCode;
    const state: State = done ? "done" : current ? "current" : "locked";
    return { code: s.code, label: t.label || s.short, state };
  });
  if (steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.state === "done").length;
  const total = steps.length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Parcours de production</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
          Progression : {doneCount} / {total}
        </span>
        <div style={{ flex: 1, minWidth: 100, maxWidth: 200, height: 6, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--eclosion, #D9B21A)" }} />
        </div>
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
        {steps.map((s) => {
          const icon = s.state === "done" ? "✓" : s.state === "current" ? "→" : "🔒";
          const color = s.state === "done" ? "#2F7D4A" : s.state === "current" ? "#0B0B0C" : "var(--muted)";
          const tag = s.state === "done" ? "Terminée" : s.state === "current" ? "En cours" : "Verrouillée";
          const tagColor = s.state === "done" ? "#2F7D4A" : s.state === "current" ? "var(--eclosion-dark, #9a7a12)" : "var(--muted)";
          return (
            <li
              key={s.code}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8,
                background: s.state === "current" ? "var(--eclosion-soft, #f6efd8)" : "transparent",
                border: s.state === "current" ? "1px solid var(--eclosion, #D9B21A)" : "1px solid transparent",
              }}
            >
              <span aria-hidden style={{ width: 18, textAlign: "center", color, fontWeight: 800 }}>{icon}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: s.state === "current" ? 700 : 500, color: s.state === "locked" ? "var(--muted)" : "var(--ink)" }}>
                {s.label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: tagColor }}>{tag}</span>
            </li>
          );
        })}
      </ol>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 0 0" }}>
        Les étapes verrouillées 🔒 s'ouvriront automatiquement une fois l'étape en cours validée.
      </p>
    </section>
  );
}
