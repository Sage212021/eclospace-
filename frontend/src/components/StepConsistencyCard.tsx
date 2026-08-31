import { useEffect, useState } from "react";
import { getStepConsistency, realignStepConsistency, type IncoherentManuscript } from "../api/client";

// Cohérence des dossiers (maintenance) : liste les ouvrages présents à plusieurs
// étapes à la fois (étape-fantôme en avance sur leur position officielle) et
// permet de les réaligner sur l'étape la moins avancée. Réservé à l'administration.

const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 };
const btn: React.CSSProperties = { background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };

export function StepConsistencyCard({ canAdminister }: { canAdminister: boolean }) {
  const [rows, setRows] = useState<IncoherentManuscript[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => getStepConsistency().then((r) => setRows(r.manuscripts)).catch((e) => {
    if ((e as { status?: number }).status === 403) setForbidden(true);
    else setErr("Analyse impossible.");
  });
  useEffect(() => { load(); }, []);

  async function realign(ids?: string[]) {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await realignStepConsistency(ids);
      setNote(`Réalignement effectué : ${r.realigned} dossier(s), ${r.steps_reset} étape(s) réinitialisée(s), ${r.tasks_cancelled} tâche(s) annulée(s).`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Réalignement impossible.");
    } finally { setBusy(false); }
  }

  if (forbidden) return null;

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Cohérence des dossiers</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px", lineHeight: 1.6 }}>
        Ouvrages présents à <strong>plusieurs étapes à la fois</strong> : leur position officielle est en retard sur une étape
        encore « active » (responsable assigné) plus avancée — souvent après un ouvrage avancé par erreur puis reculé. Le
        <strong> réalignement</strong> les remet à l'<strong>étape la moins avancée</strong> (leur position officielle) en
        réinitialisant les étapes-fantômes et en annulant leurs tâches en attente. L'historique validé n'est pas touché.
      </p>
      {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      {!rows ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Analyse…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#2F7D4A", fontSize: 13, fontWeight: 600 }}>✓ Aucun dossier incohérent. Tout est cohérent.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{rows.length} dossier(s) incohérent(s)</span>
            {canAdminister && <button style={btn} disabled={busy} onClick={() => realign()}>{busy ? "Réalignement…" : "Tout réaligner"}</button>}
          </div>
          {rows.map((m) => (
            <div key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}><span style={{ fontFamily: "var(--font-mono)" }}>{m.number}</span> — {m.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                    Position officielle : <strong>{m.current.label}</strong> · Étape(s)-fantôme en avance : {m.stray_steps.map((s) => `${s.label}${s.responsible ? ` (${s.responsible})` : ""}`).join(", ")}
                  </div>
                </div>
                {canAdminister && <button style={btnGhost} disabled={busy} onClick={() => realign([m.id])}>Réaligner</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
