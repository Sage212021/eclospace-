import { useEffect, useState } from "react";
import { listInvoices, forceCancelInvoice, type Invoice } from "../api/client";
import { Card } from "./Card";
import { IconFinance } from "./icons";

// Rubrique du DG / administrateur général (page Direction, sous pilotage) :
// historique des factures ÉMISES, replié (déroulé au clic), avec l'annulation
// directe (essai / erreur). Ce n'est pas une suppression : la facture passe
// « Annulée » (motif obligatoire, tracée) et sort du chiffre d'affaires.
// Autonome (chargement + action propres) pour vivre sur la page Direction sans
// dépendre de la page Finance.

const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 });
const STATUS: Record<string, string> = {
  issued: "Émise",
  pending_validation: "En attente de validation",
  cancellation_requested: "Annulation en attente",
};

export function EmittedInvoicesForCancellation() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function reload() {
    listInvoices()
      .then((list) => setInvoices(list.filter((i) => i.type === "invoice" && (i.status === "issued" || i.status === "pending_validation" || i.status === "cancellation_requested"))))
      .catch(() => {});
  }
  useEffect(() => { reload(); }, []);

  async function forceCancel(inv: Invoice) {
    const reason = window.prompt(
      `Annuler la facture ${inv.invoiceNumber} (${inv.customer.name}) ?\n\nLa facture passera « Annulée » et sortira du chiffre d'affaires (elle reste tracée, non supprimée).\n\nMotif (obligatoire — ex. essai, erreur de saisie, client fictif) :`,
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) { setError("Un motif d'annulation est requis."); return; }
    setError(null);
    setMessage(null);
    try {
      await forceCancelInvoice(inv.id, reason.trim());
      setMessage(`Facture ${inv.invoiceNumber} annulée (retirée du chiffre d'affaires).`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible.");
    }
  }

  return (
    <Card
      title="Historique des factures émises"
      icon={<IconFinance />}
      subtitle="Factures en attente de règlement. Le DG peut annuler un essai / une erreur (même déjà imprimée)."
      action={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13, color: "var(--ink)" }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--eclosion-dark)", background: "var(--eclosion-soft)", borderRadius: 999, padding: "0 8px" }}>{invoices.length}</span>
          <span style={{ color: "var(--muted)" }}>{open ? "Masquer" : "Dérouler"}</span>
          <span style={{ transition: "transform .15s", transform: open ? "rotate(90deg)" : "none", color: "var(--eclosion-dark)" }}>▸</span>
        </button>
      }
    >
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}
      {open && (
        invoices.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>Aucune facture émise en attente.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {invoices.map((inv) => (
              <div key={inv.id} style={row}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-mono)" }}>{inv.invoiceNumber}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    {inv.customer.name} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(Number(inv.totalTtc))}</span> · {STATUS[inv.status] ?? inv.status}
                  </div>
                </div>
                <button onClick={() => forceCancel(inv)} style={btnDanger}>Annuler (direction)</button>
              </div>
            ))}
          </div>
        )
      )}
    </Card>
  );
}

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "9px 13px" };
const btnDanger: React.CSSProperties = { border: "1px solid var(--alert)", background: "var(--alert)", color: "#fff", borderRadius: 8, padding: "8px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 };
