import { useState, type ReactNode } from "react";

// Section repliable (accordéon) réutilisable pour la fiche de l'ouvrage et les
// autres écrans à longues rubriques (demande opérateur 03/10 : « tous ces écrans
// doivent pouvoir se replier »). En-tête cliquable (titre + sous-titre + chevron),
// corps masqué quand replié. Repliée par défaut pour réduire le défilement ;
// l'état ouvert/fermé est mémorisé par `storageKey` (préférence par rubrique,
// conservée d'une fiche à l'autre). Look « carte » de la fiche (ivoire/or charte).
export function CollapsibleSection({
  title,
  subtitle,
  storageKey,
  defaultOpen = false,
  accent = false,
  badge,
  id,
  children,
}: {
  title: string;
  subtitle?: string;
  // Clé de mémorisation de l'état (ex. "fiche:retours-correction"). Sans clé,
  // l'état n'est pas mémorisé (repli par défaut à chaque affichage).
  storageKey?: string;
  defaultOpen?: boolean;
  // Liseré or à gauche (rubrique « signature », ex. Planification).
  accent?: boolean;
  // Pastille optionnelle à droite du titre (ex. un compteur), visible même replié.
  badge?: ReactNode;
  // Ancre DOM optionnelle (pour un défilement « aller à cette section »).
  id?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (!storageKey) return defaultOpen;
    try {
      const v = localStorage.getItem(`collapse:${storageKey}`);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (storageKey) {
        try { localStorage.setItem(`collapse:${storageKey}`, next ? "1" : "0"); } catch { /* stockage indisponible : sans effet */ }
      }
      return next;
    });
  }

  return (
    <section
      id={id}
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderLeft: accent ? "4px solid var(--eclosion, #D9B21A)" : "1px solid var(--line)",
        borderRadius: 10,
        marginTop: 12,
        overflow: "hidden",
        scrollMarginTop: 12,
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 16px",
          background: open ? "var(--ivory, #FAF8F2)" : "transparent",
          border: "none",
          borderBottom: open ? "1px solid var(--line)" : "none",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden
          style={{ color: "var(--eclosion-dark, #9a7a12)", flexShrink: 0, fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}
        >
          ▸
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: "var(--ink)", lineHeight: 1.3 }}>{title}</span>
          {subtitle && <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>{subtitle}</span>}
        </span>
        {badge !== undefined && badge !== null && <span style={{ flexShrink: 0 }}>{badge}</span>}
      </button>
      {open && <div style={{ padding: "14px 16px" }}>{children}</div>}
    </section>
  );
}
