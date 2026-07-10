import { useEffect, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  // Contenu du corps (champs de formulaire…).
  children: ReactNode;
  // Boutons d'action (validation, annulation) rendus en pied de fenêtre.
  footer?: ReactNode;
}

// Fenêtre intégrée (modale) à l'identité de l'app — remplace les pop-up grises
// du navigateur (window.prompt / alert). Voile flouté, panneau arrondi animé,
// fermeture par clic sur le voile ou touche Échap.
export function Modal({ title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ecl-modal__overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="ecl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ecl-modal__head">{title}</div>
        <div className="ecl-modal__body">{children}</div>
        {footer && <div className="ecl-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

// Champ de formulaire simple (libellé + contrôle) au style de l'app.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ecl-field">
      <label>{label}</label>
      {children}
    </div>
  );
}
