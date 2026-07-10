import type { ReactNode } from "react";

interface CardProps {
  title: string;
  // Icône optionnelle à gauche du titre (dorée), pour la hiérarchie visuelle.
  icon?: ReactNode;
  // Sous-titre discret sous le titre (contexte, aide).
  subtitle?: string;
  // Action à droite de l'en-tête (bouton…).
  action?: ReactNode;
  children: ReactNode;
}

// Carte premium réutilisable : coins arrondis, ombre douce, marges responsives,
// en-tête lisible (icône + titre + sous-titre, action à droite). Remplace les
// cartes à plat construites au cas par cas dans les pages opérationnelles.
export function Card({ title, icon, subtitle, action, children }: CardProps) {
  return (
    <section className="ecl-card">
      <header className="ecl-card__head">
        <div className="ecl-card__title-wrap">
          {icon && <span className="ecl-card__icon">{icon}</span>}
          <div style={{ minWidth: 0 }}>
            <div className="ecl-card__title">{title}</div>
            {subtitle && <div className="ecl-card__subtitle">{subtitle}</div>}
          </div>
        </div>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </header>
      {children}
    </section>
  );
}
