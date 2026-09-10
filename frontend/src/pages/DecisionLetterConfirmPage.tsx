import { useEffect, useState } from "react";
import { getPublicDecisionLetter, confirmPublicDecisionLetter } from "../api/client";

// Page PUBLIQUE d'accusé de réception d'une décision éditoriale. Accessible sans
// compte, via le lien unique (jeton) reçu par e-mail. L'ouverture de cette page
// vaut « consultée » ; le clic sur le bouton vaut « réception confirmée ».
export function DecisionLetterConfirmPage({ token }: { token: string }) {
  const [letter, setLetter] = useState<{ subject: string; body: string; maison: string; confirmed_at: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);

  useEffect(() => {
    getPublicDecisionLetter(token)
      .then((l) => { setLetter(l); setConfirmedAt(l.confirmed_at); })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Lien invalide ou expiré."));
  }, [token]);

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const r = await confirmPublicDecisionLetter(token);
      setConfirmedAt(r.confirmed_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmation impossible.");
    } finally {
      setBusy(false);
    }
  }

  const wrap: React.CSSProperties = { minHeight: "100vh", background: "#e9e6dd", padding: "24px 16px", fontFamily: "Georgia,'Times New Roman',serif", color: "#0b0b0c" };
  const card: React.CSSProperties = { maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 10, boxShadow: "0 6px 26px rgba(0,0,0,.15)", padding: "26px 28px" };

  if (loadError) {
    return <div style={wrap}><div style={card}><p style={{ color: "#B23A2E", fontWeight: 700 }}>{loadError}</p><p style={{ fontSize: 13, color: "#6b7280" }}>Vérifiez le lien reçu par e-mail, ou contactez la maison d'édition.</p></div></div>;
  }
  if (!letter) return <div style={wrap}><div style={card}>Chargement…</div></div>;

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ borderBottom: "2px solid #D9B21A", paddingBottom: 8, marginBottom: 18, fontWeight: "bold", letterSpacing: ".5px" }}>{letter.maison}</div>
        <div style={{ fontWeight: 700, margin: "0 0 14px" }}>{letter.subject}</div>
        <div style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{letter.body}</div>

        <div style={{ marginTop: 26, paddingTop: 18, borderTop: "1px solid #e7e2d4", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          {confirmedAt ? (
            <div style={{ background: "#DEE7DE", color: "#2F7D4A", borderRadius: 8, padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>
              ✓ Réception confirmée le {new Date(confirmedAt).toLocaleString("fr-FR")}. Merci.
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13.5, color: "#4b5563", margin: "0 0 12px" }}>Je confirme avoir reçu la décision éditoriale relative à mon manuscrit.</p>
              {error && <div style={{ background: "#F6E2DE", color: "#B23A2E", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                style={{ background: "#D9B21A", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
              >
                {busy ? "Confirmation…" : "✓ Confirmer la réception"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
