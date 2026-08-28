import { useI18n } from "../i18n";

// Sélecteur de langue FR / EN — compact, réutilisable (page de connexion +
// barre supérieure). Mémorise le choix sur le profil de l'utilisateur.
export function LanguageSwitch() {
  const { lang, setLang } = useI18n();
  const btn = (code: "fr" | "en", label: string) => (
    <button
      type="button"
      onClick={() => setLang(code)}
      aria-pressed={lang === code}
      style={{
        border: "none",
        background: lang === code ? "var(--eclosion, #d9b21a)" : "transparent",
        color: lang === code ? "#fff" : "var(--muted)",
        borderRadius: 6,
        padding: "3px 9px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "inline-flex", gap: 2, border: "1px solid var(--line)", borderRadius: 8, padding: 2 }}>
      {btn("fr", "FR")}
      {btn("en", "EN")}
    </div>
  );
}
