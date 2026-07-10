import { useEffect, useRef, useState } from "react";
import { Modal, Field } from "./Modal";
import { Button } from "./Button";
import { getKnownEmails, rememberEmail } from "../lib/emailMemory";

interface Preview {
  subject: string;
  html: string;
  default_to: string | null;
}

interface EmailModalProps {
  title: string;
  // Message pré-rempli (modèle).
  initialMessage: string;
  // Récupère l'aperçu de l'e-mail (sujet + HTML + destinataire connu) pour un message donné.
  loadPreview: (message: string) => Promise<Preview>;
  // Envoie réellement l'e-mail ; renvoie true si parti, false si simulé (SMTP non configuré).
  onSend: (to: string, message: string) => Promise<{ sent: boolean }>;
  onClose: () => void;
}

// Fenêtre d'envoi d'un document par e-mail (Phase A) : destinataire + message,
// et un APERÇU du message (le document mis en page) avant l'envoi. L'aperçu est
// rendu dans un cadre isolé (iframe) pour ne pas affecter l'application.
export function EmailModal({ title, initialMessage, loadPreview, onSend, onClose }: EmailModalProps) {
  const [to, setTo] = useState("");
  const [touchedTo, setTouchedTo] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Adresses déjà utilisées (mémoire locale) proposées en suggestion.
  const [known, setKnown] = useState<string[]>(() => getKnownEmails());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Charge (et recharge à la frappe, avec anti-rebond) l'aperçu.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      loadPreview(message)
        .then((p) => {
          setPreview(p);
          // Pré-remplit le destinataire connu tant que l'utilisateur n'y a pas touché.
          if (!touchedTo && p.default_to) setTo((cur) => cur || p.default_to || "");
          // Le destinataire connu (client/auteur) devient une adresse mémorisée.
          if (p.default_to) {
            rememberEmail(p.default_to);
            setKnown(getKnownEmails());
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Aperçu indisponible."));
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  async function handleSend() {
    if (!to.trim()) {
      setError("Renseignez l'adresse e-mail du destinataire.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const r = await onSend(to.trim(), message);
      // Mémorise l'adresse utilisée pour la reproposer ensuite.
      rememberEmail(to.trim());
      setKnown(getKnownEmails());
      setResult(
        r.sent
          ? `E-mail envoyé à ${to.trim()}.`
          : `E-mail préparé pour ${to.trim()}, mais l'envoi n'est pas encore configuré (paramètres SMTP à renseigner sur l'hébergement) — rien n'a été envoyé.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={
        result ? (
          <Button variant="add" size="sm" onClick={onClose}>Fermer</Button>
        ) : (
          <>
            <Button variant="view" size="sm" onClick={onClose}>Annuler</Button>
            <Button variant="add" size="sm" onClick={handleSend} disabled={sending || !to.trim()}>
              {sending ? "Envoi…" : "Envoyer"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink)" }}>{result}</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="ecl-field" style={{ flex: "1 1 240px" }}>
              <label>Destinataire</label>
              <input
                type="email"
                value={to}
                onChange={(e) => { setTo(e.target.value); setTouchedTo(true); }}
                onBlur={() => { rememberEmail(to); setKnown(getKnownEmails()); }}
                placeholder="adresse@exemple.com"
                list="ecl-known-emails"
                autoComplete="email"
              />
              {known.length > 0 && (
                <datalist id="ecl-known-emails">
                  {known.map((e) => (
                    <option key={e} value={e} />
                  ))}
                </datalist>
              )}
            </div>
            <div className="ecl-field" style={{ flex: "1 1 240px" }}>
              <label>Objet</label>
              <input value={preview?.subject ?? ""} readOnly style={{ background: "var(--paper)", color: "var(--muted)" }} />
            </div>
          </div>
          <Field label="Message d'accompagnement">
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>

          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Aperçu de l'e-mail</div>
            {preview ? (
              <iframe
                title="Aperçu de l'e-mail"
                srcDoc={preview.html}
                sandbox=""
                style={{ width: "100%", height: 340, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
              />
            ) : (
              <div style={{ padding: 20, fontSize: 13, color: "var(--muted)" }}>Chargement de l'aperçu…</div>
            )}
          </div>

          {error && <p style={{ margin: 0, fontSize: 13, color: "var(--alert)" }}>{error}</p>}
        </>
      )}
    </Modal>
  );
}
