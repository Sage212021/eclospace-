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
  deleteChatConversation,
  editChatMessage,
  forwardChatMessage,
  chatFileUrl,
  type ChatConversation,
  type ChatDirectoryEntry,
  type ChatMessage,
} from "../api/client";
import { useChatSocket } from "../hooks/useChatSocket";
import { useI18n } from "../i18n";
import { useConfirm } from "../components/ConfirmProvider";

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
  const confirm = useConfirm();
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
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Options messagerie : réponse citée, édition, menu d'actions, transfert, infos.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [forwardFor, setForwardFor] = useState<ChatMessage | null>(null);
  const [infoFor, setInfoFor] = useState<ChatMessage | null>(null);
  // Menu de la discussion (en-tête du fil) : effacer / supprimer la discussion.
  const [convMenuOpen, setConvMenuOpen] = useState(false);
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

  // Choix de la mise en page : deux colonnes dès que l'écran est assez large
  // (tablette/ordinateur ≥ 700 px) OU en paysage sur téléphone (≥ 560 px de
  // large). Sinon (téléphone en portrait), une seule colonne à la fois. Baser la
  // bascule sur l'ORIENTATION — et non sur une largeur fixe — garantit que la
  // rotation du téléphone affiche bien les deux colonnes, même quand le paysage
  // fait moins de 760 px. L'événement « change » suit la rotation en direct.
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Deux colonnes si l'écran est large (tablette/ordinateur) OU en paysage
      // (largeur > hauteur), quelle que soit la taille exacte ; sinon une seule
      // colonne (téléphone en portrait).
      const large = w >= 700 || w > h;
      setIsMobile(!large);
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, []);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  // Réception temps réel : si le message concerne la conversation ouverte, on
  // l'ajoute et on marque lu ; sinon on rafraîchit la liste (non-lus, ordre).
  useChatSocket(
    (m) => {
      if (m.conversation_id === activeRef.current) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        markConversationRead(m.conversation_id).catch(() => {});
      }
      loadConversations();
    },
    // Le correspondant a lu : passer mes messages antérieurs à « lu » (2 coches or).
    (e) => {
      if (e.conversationId !== activeRef.current) return;
      const readAt = new Date(e.readAt).getTime();
      setMessages((prev) => prev.map((m) => (m.mine && !m.read && new Date(m.created_at).getTime() <= readAt ? { ...m, read: true } : m)));
    },
    true,
    // Message modifié / supprimé à distance : mise à jour en place.
    (m) => {
      if (m.conversation_id !== activeRef.current) return;
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, body: m.body, deleted: m.deleted, edited: m.edited, file: m.deleted ? null : x.file } : x)));
    },
    // Le correspondant a supprimé la discussion « pour tout le monde ».
    (e) => {
      setConversations((prev) => prev.filter((c) => c.id !== e.conversationId));
      if (e.conversationId === activeRef.current) {
        setActiveId(null);
        setMessages([]);
      }
    },
  );

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

    // Mode édition : on modifie le message existant au lieu d'en envoyer un nouveau.
    if (editing) {
      if (!text && !editing.file) {
        setError("Un message sans pièce jointe ne peut pas être vidé : supprimez-le plutôt.");
        return;
      }
      setSending(true);
      setError(null);
      try {
        const updated = await editChatMessage(editing.id, text);
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        setEditing(null);
        setDraft("");
        loadConversations();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Modification impossible.");
      } finally {
        setSending(false);
      }
      return;
    }

    if (!text && !file) return;
    setSending(true);
    setError(null);
    try {
      const replyId = replyTo?.id;
      const msg = file
        ? await sendChatMessageWithFile(activeId, text, file, replyId)
        : await sendChatMessage(activeId, text, replyId);
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      setFile(null);
      setReplyTo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(id: string) {
    setMenuFor(null);
    const ok = await confirm({
      title: t("chat.delete_title", "Supprimer le message"),
      message: t("chat.delete_confirm", "Supprimer ce message ? Il ne sera plus visible par votre correspondant."),
      tone: "danger",
      confirmLabel: t("chat.delete", "Supprimer"),
    });
    if (!ok) return;
    try {
      await deleteChatMessage(id);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, deleted: true, body: "", file: null } : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  // Supprimer la discussion entière : "me" (de mon côté) ou "all" (pour les deux).
  async function deleteConversation(scope: "me" | "all") {
    if (!activeId) return;
    const convId = activeId;
    setConvMenuOpen(false);
    const ok = await confirm({
      title: scope === "all" ? t("chat.conv_del_all_title", "Supprimer pour tout le monde") : t("chat.conv_del_me_title", "Effacer la discussion"),
      message:
        scope === "all"
          ? t("chat.conv_del_all_confirm", "Supprimer cette discussion pour vous ET votre correspondant ? Tous les messages seront retirés des deux côtés (ils restent tracés, jamais effacés).")
          : t("chat.conv_del_me_confirm", "Effacer cette discussion de votre côté ? Votre correspondant garde sa copie ; elle réapparaîtra si un nouveau message arrive."),
      tone: "danger",
      confirmLabel: t("chat.delete", "Supprimer"),
    });
    if (!ok) return;
    try {
      await deleteChatConversation(convId, scope);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      setActiveId(null);
      setMessages([]);
      setNotice(scope === "all" ? t("chat.conv_del_all_done", "Discussion supprimée pour les deux correspondants.") : t("chat.conv_del_me_done", "Discussion effacée de votre côté."));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  // Démarrer une réponse citée à un message.
  function startReply(m: ChatMessage) {
    setMenuFor(null);
    setEditing(null);
    setReplyTo(m);
  }

  // Démarrer la modification de son propre message (charge son texte dans le champ).
  function startEdit(m: ChatMessage) {
    setMenuFor(null);
    setReplyTo(null);
    setEditing(m);
    setDraft(m.body);
  }

  function cancelCompose() {
    setEditing(null);
    setReplyTo(null);
    setDraft("");
  }

  // Transfert : on choisit le destinataire dans l'annuaire.
  async function openForward(m: ChatMessage) {
    setMenuFor(null);
    setForwardFor(m);
    setDirFilter("");
    try {
      setDirectory(await getChatDirectory());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function doForward(entry: ChatDirectoryEntry) {
    if (!forwardFor) return;
    const target = forwardFor;
    setForwardFor(null);
    try {
      await forwardChatMessage(target.id, entry.id);
      await loadConversations();
      setNotice(`Message transféré à ${entry.name}.`);
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transfert impossible.");
    }
  }

  const filteredDir = directory.filter((d) => d.name.toLowerCase().includes(dirFilter.toLowerCase()));

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("chat.title", "Messagerie interne")}</h1>
      <p className="ecl-page__lead">{t("chat.lead", "Échangez en privé avec vos collègues. Vous pouvez joindre un fichier.")}</p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{notice}</div>}

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
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{activeName}</span>
                {/* Menu de la discussion : effacer / supprimer. */}
                <span style={{ position: "relative" }}>
                  <button
                    onClick={() => setConvMenuOpen((v) => !v)}
                    aria-label={t("chat.conv_actions", "Options de la discussion")}
                    title={t("chat.conv_actions", "Options de la discussion")}
                    style={{ border: "1px solid var(--line)", background: "var(--card, #fff)", color: "var(--eclosion-dark, #9a7a12)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "4px 10px", borderRadius: 999, fontWeight: 800 }}
                  >
                    ⋯
                  </button>
                  {convMenuOpen && (
                    <div style={{ position: "absolute", zIndex: 6, top: 26, right: 0, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", minWidth: 220, overflow: "hidden", textAlign: "left", fontWeight: 400 }}>
                      <MenuItem label={`🧹 ${t("chat.conv_del_me", "Effacer de mon côté")}`} onClick={() => deleteConversation("me")} />
                      <MenuItem label={`🗑 ${t("chat.conv_del_all", "Supprimer pour tout le monde")}`} danger onClick={() => deleteConversation("all")} />
                    </div>
                  )}
                </span>
              </div>
              <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.map((m) => (
                  <div key={m.id} style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "76%", position: "relative" }}>
                    <div style={{ background: m.mine ? "var(--eclosion)" : "var(--eclosion-soft)", color: m.mine ? "#fff" : "var(--ink)", borderRadius: 12, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap", opacity: m.deleted ? 0.6 : 1, fontStyle: m.deleted ? "italic" : "normal" }}>
                      {/* Transféré */}
                      {!m.deleted && m.forwarded && (
                        <div style={{ fontSize: 11, fontStyle: "italic", opacity: 0.85, marginBottom: 3 }}>↪ {t("chat.forwarded", "Transféré")}</div>
                      )}
                      {/* Réponse citée */}
                      {!m.deleted && m.reply_to && (
                        <div style={{ borderLeft: `3px solid ${m.mine ? "rgba(255,255,255,0.6)" : "var(--eclosion)"}`, paddingLeft: 8, marginBottom: 5, fontSize: 12, opacity: 0.9 }}>
                          <div style={{ fontWeight: 700 }}>{m.reply_to.sender_name}</div>
                          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{m.reply_to.excerpt}</div>
                        </div>
                      )}
                      {m.deleted ? t("chat.deleted", "Message supprimé") : m.body}
                      {!m.deleted && m.file && (
                        <div style={{ marginTop: m.body ? 6 : 0 }}>
                          <a href={chatFileUrl(m.id)} target="_blank" rel="noreferrer" style={{ color: m.mine ? "#fff" : "var(--eclosion-dark)", textDecoration: "underline", fontWeight: 600, fontSize: 12.5 }}>
                            📎 {m.file.name} {m.file.size ? `(${humanSize(m.file.size)})` : ""}
                          </a>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, textAlign: m.mine ? "right" : "left", display: "flex", gap: 6, alignItems: "center", justifyContent: m.mine ? "flex-end" : "flex-start" }}>
                      <span>{dateFmt.format(new Date(m.created_at))}</span>
                      {!m.deleted && m.edited && <span style={{ fontStyle: "italic" }}>· {t("chat.edited", "modifié")}</span>}
                      {m.mine && !m.deleted && (
                        <span
                          title={m.read ? t("chat.read", "Lu") : t("chat.sent", "Envoyé")}
                          aria-label={m.read ? t("chat.read", "Lu") : t("chat.sent", "Envoyé")}
                          style={{ fontWeight: 700, letterSpacing: -2, color: m.read ? "var(--or, #d9b21a)" : "var(--muted)" }}
                        >
                          {m.read ? "✓✓" : "✓"}
                        </span>
                      )}
                      {/* Menu d'actions du message : pastille bien visible et
                          confortable au doigt (répondre, transférer, modifier…). */}
                      {!m.deleted && (
                        <span style={{ position: "relative" }}>
                          <button
                            onClick={() => setMenuFor((v) => (v === m.id ? null : m.id))}
                            aria-label={t("chat.actions", "Options du message")}
                            title={t("chat.actions", "Options du message")}
                            style={{ border: "1px solid var(--line)", background: "var(--card, #fff)", color: "var(--eclosion-dark, #9a7a12)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "3px 9px", borderRadius: 999, fontWeight: 800 }}
                          >
                            ⋯
                          </button>
                          {menuFor === m.id && (
                            <div style={{ position: "absolute", zIndex: 5, top: 18, [m.mine ? "right" : "left"]: 0, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", minWidth: 150, overflow: "hidden", textAlign: "left" } as React.CSSProperties}>
                              <MenuItem label={`↩ ${t("chat.reply", "Répondre")}`} onClick={() => startReply(m)} />
                              <MenuItem label={`↪ ${t("chat.forward", "Transférer")}`} onClick={() => openForward(m)} />
                              <MenuItem label={`ℹ ${t("chat.info", "Infos")}`} onClick={() => { setMenuFor(null); setInfoFor(m); }} />
                              {m.mine && <MenuItem label={`✎ ${t("chat.edit", "Modifier")}`} onClick={() => startEdit(m)} />}
                              {m.mine && <MenuItem label={`🗑 ${t("chat.delete", "Supprimer")}`} danger onClick={() => removeMessage(m.id)} />}
                            </div>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <div style={{ margin: "auto", color: "var(--muted)", fontSize: 13 }}>{t("chat.no_msg", "Aucun message. Écrivez le premier.")}</div>}
              </div>
              {/* Composer */}
              <div style={{ borderTop: "1px solid var(--line)", padding: 10 }}>
                {/* Bandeau réponse citée */}
                {replyTo && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "var(--eclosion-soft)", borderLeft: "3px solid var(--eclosion)", borderRadius: 6, padding: "6px 10px", marginBottom: 6, fontSize: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)" }}>↩ {t("chat.reply_to", "Réponse à")} {replyTo.sender_name}</div>
                      <div style={{ color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{replyTo.deleted ? "" : replyTo.body || (replyTo.file ? `📎 ${replyTo.file.name}` : "")}</div>
                    </div>
                    <button onClick={cancelCompose} style={{ border: "none", background: "none", color: "var(--alert)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                  </div>
                )}
                {/* Bandeau modification */}
                {editing && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "var(--eclosion-soft)", borderLeft: "3px solid var(--or, #d9b21a)", borderRadius: 6, padding: "6px 10px", marginBottom: 6, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)" }}>✎ {t("chat.editing", "Modification du message")}</div>
                    <button onClick={cancelCompose} style={{ border: "none", background: "none", color: "var(--alert)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                  </div>
                )}
                {file && !editing && (
                  <div style={{ fontSize: 12, color: "var(--eclosion-dark)", marginBottom: 6 }}>
                    📎 {file.name} <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ border: "none", background: "none", color: "var(--alert)", cursor: "pointer", textDecoration: "underline" }}>{t("chat.remove_file", "retirer")}</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  {/* La pièce jointe n'est pas modifiable en édition (immuable). */}
                  {!editing && (
                    <>
                      <button onClick={() => fileInputRef.current?.click()} title={t("chat.attach", "Joindre un fichier")} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "8px 11px", cursor: "pointer", fontSize: 16 }}>📎</button>
                      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    </>
                  )}
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={editing ? t("chat.edit_placeholder", "Modifiez votre message…") : t("chat.placeholder", "Écrivez un message…")}
                    rows={1}
                    style={{ flex: 1, resize: "none", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, fontFamily: "inherit", maxHeight: 120 }}
                  />
                  <button onClick={send} disabled={sending || (!draft.trim() && !file && !editing)} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: sending || (!draft.trim() && !file && !editing) ? 0.5 : 1 }}>
                    {sending ? t("chat.sending", "Envoi…") : editing ? t("chat.save", "Enregistrer") : t("chat.send", "Envoyer")}
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
        <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
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

      {/* Transférer : choisir le collègue destinataire */}
      {forwardFor && (
        <div onClick={() => setForwardFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, width: 380, maxWidth: "92vw", maxHeight: "70vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: 14, borderBottom: "1px solid var(--line)", fontWeight: 700 }}>↪ {t("chat.forward_to", "Transférer à…")}</div>
            <div style={{ padding: "8px 12px", fontSize: 12.5, color: "var(--muted)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              « {forwardFor.body || (forwardFor.file ? `📎 ${forwardFor.file.name}` : "")} »
            </div>
            <div style={{ padding: 10 }}>
              <input autoFocus value={dirFilter} onChange={(e) => setDirFilter(e.target.value)} placeholder={t("chat.search", "Rechercher un nom…")} style={{ width: "100%", padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div style={{ overflowY: "auto" }}>
              {filteredDir.map((d) => (
                <button key={d.id} onClick={() => doForward(d)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid var(--line)", padding: "10px 14px", cursor: "pointer", background: "#fff", fontSize: 13.5, color: "var(--ink)" }}>{d.name}</button>
              ))}
              {filteredDir.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "var(--muted)" }}>{t("chat.no_colleague", "Aucun collègue trouvé.")}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Infos d'un message */}
      {infoFor && (
        <div onClick={() => setInfoFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, width: 360, maxWidth: "92vw", overflow: "hidden" }}>
            <div style={{ padding: 14, borderBottom: "1px solid var(--line)", fontWeight: 700 }}>ℹ {t("chat.info", "Infos")}</div>
            <div style={{ padding: 14, fontSize: 13, display: "grid", gap: 8 }}>
              <InfoRow label={t("chat.info_from", "De")} value={infoFor.mine ? t("chat.info_me", "Vous") : infoFor.sender_name} />
              <InfoRow label={t("chat.info_sent", "Envoyé le")} value={dateFmt.format(new Date(infoFor.created_at))} />
              {infoFor.edited && infoFor.edited_at && <InfoRow label={t("chat.info_edited", "Modifié le")} value={dateFmt.format(new Date(infoFor.edited_at))} />}
              {infoFor.mine && <InfoRow label={t("chat.info_status", "Statut")} value={infoFor.read ? t("chat.read", "Lu") : t("chat.sent", "Envoyé")} />}
              {infoFor.forwarded && <InfoRow label={t("chat.info_forwarded", "Origine")} value={t("chat.forwarded", "Transféré")} />}
              {infoFor.file && <InfoRow label={t("chat.info_file", "Pièce jointe")} value={`${infoFor.file.name}${infoFor.file.size ? ` (${humanSize(infoFor.file.size)})` : ""}`} />}
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", textAlign: "right" }}>
              <button onClick={() => setInfoFor(null)} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 13 }}>{t("common.close", "Fermer")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Élément d'un menu d'actions de message.
function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid var(--line)", padding: "9px 12px", cursor: "pointer", background: "#fff", fontSize: 13, color: danger ? "var(--alert)" : "var(--ink)" }}
    >
      {label}
    </button>
  );
}

// Ligne libellé / valeur du panneau d'infos.
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "var(--ink)", fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
