import { useEffect, useState } from "react";
import { getChatDirectory, startConversation, sendChatMessageWithFile, type ChatDirectoryEntry } from "../api/client";

// Transfert d'un document (PDF généré ou pièce numérisée) vers la messagerie
// interne (fichier réellement joint) ou WhatsApp (message pré-rempli + pièce
// téléchargée à joindre à la main). Générique, réutilisé par les contrats ET les
// bons de commande. `getFile` fournit le fichier ; `onSent` (facultatif) permet
// au parent de tracer l'envoi (journal d'envoi). `subject` nomme le type de pièce.
export function TransferDocDialog({
  title, fileName, getFile, subject = "Document", partnerWhatsapp, onSent, onClose, onError,
}: {
  title: string;
  fileName: string;
  getFile: () => Promise<File> | File;
  subject?: string;
  partnerWhatsapp?: string | null;
  onSent?: (channel: "messagerie_interne" | "whatsapp", recipientLabel: string, note: string) => void | Promise<void>;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [dir, setDir] = useState<ChatDirectoryEntry[]>([]);
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getChatDirectory().then((d) => { setDir(d); if (d[0]) setRecipient(d[0].id); }).catch(() => setDir([]));
  }, []);

  async function sendInternal() {
    if (!recipient) return;
    setSending(true);
    try {
      const conv = await startConversation(recipient);
      const body = (note.trim() ? note.trim() + "\n\n" : "") + `${subject} : ${title}`;
      const file = await getFile();
      await sendChatMessageWithFile(conv.id, body, file);
      try { await onSent?.("messagerie_interne", dir.find((u) => u.id === recipient)?.name ?? "", note.trim()); } catch { /* le journal ne bloque pas l'envoi */ }
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Transfert impossible.");
    } finally {
      setSending(false);
    }
  }

  async function shareWhatsApp() {
    try {
      const file = await getFile();
      const objUrl = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = objUrl; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
      const text = encodeURIComponent(`${note.trim() ? note.trim() + " — " : ""}${subject} : ${title} (pièce jointe téléchargée à joindre au message).`);
      const num = (partnerWhatsapp ?? "").replace(/[^\d]/g, "");
      const url = num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`;
      window.open(url, "_blank", "noopener");
      try { await onSent?.("whatsapp", partnerWhatsapp ? partnerWhatsapp : "Contact WhatsApp", note.trim()); } catch { /* journal best-effort */ }
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Préparation du fichier impossible.");
    }
  }

  const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13, boxSizing: "border-box" };
  const btn: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 440, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 4 }}>Transférer le document</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>{title}</div>

        <label style={{ fontSize: 11.5, display: "block", marginBottom: 10 }}>
          Message (facultatif)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Un mot d'accompagnement…" />
        </label>

        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Messagerie interne</div>
          {dir.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Aucun destinataire disponible.</p>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ fontSize: 11.5, flex: 1, minWidth: 160 }}>
                Destinataire
                <select value={recipient} onChange={(e) => setRecipient(e.target.value)} style={inputStyle}>
                  {dir.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <button onClick={sendInternal} disabled={sending || !recipient} style={{ ...btn, background: "var(--eclosion)", color: "#fff", border: "none" }}>
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          )}
        </div>

        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>WhatsApp</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
            {partnerWhatsapp ? <>Vers le numéro : <span style={{ fontFamily: "var(--font-mono)" }}>{partnerWhatsapp}</span>.</> : "Vous choisirez le contact dans WhatsApp."} La pièce sera téléchargée pour être jointe au message.
          </div>
          <button onClick={shareWhatsApp} style={{ ...btn, borderColor: "#25D366", color: "#128C3E", fontWeight: 600 }}>
            💬 Ouvrir WhatsApp
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} style={btn}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
