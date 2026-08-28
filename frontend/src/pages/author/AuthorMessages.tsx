import { useEffect, useMemo, useState } from "react";
import {
  getAuthorServiceThreads,
  createAuthorServiceThread,
  getAuthorServiceThread,
  replyAuthorServiceThread,
  type ServiceDesk,
  type ServiceThreadSummary,
  type ServiceThreadDetail,
} from "../../api/client";
import { useI18n } from "../../i18n";

// Section « Messagerie » du portail auteur (inc. 2b) : l'auteur écrit au Service
// Éducation ou au Service Client, et suit les réponses. Un fil = un sujet.

export function AuthorMessages() {
  const { t, lang } = useI18n();
  const [threads, setThreads] = useState<ServiceThreadSummary[]>([]);
  const [active, setActive] = useState<ServiceThreadDetail | null>(null);
  const [composing, setComposing] = useState(false);
  const [service, setService] = useState<ServiceDesk>("education");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short" }), [lang]);

  const load = () => getAuthorServiceThreads().then(setThreads).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function openThread(id: string) {
    setError(null);
    try {
      setActive(await getAuthorServiceThread(id));
      setReply("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function send() {
    if (busy || !subject.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await createAuthorServiceThread(service, subject.trim(), body.trim());
      setComposing(false);
      setSubject("");
      setBody("");
      await load();
      await openThread(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (busy || !active || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await replyAuthorServiceThread(active.id, reply.trim());
      await openThread(active.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: 15, textTransform: "uppercase", letterSpacing: 1, color: "var(--marine, #0b0b0c)", margin: 0 }}>{t("author.messaging", "Messagerie")}</h2>
        <button onClick={() => { setComposing(true); setError(null); }} style={{ border: "1px solid var(--or, #d9b21a)", background: "var(--or, #d9b21a)", color: "#0b0b0c", borderRadius: 8, padding: "6px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          ✚ {t("author.new_message", "Nouveau message")}
        </button>
      </div>
      <p style={{ color: "var(--muted, #667085)", fontSize: 13, marginTop: 4 }}>{t("author.messaging_lead", "Écrivez au Service Éducation ou au Service Client.")}</p>

      {error && !composing && !active && <div style={{ background: "var(--alert-soft, #F6E3DF)", color: "var(--alert, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {threads.length === 0 && <p style={{ fontSize: 13, color: "var(--muted, #667085)", margin: 0 }}>{t("author.no_threads", "Aucun message. Cliquez sur « Nouveau message ».")}</p>}
        {threads.map((th) => (
          <button key={th.id} onClick={() => openThread(th.id)} style={{ textAlign: "left", border: "1px solid var(--line, #E3E8EF)", borderRadius: 10, background: "#fff", padding: "11px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "var(--marine, #0b0b0c)", fontSize: 14 }}>{th.subject}</div>
              <div style={{ fontSize: 12, color: "var(--muted, #667085)", marginTop: 2 }}>
                <span style={{ color: "var(--or-dark, #9a7a12)", fontWeight: 700 }}>{th.service_label}</span> · {th.last_message}
              </div>
            </div>
            {th.unread > 0 && <span style={{ background: "var(--alert, #C24B3A)", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "1px 7px", flexShrink: 0 }}>{th.unread}</span>}
          </button>
        ))}
      </div>

      {/* Nouveau message */}
      {composing && (
        <div onClick={() => setComposing(false)} style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 14 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 480, maxWidth: "100%", padding: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontFamily: "Georgia, serif", color: "var(--marine, #0b0b0c)" }}>{t("author.new_message", "Nouveau message")}</h3>
            {error && <div style={{ background: "var(--alert-soft, #F6E3DF)", color: "var(--alert, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--marine, #0b0b0c)" }}>{t("author.service", "Service")}</label>
            <div style={{ display: "flex", gap: 8, margin: "6px 0 12px" }}>
              {(["education", "client"] as const).map((s) => (
                <button key={s} onClick={() => setService(s)} style={{ flex: 1, border: `1px solid ${service === s ? "var(--marine, #0b0b0c)" : "var(--line, #E3E8EF)"}`, background: service === s ? "var(--eclosion-soft, #F3E9CC)" : "#fff", color: "var(--marine, #0b0b0c)", borderRadius: 8, padding: "8px", fontSize: 13, fontWeight: service === s ? 700 : 400, cursor: "pointer" }}>
                  {s === "education" ? t("author.service_education", "Service Éducation") : t("author.service_client", "Service Client")}
                </button>
              ))}
            </div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("author.subject", "Sujet")} style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--line, #E3E8EF)", borderRadius: 8, fontSize: 13.5, marginBottom: 10, boxSizing: "border-box" }} />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("author.your_message", "Votre message…")} rows={5} style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--line, #E3E8EF)", borderRadius: 8, fontSize: 13.5, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setComposing(false)} style={{ border: "1px solid var(--line, #E3E8EF)", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>{t("author.cancel", "Annuler")}</button>
              <button onClick={send} disabled={busy || !subject.trim() || !body.trim()} style={{ border: "none", background: "var(--marine, #0b0b0c)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: busy || !subject.trim() || !body.trim() ? 0.5 : 1 }}>{busy ? t("author.sending", "Envoi…") : t("author.send", "Envoyer")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Fil de discussion */}
      {active && (
        <div onClick={() => setActive(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 640, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line, #E3E8EF)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, color: "var(--marine, #0b0b0c)", fontSize: 16 }}>{active.subject}</div>
                <div style={{ fontSize: 12.5, color: "var(--or-dark, #9a7a12)", fontWeight: 700, marginTop: 2 }}>{active.service_label}</div>
              </div>
              <button onClick={() => setActive(null)} aria-label={t("author.close", "Fermer")} style={{ border: "none", background: "none", fontSize: 24, cursor: "pointer", color: "var(--muted, #667085)", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {active.messages.map((m) => (
                <div key={m.id} style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "78%" }}>
                  <div style={{ background: m.mine ? "var(--marine, #0b0b0c)" : "var(--eclosion-soft, #F3E9CC)", color: m.mine ? "#fff" : "var(--marine, #0b0b0c)", borderRadius: 12, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted, #667085)", marginTop: 2, textAlign: m.mine ? "right" : "left" }}>
                    {m.from_service ? active.service_label : t("author.you", "Vous")} · {dateFmt.format(new Date(m.created_at))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid var(--line, #E3E8EF)", padding: 10, display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }} placeholder={t("author.your_message", "Votre message…")} rows={1} style={{ flex: 1, resize: "none", padding: "9px 12px", border: "1px solid var(--line, #E3E8EF)", borderRadius: 8, fontSize: 13.5, fontFamily: "inherit", maxHeight: 120 }} />
              <button onClick={sendReply} disabled={busy || !reply.trim()} style={{ border: "none", background: "var(--marine, #0b0b0c)", color: "#fff", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: busy || !reply.trim() ? 0.5 : 1 }}>{t("author.send", "Envoyer")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
