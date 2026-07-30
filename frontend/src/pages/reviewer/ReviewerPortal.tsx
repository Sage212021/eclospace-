import { setMyLanguage } from "../../api/client";
import { useI18n } from "../../i18n";
import { MyReadings } from "../MyReadings";

// Espace Relecteur — portail externe pour un relecteur EXTERNE (compte dédié à
// accès limité, comme l'espace auteur). Aucune barre latérale, aucun accès aux
// modules internes : uniquement ses missions de lecture et la remise de ses
// évaluations (réutilise la page « Mes lectures »).
function ReviewerHeader({ name, onLogout }: { name: string; onLogout: () => void }) {
  const { t, lang, setLang } = useI18n();
  const switchLang = (l: "fr" | "en") => {
    setLang(l);
    setMyLanguage(l).catch(() => {});
  };
  return (
    <header style={{ background: "var(--marine, #16233D)", color: "#fff", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700, letterSpacing: 0.3 }}>Eclospace</span>
        <span style={{ fontSize: 12, color: "var(--or, #C89A1B)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{t("reviewer.space", "Espace Relecteur")}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,.12)", borderRadius: 999, padding: 2 }}>
          {(["fr", "en"] as const).map((l) => (
            <button key={l} onClick={() => switchLang(l)} style={{ border: "none", cursor: "pointer", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: lang === l ? "var(--or, #C89A1B)" : "transparent", color: lang === l ? "#16233D" : "#fff" }}>{l.toUpperCase()}</button>
          ))}
        </div>
        <span style={{ fontSize: 13, opacity: 0.9 }}>{name}</span>
        <button onClick={onLogout} style={{ border: "1px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", borderRadius: 8, padding: "5px 12px", fontSize: 13, cursor: "pointer" }}>{t("author.logout", "Déconnexion")}</button>
      </div>
    </header>
  );
}

export function ReviewerPortal({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #F8F9FB)" }}>
      <ReviewerHeader name={userName} onLogout={onLogout} />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "22px 18px 60px" }}>
        <h1 style={{ fontFamily: "Georgia, serif", color: "var(--marine, #16233D)", fontSize: 26, margin: "6px 0 2px" }}>
          {t("reviewer.hello", "Bonjour")} {userName.split(" ")[0]}
        </h1>
        <p style={{ color: "var(--muted, #667085)", fontSize: 14, marginTop: 0 }}>
          {t("reviewer.subtitle", "Vos manuscrits à relire pour Éclosion Édition, et la remise de vos évaluations.")}
        </p>
        <MyReadings />
      </main>
    </div>
  );
}
