import type { ReactNode } from "react";

// Encadré d'orientation (demande opérateur du 29/07/2026) : une note discrète,
// à l'identité de la maison (fond or pâle), qui explique en une phrase à quoi
// sert la rubrique et, au besoin, l'ordre des opérations. Uniformise l'aide
// contextuelle des sous-rubriques éditoriales.
export function GuidanceNote({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      role="note"
      style={{
        background: "var(--eclosion-soft)",
        border: "1px solid var(--eclosion)",
        borderRadius: 8,
        padding: "10px 13px",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: "var(--ink)",
        margin: "0 0 16px",
      }}
    >
      {title && <strong>{title}</strong>}
      {title ? <span> — </span> : null}
      {children}
    </div>
  );
}

// Variante avec liste ordonnée (« dans l'ordre : 1… 2… 3… »).
export function GuidanceSteps({ title, steps }: { title: string; steps: ReactNode[] }) {
  return (
    <div
      role="note"
      style={{
        background: "var(--eclosion-soft)",
        border: "1px solid var(--eclosion)",
        borderRadius: 8,
        padding: "10px 13px",
        fontSize: 12.5,
        color: "var(--ink)",
        margin: "0 0 16px",
      }}
    >
      <strong>{title}</strong>
      <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
