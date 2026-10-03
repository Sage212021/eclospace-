import { useEffect, useState } from "react";
import { getMyProductionWork, type MyProductionWork as Work } from "../api/client";

// « Mes travaux de production » (demande opérateur 03/10) — TABLEAU DE BORD du
// pôle Production : un TABLEAU récapitulatif de toute la charge de l'utilisateur,
// par ÉTAPE de production (ordre réel), colonnes Total / En attente / En cours /
// Livrés. Chaque ligne se déroule pour montrer les ouvrages ; chaque ouvrage
// ouvre sa fiche de travail. Relook charte Éclospace, lisible sur téléphone
// (colonnes compactes + défilement horizontal de secours, jamais de coupe).

const STAGES: { key: string; label: string; codes: string[] }[] = [
  { key: "integration", label: "Mes intégrations & corrections", codes: ["INTEGRATION_COUVERTURE", "INTEGRATION_TEXTE"] },
  { key: "maquette", label: "Maquette / Mise en page", codes: ["MISE_EN_PAGE"] },
  { key: "infographie", label: "Infographie / Couverture", codes: ["INFOGRAPHIE"] },
  { key: "references", label: "Références / ISBN / Dépôt légal", codes: ["ATTRIBUTION_REFERENCES"] },
  { key: "bat", label: "BAT Final & contrôle qualité", codes: ["VALIDATION_BAT"] },
  { key: "impression", label: "Impression", codes: ["IMPRESSION", "CONTROLE_QUALITE_IMPRESSION"] },
];

type EtatCol = "attente" | "cours" | "livre";
function etatOf(w: Work): EtatCol {
  if (w.bucket === "termine") return "livre";
  if (w.bucket === "en_cours") return "cours";
  return "attente";
}
const ATTENTE = "#B87400", COURS = "var(--eclosion-dark, #9a7a12)", LIVRE = "#2F7D4A";
const ETAT_LABEL: Record<EtatCol, string> = { attente: "En attente", cours: "En cours", livre: "Livré" };
const ETAT_COLOR: Record<EtatCol, string> = { attente: ATTENTE, cours: COURS, livre: LIVRE };

// Grille commune en-tête/lignes : nom (souple) + 4 colonnes chiffrées compactes.
const COLS = "minmax(104px,1fr) 42px 50px 50px 50px";

export function MyProductionWork({ onOpenManuscript, onOpenIntegration, canOpen }: { onOpenManuscript: (id: string) => void; onOpenIntegration: (id: string) => void; canOpen: boolean }) {
  const [rows, setRows] = useState<Work[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStage, setOpenStage] = useState<string | null>(null);

  useEffect(() => {
    getMyProductionWork()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const stageRows = (codes: string[]) => (rows ?? []).filter((r) => codes.includes(r.step_code));
  const hasAny = (rows ?? []).length > 0;

  return (
    <section style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 21, margin: "0 0 4px", fontFamily: "var(--font-title, inherit)" }}>Mes travaux de production</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Vue d'ensemble de toute votre charge de production, étape par étape. Touchez une étape pour voir les ouvrages concernés, puis un ouvrage pour ouvrir son travail.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {rows === null && !error && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}

      {rows !== null && !hasAny && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          Aucun travail de production ne vous est confié pour l'instant. Dès qu'un ouvrage vous sera transmis (intégration, mise en page, infographie, références, BAT…), il apparaîtra ici.
        </div>
      )}

      {rows !== null && hasAny && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", background: "var(--card)", boxShadow: "0 1px 2px rgba(11,11,12,.04)" }}>
          {/* Défilement horizontal de secours : sur un écran très étroit, le
              tableau glisse au lieu de couper une colonne. */}
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 300 }}>
              {/* En-tête */}
              <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 4, padding: "10px 12px", background: "var(--ivory, #FAF8F2)", borderBottom: "2px solid var(--eclosion, #D9B21A)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--muted)", alignItems: "end" }}>
                <span>Étape de production</span>
                <HeadCell label="Total" />
                <HeadCell label="En attente" dot={ATTENTE} />
                <HeadCell label="En cours" dot={COURS} />
                <HeadCell label="Livrés" dot={LIVRE} />
              </div>

              {STAGES.map((st, i) => {
                const items = stageRows(st.codes);
                const total = items.length;
                const attente = items.filter((w) => etatOf(w) === "attente").length;
                const cours = items.filter((w) => etatOf(w) === "cours").length;
                const livre = items.filter((w) => etatOf(w) === "livre").length;
                const expanded = openStage === st.key;
                const empty = total === 0;
                const last = i === STAGES.length - 1;

                return (
                  <div key={st.key} style={{ borderBottom: last && !expanded ? "none" : "1px solid var(--line)" }}>
                    <button
                      type="button"
                      disabled={empty}
                      onClick={() => setOpenStage(expanded ? null : st.key)}
                      style={{
                        width: "100%", display: "grid", gridTemplateColumns: COLS, gap: 4, alignItems: "center",
                        padding: "11px 12px", border: "none", textAlign: "left", cursor: empty ? "default" : "pointer",
                        background: expanded ? "var(--eclosion-soft, #f6efd8)" : "transparent", fontSize: 13,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                        <span aria-hidden style={{ width: 10, flexShrink: 0, color: "var(--muted)", fontSize: 11 }}>{empty ? "" : expanded ? "▾" : "▸"}</span>
                        <span style={{ display: "inline-grid", placeItems: "center", width: 20, height: 20, flexShrink: 0, borderRadius: "50%", fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono, ui-monospace, monospace)", background: empty ? "var(--line)" : "var(--eclosion, #D9B21A)", color: empty ? "var(--muted)" : "#0B0B0C" }}>{i + 1}</span>
                        <span style={{ fontWeight: 700, color: empty ? "var(--muted)" : "var(--ink)", lineHeight: 1.25 }}>{st.label}</span>
                      </span>
                      <NumCell n={total} strong color={empty ? "var(--line)" : "var(--ink)"} />
                      <NumCell n={attente} color={ATTENTE} />
                      <NumCell n={cours} color={COURS} />
                      <NumCell n={livre} color={LIVRE} />
                    </button>

                    {expanded && total > 0 && (
                      <div style={{ padding: "0 12px 8px", background: "var(--eclosion-soft, #f6efd8)" }}>
                        {items.map((w) => {
                          const etat = etatOf(w);
                          return (
                            <div key={`${w.manuscript_id}-${w.step_code}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid #e6dcbe", padding: "10px 2px" }}>
                              <div style={{ flex: 1, minWidth: 200 }}>
                                <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}><span aria-hidden>📕</span>{w.title}</div>
                                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                  <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{w.manuscript_number}</span>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, color: ETAT_COLOR[etat] }}>
                                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: ETAT_COLOR[etat], display: "inline-block" }} />
                                    {ETAT_LABEL[etat]}
                                  </span>
                                </div>
                                {w.blocked_reason && <div style={{ fontSize: 12, color: ATTENTE, marginTop: 3 }}>⏳ En attente : {w.blocked_reason}.</div>}
                                {w.detail && !w.blocked_reason && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{w.detail}</div>}
                              </div>
                              {canOpen ? (
                                <button
                                  onClick={() => (w.kind === "integration" ? onOpenIntegration(w.manuscript_id) : onOpenManuscript(w.manuscript_id))}
                                  style={{ border: "1px solid var(--eclosion, #D9B21A)", background: etat === "livre" ? "#fff" : "var(--eclosion, #D9B21A)", color: etat === "livre" ? "var(--eclosion-dark, #9a7a12)" : "#0B0B0C", borderRadius: 8, padding: "6px 15px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
                                >
                                  Ouvrir
                                </button>
                              ) : (
                                <span style={{ fontSize: 12, color: "var(--muted)" }}>Consultation seule</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function HeadCell({ label, dot }: { label: string; dot?: string }) {
  return (
    <span style={{ textAlign: "center", lineHeight: 1.15 }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, display: "inline-block", marginRight: 3, verticalAlign: "middle" }} />}
      {label}
    </span>
  );
}

function NumCell({ n, color, strong }: { n: number; color: string; strong?: boolean }) {
  return (
    <span style={{ textAlign: "center", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontWeight: strong ? 800 : 700, fontSize: strong ? 15 : 14, color: n > 0 ? color : "var(--line)" }}>
      {n}
    </span>
  );
}
