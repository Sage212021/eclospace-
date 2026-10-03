import { useEffect, useState } from "react";
import { getMyProductionWork, type MyProductionWork as Work } from "../api/client";

// « Mes travaux de production » (demande opérateur 03/10) — TABLEAU DE BORD du
// pôle Production. À l'ouverture : une vue synthétique de TOUTE la charge de
// l'utilisateur, par ÉTAPE de production (dans l'ordre réel), avec pour chacune
// combien d'ouvrages sont en attente / en cours / livrés. Chaque étape se déroule
// pour montrer les ouvrages ; chaque ouvrage ouvre sa fiche de travail. Présenté
// en cartes (lisible sur téléphone), charte Éclospace or/noir/ivoire.

// Étapes de production, dans l'ordre réel, avec les codes workflow regroupés.
const STAGES: { key: string; label: string; codes: string[] }[] = [
  { key: "integration", label: "Mes intégrations & corrections", codes: ["INTEGRATION_COUVERTURE", "INTEGRATION_TEXTE"] },
  { key: "maquette", label: "Maquette / Mise en page", codes: ["MISE_EN_PAGE"] },
  { key: "infographie", label: "Infographie / Couverture", codes: ["INFOGRAPHIE"] },
  { key: "references", label: "Références / ISBN / Dépôt légal", codes: ["ATTRIBUTION_REFERENCES"] },
  { key: "bat", label: "BAT / Final", codes: ["VALIDATION_BAT"] },
  { key: "impression", label: "Impression", codes: ["IMPRESSION", "CONTROLE_QUALITE_IMPRESSION"] },
];

// 4 bacs internes → 3 états lisibles.
type EtatCol = "attente" | "cours" | "livre";
function etatOf(w: Work): EtatCol {
  if (w.bucket === "termine") return "livre";
  if (w.bucket === "en_cours") return "cours";
  return "attente";
}
const ATTENTE = "#B87400", COURS = "#D9B21A", LIVRE = "#2F7D4A";
const ETAT_LABEL: Record<EtatCol, string> = { attente: "En attente", cours: "En cours", livre: "Livré" };
const ETAT_COLOR: Record<EtatCol, string> = { attente: ATTENTE, cours: "var(--eclosion-dark, #9a7a12)", livre: LIVRE };

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
  const grand = rows ?? [];
  const hasAny = grand.length > 0;
  const totalAll = grand.length;
  const livreAll = grand.filter((w) => etatOf(w) === "livre").length;

  return (
    <section style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ fontSize: 21, margin: "0 0 4px", fontFamily: "var(--font-title, inherit)" }}>Mes travaux de production</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Toute votre charge de production, étape par étape. Touchez une étape pour voir les ouvrages, puis un ouvrage pour ouvrir son travail.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {rows === null && !error && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}

      {rows !== null && !hasAny && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          Aucun travail de production ne vous est confié pour l'instant. Dès qu'un ouvrage vous sera transmis (intégration, mise en page, infographie, références, BAT…), il apparaîtra ici.
        </div>
      )}

      {rows !== null && hasAny && (
        <>
          {/* Bandeau de synthèse + légende des couleurs. */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 12, padding: "10px 14px", background: "var(--ivory, #FAF8F2)", border: "1px solid var(--line)", borderRadius: 12 }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontWeight: 800, fontSize: 18 }}>{livreAll}</span>
              <span style={{ color: "var(--muted)" }}> / {totalAll} livrés</span>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginLeft: "auto", fontSize: 11.5, color: "var(--muted)" }}>
              <Legend color={ATTENTE} label="En attente" />
              <Legend color={COURS} label="En cours" />
              <Legend color={LIVRE} label="Livré" />
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {STAGES.map((st, i) => {
              const items = stageRows(st.codes);
              const total = items.length;
              const attente = items.filter((w) => etatOf(w) === "attente").length;
              const cours = items.filter((w) => etatOf(w) === "cours").length;
              const livre = items.filter((w) => etatOf(w) === "livre").length;
              const expanded = openStage === st.key;
              const empty = total === 0;

              return (
                <div key={st.key} style={{ border: `1px solid ${expanded ? "var(--eclosion, #D9B21A)" : "var(--line)"}`, borderRadius: 12, background: "var(--card)", overflow: "hidden", opacity: empty ? 0.6 : 1, transition: "border-color .15s" }}>
                  <button
                    type="button"
                    disabled={empty}
                    onClick={() => setOpenStage(expanded ? null : st.key)}
                    style={{ width: "100%", border: "none", background: expanded ? "var(--eclosion-soft, #f6efd8)" : "transparent", textAlign: "left", padding: "12px 14px", cursor: empty ? "default" : "pointer", display: "flex", alignItems: "center", gap: 12 }}
                  >
                    {/* Numéro d'étape (pastille) */}
                    <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12.5, fontWeight: 800, fontFamily: "var(--font-mono, ui-monospace, monospace)", background: empty ? "var(--line)" : "var(--eclosion, #D9B21A)", color: empty ? "var(--muted)" : "#0B0B0C" }}>{i + 1}</span>

                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: empty ? "var(--muted)" : "var(--ink)" }}>{st.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                        {empty ? "Aucun ouvrage" : [
                          attente > 0 ? `${attente} en attente` : null,
                          cours > 0 ? `${cours} en cours` : null,
                          livre > 0 ? `${livre} livré${livre > 1 ? "s" : ""}` : null,
                        ].filter(Boolean).join(" · ") || `${total} ouvrage${total > 1 ? "s" : ""}`}
                      </span>
                      {/* Barre segmentée des états (proportions). */}
                      {!empty && (
                        <span style={{ display: "flex", height: 5, borderRadius: 999, overflow: "hidden", marginTop: 7, background: "var(--line)" }}>
                          {attente > 0 && <span style={{ flexGrow: attente, background: ATTENTE }} />}
                          {cours > 0 && <span style={{ flexGrow: cours, background: COURS }} />}
                          {livre > 0 && <span style={{ flexGrow: livre, background: LIVRE }} />}
                        </span>
                      )}
                    </span>

                    {/* Total + chevron */}
                    <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ textAlign: "right" }}>
                        <span style={{ display: "block", fontSize: 17, fontWeight: 800, fontFamily: "var(--font-mono, ui-monospace, monospace)", color: empty ? "var(--muted)" : "var(--ink)" }}>{total}</span>
                        <span style={{ display: "block", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" }}>Total</span>
                      </span>
                      {!empty && <span aria-hidden style={{ color: "var(--muted)", fontSize: 12, transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>}
                    </span>
                  </button>

                  {expanded && total > 0 && (
                    <div style={{ padding: "0 14px 8px" }}>
                      {items.map((w) => {
                        const etat = etatOf(w);
                        return (
                          <div key={`${w.manuscript_id}-${w.step_code}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid #ece6d4", padding: "10px 0" }}>
                            <div style={{ flex: 1, minWidth: 200 }}>
                              <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                                <span aria-hidden>📕</span>{w.title}
                              </div>
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
        </>
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}
