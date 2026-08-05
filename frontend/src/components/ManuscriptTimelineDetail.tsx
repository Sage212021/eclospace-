import { useState } from "react";

// Détail enrichi de la frise éditoriale (refonte workflow) : pour chaque étape,
// son état, son responsable, ses dates, le temps passé et le respect du délai
// (échéance / retard). Complète la frise visuelle « Spine ».
//
// Type autonome : n'exige de la frise que les champs de base ; les champs
// enrichis renvoyés par /timeline sont optionnels. Un TimelineStep du client
// (avec ou sans ces champs) reste ainsi assignable à ce composant.
export interface TimelineStep {
  status_code: string;
  label: string;
  step_order: number;
  is_conditional: boolean;
  validated_at: string | null;
  late: boolean;
  department?: string | null;
  state?: "done" | "current" | "todo" | "skipped";
  responsible?: string | null;
  validated_by?: string | null;
  start_at?: string | null;
  time_spent_days?: number | null;
  target_days?: number | null;
  due_date?: string | null;
  overdue?: boolean;
}

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

function StateBadge({ step }: { step: TimelineStep }) {
  const state = step.state ?? (step.validated_at ? "done" : "todo");
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    done: { label: "Fait", bg: "var(--eclosion-soft)", fg: "var(--eclosion-dark, #8A6A12)" },
    current: { label: "En cours", bg: "#E9EEF7", fg: "var(--eclosion, #16233D)" },
    todo: { label: "À venir", bg: "#F1F3F7", fg: "var(--muted)" },
    skipped: { label: "Non requise", bg: "#F1F3F7", fg: "var(--muted)" },
  };
  const s = map[state] ?? map.todo;
  return (
    <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{s.label}</span>
  );
}

export function ManuscriptTimelineDetail({ steps }: { steps: TimelineStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const current = steps.find((s) => s.state === "current");
  // Étapes visibles par défaut : on masque les « à venir » lointaines derrière un dépliage.
  const visible = open ? steps : steps.filter((s) => s.state !== "todo" || s.step_order === (current?.step_order ?? 0) + 1);

  return (
    <section className="ecl-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, margin: 0, color: "var(--ink)" }}>Détail des étapes</h3>
        <button onClick={() => setOpen((v) => !v)} style={{ border: "none", background: "none", color: "var(--eclosion)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, textDecoration: "underline" }}>
          {open ? "Masquer les étapes à venir" : "Voir toutes les étapes"}
        </button>
      </div>

      {/* Bandeau de l'étape en cours : échéance et retard mis en avant. */}
      {current && (
        <div style={{ marginTop: 10, borderRadius: 10, padding: "10px 14px", background: current.overdue ? "var(--warn-soft, #FBEEE3)" : "#E9EEF7", border: `1px solid ${current.overdue ? "var(--warn, #C4661F)" : "var(--line)"}` }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: current.overdue ? "var(--warn, #C4661F)" : "var(--eclosion-dark, #8A6A12)" }}>
            {current.overdue ? "⚠ Étape en retard" : "Étape en cours"}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginTop: 2 }}>{current.label}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 14 }}>
            <span>Depuis le {fmtDate(current.start_at)}</span>
            {current.time_spent_days != null && <span>· {current.time_spent_days} j écoulé{current.time_spent_days > 1 ? "s" : ""}</span>}
            {current.target_days != null && <span>· délai : {current.target_days} j</span>}
            {current.due_date && (
              <span style={{ color: current.overdue ? "var(--warn, #C4661F)" : "var(--muted)", fontWeight: current.overdue ? 700 : 400 }}>
                · échéance {fmtDate(current.due_date)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tableau des étapes */}
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11 }}>
              <th style={thStyle}>Étape</th>
              <th style={thStyle}>État</th>
              <th style={thStyle}>Responsable</th>
              <th style={thStyle}>Début</th>
              <th style={thStyle}>Validée</th>
              <th style={thStyle}>Temps</th>
              <th style={thStyle}>Délai</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const validatedLate = Boolean(s.late && s.validated_at);
              return (
                <tr key={s.status_code} style={{ borderTop: "1px solid var(--line)", background: s.state === "current" ? "#F7F9FC" : "transparent" }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: s.state === "current" ? 700 : 500, color: s.state === "todo" ? "var(--muted)" : "var(--ink)" }}>{s.label}</span>
                    {s.is_conditional && <span style={{ fontSize: 10.5, color: "var(--muted)", fontStyle: "italic" }}> (si nécessaire)</span>}
                    {s.department && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{s.department}</div>}
                  </td>
                  <td style={tdStyle}><StateBadge step={s} /></td>
                  <td style={tdStyle}>{s.responsible ?? (s.validated_by ? s.validated_by : "—")}</td>
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{fmtDate(s.start_at)}</td>
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                    {s.validated_at ? fmtDate(s.validated_at) : "—"}
                    {validatedLate && <span title="Validée en retard" style={{ color: "var(--warn, #C4661F)", marginLeft: 4 }}>⚠</span>}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{s.time_spent_days != null ? `${s.time_spent_days} j` : "—"}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {s.target_days != null ? (
                      <span style={{ color: s.overdue ? "var(--warn, #C4661F)" : "var(--muted)", fontWeight: s.overdue ? 700 : 400 }}>
                        {s.target_days} j{s.overdue ? " · dépassé" : ""}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const thStyle: React.CSSProperties = { padding: "4px 8px", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "8px 8px", verticalAlign: "top", color: "var(--ink)" };
