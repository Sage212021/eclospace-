import { useEffect, useState } from "react";
import {
  createPurchaseOrder,
  listPrintQuotes,
  listPrinters,
  listPurchaseOrders,
  recordGoodsReceipt,
  recordPrintQuoteAmounts,
  requestPrintQuote,
  selectPrintQuote,
  updatePurchaseOrderStatus,
  type PrintQuote,
  type Printer,
  type PurchaseOrder,
} from "../api/client";

interface PrintingSectionProps {
  manuscriptId: string;
  canManage: boolean;
  canValidate: boolean;
}

// Impression et fabrication (Ch. 15) : devis comparés, bon de commande,
// suivi de fabrication jusqu'à la réception.
export function PrintingSection({ manuscriptId, canManage, canValidate }: PrintingSectionProps) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [quotes, setQuotes] = useState<PrintQuote[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [printerList, quoteData, orderList] = await Promise.all([listPrinters(), listPrintQuotes(manuscriptId), listPurchaseOrders(manuscriptId)]);
    setPrinters(printerList);
    setQuotes(quoteData.quotes);
    setOrders(orderList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  async function handleRequestQuote() {
    if (printers.length === 0) {
      setError("Aucun imprimeur enregistré.");
      return;
    }
    const printerId = printers[0].id;
    const quantities = (window.prompt("Hypothèses de tirage (séparées par des virgules)", "500,1000") ?? "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => v > 0);
    if (quantities.length === 0) return;
    try {
      await requestPrintQuote(manuscriptId, printerId, quantities);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la demande de devis.");
    }
  }

  async function handleRecordAmounts(quote: PrintQuote) {
    const amounts: Record<string, number> = {};
    for (const qty of quote.quantities) {
      const amount = Number(window.prompt(`Montant pour ${qty} exemplaires`, "0") ?? "0");
      if (amount > 0) amounts[String(qty)] = amount;
    }
    try {
      await recordPrintQuoteAmounts(quote.id, amounts);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement du devis.");
    }
  }

  async function handleSelect(quote: PrintQuote) {
    const chosenQuantity = Number(window.prompt("Tirage retenu", quote.quantities[0]?.toString() ?? "0") ?? "0");
    const motive = window.prompt("Motif du choix");
    if (!chosenQuantity || !motive) return;
    try {
      await selectPrintQuote(quote.id, motive, chosenQuantity);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sélection.");
    }
  }

  async function handleCreatePurchaseOrder(quote: PrintQuote) {
    try {
      await createPurchaseOrder(quote.id, {});
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la génération du bon de commande.");
    }
  }

  async function handleAdvancePo(po: PurchaseOrder) {
    const next = { draft: "approved", approved: "sent", sent: "in_production", in_production: "completed" } as Record<string, string>;
    const nextStatus = next[po.status];
    if (!nextStatus) return;
    try {
      await updatePurchaseOrderStatus(po.id, nextStatus);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la transition.");
    }
  }

  async function handleReceipt(po: PurchaseOrder) {
    const quantity = Number(window.prompt("Quantité reçue", po.orderedQuantity.toString()) ?? "0");
    if (!quantity) return;
    try {
      const result = await recordGoodsReceipt(po.id, quantity);
      if (!result.within_tolerance) {
        setError(`Écart de ${result.variance} exemplaire(s) hors tolérance contractuelle.`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement de la réception.");
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Impression et fabrication</div>
        {canManage && (
          <button onClick={handleRequestQuote} style={secondaryButtonStyle}>
            + Demander un devis
          </button>
        )}
      </div>
      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      <div style={{ fontSize: 12, fontWeight: 600 }}>Devis</div>
      {quotes.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun devis demandé.</p>}
      {quotes.map((quote) => (
        <div key={quote.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
          <div>
            {quote.printer.partner.firstName} {quote.printer.partner.lastName} — {quote.status} — tirages : {quote.quantities.join(", ")}
          </div>
          {quote.amounts && <div style={{ fontSize: 12, color: "var(--muted)" }}>Montants : {JSON.stringify(quote.amounts)}</div>}
          {canManage && quote.status === "requested" && (
            <button onClick={() => handleRecordAmounts(quote)} style={secondaryButtonStyle}>
              Saisir le devis reçu
            </button>
          )}
          {canValidate && quote.status === "received" && (
            <button onClick={() => handleSelect(quote)} style={secondaryButtonStyle}>
              Sélectionner
            </button>
          )}
          {canManage && quote.status === "selected" && (
            <button onClick={() => handleCreatePurchaseOrder(quote)} style={secondaryButtonStyle}>
              Générer le bon de commande
            </button>
          )}
        </div>
      ))}

      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 16 }}>Bons de commande</div>
      {orders.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun bon de commande.</p>}
      {orders.map((po) => (
        <div key={po.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
          <div style={{ fontFamily: "var(--font-mono)" }}>{po.poNumber}</div>
          <div>
            {po.status} — {po.orderedQuantity} ex. — {po.amount}
          </div>
          {canValidate && ["draft", "approved", "sent", "in_production"].includes(po.status) && (
            <button onClick={() => handleAdvancePo(po)} style={secondaryButtonStyle}>
              Faire avancer →
            </button>
          )}
          {canManage && po.status !== "draft" && (
            <button onClick={() => handleReceipt(po)} style={secondaryButtonStyle}>
              Enregistrer une réception
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
  marginTop: 6,
};
