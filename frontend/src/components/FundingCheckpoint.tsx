import { useState } from "react";
import { setManuscriptFunding, type FundingMode, type QuoteDecision } from "../api/client";

// Jalon « Prise en charge & devis » (reconfiguration Finance) — VOLONTAIREMENT
// NON BLOQUANT. Pour un ouvrage à compte d'auteur, on propose des options
// (établir le devis, plus tard, passer l'étape) sans jamais empêcher le travail
// éditorial. L'établissement du devis lui-même se fait dans la section « Devis »
// ci-dessous (côté Finance).

const DECISION_LABEL: Record<QuoteDecision, string> = {
  pending: "Décision à prendre",
  requested: "Devis demandé à la Finance",
  deferred: "Reporté à plus tard",
  skipped: "Étape passée",
};

export function FundingCheckpoint({
  manuscriptId,
  fundingMode,
  quoteDecision,
  quoteDecisionNote,
  canManage,
  onChanged,
}: {
  manuscriptId: string;
  fundingMode: FundingMode;
  quoteDecision: QuoteDecision;
  quoteDecisionNote: string | null | undefined;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(input: { funding_mode?: FundingMode; decision?: QuoteDecision; note?: string }) {
    setBusy(true);
    setError(null);
    try {
      await setManuscriptFunding(manuscriptId, input);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    const note = window.prompt("Passer l'étape du devis — indiquez brièvement pourquoi (ex. accord particulier, ouvrage offert) :");
    if (note === null) return;
    if (!note.trim()) {
      setError("Une justification est requise pour passer l'étape.");
      return;
    }
    apply({ decision: "skipped", note: note.trim() });
  }

  const author = fundingMode === "author";
  const decided = quoteDecision !== "pending";

  return (
    <section className="ecl-card">
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>Prise en charge & devis</h3>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
        Qui finance l'ouvrage ? Pour un ouvrage à compte d'auteur, un devis est attendu — mais cette étape ne bloque jamais le travail éditorial.
      </p>
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {/* Mode de prise en charge */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(["publisher", "author"] as const).map((m) => (
          <button
            key={m}
            disabled={!canManage || busy}
            onClick={() => apply({ funding_mode: m })}
            style={{ border: `1px solid ${fundingMode === m ? "var(--eclosion)" : "var(--line)"}`, background: fundingMode === m ? "var(--eclosion-soft)" : "#fff", color: "var(--ink)", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: fundingMode === m ? 700 : 400, cursor: canManage ? "pointer" : "default" }}
          >
            {m === "publisher" ? "À compte d'éditeur" : "À compte d'auteur"}
          </button>
        ))}
      </div>

      {!author && <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>À compte d'éditeur : aucun devis auteur requis.</p>}

      {author && (
        <>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <span style={{ color: "var(--muted)" }}>État du jalon : </span>
            <span style={{ fontWeight: 700, color: quoteDecision === "skipped" ? "var(--muted)" : "var(--ink)" }}>{DECISION_LABEL[quoteDecision]}</span>
            {quoteDecision === "skipped" && quoteDecisionNote ? <span style={{ color: "var(--muted)" }}> — {quoteDecisionNote}</span> : null}
          </div>
          {canManage && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={() => apply({ decision: "requested" })} style={btn("var(--eclosion)", true)}>
                Établir le devis
              </button>
              <button disabled={busy} onClick={() => apply({ decision: "deferred" })} style={btn("var(--line)", false)}>
                Plus tard
              </button>
              <button disabled={busy} onClick={skip} style={btn("var(--line)", false)}>
                Passer cette étape
              </button>
            </div>
          )}
          {quoteDecision === "requested" && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>La Finance est prévenue. Le devis s'établit dans la section « Devis de prestation » ci-dessous.</p>
          )}
          {decided && canManage && (
            <button disabled={busy} onClick={() => apply({ decision: "pending" })} style={{ marginTop: 8, border: "none", background: "none", color: "var(--muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
              Réinitialiser la décision
            </button>
          )}
        </>
      )}
    </section>
  );
}

function btn(color: string, primary: boolean): React.CSSProperties {
  return { border: `1px solid ${color}`, background: primary ? color : "#fff", color: primary ? "#fff" : "var(--ink)", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: primary ? 700 : 400, cursor: "pointer" };
}
