import { useEffect, useMemo, useRef, useState } from "react";
import {
  getChatDirectory,
  getConversations,
  startConversation,
  getMessages,
  sendChatMessage,
  sendChatMessageWithFile,
  markConversationRead,
  deleteChatMessage,
  chatFileUrl,
  type ChatConversation,
  type ChatDirectoryEntry,
  type ChatMessage,
} from "../api/client";
import { useChatSocket } from "../hooks/useChatSocket";
import { useI18n } from "../i18n";

// Messagerie interne 1-à-1 (pôle Communication interne). Liste des conversations
// à gauche, fil à droite, envoi texte et/ou pièce jointe. Réception en direct via
// Socket.IO ; badge de non-lus.

function humanSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function ChatPage() {
  const { t, lang } = useI18n();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [directory, setDirectory] = useState<ChatDirectoryEntry[]>([]);
  const [dirFilter, setDirFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Affichage responsive : sous ce seuil (téléphone), une seule colonne à la
  // fois (liste OU fil). L'écouteur matchMedia suit aussi la rotation de l'écran.
  const [isMobile, setIsMobile] = useState(false);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  const threadRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short" }), [lang]);

  async function loadConversations() {
    try {
      setConversations(await getConversations());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  useEffect(() => {
    loadConversations();
  }, []);

  // Suit la largeur de l'écran (et la rotation) pour basculer entre une et deux
  // colonnes.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  // Réception temps réel : si le message concerne la conversation ouverte, on
  // l'ajoute et on marque lu ; sinon on rafraîchit la liste (non-lus, ordre).
  useChatSocket((m) => {
    if (m.conversation_id === activeRef.current) {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      markConversationRead(m.conversation_id).catch(() => {});
    }
    loadConversations();
  });

  async function openConversation(id: string, name: string) {
    setActiveId(id);
    setActiveName(name);
    setError(null);
    try {
      setMessages(await getMessages(id));
      await markConversationRead(id).catch(() => {});
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function openPicker() {
    setPickerOpen(true);
    setDirFilter("");
    try {
      setDirectory(await getChatDirectory());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function pick(entry: ChatDirectoryEntry) {
    setPickerOpen(false);
    try {
      const conv = await startConversation(entry.id);
      await loadConversations();
      await openConversation(conv.id, conv.other_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function send() {
    if (!activeId || sending) return;
    const text = draft.trim();
    if (!text && !file) return;
    setSending(true);
    setError(null);
    try {
      const msg = file ? await sendChatMessageWithFile(activeId, text, file) : await sendChatMessage(activeId, text);
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(id: string) {
    try {
      await deleteChatMessage(id);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, deleted: true, body: "", file: null } : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  const filteredDir = directory.filter((d) => d.name.toLowerCase().includes(dirFilter.toLowerCase()));

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("chat.title", "Messagerie interne")}</h1>
      <p className="ecl-page__lead">{t("chat.lead", "Échangez en privé avec vos collègues. Vous pouvez joindre un fichier.")}</p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 14, alignItems: "stretch", height: isMobile ? "72vh" : "62vh", minHeight: 380 }}>
        {/* Colonne gauche : conversations (masquée sur mobile quand un fil est ouvert) */}
        {(!isMobile || !activeId) && (
        <div style={{ flex: isMobile ? "1 1 auto" : "0 0 280px", minWidth: 0, border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--line)" }}>
            <button onClick={openPicker} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--eclosion)", background: "var(--eclosion)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              ✚ {t("chat.new", "Nouveau message")}
            </button>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {conversations.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "var(--muted)" }}>{t("chat.empty_list", "Aucune conversation. Cliquez sur « Nouveau message ».")}</div>}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id, c.other_name)}
                style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid var(--line)", padding: "10px 12px", cursor: "pointer", background: c.id === activeId ? "var(--eclosion-soft)" : "#fff" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{c.other_name}</span>
                  {c.unread > 0 && <span style={{ background: "var(--alert)", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{c.unread}</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{c.last_message || "—"}</div>
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Colonne droite : fil (masquée sur mobile tant qu'aucun fil n'est ouvert) */}
        {(!isMobile || activeId) && (
        <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!activeId ? (
            <div style={{ margin: "auto", color: "var(--muted)", fontSize: 14, padding: 16, textAlign: "center" }}>{t("chat.pick", "Sélectionnez une conversation ou démarrez-en une.")}</div>
          ) : (
            <>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 10 }}>
                {isMobile && (
                  <button onClick={() => setActiveId(null)} aria-label={t("chat.back", "Retour")} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--eclosion-dark)", padding: 0 }}>←</button>
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeName}</span>
              </div>
              <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.map((m) => (
                  <div key={m.id} style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "76%" }}>
                    <div style={{ background: m.mine ? "var(--eclosion)" : "var(--eclosion-soft)", color: m.mine ? "#fff" : "var(--ink)", borderRadius: 12, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap", opacity: m.deleted ? 0.6 : 1, fontStyle: m.deleted ? "italic" : "normal" }}>
                      {m.deleted ? t("chat.deleted", "Message supprimé") : m.body}
                      {!m.deleted && m.file && (
                        <div style={{ marginTop: m.body ? 6 : 0 }}>
                          <a href={chatFileUrl(m.id)} target="_blank" rel="noreferrer" style={{ color: m.mine ? "#fff" : "var(--eclosion-dark)", textDecoration: "underline", fontWeight: 600, fontSize: 12.5 }}>
                            📎 {m.file.name} {m.file.size ? `(${humanSize(m.file.size)})` : ""}
                          </a>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, textAlign: m.mine ? "right" : "left" }}>
                      {dateFmt.format(new Date(m.created_at))}
                      {m.mine && !m.deleted && (
                        <button onClick={() => removeMessage(m.id)} style={{ marginLeft: 8, border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>{t("chat.delete", "Supprimer")}</button>
                      )}
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <div style={{ margin: "auto", color: "var(--muted)", fontSize: 13 }}>{t("chat.no_msg", "Aucun message. Écrivez le premier.")}</div>}
              </div>
              {/* Composer */}
              <div style={{ borderTop: "1px solid var(--line)", padding: 10 }}>
                {file && (
                  <div style={{ fontSize: 12, color: "var(--eclosion-dark)", marginBottom: 6 }}>
                    📎 {file.name} <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ border: "none", background: "none", color: "var(--alert)", cursor: "pointer", textDecoration: "underline" }}>{t("chat.remove_file", "retirer")}</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <button onClick={() => fileInputRef.current?.click()} title={t("chat.attach", "Joindre un fichier")} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "8px 11px", cursor: "pointer", fontSize: 16 }}>📎</button>
                  <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={t("chat.placeholder", "Écrivez un message…")}
                    rows={1}
                    style={{ flex: 1, resize: "none", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, fontFamily: "inherit", maxHeight: 120 }}
                  />
                  <button onClick={send} disabled={sending || (!draft.trim() && !file)} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: sending || (!draft.trim() && !file) ? 0.5 : 1 }}>
                    {sending ? t("chat.sending", "Envoi…") : t("chat.send", "Envoyer")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* Sélecteur de correspondant (annuaire) */}
      {pickerOpen && (
        <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(22,35,61,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, width: 380, maxWidth: "92vw", maxHeight: "70vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: 14, borderBottom: "1px solid var(--line)", fontWeight: 700 }}>{t("chat.choose", "Écrire à un collègue")}</div>
            <div style={{ padding: 10 }}>
              <input autoFocus value={dirFilter} onChange={(e) => setDirFilter(e.target.value)} placeholder={t("chat.search", "Rechercher un nom…")} style={{ width: "100%", padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div style={{ overflowY: "auto" }}>
              {filteredDir.map((d) => (
                <button key={d.id} onClick={() => pick(d)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid var(--line)", padding: "10px 14px", cursor: "pointer", background: "#fff", fontSize: 13.5, color: "var(--ink)" }}>{d.name}</button>
              ))}
              {filteredDir.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "var(--muted)" }}>{t("chat.no_colleague", "Aucun collègue trouvé.")}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
