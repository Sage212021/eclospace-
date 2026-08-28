import { useEffect, useState } from "react";
import { listWorkflowStatuses, type WorkflowStatusRef } from "../api/client";

// Frise de progression d'un ouvrage : « où en est le livre » d'un coup d'œil,
// avec des voyants (fait / en cours / à venir). Pensé pour que chacun —
// commercial, assistante éditoriale — situe l'ouvrage sans connaître le détail.

const DONE = "var(--eclosion-dark, #9a7a12)";
const DONE_BG = "var(--eclosion-soft, #f6efd8)";
const CURRENT = "var(--eclosion, #d9b21a)";
const TODO = "var(--line, #e7e2d4)";

export function ManuscriptProgress({ stepOrder }: { stepOrder: number }) {
  const [steps, setSteps] = useState<WorkflowStatusRef[] | null>(null);

  useEffect(() => {
    listWorkflowStatuses()
      .then(setSteps)
      .catch(() => setSteps([]));
  }, []);

  if (!steps || steps.length === 0) return null;

  const current = steps.find((s) => s.stepOrder === stepOrder);
  const total = steps.length;
  const doneCount = steps.filter((s) => s.stepOrder < stepOrder).length;
  const pct = Math.round((doneCount / (total - 1)) * 100);

  return (
    <section className="ecl-card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, margin: 0, color: "var(--ink)" }}>Où en est l'ouvrage</h3>
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
          Étape {stepOrder} / {total} · {pct}%
        </span>
      </div>

      {current && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: DONE_BG,
            border: `1px solid ${CURRENT}`,
            borderRadius: 10,
            padding: "10px 14px",
          }}
        >
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: CURRENT, boxShadow: `0 0 0 4px var(--eclosion-soft)`, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: "var(--eclosion-dark)", textTransform: "uppercase" }}>Étape en cours</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{current.label}</div>
          </div>
        </div>
      )}

      {/* Barre de progression */}
      <div style={{ height: 8, borderRadius: 999, background: TODO, marginTop: 14, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${DONE}, ${CURRENT})` }} />
      </div>

      {/* Voyants : chaque étape du circuit */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginTop: 16 }}>
        {steps.map((s) => {
          const state = s.stepOrder < stepOrder ? "done" : s.stepOrder === stepOrder ? "current" : "todo";
          const dot = state === "done" ? DONE : state === "current" ? CURRENT : "transparent";
          const border = state === "todo" ? `2px solid ${TODO}` : "none";
          return (
            <div
              key={s.code}
              title={s.isConditional ? `${s.label} (si nécessaire)` : s.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 8,
                background: state === "current" ? DONE_BG : "transparent",
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: dot,
                  border,
                  flexShrink: 0,
                  boxShadow: state === "current" ? `0 0 0 3px var(--eclosion-soft)` : "none",
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  lineHeight: 1.15,
                  color: state === "todo" ? "var(--muted)" : "var(--ink)",
                  fontWeight: state === "current" ? 700 : 500,
                  fontStyle: s.isConditional ? "italic" : "normal",
                }}
              >
                {s.label}
                {state === "done" && <span style={{ color: DONE, marginLeft: 4 }}>✓</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
