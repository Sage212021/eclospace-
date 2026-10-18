import { useEffect, useMemo, useState } from "react";
import {
  listManuscripts,
  getAiEditor,
  diagnoseAiEditor,
  sendAiEditorMessage,
  requestAiEditorRewrite,
  decideAiEditorRewrite,
  type Manuscript,
  type AiEditorDossier,
  type AiEditorMessage,
  type AiEditorRewrite,
  type RewriteMode,
} from "../api/client";

const REWRITE_MODE_LABELS: Record<RewriteMode, string> = {
  fidele: "Fidèle à l'auteur",
  renforce: "Littérairement renforcé",
  alternatif: "Proposition alternative",
};

// ÉCLOSION ÉDITORIAL IA — Lot A (lecture + diagnostic + dialogue). Réservé DG +
// admin. On choisit un ouvrage DÉJÀ enregistré dans Eclospace ; l'agent lit son
// manuscrit et son rapport d'évaluation déjà déposés, en fait un diagnostic, et
// on peut dialoguer avec lui. Tout est conservé et horodaté.

export function AiEditorPage() {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dossier, setDossier] = useState<AiEditorDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rwMode, setRwMode] = useState<RewriteMode>("fidele");
  const [rwSource, setRwSource] = useState("");
  const [rwInstruction, setRwInstruction] = useState("");

  useEffect(() => {
    listManuscripts().then(setManuscripts).catch(() => setManuscripts([]));
  }, []);

  const loadDossier = (id: string) => getAiEditor(id).then(setDossier).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));

  useEffect(() => {
    if (!selectedId) { setDossier(null); return; }
    setError(null);
    setDossier(null);
    loadDossier(selectedId);
  }, [selectedId]);

  // Rafraîchissement tant qu'une réponse OU une réécriture est en cours en fond.
  const pending =
    (dossier?.messages.some((m) => m.status === "pending") ?? false) ||
    (dossier?.rewrites.some((r) => r.status === "pending") ?? false);
  useEffect(() => {
    if (!selectedId || !pending) return;
    const t = setTimeout(() => { loadDossier(selectedId); }, 5000);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [dossier, pending, selectedId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? manuscripts.filter((m) => m.title.toLowerCase().includes(q) || m.manuscriptNumber.toLowerCase().includes(q)) : manuscripts;
    return base.slice(0, 25);
  }, [manuscripts, query]);

  async function diagnose() {
    if (!selectedId) return;
    setBusy(true); setError(null);
    try {
      await diagnoseAiEditor(selectedId);
      await loadDossier(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diagnostic impossible.");
    } finally { setBusy(false); }
  }

  async function send() {
    if (!selectedId || !input.trim()) return;
    setBusy(true); setError(null);
    try {
      await sendAiEditorMessage(selectedId, input.trim());
      setInput("");
      await loadDossier(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally { setBusy(false); }
  }

  async function requestRewrite() {
    if (!selectedId || !rwSource.trim()) return;
    setBusy(true); setError(null);
    try {
      await requestAiEditorRewrite(selectedId, { mode: rwMode, source_text: rwSource.trim(), instruction: rwInstruction.trim() || undefined });
      setRwSource(""); setRwInstruction("");
      await loadDossier(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Réécriture impossible.");
    } finally { setBusy(false); }
  }

  async function decide(rewriteId: string, decision: "accepted" | "rejected") {
    if (!selectedId) return;
    setBusy(true); setError(null);
    try {
      await decideAiEditorRewrite(rewriteId, decision);
      await loadDossier(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Décision impossible.");
    } finally { setBusy(false); }
  }

  const diagnostic = dossier?.messages.find((m) => m.kind === "diagnostic");
  const chat = dossier?.messages.filter((m) => m.kind === "chat") ?? [];
  const rewrites = dossier?.rewrites ?? [];

  return (
    <section style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 21, margin: "0 0 4px", fontFamily: "var(--font-title, inherit)" }}>🖋️ SAGE — Éditeur professionnel</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        SAGE est l'éditeur professionnel des Éditions Éclosion. Choisissez un ouvrage <b>enregistré dans Eclospace</b> : il lit son manuscrit et son rapport d'évaluation déjà déposés,
        en établit un <b>diagnostic éditorial</b>, et vous pouvez <b>dialoguer</b> avec lui. Ses réponses se fondent sur le texte réel ; chaque échange est conservé.
        <br />Réservé à la Direction générale et à l'administrateur.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {/* Choix de l'ouvrage */}
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Ouvrage</div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par titre ou référence…"
          style={{ width: "100%", padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, marginBottom: 8 }}
        />
        <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value || null)} style={{ width: "100%", padding: "7px 8px", fontSize: 13 }}>
          <option value="">— Choisir un ouvrage —</option>
          {matches.map((m) => (
            <option key={m.id} value={m.id}>{m.title} · {m.manuscriptNumber}</option>
          ))}
        </select>
      </div>

      {dossier && (
        <>
          {/* Sources disponibles */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--ivory, #FAF8F2)", padding: 12, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>📘 {dossier.manuscript.title} <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, color: "var(--muted)" }}>{dossier.manuscript.number}</span></div>
            <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.7 }}>
              <div style={{ color: dossier.sources.has_manuscript_file ? "#2F7D4A" : "#B87400" }}>
                {dossier.sources.has_manuscript_file ? "✅ Manuscrit déposé" : "⚠ Aucun manuscrit déposé (le diagnostic nécessite le manuscrit)"}
              </div>
              <div style={{ color: dossier.sources.has_evaluation_report ? "#2F7D4A" : "var(--muted)" }}>
                {dossier.sources.has_evaluation_report ? "✅ Rapport d'évaluation disponible" : "ⓘ Aucun rapport d'évaluation (l'agent s'appuiera sur le manuscrit seul)"}
              </div>
              <div style={{ color: dossier.memory.passage_count > 0 ? "#2F7D4A" : "var(--muted)" }}>
                {dossier.memory.passage_count > 0
                  ? `✅ Mémoire prête : ${dossier.memory.passage_count} passages indexés (SAGE cite le chapitre/extrait)`
                  : "ⓘ Mémoire non constituée (lancez le diagnostic pour indexer le manuscrit)"}
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                onClick={diagnose}
                disabled={busy || pending || !dossier.sources.has_manuscript_file}
                title={!dossier.sources.has_manuscript_file ? "Déposez d'abord le manuscrit dans la fiche." : undefined}
                style={{ background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "7px 15px", fontWeight: 700, fontSize: 12.5, cursor: busy || pending || !dossier.sources.has_manuscript_file ? "not-allowed" : "pointer", opacity: busy || pending || !dossier.sources.has_manuscript_file ? 0.55 : 1 }}
              >
                {diagnostic ? "Relancer le diagnostic" : "Lancer le diagnostic éditorial"}
              </button>
            </div>
          </div>

          {/* Diagnostic */}
          {diagnostic && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Diagnostic éditorial</div>
              <MessageBody m={diagnostic} />
            </div>
          )}

          {/* Dialogue */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Dialogue avec l'éditeur</div>
            {chat.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Posez une question sur l'ouvrage (ex. « Le dénouement est-il assez préparé ? », « Le personnage principal est-il crédible ? »).</p>}
            <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
              {chat.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "85%", background: m.role === "user" ? "var(--eclosion-soft, #f6efd8)" : "var(--ivory, #FAF8F2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px", fontSize: 13 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginBottom: 3 }}>{m.role === "user" ? "Vous" : "SAGE"}</div>
                    <MessageBody m={m} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Votre question à l'éditeur…"
                rows={2}
                style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, resize: "vertical" }}
              />
              <button
                onClick={send}
                disabled={busy || pending || !input.trim()}
                style={{ background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "9px 15px", fontWeight: 700, fontSize: 12.5, cursor: busy || pending || !input.trim() ? "not-allowed" : "pointer", opacity: busy || pending || !input.trim() ? 0.55 : 1, whiteSpace: "nowrap" }}
              >
                Envoyer
              </button>
            </div>
            {pending && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>L'éditeur réfléchit… (la réponse s'affichera ici, vous pouvez patienter ou revenir plus tard)</div>}
          </div>

          {/* Atelier de réécriture */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 14, marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Atelier de réécriture</div>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 10px", lineHeight: 1.5 }}>
              Collez le passage à retravailler, choisissez un mode, et SAGE propose une réécriture + une explication. <b>L'original est conservé</b> ; rien n'est appliqué au manuscrit tant que vous n'avez pas accepté.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {(Object.keys(REWRITE_MODE_LABELS) as RewriteMode[]).map((mode) => (
                <label key={mode} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 8, padding: "5px 9px", background: rwMode === mode ? "var(--eclosion-soft, #f6efd8)" : "#fff", cursor: "pointer" }}>
                  <input type="radio" name="rwmode" checked={rwMode === mode} onChange={() => setRwMode(mode)} />
                  {REWRITE_MODE_LABELS[mode]}
                </label>
              ))}
            </div>
            <textarea value={rwSource} onChange={(e) => setRwSource(e.target.value)} placeholder="Collez ici le passage à réécrire…" rows={4} style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, resize: "vertical", marginBottom: 8 }} />
            <input value={rwInstruction} onChange={(e) => setRwInstruction(e.target.value)} placeholder="Consigne particulière (facultatif) — ex. « rendre le dialogue plus vif »" style={{ width: "100%", padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5, marginBottom: 8 }} />
            <button onClick={requestRewrite} disabled={busy || pending || !rwSource.trim()} style={{ background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "8px 15px", fontWeight: 700, fontSize: 12.5, cursor: busy || pending || !rwSource.trim() ? "not-allowed" : "pointer", opacity: busy || pending || !rwSource.trim() ? 0.55 : 1 }}>
              Proposer une réécriture
            </button>

            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {rewrites.map((r) => <RewriteCard key={r.id} r={r} busy={busy} onDecide={decide} />)}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function MessageBody({ m }: { m: AiEditorMessage }) {
  if (m.status === "pending") return <span style={{ color: "var(--muted)", fontStyle: "italic" }}>Analyse en cours…</span>;
  if (m.status === "erreur") return <span style={{ color: "var(--alert)" }}>⚠ {m.error_message || "L'analyse a échoué."}</span>;
  return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{m.content}</div>;
}

const REWRITE_CARD_MODE: Record<string, string> = { fidele: "Fidèle à l'auteur", renforce: "Littérairement renforcé", alternatif: "Proposition alternative" };
const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending: { label: "En cours…", color: "#B87400" },
  done: { label: "Proposition prête", color: "var(--eclosion-dark, #9a7a12)" },
  erreur: { label: "Échec", color: "#B23A2E" },
  accepted: { label: "Acceptée", color: "#2F7D4A" },
  rejected: { label: "Refusée", color: "var(--muted)" },
};

function RewriteCard({ r, busy, onDecide }: { r: AiEditorRewrite; busy: boolean; onDecide: (id: string, d: "accepted" | "rejected") => void }) {
  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.done;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--ivory, #FAF8F2)", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Mode : {REWRITE_CARD_MODE[r.mode] ?? r.mode}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: badge.color }}>{badge.label}</span>
      </div>
      {r.instruction && <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>Consigne : {r.instruction}</div>}
      {r.status === "erreur" ? (
        <div style={{ color: "var(--alert)", fontSize: 12.5 }}>⚠ {r.error_message || "La réécriture a échoué."}</div>
      ) : r.status === "pending" ? (
        <div style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 12.5 }}>SAGE réécrit le passage…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginBottom: 3 }}>ORIGINAL</div>
              <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: 8, maxHeight: 220, overflow: "auto" }}>{r.source_text}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", marginBottom: 3 }}>PROPOSÉ PAR SAGE</div>
              <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#fff", border: "1px solid var(--eclosion, #D9B21A)", borderRadius: 6, padding: 8, maxHeight: 220, overflow: "auto" }}>{r.proposed_text}</div>
            </div>
          </div>
          {r.explanation && (
            <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Explication : </span><span style={{ whiteSpace: "pre-wrap" }}>{r.explanation}</span>
            </div>
          )}
          {(r.status === "done") && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => onDecide(r.id, "accepted")} disabled={busy} style={{ background: "#2F7D4A", color: "#fff", border: "none", borderRadius: 8, padding: "6px 13px", fontWeight: 700, fontSize: 12.5, cursor: busy ? "not-allowed" : "pointer" }}>Accepter</button>
              <button onClick={() => onDecide(r.id, "rejected")} disabled={busy} style={{ background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 13px", fontWeight: 600, fontSize: 12.5, cursor: busy ? "not-allowed" : "pointer" }}>Refuser</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
