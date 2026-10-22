import { useEffect, useRef, useState } from "react";
import {
  listSageConversations,
  getSageConversation,
  createSageConversation,
  sendSageMessage,
  renameSageConversation,
  archiveSageConversation,
  listSageKnowledge,
  createSageKnowledge,
  updateSageKnowledge,
  deleteSageKnowledge,
  validateSageKnowledge,
  analyzeSageLearning,
  getSageLearningLatest,
  getCatalogueAudit,
  sageAttachmentUrl,
  type SageConversation,
  type SageDossier,
  type SageKnowledge,
  type SageKnowledgeCategory,
  type SageLearningRun,
  type CatalogueAudit,
  type CatalogueAuditCategory,
} from "../api/client";

const AUDIT_CATS: { value: CatalogueAuditCategory; label: string }[] = [
  { value: "urgentes", label: "Corrections urgentes" },
  { value: "commerciales", label: "Mises à jour commerciales" },
  { value: "editoriales", label: "Mises à jour éditoriales" },
  { value: "presentation", label: "Présentation" },
  { value: "a_confirmer", label: "À confirmer" },
];
const PRIO_COLOR: Record<string, string> = { urgent: "#B23A2E", important: "#B87400", mineur: "var(--muted)" };

const KNOWLEDGE_CATS: { value: SageKnowledgeCategory; label: string }[] = [
  { value: "institution", label: "Institution" },
  { value: "editorial", label: "Éditorial" },
  { value: "procedure", label: "Procédure" },
  { value: "collection", label: "Collection" },
  { value: "decision", label: "Décision" },
  { value: "autre", label: "Autre" },
];
const KCAT_LABEL = (c: string) => KNOWLEDGE_CATS.find((k) => k.value === c)?.label ?? c;

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
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  // Connaissances de la maison (mémoire validée).
  const [knowledge, setKnowledge] = useState<SageKnowledge[]>([]);
  const [kOpen, setKOpen] = useState(false);
  const [kForm, setKForm] = useState<{ id: string | null; category: SageKnowledgeCategory; title: string; content: string } | null>(null);
  // Apprentissage (Lot 4) : dernière analyse + état.
  const [learning, setLearning] = useState<SageLearningRun | null>(null);
  // Audit interne du catalogue Éclospace (section 15).
  const [audit, setAudit] = useState<CatalogueAudit | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadConversations = () => listSageConversations().then((r) => setConversations(r.conversations)).catch(() => setConversations([]));
  const loadKnowledge = () => listSageKnowledge().then((r) => setKnowledge(r.entries)).catch(() => setKnowledge([]));
  const loadLearning = () => getSageLearningLatest().then((r) => setLearning(r.run)).catch(() => setLearning(null));
  useEffect(() => { loadConversations(); loadKnowledge(); loadLearning(); }, []);

  // Suivi de l'analyse d'apprentissage en cours.
  useEffect(() => {
    if (learning?.status !== "pending") return;
    const t = setTimeout(() => { loadLearning(); loadKnowledge(); }, 4000);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [learning]);

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
    if (!selectedId || (!input.trim() && !file)) return;
    setBusy(true); setError(null);
    try {
      await sendSageMessage(selectedId, input.trim(), file);
      setInput("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  async function saveKnowledge() {
    if (!kForm || !kForm.title.trim() || !kForm.content.trim()) { setError("Titre et contenu requis."); return; }
    setError(null);
    try {
      if (kForm.id) await updateSageKnowledge(kForm.id, { category: kForm.category, title: kForm.title.trim(), content: kForm.content.trim() });
      else await createSageKnowledge({ category: kForm.category, title: kForm.title.trim(), content: kForm.content.trim() });
      setKForm(null);
      await loadKnowledge();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  async function removeKnowledge(id: string) {
    if (!window.confirm("Retirer cette connaissance de la mémoire de SAGE ?")) return;
    try {
      await deleteSageKnowledge(id);
      await loadKnowledge();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  async function acceptProposal(id: string) {
    try { await validateSageKnowledge(id); await loadKnowledge(); } catch (e) { setError(e instanceof Error ? e.message : "Validation impossible."); }
  }
  async function rejectProposal(id: string) {
    try { await deleteSageKnowledge(id); await loadKnowledge(); } catch (e) { setError(e instanceof Error ? e.message : "Rejet impossible."); }
  }
  async function analyze() {
    setError(null);
    try {
      await analyzeSageLearning();
      await loadLearning();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse impossible.");
    }
  }
  async function runAudit() {
    setAuditError(null);
    setAuditLoading(true);
    try {
      setAudit(await getCatalogueAudit());
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "L'audit a échoué.");
    } finally {
      setAuditLoading(false);
    }
  }

  // « Retenir » une réponse de SAGE comme décision/connaissance validée.
  async function rememberFromMessage(content: string) {
    const title = window.prompt("Retenir dans la mémoire de la maison.\n\nDonnez un titre court à cette connaissance :", "");
    if (title === null || !title.trim()) return;
    try {
      await createSageKnowledge({ category: "decision", title: title.trim(), content });
      await loadKnowledge();
      setError(null);
      window.alert("Enregistré dans les connaissances de la maison.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
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

          {/* Connaissances de la maison (mémoire validée que SAGE consulte). */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 12, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>🏛️ Connaissances de la maison</div>
              <button onClick={() => setKOpen((v) => !v)} style={{ ...rowBtnStyle, width: "auto", fontWeight: 700, padding: "5px 10px" }}>{kOpen ? "Masquer ▴" : `Gérer (${knowledge.length}) ▾`}</button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.45 }}>
              Ce que SAGE doit tenir pour vrai sur Éclosion (histoire, collections, procédures, décisions actées). Il s'appuie sur ces fiches dans toutes vos conversations, et elles sont conservées durablement.
            </p>
            {kOpen && (
              <div style={{ marginTop: 10 }}>
                {kForm === null && (
                  <button onClick={() => setKForm({ id: null, category: "institution", title: "", content: "" })} style={{ ...primaryBtnStyle, padding: "6px 13px", marginBottom: 10 }}>+ Ajouter une fiche</button>
                )}
                {kForm && (
                  <div style={{ border: "1px solid var(--eclosion, #D9B21A)", borderRadius: 8, padding: 10, marginBottom: 10, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <select value={kForm.category} onChange={(e) => setKForm({ ...kForm, category: e.target.value as SageKnowledgeCategory })} style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}>
                        {KNOWLEDGE_CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <input value={kForm.title} onChange={(e) => setKForm({ ...kForm, title: e.target.value })} placeholder="Titre (ex. Modalités de soumission)" style={{ flex: 1, minWidth: 180, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
                    </div>
                    <textarea value={kForm.content} onChange={(e) => setKForm({ ...kForm, content: e.target.value })} placeholder="Contenu validé…" rows={3} style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, resize: "vertical" }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={saveKnowledge} style={{ ...primaryBtnStyle, padding: "6px 13px" }}>Enregistrer</button>
                      <button onClick={() => setKForm(null)} style={{ ...rowBtnStyle, width: "auto", padding: "6px 13px" }}>Annuler</button>
                    </div>
                  </div>
                )}
                {/* Apprentissage (Lot 4) : SAGE analyse les échanges et propose. */}
                <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 10, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={analyze} disabled={learning?.status === "pending"} style={{ ...rowBtnStyle, width: "auto", fontWeight: 700, padding: "6px 12px", opacity: learning?.status === "pending" ? 0.6 : 1 }}>
                      {learning?.status === "pending" ? "Analyse en cours…" : "✨ Analyser mes échanges"}
                    </button>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>SAGE repère les questions récurrentes et ses lacunes, et propose des fiches à valider.</span>
                  </div>
                  {learning && learning.status === "done" && learning.summary && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.5, background: "var(--ivory, #FAF8F2)", border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>{learning.summary}</div>
                  )}
                  {learning && learning.status === "erreur" && (
                    <div style={{ fontSize: 12, color: "var(--alert)", marginTop: 8 }}>⚠ {learning.error_message || "L'analyse a échoué."}</div>
                  )}
                </div>

                {/* Propositions de SAGE (à valider). */}
                {knowledge.some((k) => k.status === "pending") && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", marginBottom: 6 }}>Propositions de SAGE — à valider</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {knowledge.filter((k) => k.status === "pending").map((e) => (
                        <div key={e.id} style={{ border: "1px solid var(--eclosion, #D9B21A)", borderRadius: 8, padding: "8px 10px", background: "#fffdf4" }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}><span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", marginRight: 6 }}>{KCAT_LABEL(e.category).toUpperCase()}</span>{e.title}</div>
                          <div style={{ fontSize: 12, color: "var(--ink)", marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{e.content}</div>
                          {e.rationale && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, fontStyle: "italic" }}>Pourquoi : {e.rationale}</div>}
                          <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
                            <button onClick={() => acceptProposal(e.id)} style={{ background: "#2F7D4A", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Valider</button>
                            <button onClick={() => rejectProposal(e.id)} style={{ background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 7, padding: "5px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Rejeter</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Connaissances validées. */}
                {knowledge.filter((k) => k.status === "validated").length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>Aucune fiche validée pour l'instant.</p>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {knowledge.filter((k) => k.status === "validated").map((e) => (
                      <div key={e.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", background: "var(--ivory, #FAF8F2)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}><span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", marginRight: 6 }}>{KCAT_LABEL(e.category).toUpperCase()}</span>{e.title}</span>
                          <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <button onClick={() => setKForm({ id: e.id, category: e.category, title: e.title, content: e.content })} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>✎</button>
                            <button onClick={() => removeKnowledge(e.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>🗑</button>
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{e.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Audit interne du catalogue Éclospace (section 15, volet catalogue). */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 12, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>🔎 Audit du catalogue</div>
              <button onClick={() => setAuditOpen((v) => !v)} style={{ ...rowBtnStyle, width: "auto", fontWeight: 700, padding: "5px 10px" }}>{auditOpen ? "Masquer ▴" : "Ouvrir ▾"}</button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.45 }}>
              SAGE passe en revue les fiches du catalogue et signale les manques et anomalies (résumé, auteur, genre, biographie, couverture, ISBN, prix, doublons). Lecture seule : rien n'est modifié. Les changements sensibles (prix, ISBN, droits) restent soumis à votre validation. La comparaison avec le site public eclosion.cm n'est pas incluse ici.
            </p>
            {auditOpen && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={runAudit} disabled={auditLoading} style={{ ...primaryBtnStyle, padding: "6px 13px", opacity: auditLoading ? 0.6 : 1 }}>{auditLoading ? "Analyse en cours…" : audit ? "Relancer l'audit" : "Lancer l'audit"}</button>
                  {audit && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{audit.total_manuscripts} ouvrage(s) examiné(s) · {audit.findings.length} point(s) relevé(s)</span>}
                </div>
                {auditError && <div style={{ fontSize: 12, color: "var(--alert)", marginTop: 8 }}>⚠ {auditError}</div>}
                {audit && audit.findings.length === 0 && !auditLoading && (
                  <p style={{ color: "var(--positive, #2F7D4A)", fontSize: 12.5, margin: "10px 0 0" }}>Aucune anomalie relevée : le catalogue est complet sur les points vérifiés.</p>
                )}
                {audit && audit.findings.length > 0 && (
                  <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                    {AUDIT_CATS.filter((c) => audit.counts[c.value] > 0).map((c) => (
                      <div key={c.value}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{c.label} <span style={{ color: "var(--muted)", fontWeight: 600 }}>({audit.counts[c.value]})</span></div>
                        <div style={{ display: "grid", gap: 6 }}>
                          {audit.findings.filter((f) => f.category === c.value).map((f, i) => (
                            <div key={`${f.manuscript_id}-${f.field}-${i}`} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", background: "var(--ivory, #FAF8F2)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{f.field} — {f.manuscript_title} <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>[{f.manuscript_ref}]</span></span>
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: PRIO_COLOR[f.priority] ?? "var(--muted)" }}>{f.priority.toUpperCase()}</span>
                              </div>
                              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}>
                                <span style={{ color: "var(--ink)" }}>Actuel :</span> {f.current}<br />
                                <span style={{ color: "var(--ink)" }}>Proposition :</span> {f.suggestion}<br />
                                <span style={{ fontStyle: "italic" }}>{f.reason}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <p style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic", margin: 0, lineHeight: 1.45 }}>{audit.note}</p>
                  </div>
                )}
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
                    {m.attachments && m.attachments.length > 0 && (
                      <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 7, display: "grid", gap: 4 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>{m.role === "user" ? "Fichier joint" : "Documents déposés"}</div>
                        {m.attachments.map((a, i) => a.kind === "upload" ? (
                          <span key={i} style={{ fontSize: 12, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            📎 {a.name}{a.lu === false ? <em style={{ color: "var(--alert)", fontStyle: "normal" }}> — non lisible</em> : null}
                          </span>
                        ) : a.download_path ? (
                          <a key={a.version_id ?? i} href={sageAttachmentUrl(a.download_path)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--eclosion-dark, #9a7a12)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            📎 {a.label}
                          </a>
                        ) : null)}
                      </div>
                    )}
                    {m.role === "assistant" && m.status === "done" && m.content && (
                      <button onClick={() => rememberFromMessage(m.content)} title="Retenir dans la mémoire de la maison" style={{ background: "none", border: "none", padding: 0, marginTop: 6, fontSize: 11.5, color: "var(--muted)", cursor: "pointer", textDecoration: "underline" }}>📌 Retenir</button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {file && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink)", background: "var(--ivory, #FAF8F2)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
                <span>📎 {file.name} <span style={{ color: "var(--muted)" }}>({Math.max(1, Math.round(file.size / 1024))} Ko)</span></span>
                <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} title="Retirer le fichier" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>✕</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md,.csv,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => fileInputRef.current?.click()} disabled={busy || pending} title="Joindre un fichier (PDF, Word, texte)" style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px", fontSize: 15, cursor: busy || pending ? "not-allowed" : "pointer", opacity: busy || pending ? 0.55 : 1 }}>📎</button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
                placeholder="Écrivez à SAGE… (Ctrl+Entrée pour envoyer)"
                rows={2}
                style={{ flex: 1, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, resize: "vertical" }}
              />
              <button onClick={send} disabled={busy || pending || (!input.trim() && !file)} style={{ ...primaryBtnStyle, whiteSpace: "nowrap", cursor: busy || pending || (!input.trim() && !file) ? "not-allowed" : "pointer", opacity: busy || pending || (!input.trim() && !file) ? 0.55 : 1 }}>Envoyer</button>
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
