import { useEffect, useState } from "react";
import { getPublicQuote, signPublicQuote, type PublicQuote } from "../api/client";

// Coordonnées officielles de la maison — identiques à l'en-tête/pied des
// documents imprimés (facture, devis) et des e-mails. Source unique ici.
const HOUSE = {
  legalName: "ECLOSION EDITION SARL",
  address: "Carrefour INSTIC – Nouvelle route Kondengui, Yaoundé, Cameroun",
  poBox: "B.P. 33071 Yaoundé",
  phone: "(+237) 698 03 15 02 / 678 70 40 86",
  email: "eclosionedition@gmail.com",
  website: "https://eclosioneditions.cm",
  rccm: "RC/YAO/2019/B/144",
  niu: "M021912751174Y",
  cnps: "C-YAO-2019-0144",
};

// Page publique de signature d'un devis de prestation éditoriale (③). Accessible
// sans compte, via le lien unique reçu par e-mail. Mise en page sobre aux
// couleurs de la maison ; l'auteur consulte son devis et signe en un clic.

function money(value: string, currency: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "XAF", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString("fr-FR")} ${currency}`;
  }
}

export function QuoteSignPage({ token }: { token: string }) {
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    getPublicQuote(token)
      .then((q) => {
        setQuote(q);
        setName(q.author);
        if (q.status === "accepted" || q.status === "invoiced") setSigned(true);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Devis introuvable."));
  }, [token]);

  async function handleSign() {
    if (!consent) {
      setError("Cochez la case d'acceptation pour signer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signPublicQuote(token, { signer_name: name.trim(), consent });
      setSigned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "La signature n'a pas abouti.");
      setBusy(false);
    }
  }

  return (
    <div style={page}>
      <div style={card}>
        <div style={header}>
          <div>
            <img
              src="/eclosion-logo.png"
              alt="Éclosion Édition — L'avenir du livre"
              style={{ height: 56, width: "auto", display: "block" }}
              // Repli discret si le logo ne se charge pas : on affiche le nom.
              onError={(e) => {
                const img = e.currentTarget;
                img.style.display = "none";
                const fb = img.nextElementSibling as HTMLElement | null;
                if (fb) fb.style.display = "block";
              }}
            />
            <div style={{ display: "none" }}>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>Éclosion Édition</div>
              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#C89A1B" }}>L'avenir du livre</div>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, color: "#4b5563", lineHeight: 1.7, maxWidth: 300 }}>
            {HOUSE.address}
            <br />
            {HOUSE.poBox} · Tél. {HOUSE.phone}
            <br />
            {HOUSE.email} · {HOUSE.website}
          </div>
        </div>

        <div style={{ padding: "24px 26px" }}>
          {loadError && <p style={{ color: "#C24B3A", fontSize: 14 }}>{loadError}</p>}

          {!quote && !loadError && <p style={{ color: "#6b7280" }}>Chargement de votre devis…</p>}

          {quote && (
            <>
              <h1 style={{ fontFamily: "Georgia, serif", fontSize: 21, margin: "0 0 4px" }}>Votre devis de prestation éditoriale</h1>
              <div style={{ fontSize: 13, color: "#4b5563", marginBottom: 18 }}>
                Devis <b style={{ fontFamily: "var(--font-mono, monospace)" }}>{quote.quote_number}</b>
                {quote.manuscript_title ? ` · Ouvrage « ${quote.manuscript_title} »` : ""}
              </div>

              <table style={table}>
                <thead>
                  <tr>
                    <th style={thL}>Prestation</th>
                    <th style={thR}>Qté</th>
                    <th style={thR}>P.U.</th>
                    <th style={thR}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={td}>{l.description}</td>
                      <td style={tdR}>{l.quantity}</td>
                      <td style={tdR}>{money(l.unit_price, quote.currency)}</td>
                      <td style={tdR}>{money(l.line_total, quote.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ textAlign: "right", marginTop: 14, fontSize: 15 }}>
                <div style={{ color: "#4b5563" }}>Total HT&nbsp;: {money(quote.total_ht, quote.currency)}</div>
                <div style={{ color: "#4b5563" }}>TVA&nbsp;: {money(quote.total_tax, quote.currency)}</div>
                <div style={{ fontWeight: 700, fontSize: 18, borderTop: "2px solid #16233D", paddingTop: 6, marginTop: 6 }}>
                  Total TTC&nbsp;: {money(quote.total_ttc, quote.currency)}
                </div>
              </div>

              {quote.exclusions_note && (
                <p style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic", marginTop: 14 }}>{quote.exclusions_note}</p>
              )}

              <hr style={{ border: 0, borderTop: "1px solid #e6e9ef", margin: "22px 0" }} />

              {signed ? (
                <div style={{ background: "#eef7ee", border: "1px solid #cfe6cf", borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#2e6b32" }}>✓ Devis signé — merci !</div>
                  <p style={{ fontSize: 13.5, color: "#3a4b3a", margin: "8px 0 0" }}>
                    Votre accord a bien été enregistré. La maison d'édition va poursuivre le travail éditorial et vous fera parvenir la
                    facture correspondante. Vous pouvez fermer cette page.
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Signer ce devis</div>
                  <label style={{ display: "block", fontSize: 13, marginBottom: 12 }}>
                    Votre nom
                    <input value={name} onChange={(e) => setName(e.target.value)} style={input} placeholder="Nom et prénom" />
                  </label>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, marginBottom: 16 }}>
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>
                      J'ai lu ce devis et j'accepte la prestation et son montant. Je comprends que ma signature électronique
                      vaut accord et sera horodatée.
                    </span>
                  </label>
                  {error && <p style={{ color: "#C24B3A", fontSize: 13, marginTop: 0 }}>{error}</p>}
                  <button onClick={handleSign} disabled={busy || !name.trim() || !consent} style={{ ...button, opacity: busy || !name.trim() || !consent ? 0.5 : 1 }}>
                    {busy ? "Signature en cours…" : "J'accepte et je signe"}
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <div style={footer}>
          <div style={{ color: "#16233D", fontWeight: 700 }}>{HOUSE.legalName}</div>
          RCCM : {HOUSE.rccm} · NIU : {HOUSE.niu} · N° Affil. CNPS : {HOUSE.cnps}
          <br />
          {HOUSE.address} · {HOUSE.poBox} · Tél. {HOUSE.phone}
        </div>
      </div>
    </div>
  );
}

const page: React.CSSProperties = { minHeight: "100vh", background: "#eef1f6", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 12px", fontFamily: "Arial, Helvetica, sans-serif", color: "#16233D" };
const card: React.CSSProperties = { width: "100%", maxWidth: 640, background: "#fff", border: "1px solid #e6e9ef", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 30px rgba(22,35,61,.08)" };
const header: React.CSSProperties = { padding: "20px 26px", borderBottom: "3px solid #16233D", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" };
const footer: React.CSSProperties = { padding: "14px 26px", borderTop: "1px solid #e6e9ef", fontSize: 11, color: "#6b7280" };
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13.5 };
const thL: React.CSSProperties = { textAlign: "left", background: "#16233D", color: "#fff", padding: "8px 10px" };
const thR: React.CSSProperties = { textAlign: "right", background: "#16233D", color: "#fff", padding: "8px 10px" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #e6e9ef" };
const tdR: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #e6e9ef", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const input: React.CSSProperties = { display: "block", width: "100%", padding: "9px 10px", marginTop: 5, fontSize: 14, border: "1px solid #cfd5e0", borderRadius: 8, boxSizing: "border-box" };
const button: React.CSSProperties = { background: "#16233D", color: "#fff", border: "none", borderRadius: 9, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%" };
