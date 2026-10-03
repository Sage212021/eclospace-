import { useEffect, useState } from "react";
import { getMyProductionWork, type MyProductionWork as Work } from "../api/client";

// « Mes travaux de production » (demande opérateur 03/10) — TABLEAU DE BORD du
// pôle Production. À l'ouverture : une vue synthétique de TOUTE la charge de
// l'utilisateur, par ÉTAPE de production (Total / En attente / En cours /
// Validés-livrés), dans l'ordre réel du circuit. Chaque ligne d'étape se déroule
// pour montrer les ouvrages concernés ; chaque ouvrage ouvre sa fiche de travail.
// Les chiffres sont dynamiques (recalculés depuis le workflow réel à chaque
// chargement) ; un même ouvrage peut être « livré » à une étape et « en attente »
// à une autre — le workflow suit chaque étape séparément.

// Étapes de production, dans l'ordre réel, avec les codes workflow qu'elles
// regroupent. L'intégration de correction (couverture) est la 1re étape du pôle.
const STAGES: { key: string; label: string; codes: string[] }[] = [
  { key: "integration", label: "Mes intégrations & corrections", codes: ["INTEGRATION_COUVERTURE", "INTEGRATION_TEXTE"] },
  { key: "maquette", label: "Maquette / Mise en page", codes: ["MISE_EN_PAGE"] },
  { key: "infographie", label: "Infographie / Couverture", codes: ["INFOGRAPHIE"] },
  { key: "references", label: "Références / ISBN / Dépôt légal", codes: ["ATTRIBUTION_REFERENCES"] },
  { key: "bat", label: "BAT / Final", codes: ["VALIDATION_BAT"] },
  { key: "impression", label: "Impression", codes: ["IMPRESSION", "CONTROLE_QUALITE_IMPRESSION"] },
];

// État d'un travail (regroupe les 4 bacs internes en 3 colonnes lisibles) :
//  • En attente = confié mais pas commencé OU bloqué par un préalable manquant ;
//  • En cours   = travail commencé ;
//  • Livré      = étape validée par l'utilisateur.
type EtatCol = "attente" | "cours" | "livre";
function etatOf(w: Work): EtatCol {
  if (w.bucket === "termine") return "livre";
  if (w.bucket === "en_cours") return "cours";
  return "attente"; // a_traiter + en_attente
}
const ETAT_LABEL: Record<EtatCol, string> = { attente: "En attente", cours: "En cours", livre: "Livré" };
const ETAT_COLOR: Record<EtatCol, string> = { attente: "#B87400", cours: "var(--eclosion-dark, #9a7a12)", livre: "#2F7D4A" };

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
    <section style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Mes travaux de production</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        Vue d'ensemble de toute votre charge de production, étape par étape. Cliquez sur une étape pour voir les ouvrages concernés, puis sur un ouvrage pour ouvrir son travail.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {rows === null && !error && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}

      {rows !== null && !hasAny && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          Aucun travail de production ne vous est confié pour l'instant. Dès qu'un ouvrage vous sera transmis (intégration, mise en page, infographie, références, BAT…), il apparaîtra ici.
        </div>
      )}

      {rows !== null && hasAny && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--card)" }}>
          {/* En-tête de colonnes */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 54px 90px 78px 78px", gap: 6, padding: "9px 12px", background: "var(--ivory, #FAF8F2)", borderBottom: "1px solid var(--line)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--muted)" }}>
            <span>Étape de production</span>
            <span style={{ textAlign: "center" }}>Total</span>
            <span style={{ textAlign: "center" }}>En attente</span>
            <span style={{ textAlign: "center" }}>En cours</span>
            <span style={{ textAlign: "center" }}>Livrés</span>
          </div>

          {STAGES.map((st) => {
            const items = stageRows(st.codes);
            const total = items.length;
            const attente = items.filter((w) => etatOf(w) === "attente").length;
            const cours = items.filter((w) => etatOf(w) === "cours").length;
            const livre = items.filter((w) => etatOf(w) === "livre").length;
            const expanded = openStage === st.key;
            const disabled = total === 0;
            return (
              <div key={st.key} style={{ borderBottom: "1px solid var(--line)" }}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setOpenStage(expanded ? null : st.key)}
                  style={{
                    width: "100%", display: "grid", gridTemplateColumns: "1fr 54px 90px 78px 78px", gap: 6, alignItems: "center",
                    padding: "11px 12px", border: "none", textAlign: "left", cursor: disabled ? "default" : "pointer",
                    background: expanded ? "var(--eclosion-soft, #f6efd8)" : "transparent", fontSize: 13,
                  }}
                >
                  <span style={{ fontWeight: 700, color: disabled ? "var(--muted)" : "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span aria-hidden style={{ color: "var(--muted)", width: 12, display: "inline-block" }}>{disabled ? "" : expanded ? "▾" : "▸"}</span>
                    {st.label}
                  </span>
                  <span style={{ textAlign: "center", fontWeight: 800, fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{total}</span>
                  <Cell n={attente} color={ETAT_COLOR.attente} />
                  <Cell n={cours} color={ETAT_COLOR.cours} />
                  <Cell n={livre} color={ETAT_COLOR.livre} />
                </button>

                {expanded && total > 0 && (
                  <div style={{ padding: "2px 12px 12px", background: "var(--ivory, #FAF8F2)" }}>
                    {items.map((w) => {
                      const etat = etatOf(w);
                      return (
                        <div key={`${w.manuscript_id}-${w.step_code}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid #ece6d4", padding: "9px 2px" }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>📕 {w.title}</div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{w.manuscript_number}</span>
                              <span style={{ fontWeight: 700, color: ETAT_COLOR[etat] }}>{etat === "livre" ? "✓ " : ""}{ETAT_LABEL[etat]}</span>
                            </div>
                            {w.blocked_reason && <div style={{ fontSize: 12, color: "#B87400", marginTop: 3 }}>⏳ En attente : {w.blocked_reason}.</div>}
                            {w.detail && !w.blocked_reason && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{w.detail}</div>}
                          </div>
                          {canOpen ? (
                            <button
                              onClick={() => (w.kind === "integration" ? onOpenIntegration(w.manuscript_id) : onOpenManuscript(w.manuscript_id))}
                              style={{ border: "1px solid var(--eclosion, #D9B21A)", background: etat === "livre" ? "#fff" : "var(--eclosion, #D9B21A)", color: etat === "livre" ? "var(--eclosion-dark, #9a7a12)" : "#0B0B0C", borderRadius: 8, padding: "6px 14px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
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
      )}
    </section>
  );
}

function Cell({ n, color }: { n: number; color: string }) {
  return (
    <span style={{ textAlign: "center", fontWeight: 700, fontFamily: "var(--font-mono, ui-monospace, monospace)", color: n > 0 ? color : "var(--line)" }}>
      {n}
    </span>
  );
}
