import { useState } from "react";
import { login, verifyTwoFactor } from "../api/client";
import { PasswordInput } from "../components/PasswordInput";

interface LoginProps {
  onAuthenticated: () => void;
}

type Step = { kind: "credentials" } | { kind: "twoFactor"; challengeId: string };

export function Login({ onAuthenticated }: LoginProps) {
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCredentialsSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(username, password);
      if (result.requires_2fa && result.challenge_id) {
        setStep({ kind: "twoFactor", challengeId: result.challenge_id });
      } else {
        onAuthenticated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Identifiants invalides.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTwoFactorSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (step.kind !== "twoFactor") return;
    setError(null);
    setSubmitting(true);
    try {
      await verifyTwoFactor(step.challengeId, code);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code de vérification invalide.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "linear-gradient(155deg, #16233d 0%, #1e2a44 55%, #223252 100%)",
      }}
    >
      <div
        style={{
          background: "var(--card)",
          borderRadius: 18,
          padding: "44px 40px",
          width: 380,
          maxWidth: "100%",
          boxShadow: "0 24px 70px rgba(9, 16, 33, 0.45)",
        }}
      >
        <img src="/eclospace-logo.jpg" alt="Eclospace" style={{ width: "88%", display: "block", margin: "0 auto 28px" }} />

        {step.kind === "credentials" ? (
          <form onSubmit={handleCredentialsSubmit}>
            <Field label="Identifiant">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                name="username"
              />
            </Field>
            <Field label="Mot de passe">
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                name="password"
              />
            </Field>
            {error && <ErrorBanner message={error} />}
            <PrimaryButton disabled={submitting}>Se connecter</PrimaryButton>
          </form>
        ) : (
          <form onSubmit={handleTwoFactorSubmit}>
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
              Saisissez le code à 6 chiffres de votre application d'authentification.
            </p>
            <Field label="Code de vérification">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
                maxLength={6}
                inputMode="numeric"
                name="code"
                style={{ fontFamily: "var(--font-mono)", letterSpacing: 4, textAlign: "center" }}
              />
            </Field>
            {error && <ErrorBanner message={error} />}
            <PrimaryButton disabled={submitting}>Valider le code</PrimaryButton>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{label}</span>
      <div
        style={{
          "--field-border": "var(--line)",
        } as React.CSSProperties}
      >
        {children}
      </div>
      <style>{`
        label input {
          width: 100%;
          padding: 11px 13px;
          border: 1px solid var(--line);
          border-radius: 9px;
          font-size: 14px;
          transition: border-color 120ms ease, box-shadow 120ms ease;
        }
      `}</style>
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  // Bandeau de blocage (.warn, guide §4.7) : cause explicite, jamais "une erreur est survenue".
  return (
    <div
      style={{
        background: "var(--alert-soft)",
        color: "var(--alert)",
        border: "1px solid var(--alert)",
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      {message}
    </div>
  );
}

function PrimaryButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  // Bouton or « premium » : léger dégradé, halo doré et brillance au survol.
  return (
    <button
      type="submit"
      disabled={disabled}
      className="eclospace-cta"
      style={{
        width: "100%",
        background: "linear-gradient(180deg, var(--eclosion-light) 0%, var(--eclosion) 100%)",
        color: "#fff",
        border: "none",
        borderRadius: 9,
        padding: "12px 16px",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: "0 8px 20px rgba(200, 154, 27, 0.35)",
        transition: "filter 120ms ease, box-shadow 120ms ease, transform 60ms ease",
      }}
    >
      <style>{`
        .eclospace-cta:not(:disabled):hover { filter: brightness(1.06); box-shadow: 0 10px 26px rgba(200,154,27,0.45); }
        .eclospace-cta:not(:disabled):active { transform: translateY(1px); }
      `}</style>
      {children}
    </button>
  );
}
