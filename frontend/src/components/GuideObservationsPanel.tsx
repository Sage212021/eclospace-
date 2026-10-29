import { useEffect, useState } from "react";
import { getImprovementGuide, updateGuideObservation, validateImprovementGuide, requestGuideRewrite, decideGuideRewrite, type ImprovementGuideState, type GuideObservation } from "../api/client";

// Guide éditorial d'amélioration (SAGE) — suivi des observations EVAL-xxx et
// validation du comité « pour transmission à l'auteur » (Phase 2). N'affiche
// rien tant qu'aucun guide n'a été généré pour l'ouvrage.

const STATUS_LABELS: Record<string, string> = {
  a_traiter: "À traiter",
  en_cours: "En cours",
  traite: "Traité",
  ecarte: "Écarté",
  a_verifier: "À vérifier",
};
const STATUSES = ["a_traiter", "en_cours", "traite", "ecarte", "a_verifier"];
const PRIORITY_LABELS: Record<string, string> = { majeure: "Majeure", importante: "Importante", secondaire: "Secondaire" };
const PRIORITY_COLOR: Record<string, string> = { majeure: "#B23A2E", importante: "#B87400", secondaire: "#6b7280" };

export function GuideObservationsPanel({ manuscriptId, canManage }: { manuscriptId: string; canManage: boolean }) {
  const [state, setState] = useState<ImprovementGuideState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setState(await getImprovementGuide(manuscriptId)); }
    catch { setState({ guide: null, observations: [] }); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId]);

  if (!state || !state.guide) return null; // pas de guide → rien à afficher

  const { guide, observations } = state;

  async function setStatus(obsId: string, status: string) {
    setBusy(true); setError(null);
    try { await updateGuideObservation(manuscriptId, obsId, { status }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Mise à jour impossible."); }
    finally { setBusy(false); }
  }
  async function validate() {
    setBusy(true); setError(null);
    try { await validateImprovementGuide(manuscriptId); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Validation impossible."); }
    finally { setBusy(false); }
  }

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginTop: 16, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <h3 style={{ fontFamily: "var(--font-title)", fontSize: 16, margin: 0 }}>Guide éditorial d'amélioration</h3>
        {guide.validated
          ? <span style={{ fontSize: 12, fontWeight: 600, color: "#2F7D4A", border: "1px solid #2F7D4A", borderRadius: 999, padding: "1px 10px" }}>Validé — transmissible</span>
          : <span style={{ fontSize: 12, fontWeight: 600, color: "#B87400", border: "1px solid #B87400", borderRadius: 999, padding: "1px 10px" }}>Brouillon — à valider</span>}
        {canManage && !guide.validated && (
          <button onClick={validate} disabled={busy} style={{ marginLeft: "auto", background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
            Valider pour transmission à l'auteur
          </button>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>
        Établi par le Service éditorial à partir du rapport d'évaluation et du manuscrit. Suivez le traitement de chaque observation. Le document complet est dans « Documents » (rubrique « Guide éditorial d'amélioration »).
      </p>
      {error && <p style={{ fontSize: 12.5, color: "#B23A2E" }}>{error}</p>}
      {observations.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Aucune observation structurée n'a été extraite — consultez le guide complet dans les documents.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {observations.map((o) => (
            <div key={o.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "9px 11px", background: "var(--ivory, #FAF8F2)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 700 }}>{o.code}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_COLOR[o.priority] ?? "#6b7280" }}>{PRIORITY_LABELS[o.priority] ?? o.priority}</span>
                {o.title && <span style={{ fontSize: 13, fontWeight: 600 }}>{o.title}</span>}
                <span style={{ marginLeft: "auto", fontSize: 12 }}>
                  {canManage ? (
                    <select value={o.status} disabled={busy} onChange={(e) => setStatus(o.id, e.target.value)} style={{ padding: "4px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  ) : <span style={{ color: "var(--muted)" }}>{STATUS_LABELS[o.status] ?? o.status}</span>}
                </span>
              </div>
              {o.location && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Localisation : {o.location}</div>}
              {o.recommendation && <div style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{o.recommendation}</div>}
              <RewriteBlock obs={o} manuscriptId={manuscriptId} canManage={canManage} onChange={load} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Mode « assistance à la réécriture » (Phase 2b) : SAGE propose, l'humain décide.
const lbl: React.CSSProperties = { fontWeight: 600, color: "var(--muted)", marginRight: 4 };
const quote: React.CSSProperties = { borderLeft: "3px solid var(--line)", padding: "2px 8px", marginTop: 2, whiteSpace: "pre-wrap", lineHeight: 1.45 };
const ghostBtn: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" };
const primBtn: React.CSSProperties = { background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const taStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, resize: "vertical", marginTop: 2 };
const errStyle: React.CSSProperties = { color: "#B23A2E", fontSize: 12, marginLeft: 8 };

function RewriteBlock({ obs, manuscriptId, canManage, onChange }: { obs: GuideObservation; manuscriptId: string; canManage: boolean; onChange: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(obs.rewrite_proposal ?? "");
  const [err, setErr] = useState<string | null>(null);
  const st = obs.rewrite_status;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); await onChange(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Action impossible."); }
    finally { setBusy(false); }
  }

  if (st === "none") {
    if (!canManage) return null;
    return (
      <div style={{ marginTop: 6 }}>
        <button disabled={busy} onClick={() => run(() => requestGuideRewrite(manuscriptId, obs.id))} style={ghostBtn}>{busy ? "SAGE rédige…" : "✍️ Proposer une réécriture (SAGE)"}</button>
        {err && <span style={errStyle}>{err}</span>}
      </div>
    );
  }
  if (st === "non_applicable") {
    return (
      <div style={{ marginTop: 6, fontSize: 12, background: "#fff", border: "1px dashed var(--line)", borderRadius: 6, padding: "7px 9px" }}>
        <b>Réécriture non adaptée</b> — une recherche ou un approfondissement est nécessaire (pas de texte inventé).
        {obs.rewrite_problem && <div style={{ marginTop: 3 }}>{obs.rewrite_problem}</div>}
        {obs.rewrite_justification && <div style={{ marginTop: 3, color: "var(--muted)" }}>{obs.rewrite_justification}</div>}
        {canManage && <div style={{ marginTop: 5 }}><button disabled={busy} onClick={() => run(() => requestGuideRewrite(manuscriptId, obs.id))} style={ghostBtn}>↻ Redemander</button>{err && <span style={errStyle}>{err}</span>}</div>}
      </div>
    );
  }
  const decided = st === "acceptee" || st === "refusee";
  const tag = st === "acceptee" ? " · acceptée" : st === "refusee" ? " · refusée" : st === "modifiee" ? " · modifiée" : "";
  return (
    <div style={{ marginTop: 6, fontSize: 12, background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Proposition de réécriture{tag}</div>
      {obs.rewrite_original && <div style={{ marginBottom: 4 }}><span style={lbl}>Texte original</span><div style={quote}>{obs.rewrite_original}</div></div>}
      {obs.rewrite_problem && <div style={{ marginBottom: 4 }}><span style={lbl}>Problème</span>{obs.rewrite_problem}</div>}
      <div style={{ marginBottom: 4 }}><span style={lbl}>Proposition</span>
        {editing ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} style={taStyle} /> : <div style={{ ...quote, borderLeftColor: "#2F7D4A" }}>{obs.rewrite_proposal}</div>}
      </div>
      {obs.rewrite_justification && <div style={{ marginBottom: 4, color: "var(--muted)" }}><span style={lbl}>Justification</span>{obs.rewrite_justification}</div>}
      {canManage && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
          {editing ? (
            <>
              <button disabled={busy} onClick={() => run(async () => { await decideGuideRewrite(manuscriptId, obs.id, { decision: "modifiee", proposal: draft }); setEditing(false); })} style={primBtn}>Enregistrer la modification</button>
              <button disabled={busy} onClick={() => { setEditing(false); setDraft(obs.rewrite_proposal ?? ""); }} style={ghostBtn}>Annuler</button>
            </>
          ) : (
            <>
              {!decided && <button disabled={busy} onClick={() => run(() => decideGuideRewrite(manuscriptId, obs.id, { decision: "acceptee" }))} style={primBtn}>Accepter</button>}
              {!decided && <button disabled={busy} onClick={() => { setDraft(obs.rewrite_proposal ?? ""); setEditing(true); }} style={ghostBtn}>Modifier</button>}
              {!decided && <button disabled={busy} onClick={() => run(() => decideGuideRewrite(manuscriptId, obs.id, { decision: "refusee" }))} style={ghostBtn}>Refuser</button>}
              <button disabled={busy} onClick={() => run(() => requestGuideRewrite(manuscriptId, obs.id))} style={ghostBtn}>↻ Nouvelle proposition</button>
            </>
          )}
          {err && <span style={errStyle}>{err}</span>}
        </div>
      )}
    </div>
  );
}
