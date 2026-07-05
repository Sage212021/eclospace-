import type { TimelineStep } from "../api/client";

// La frise du manuscrit (guide de style §5.1) — élément signature, apparaît
// sur toute fiche d'ouvrage. Nœud plein or = validée, halo or = étape
// courante, orange = validée en retard, vide = à venir.
export function Spine({ steps, currentStatusCode }: { steps: TimelineStep[]; currentStatusCode: string }) {
  return (
    <div style={{ display: "flex", overflowX: "auto", gap: 4, padding: "12px 4px" }}>
      {steps.map((step) => {
        const isCurrent = step.status_code === currentStatusCode;
        const isValidated = Boolean(step.validated_at);
        const color = isValidated && step.late ? "var(--amber)" : "var(--eclosion)";

        return (
          <div key={step.status_code} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 92 }}>
            <div
              title={step.label}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: isValidated ? color : "transparent",
                border: `2px solid ${isValidated ? color : "var(--line)"}`,
                boxShadow: isCurrent && !isValidated ? `0 0 0 4px var(--eclosion-soft)` : "none",
              }}
            />
            <div
              style={{
                fontSize: 10,
                textAlign: "center",
                marginTop: 6,
                color: isCurrent ? "var(--ink)" : "var(--muted)",
                fontWeight: isCurrent ? 600 : 400,
              }}
            >
              {step.label}
            </div>
            {step.is_conditional && (
              <div style={{ fontSize: 9, color: "var(--muted)" }}>(si nécessaire)</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
