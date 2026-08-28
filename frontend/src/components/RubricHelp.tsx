import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { getHelpContent, type HelpEntry } from "../help/helpContent";

// Aide contextuelle : une toute petite pastille « ❓ Aide » en haut de l'écran.
// On est déjà DANS la rubrique, donc pas de « Aide de cette rubrique » (surcharge).
// - 1er clic : la pastille s'ouvre et montre le MOTIF (à quoi sert cet écran).
// - 2e clic (« Voir la marche à suivre ») : déroule les étapes et les blocages.
// Style volontairement discret et compact — jamais un grand bandeau en largeur.
// Le contenu suit la langue de l'interface (FR/EN).

export function RubricHelp({ helpKey }: { helpKey: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);

  const { byKey, general } = useMemo(() => {
    const content = getHelpContent(lang);
    const byKey: Record<string, HelpEntry> = {};
    for (const pole of content) for (const e of pole.entries) byKey[e.key] = e;
    // La 1re rubrique (« Pour bien démarrer » / « Getting started ») = repères généraux.
    const general: HelpEntry[] = content[0]?.entries ?? [];
    return { byKey, general };
  }, [lang]);

  const own = byKey[helpKey];
  const isHome = helpKey === "dashboard";
  if (!own && !isHome) return null;

  const entries: HelpEntry[] = own
    ? [own, ...(isHome ? general.filter((e) => e.key !== own.key) : [])]
    : general;
  const multi = entries.length > 1;

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 11px",
          background: open ? "var(--eclosion-soft, #f6efd8)" : "transparent",
          border: "1px solid var(--line)",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--eclosion-dark, #9a7a12)",
        }}
      >
        <span aria-hidden>❓</span>
        <span>{t("help.label", "Aide")}</span>
        <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            maxWidth: 560,
            border: "1px solid var(--line)",
            background: "var(--card)",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: multi ? 2 : 0,
          }}
        >
          {multi
            ? entries.map((e) => <EntryAccordion key={e.key} entry={e} t={t} />)
            : <EntryBody entry={entries[0]} t={t} />}
        </div>
      )}
    </div>
  );
}

// Sur l'accueil (plusieurs repères) : un petit titre cliquable par sujet ; on ne
// déroule que celui qu'on ouvre, et dedans on retrouve motif → étapes au clic.
function EntryAccordion({ entry, t }: { entry: HelpEntry; t: (k: string, d: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 0",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--ink)",
        }}
      >
        <span style={{ flex: 1 }}>{entry.title}</span>
        <span aria-hidden style={{ fontSize: 10, color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 0 10px" }}>
          <EntryBody entry={entry} t={t} />
        </div>
      )}
    </div>
  );
}

// Motif d'abord (une phrase), puis les étapes + blocages seulement au 2e clic.
function EntryBody({ entry, t }: { entry: HelpEntry; t: (k: string, d: string) => string }) {
  const [showSteps, setShowSteps] = useState(false);
  return (
    <div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink)", lineHeight: 1.45 }}>{entry.purpose}</p>

      {!showSteps ? (
        <button
          onClick={() => setShowSteps(true)}
          style={{
            marginTop: 8,
            padding: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--eclosion-dark, #9a7a12)",
          }}
        >
          {t("help.more", "Voir la marche à suivre")} ▾
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={sectionLabel}>{t("help.procedure", "Comment faire, étape par étape")}</div>
          <ol style={{ margin: "0 0 10px", paddingLeft: 17, fontSize: 13, color: "var(--ink)", lineHeight: 1.45 }}>
            {entry.procedure.map((a, i) => (
              <li key={i} style={{ marginBottom: 3 }}>{a}</li>
            ))}
          </ol>

          {entry.stuck.length > 0 && (
            <div style={{ background: "var(--amber-soft, #f9e9db)", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ ...sectionLabel, color: "var(--amber)" }}>{t("help.stuck", "Si vous êtes bloqué")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {entry.stuck.map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)" }}>{s.q}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink)" }}>{s.a}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--eclosion-dark)",
  marginBottom: 5,
};
