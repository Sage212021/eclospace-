import { useState } from "react";
import { changePassword, requestIdentifierChange, type EffectiveUser } from "../api/client";

// Section « Sécurité du compte » (Ch. 2) : changement de mot de passe (règles
// de complexité) et de l'identifiant/e-mail de connexion (confirmation par
// e-mail avant application). Toute modification est journalisée côté serveur.
export function AccountSecurity({ user }: { user: EffectiveUser }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Sécurité du compte</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 14px" }}>
        Gérez votre mot de passe et vos identifiants de connexion. Ces opérations sont tracées (horodatage, adresse IP).
      </p>
      <PasswordForm />
      <div style={{ height: 1, background: "var(--line)", margin: "18px 0" }} />
      <IdentifierForm user={user} />
    </div>
  );
}

function clientPasswordError(pw: string): string | null {
  if (pw.length < 8) return "Au moins 8 caractères.";
  if (!/[A-Z]/.test(pw)) return "Au moins une majuscule.";
  if (!/[0-9]/.test(pw)) return "Au moins un chiffre.";
  return null;
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (next !== confirm) {
      setError("Le nouveau mot de passe et sa confirmation ne correspondent pas.");
      return;
    }
    const complexity = clientPasswordError(next);
    if (complexity) {
      setError(`Mot de passe trop faible : ${complexity}`);
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(current, next);
      setMessage("Mot de passe modifié.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du changement de mot de passe.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Changer le mot de passe</div>
      {error && <Banner tone="alert">{error}</Banner>}
      {message && <Banner tone="ok">{message}</Banner>}
      <Field label="Mot de passe actuel">
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required style={inputStyle} />
      </Field>
      <Field label="Nouveau mot de passe (min. 8 caractères, une majuscule, un chiffre)">
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required style={inputStyle} />
      </Field>
      <Field label="Confirmer le nouveau mot de passe">
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required style={inputStyle} />
      </Field>
      <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>
        Modifier le mot de passe
      </button>
    </form>
  );
}

function IdentifierForm({ user }: { user: EffectiveUser }) {
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const changed = username !== user.username || email !== user.email;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!changed) {
      setError("Modifiez l'identifiant ou l'e-mail avant d'enregistrer.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestIdentifierChange({
        current_password: password,
        new_username: username !== user.username ? username : undefined,
        new_email: email !== user.email ? email : undefined,
      });
      setPassword("");
      if (result.email_sent) {
        setMessage("Un e-mail de confirmation vient d'être envoyé. Le changement s'appliquera après clic sur le lien reçu.");
      } else if (result.confirmation_url) {
        // Mode sans e-mail configuré (recette/dev) : on affiche le lien.
        setMessage(`E-mail non configuré : lien de confirmation à ouvrir manuellement — ${result.confirmation_url}`);
      } else {
        setMessage("Demande enregistrée : confirmez via le lien reçu par e-mail.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la demande.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Changer l'identifiant / l'e-mail de connexion</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
        Le changement n'est appliqué qu'après confirmation via un e-mail envoyé à la nouvelle adresse.
      </p>
      {error && <Banner tone="alert">{error}</Banner>}
      {message && <Banner tone="ok">{message}</Banner>}
      <Field label="Identifiant de connexion">
        <input value={username} onChange={(e) => setUsername(e.target.value)} required style={inputStyle} />
      </Field>
      <Field label="E-mail de connexion">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
      </Field>
      <Field label="Mot de passe actuel (pour confirmer votre identité)">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
      </Field>
      <button type="submit" disabled={submitting || !changed} style={primaryButtonStyle(submitting || !changed)}>
        Demander le changement
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function Banner({ tone, children }: { tone: "alert" | "ok"; children: React.ReactNode }) {
  const alert = tone === "alert";
  return (
    <div
      style={{
        background: alert ? "var(--alert-soft)" : "var(--eclosion-soft)",
        color: alert ? "var(--alert)" : "var(--eclosion)",
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 13,
        marginBottom: 10,
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  fontSize: 14,
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "var(--eclosion)",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
