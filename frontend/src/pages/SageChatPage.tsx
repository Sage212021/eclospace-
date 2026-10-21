import { useEffect, useRef, useState } from "react";
import {
  listSageConversations,
  getSageConversation,
  createSageConversation,
  sendSageMessage,
  renameSageConversation,
  archiveSageConversation,
  type SageConversation,
  type SageDossier,
} from "../api/client";

// « Échanger avec SAGE » — espace de dialogue privé du directeur général avec
// SAGE (éditeur de la maison). Conversations libres, persistantes, avec
// historique. Réservé à la Direction générale et à l'administrateur. Fondation
// (Lot 1) : réflexion éditoriale et projets ; la connexion aux manuscrits de
// l'ERP et les mémoires de connaissance viendront aux lots suivants.

export function SageChatPage() {
  const [conversations, setConversations] = useState<SageConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dossier, setDossier] = useState<SageDossier | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = () => listSageConversations().then((r) => setConversations(r.conversations)).catch(() => setConversations([]));
  useEffect(() => { loadConversations(); }, []);

  const loadDossier = (id: string) =>
    getSageConversation(id).then((d) => { setDossier(d); loadConversations(); }).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));

  useEffect(() => {
    if (!selectedId) { setDossier(null); return; }
    setError(null); setDossier(null);
    loadDossier(selectedId);
    /* eslint-disable-next-line */
  }, [selectedId]);

  // Rafraîchissement tant que SAGE rédige une réponse en arrière-plan.
  const pending = dossier?.messages.some((m) => m.status === "pending") ?? false;
  useEffect(() => {
    if (!selectedId || !pending) return;
    const t = setTimeout(() => loadDossier(selectedId), 4000);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [dossier, pending, selectedId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [dossier?.messages.length, pending]);

  async function newConversation() {
    setBusy(true); setError(null);
    try {
      const c = await createSageConversation();
      await loadConversations();
      setSelectedId(c.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible.");
    } finally { setBusy(false); }
  }

  async function send() {
    if (!selectedId || !input.trim()) return;
    setBusy(true); setError(null);
    try {
      await sendSageMessage(selectedId, input.trim());
      setInput("");
      await loadDossier(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally { setBusy(false); }
  }

  async function rename() {
    if (!selectedId || !dossier) return;
    const title = window.prompt("Titre de la conversation :", dossier.title);
    if (title === null || !title.trim()) return;
    try {
      await renameSageConversation(selectedId, title.trim());
      setDossier({ ...dossier, title: title.trim() });
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Renommage impossible.");
    }
  }

  async function archive(id: string) {
    if (!window.confirm("Retirer cette conversation de la liste ?")) return;
    try {
      await archiveSageConversation(id);
      if (selectedId === id) { setSelectedId(null); setDossier(null); }
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  return (
    <section style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 21, margin: "0 0 4px", fontFamily: "var(--font-title, inherit)" }}>💬 Échanger avec SAGE</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Votre espace de travail privé avec SAGE, l'éditeur de la maison : réfléchissez à des projets, des collections, des manuscrits (enregistrés ou à l'état d'idée), demandez des synthèses ou des avis. Vos conversations sont conservées et ne sont visibles que de vous.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {!selectedId && (
        <>
          <button onClick={newConversation} disabled={busy} style={{ ...primaryBtnStyle, marginBottom: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>+ Nouvelle conversation</button>
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Mes conversations</div>
            {conversations.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>Aucune conversation pour l'instant. Démarrez-en une ci-dessus.</p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {conversations.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => setSelectedId(c.id)} style={{ ...rowBtnStyle, flex: 1 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {c.title}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{c.message_count} msg · {new Date(c.updated_at).toLocaleDateString("fr-FR")}</span>
                    </button>
                    <button onClick={() => archive(c.id)} title="Retirer de la liste" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--muted)", padding: 4 }}>🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {selectedId && dossier && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button onClick={() => { setSelectedId(null); loadConversations(); }} style={{ ...rowBtnStyle, display: "inline-flex", width: "auto", fontWeight: 700 }}>← Mes conversations</button>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{dossier.title}</span>
            <button onClick={rename} title="Renommer" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>✎</button>
          </div>

          <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 14 }}>
            {dossier.messages.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Posez votre première question ou décrivez un projet. SAGE répond comme un collaborateur éditorial.</p>}
            <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
              {dossier.messages.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "88%", background: m.role === "user" ? "var(--eclosion-soft, #f6efd8)" : "var(--ivory, #FAF8F2)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13.5 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginBottom: 3 }}>{m.role === "user" ? "Vous" : "SAGE"}</div>
                    {m.status === "pending" ? (
                      <span style={{ color: "var(--muted)", fontStyle: "italic" }}>SAGE réfléchit…</span>
                    ) : m.status === "erreur" ? (
                      <span style={{ color: "var(--alert)" }}>⚠ {m.error_message || "La réponse a échoué."}</span>
                    ) : (
                      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{m.content}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
                placeholder="Écrivez à SAGE… (Ctrl+Entrée pour envoyer)"
                rows={2}
                style={{ flex: 1, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, resize: "vertical" }}
              />
              <button onClick={send} disabled={busy || pending || !input.trim()} style={{ ...primaryBtnStyle, whiteSpace: "nowrap", cursor: busy || pending || !input.trim() ? "not-allowed" : "pointer", opacity: busy || pending || !input.trim() ? 0.55 : 1 }}>Envoyer</button>
            </div>
            {pending && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>SAGE rédige sa réponse… elle s'affichera ici (vous pouvez patienter ou revenir plus tard).</div>}
          </div>
        </>
      )}
    </section>
  );
}

const rowBtnStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
  width: "100%", textAlign: "left", background: "#fff", border: "1px solid var(--line)",
  borderRadius: 8, padding: "9px 11px", fontSize: 13, cursor: "pointer",
};
const primaryBtnStyle: React.CSSProperties = {
  background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 8,
  padding: "9px 15px", fontWeight: 700, fontSize: 12.5, cursor: "pointer",
};
