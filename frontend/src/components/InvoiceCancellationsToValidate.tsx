import { useEffect, useState } from "react";
import {
  getPendingCancellationInvoices,
  approveInvoiceCancellation,
  rejectInvoiceCancellation,
  type PendingCancellationInvoice,
} from "../api/client";
import { Card } from "./Card";
import { IconFinance } from "./icons";

// Rubrique de décision du DG : annulations de factures demandées par le
// comptable, à valider (retire la facture du chiffre d'affaires) ou à refuser
// (la facture reste émise). Composant autonome (chargement + actions propres)
// pour être placé aussi bien sur la page Finance que sur la page Direction.

const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 });

export function InvoiceCancellationsToValidate({ showWhenEmpty = false }: { showWhenEmpty?: boolean }) {
  const [items, setItems] = useState<PendingCancellationInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  function reload() {
    getPendingCancellationInvoices()
      .then((r) => { setItems(r); setLoaded(true); })
      .catch(() => setLoaded(true));
  }
  useEffect(() => { reload(); }, []);

  async function approve(inv: PendingCancellationInvoice) {
    setError(null);
    setMessage(null);
    try {
      await approveInvoiceCancellation(inv.id);
      setMessage(`Facture ${inv.invoice_number} annulée — retirée du chiffre d'affaires.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation de l'annulation impossible.");
    }
  }
  async function reject(inv: PendingCancellationInvoice) {
    setError(null);
    setMessage(null);
    try {
      await rejectInvoiceCancellation(inv.id);
      setMessage(`Annulation de ${inv.invoice_number} refusée — la facture reste émise.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refus impossible.");
    }
  }

  // Tant que rien n'est chargé, ou s'il n'y a rien et qu'on ne force pas
  // l'affichage, on n'encombre pas la page.
  if (!loaded && items.length === 0) return null;
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <Card
      title="Annulations de factures à valider"
      icon={<IconFinance />}
      subtitle="Le comptable a demandé l'annulation ; votre validation (DG) la retire du chiffre d'affaires."
    >
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}
      {items.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>Aucune annulation en attente.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((inv) => (
            <div key={inv.id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-mono)" }}>{inv.invoice_number}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {inv.customer_name} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(inv.total_ttc)}</span>
                </div>
                {inv.reason && <div style={{ fontSize: 12.5, color: "var(--amber, #C4661F)", marginTop: 2 }}>Motif : {inv.reason}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => approve(inv)} style={btnDanger}>Valider l'annulation</button>
                <button onClick={() => reject(inv)} style={btnGhost}>Refuser</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "9px 13px" };
const btnDanger: React.CSSProperties = { border: "1px solid var(--alert)", background: "var(--alert)", color: "#fff", borderRadius: 8, padding: "8px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 };
const btnGhost: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", color: "var(--ink)", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer" };
