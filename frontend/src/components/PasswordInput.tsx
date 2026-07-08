import { useState } from "react";

// Champ mot de passe avec icône « œil » (spéc. fonctionnelle §1) : l'utilisateur
// peut afficher/masquer la valeur saisie pour vérifier sa frappe. Le champ reste
// masqué par défaut. Réutilisable partout où l'on saisit un secret (connexion,
// sécurité du compte, réinitialisation par l'admin).
type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export function PasswordInput({ value, onChange, style, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  // Le conteneur reprend les contraintes de largeur du champ pour que l'icône
  // reste collée au bord droit du champ, quel que soit son gabarit.
  const wrapperStyle: React.CSSProperties = {
    position: "relative",
    display: "block",
    width: style?.width ?? "100%",
    ...(style?.maxWidth != null ? { maxWidth: style.maxWidth } : {}),
  };
  return (
    <div style={wrapperStyle}>
      <input
        {...rest}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        style={{ ...style, width: "100%", maxWidth: "100%", paddingRight: 40, boxSizing: "border-box" as const }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        title={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        tabIndex={-1}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 6,
          margin: "auto 0",
          height: 26,
          width: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--muted)",
        }}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
