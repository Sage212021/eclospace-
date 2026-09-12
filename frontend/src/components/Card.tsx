import { useState, type ReactNode } from "react";

interface CardProps {
  title: string;
  // Icône optionnelle à gauche du titre (dorée), pour la hiérarchie visuelle.
  icon?: ReactNode;
  // Sous-titre discret sous le titre (contexte, aide).
  subtitle?: string;
  // Action à droite de l'en-tête (bouton…).
  action?: ReactNode;
  // Repliable (accordéon) : l'en-tête devient cliquable et masque/affiche le corps.
  collapsible?: boolean;
  // État initial d'une carte repliable (ignoré si non repliable). Défaut : replié.
  defaultOpen?: boolean;
  // Accent doré (liseré gauche) : marque une carte « signature » de façon
  // CONSTANTE, quel que soit son contenu (ex. Planification du projet).
  accent?: boolean;
  children: ReactNode;
}

// Carte premium réutilisable : coins arrondis, ombre douce, marges responsives,
// en-tête lisible (icône + titre + sous-titre, action à droite). Remplace les
// cartes à plat construites au cas par cas dans les pages opérationnelles.
// Option « collapsible » : accordéon (en-tête cliquable + chevron), utilisé pour
// regrouper les rubriques d'un module (ex. Moteur de paie).
export function Card({ title, icon, subtitle, action, collapsible, defaultOpen, accent, children }: CardProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const bodyShown = !collapsible || open;
  const accentStyle = accent ? { borderLeft: "4px solid var(--eclosion, #d9b21a)" } : undefined;

  const head = (
    <>
      <div className="ecl-card__title-wrap">
        {collapsible && (
          <span aria-hidden style={{ color: "var(--muted)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", marginRight: 2 }}>▸</span>
        )}
        {icon && <span className="ecl-card__icon">{icon}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="ecl-card__title">{title}</div>
          {subtitle && <div className="ecl-card__subtitle">{subtitle}</div>}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>{action}</div>}
    </>
  );

  return (
    <section className="ecl-card" style={accentStyle}>
      {collapsible ? (
        <header
          className="ecl-card__head"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
          style={{ cursor: "pointer" }}
        >
          {head}
        </header>
      ) : (
        <header className="ecl-card__head">{head}</header>
      )}
      {bodyShown && children}
    </section>
  );
}
