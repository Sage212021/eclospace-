import type { TimelineStep } from "../api/client";

// Fil du workflow DE L'OUVRAGE, affiché sur la fiche (remplace la frise en
// pastilles) : on voit d'un coup les étapes terminées, l'étape en cours, la
// prochaine étape, le pôle responsable, la personne affectée et les dates —
// sans quitter la page. Alimenté par la timeline de la fiche, qui est
// rechargée après chaque validation : la nouvelle étape active (ex. «
// Correction ») apparaît donc immédiatement.

const GOLD = "var(--eclosion, #d9b21a)";
const GOLD_DARK = "var(--eclosion-dark, #9a7a12)";
const GOLD_SOFT = "var(--eclosion-soft, #f6efd8)";
const LINE = "var(--line, #e7e2d4)";

const fdate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

// État de l'étape : on privilégie `state` fourni par le serveur ; à défaut on le
// déduit de l'étape courante et de la validation (compatibilité).
function stepState(s: TimelineStep, currentStatusCode: string): "done" | "current" | "todo" {
  if (s.state) return s.state;
  if (s.status_code === currentStatusCode) return "current";
  return s.validated_at ? "done" : "todo";
}

export function ManuscriptWorkflow({ steps, currentStatusCode }: { steps: TimelineStep[]; currentStatusCode: string }) {
  if (!steps || steps.length === 0) return null;

  const enriched = steps.map((s) => ({ s, state: stepState(s, currentStatusCode) }));
  // On masque les étapes conditionnelles jamais atteintes (ni faites ni en
  // cours), pour garder la chaîne lisible sans les perdre quand elles servent.
  const visible = enriched.filter((e) => !e.s.is_conditional || e.state !== "todo");
  const currentIdx = visible.findIndex((e) => e.state === "current");
  const nextCode = currentIdx >= 0 ? visible.slice(currentIdx + 1).find((e) => e.state === "todo")?.s.status_code : undefined;
  const done = visible.filter((e) => e.state === "done").length;
  const pct = Math.round((done / Math.max(visible.length - 1, 1)) * 100);

  return (
    <section className="ecl-card" aria-label="Fil du workflow de l'ouvrage" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, margin: 0, color: "var(--ink)" }}>Fil du projet</h3>
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{pct}%</span>
      </div>

      <div style={{ height: 6, borderRadius: 999, background: LINE, margin: "12px 0 14px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${GOLD_DARK}, ${GOLD})` }} />
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.map(({ s, state }) => {
          const isCurrent = state === "current";
          const isNext = s.status_code === nextCode;
          const dot = state === "done" ? GOLD_DARK : isCurrent ? GOLD : "transparent";
          const startD = fdate(s.started_at);
          const endD = fdate(s.validated_at ?? s.actual_end);
          const meta = [
            s.department,
            s.assignee ? `Affecté à ${s.assignee}` : null,
            isCurrent && startD ? `Depuis le ${startD}` : state === "done" && endD ? `Le ${endD}` : null,
          ].filter(Boolean).join(" · ");
          return (
            <li
              key={s.status_code}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", borderRadius: 8,
                background: isCurrent ? GOLD_SOFT : "transparent",
                border: isCurrent ? `1px solid ${GOLD}` : isNext ? `1px dashed ${LINE}` : "1px solid transparent",
              }}
            >
              <span style={{ marginTop: 3, width: 13, height: 13, borderRadius: "50%", flexShrink: 0, background: dot, border: state === "todo" ? `2px solid ${LINE}` : "none", boxShadow: isCurrent ? `0 0 0 3px var(--eclosion-soft)` : "none" }} />
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: isCurrent ? 700 : 500, color: state === "todo" ? "var(--muted)" : "var(--ink)", fontStyle: s.is_conditional ? "italic" : "normal" }}>
                    {s.label}{state === "done" && <span style={{ color: GOLD_DARK, marginLeft: 5 }}>✓</span>}
                  </span>
                  {isCurrent && <span style={tag(GOLD, "#fff", GOLD)}>Étape en cours</span>}
                  {isNext && <span style={tag("transparent", GOLD_DARK, GOLD)}>Prochaine étape</span>}
                  {s.late && <span style={tag("transparent", "var(--warn, #B87400)", "#eddcae")}>en retard</span>}
                </div>
                {meta && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{meta}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const tag = (bg: string, color: string, border: string): React.CSSProperties => ({
  fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase",
  background: bg, color, border: `1px solid ${border}`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap",
});
