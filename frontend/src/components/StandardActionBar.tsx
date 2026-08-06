import type { CSSProperties, ReactNode } from "react";

// Barre d'actions standard (refonte RH/Commercial — Étape 1, « fondations
// communes »). Convention transversale : chaque fiche/formulaire présente, de
// manière homogène, les mêmes actions — chacune n'apparaît que si un gestionnaire
// est fourni. Les boutons propres au métier restent à côté, ils ne passent pas
// par cette barre.
//
// Ordre canonique : Nouveau · Modifier · Enregistrer · Annuler · Historique ·
// Imprimer · Export PDF · Retour. « Enregistrer » est l'action primaire ;
// « Annuler » revient sans perdre la fiche ; rien n'est définitif tant que ce
// n'est pas validé (le workflow brouillon→validation est porté par chaque module).

export interface StandardActionBarProps {
  onNew?: () => void;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  onHistory?: () => void;
  onPrint?: () => void;
  onExport?: () => void;
  onBack?: () => void;
  /** Enregistrement en cours : désactive Enregistrer. */
  saving?: boolean;
  /** Rien à enregistrer (formulaire non modifié) : désactive Enregistrer. */
  dirty?: boolean;
  size?: "sm" | "md";
  align?: "start" | "end";
}

export function StandardActionBar(props: StandardActionBarProps) {
  const { onNew, onEdit, onSave, onCancel, onHistory, onPrint, onExport, onBack, saving, dirty, size = "sm", align = "start" } = props;
  const pad = size === "sm" ? "5px 11px" : "7px 14px";
  const font = size === "sm" ? 12.5 : 13.5;

  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
    border: "1px solid var(--line)", background: "var(--card, #fff)", color: "var(--ink)",
    borderRadius: 7, padding: pad, fontSize: font, fontWeight: 600, whiteSpace: "nowrap",
  };
  const primary: CSSProperties = { ...base, background: "var(--eclosion)", borderColor: "var(--eclosion)", color: "#fff" };
  const neutral: CSSProperties = { ...base, color: "var(--muted)" };

  const btn = (key: string, label: string, icon: ReactNode, onClick: () => void, style: CSSProperties, disabled = false) => (
    <button key={key} type="button" onClick={onClick} disabled={disabled} style={{ ...style, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>
      <span aria-hidden>{icon}</span> {label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: align === "end" ? "flex-end" : "flex-start" }}>
      {onNew && btn("new", "Nouveau", "＋", onNew, base)}
      {onEdit && btn("edit", "Modifier", "✎", onEdit, base)}
      {onSave && btn("save", "Enregistrer", "✔", onSave, primary, Boolean(saving) || dirty === false)}
      {onCancel && btn("cancel", "Annuler", "↺", onCancel, neutral)}
      {onHistory && btn("history", "Historique", "🕑", onHistory, neutral)}
      {onPrint && btn("print", "Imprimer", "🖨", onPrint, neutral)}
      {onExport && btn("export", "Export PDF", "⭳", onExport, neutral)}
      {onBack && btn("back", "Retour", "←", onBack, neutral)}
    </div>
  );
}
