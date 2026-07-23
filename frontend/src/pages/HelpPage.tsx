import { useMemo, useState } from "react";
import { Card } from "../components/Card";
import { useI18n } from "../i18n";
import { HELP_CONTENT, type HelpEntry } from "../help/helpContent";

// Aide intégrée : centre d'aide parcourable, organisé par pôle puis par écran.
// Chaque écran explique à quoi il sert, ses actions principales, et « si vous
// êtes bloqué ». Une recherche filtre l'ensemble. Accessible à tout le personnel.

function matches(entry: HelpEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.title,
    entry.purpose,
    ...entry.actions,
    ...entry.stuck.flatMap((s) => [s.q, s.a]),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function HelpPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      HELP_CONTENT.map((pole) => ({ ...pole, entries: pole.entries.filter((e) => matches(e, query)) })).filter(
        (p) => p.entries.length > 0,
      ),
    [query],
  );

  const total = HELP_CONTENT.reduce((n, p) => n + p.entries.length, 0);

  return (
    <Card
      title={t("help.title", "Aide")}
      subtitle={t("help.subtitle", "Un mode d'emploi par écran, pour vous orienter quand vous bloquez.")}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("help.search", "Rechercher une aide (ex. « facture », « stock », « mot de passe »)…")}
        style={{
          width: "100%",
          padding: "10px 13px",
          fontSize: 14,
          border: "1px solid var(--line)",
          borderRadius: 10,
          marginBottom: 6,
        }}
      />
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, fontFamily: "var(--font-mono)" }}>
        {query
          ? `${filtered.reduce((n, p) => n + p.entries.length, 0)} ${t("help.results", "résultat(s)")}`
          : `${total} ${t("help.screens", "écrans documentés")}`}
      </div>

      {filtered.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          {t("help.empty", "Aucune aide ne correspond. Essayez un autre mot, ou contactez votre administrateur.")}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {filtered.map((pole) => (
          <section key={pole.pole}>
            <h3 style={{ fontSize: 14, margin: "0 0 4px", color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.6 }}>
              {pole.pole}
            </h3>
            {pole.intro && <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>{pole.intro}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pole.entries.map((entry) => {
                const isOpen = open === entry.key || Boolean(query);
                return (
                  <div key={entry.key} style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--card)" }}>
                    <button
                      onClick={() => setOpen(isOpen && !query ? null : entry.key)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "12px 14px",
                        background: "transparent",
                        border: "none",
                        cursor: query ? "default" : "pointer",
                        textAlign: "left",
                        fontSize: 14.5,
                        fontWeight: 700,
                        color: "var(--ink)",
                      }}
                    >
                      <span>{entry.title}</span>
                      {!query && <span style={{ color: "var(--muted)", fontSize: 13 }}>{isOpen ? "▲" : "▼"}</span>}
                    </button>
                    {isOpen && (
                      <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink)" }}>{entry.purpose}</p>

                        <div>
                          <div style={sectionLabel}>{t("help.actions", "Les actions principales")}</div>
                          <ul style={listStyle}>
                            {entry.actions.map((a, i) => (
                              <li key={i} style={{ marginBottom: 4 }}>{a}</li>
                            ))}
                          </ul>
                        </div>

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
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Card>
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
const listStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 13.5, color: "var(--ink)" };
