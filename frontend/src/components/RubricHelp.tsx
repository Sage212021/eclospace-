import { useState } from "react";
import { useI18n } from "../i18n";
import { HELP_CONTENT, type HelpEntry } from "../help/helpContent";

// Aide contextuelle : intégrée EN HAUT de chaque rubrique, elle montre l'aide
// de CET écran (procédé + blocages). Repliée par défaut, dépliée d'un clic.
// Pas de rubrique « Aide » globale au menu : chaque écran porte la sienne.

const BY_KEY: Record<string, HelpEntry> = {};
for (const pole of HELP_CONTENT) for (const e of pole.entries) BY_KEY[e.key] = e;
const GENERAL: HelpEntry[] = HELP_CONTENT.find((p) => p.pole === "Pour bien démarrer")?.entries ?? [];

export function RubricHelp({ helpKey }: { helpKey: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const own = BY_KEY[helpKey];
  // Sur l'accueil, on ajoute les repères généraux (connexion, circuit, e-mail…).
  const isHome = helpKey === "dashboard";
  if (!own && !isHome) return null;

  const entries: HelpEntry[] = own
    ? [own, ...(isHome ? GENERAL.filter((e) => e.key !== own.key) : [])]
    : GENERAL;
  const heading = own ? own.title : t("help.title", "Aide");

  return (
    <div
      style={{
        border: "1px solid var(--eclosion, #C89A1B)",
        background: "var(--eclosion-soft, #f6efd8)",
        borderRadius: 12,
        marginBottom: 16,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 13.5,
          fontWeight: 700,
          color: "var(--eclosion-dark, #a87d14)",
        }}
      >
        <span aria-hidden style={{ fontSize: 15 }}>❓</span>
        <span style={{ flex: 1 }}>
          {t("help.rubric", "Aide de cette rubrique")}
          <span style={{ fontWeight: 500, color: "var(--muted)" }}> — {heading}</span>
        </span>
        <span style={{ fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 16, background: "var(--card)" }}>
          <div style={{ height: 1, background: "var(--line)" }} />
          {entries.map((entry) => (
            <EntryBlock key={entry.key} entry={entry} showTitle={entries.length > 1} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryBlock({ entry, showTitle, t }: { entry: HelpEntry; showTitle: boolean; t: (k: string, d: string) => string }) {
  return (
    <div>
      {showTitle && <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", marginBottom: 4 }}>{entry.title}</div>}
      <p style={{ margin: "0 0 10px", fontSize: 13.5, color: "var(--ink)" }}>{entry.purpose}</p>

      <div style={sectionLabel}>{t("help.procedure", "Comment faire, étape par étape")}</div>
      <ol style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13.5, color: "var(--ink)" }}>
        {entry.procedure.map((a, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{a}</li>
        ))}
      </ol>

      {entry.stuck.length > 0 && (
        <div style={{ background: "var(--amber-soft, #f9e9db)", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ ...sectionLabel, color: "var(--amber)" }}>{t("help.stuck", "Si vous êtes bloqué")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {entry.stuck.map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{s.q}</div>
                <div style={{ fontSize: 13, color: "var(--ink)" }}>{s.a}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--eclosion-dark)",
  marginBottom: 6,
};
