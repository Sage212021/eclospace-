import { useEffect, useMemo, useState } from "react";
import {
  getServiceThreads,
  getServiceThread,
  replyServiceThread,
  type ServiceDesk,
  type ServiceThreadSummary,
  type ServiceThreadDetail,
} from "../api/client";
import { GuidanceNote } from "../components/GuidanceNote";

// Guichets Service Éducation / Service Client (Espace Auteur inc. 2b), côté
// personnel : les agents habilités (permission service_auteurs) traitent les
// messages des auteurs et répondent.

export function ServiceDeskPage({ canReply }: { canReply: boolean }) {
  const [filter, setFilter] = useState<ServiceDesk | "all">("all");
  const [threads, setThreads] = useState<ServiceThreadSummary[]>([]);
  const [active, setActive] = useState<ServiceThreadDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }), []);

  const load = () => getServiceThreads(filter === "all" ? undefined : filter).then(setThreads).catch((e) => setError(e instanceof Error ? e.message : "Erreur"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function openThread(id: string) {
    setError(null);
    try {
      setActive(await getServiceThread(id));
      setReply("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function sendReply() {
    if (busy || !active || !reply.trim()) return;
    setBusy(true);
    try {
      await replyServiceThread(active.id, reply.trim());
      await openThread(active.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  const tabs: { key: ServiceDesk | "all"; label: string }[] = [
    { key: "all", label: "Tous" },
    { key: "education", label: "Service Éducation" },
    { key: "client", label: "Service Client" },
  ];

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">Messages des auteurs</h1>
      <p className="ecl-page__lead">Les demandes des auteurs adressées au Service Éducation et au Service Client.</p>

      <GuidanceNote title="Messages des auteurs">
        La boîte de réception des messages envoyés par les auteurs depuis leur espace, vers le Service Éducation ou le
        Service Client. Ouvrez un fil pour répondre (selon vos droits).
      </GuidanceNote>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => setFilter(tb.key)} style={{ border: `1px solid ${filter === tb.key ? "var(--eclosion)" : "var(--line)"}`, background: filter === tb.key ? "var(--eclosion-soft)" : "#fff", color: "var(--ink)", borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: filter === tb.key ? 700 : 400, cursor: "pointer" }}>{tb.label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 8, maxWidth: 780 }}>
        {threads.length === 0 && <p style={{ fontSize: 14, color: "var(--muted)" }}>Aucun message pour ce filtre.</p>}
        {threads.map((th) => (
          <button key={th.id} onClick={() => openThread(th.id)} className="ecl-card" style={{ textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14.5 }}>{th.subject}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                <span style={{ color: "var(--eclosion-dark, #8A6A12)", fontWeight: 700 }}>{th.service_label}</span> · {th.author_name} · {th.last_message}
              </div>
            </div>
            {th.unread > 0 && <span style={{ background: "var(--alert)", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "1px 8px", flexShrink: 0 }}>{th.unread}</span>}
          </button>
        ))}
      </div>

      {active && (
        <div onClick={() => setActive(null)} style={{ position: "fixed", inset: 0, background: "rgba(22,35,61,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 640, maxWidth: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 16 }}>{active.subject}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  <span style={{ color: "var(--eclosion-dark, #8A6A12)", fontWeight: 700 }}>{active.service_label}</span> · {active.author_name}
                </div>
              </div>
              <button onClick={() => setActive(null)} aria-label="Fermer" style={{ border: "none", background: "none", fontSize: 24, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {active.messages.map((m) => (
                <div key={m.id} style={{ alignSelf: m.from_service ? "flex-end" : "flex-start", maxWidth: "78%" }}>
                  <div style={{ background: m.from_service ? "var(--eclosion)" : "var(--eclosion-soft)", color: m.from_service ? "#fff" : "var(--ink)", borderRadius: 12, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, textAlign: m.from_service ? "right" : "left" }}>
                    {m.from_service ? "Service" : active.author_name} · {dateFmt.format(new Date(m.created_at))}
                  </div>
                </div>
              ))}
            </div>
            {canReply && (
              <div style={{ borderTop: "1px solid var(--line)", padding: 10, display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }} placeholder="Votre réponse…" rows={1} style={{ flex: 1, resize: "none", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, fontFamily: "inherit", maxHeight: 120 }} />
                <button onClick={sendReply} disabled={busy || !reply.trim()} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: busy || !reply.trim() ? 0.5 : 1 }}>Répondre</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
