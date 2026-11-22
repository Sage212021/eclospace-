import { useState } from "react";
import { setStepNotApplicable, type TimelineStep } from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

// « Étapes non applicables » (D-075) : un responsable peut déclarer une étape À
// VENIR non applicable à cet ouvrage (numérique, déjà paru, sans stock…) — la
// navigation la saute, sans bloquer la suite. Motif obligatoire, réversible.
export function NotApplicableSteps({ manuscriptId, timeline, onChanged }: { manuscriptId: string; timeline: TimelineStep[]; onChanged: () => void | Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Étapes À VENIR que l'on peut basculer : soit encore applicables (déclarables),
  // soit déjà déclarées non applicables (rétablissables).
  const candidates = timeline.filter((s) => s.state === "todo" && (s.not_applicable === true || s.applicable !== false));
  if (candidates.length === 0) return null;

  async function mark(code: string, na: boolean, why?: string) {
    setBusy(code);
    setErr(null);
    try {
      await setStepNotApplicable(manuscriptId, code, na, why);
      setEditing(null);
      setReason("");
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(null);
    }
  }

  const btn: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", borderRadius: 7, padding: "5px 11px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" };
  const btnGold: React.CSSProperties = { ...btn, background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", fontWeight: 700 };

  return (
    <CollapsibleSection
      title="Étapes non applicables (cas particuliers)"
      subtitle="Numérique, ouvrage déjà paru, sans stock… — une étape à venir peut être déclarée non applicable, sans bloquer la suite."
      storageKey={`fiche:na-steps:${manuscriptId}`}
    >
      {err && <div style={{ background: "#F6E2DE", color: "#B23A2E", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "grid", gap: 7 }}>
        {candidates.map((s) => (
          <div key={s.status_code} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: s.not_applicable ? "var(--paper, #FAF8F2)" : "#fff" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{s.label}</span>
              {s.not_applicable && (
                <div style={{ fontSize: 11.5, color: "#B87400", marginTop: 2 }}>Non applicable{s.not_applicable_reason ? <> — {s.not_applicable_reason}</> : null}</div>
              )}
            </div>
            {s.not_applicable ? (
              <button onClick={() => mark(s.status_code, false)} disabled={busy === s.status_code} style={btn}>
                {busy === s.status_code ? "…" : "Rétablir"}
              </button>
            ) : editing === s.status_code ? (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motif (ex. ouvrage numérique)"
                  style={{ fontSize: 12.5, borderRadius: 6, border: "1px solid var(--line)", padding: "5px 8px", minWidth: 170 }}
                />
                <button onClick={() => mark(s.status_code, true, reason)} disabled={busy === s.status_code || reason.trim().length < 2} style={btnGold}>
                  {busy === s.status_code ? "…" : "Confirmer"}
                </button>
                <button onClick={() => { setEditing(null); setReason(""); }} style={btn}>Annuler</button>
              </span>
            ) : (
              <button onClick={() => { setEditing(s.status_code); setReason(""); }} style={btn}>Déclarer non applicable</button>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
