import { useEffect, useState } from "react";
import {
  correctGoodsReceipt,
  createGoodsReceiptClaim,
  createPurchaseOrder,
  listPrintQuotes,
  listPrinters,
  listPurchaseOrders,
  listQcChecklistItems,
  recordGoodsReceipt,
  recordPrintQuoteAmounts,
  requestPrintQuote,
  selectPrintQuote,
  setGoodsReceiptQc,
  updatePurchaseOrderStatus,
  type GoodsReceipt,
  type PrintQuote,
  type Printer,
  type PurchaseOrder,
  type QcChecklistEntry,
  type QcChecklistItem,
  type QcVerdict,
} from "../api/client";
import { printPurchaseOrder } from "../lib/print";
import { downloadPurchaseOrderPdf } from "../lib/financePdf";
import { DocPrintMenu } from "./DocPrintMenu";
import { CollapsibleSection } from "./CollapsibleSection";

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
  const [qcItems, setQcItems] = useState<QcChecklistItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [printerList, quoteData, orderList] = await Promise.all([listPrinters(), listPrintQuotes(manuscriptId), listPurchaseOrders(manuscriptId)]);
    setPrinters(printerList);
    setQuotes(quoteData.quotes);
    setOrders(orderList);
  };

  useEffect(() => {
    listQcChecklistItems()
      .then((r) => setQcItems(r.items))
      .catch(() => setQcItems([]));
  }, []);

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
    <CollapsibleSection title="Impression et fabrication" storageKey="fiche:impression">
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 10 }}>
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
          {quote.amounts && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 12 }}>
              {Object.entries(quote.amounts).map(([quantity, total]) => {
                const qty = Number(quantity);
                const unit = qty > 0 ? Math.round((total / qty) * 100) / 100 : null;
                return (
                  <span key={quantity}>
                    {qty.toLocaleString("fr-FR")} ex. →{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>{total.toLocaleString("fr-FR")}</span>
                    {unit !== null && <span style={{ fontFamily: "var(--font-mono)" }}> ({unit.toLocaleString("fr-FR")}/u)</span>}
                  </span>
                );
              })}
            </div>
          )}
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
          <DocPrintMenu onPrint={(o) => printPurchaseOrder(po, o)} onDownloadPdf={() => downloadPurchaseOrderPdf(po)} />
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

          {(po.goodsReceipts ?? []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Réceptions &amp; contrôle qualité
              </div>
              {(po.goodsReceipts ?? []).map((r) => (
                <ReceiptCard
                  key={r.id}
                  receipt={r}
                  qcItems={qcItems}
                  canManage={canManage}
                  canValidate={canValidate}
                  onDone={refresh}
                  onError={setError}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </CollapsibleSection>
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

// Charte Éclospace : or = conforme (positif), orange = réserves, rouge = critique.
const VERDICTS: { value: QcVerdict; label: string; color: string }[] = [
  { value: "conform", label: "Conforme", color: "#d9b21a" },
  { value: "with_reserves", label: "Conforme avec réserves", color: "#C4661F" },
  { value: "non_conform", label: "Non conforme", color: "#C24B3A" },
];

function verdictOf(v?: QcVerdict | null) {
  return VERDICTS.find((x) => x.value === v);
}

function VerdictBadge({ verdict }: { verdict?: QcVerdict | null }) {
  const def = verdictOf(verdict);
  if (!def) return <span style={{ fontSize: 11, color: "var(--muted)" }}>Verdict à saisir</span>;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: def.color, borderRadius: 999, padding: "2px 8px" }}>
      {def.label}
    </span>
  );
}

interface ReceiptCardProps {
  receipt: GoodsReceipt;
  qcItems: QcChecklistItem[];
  canManage: boolean;
  canValidate: boolean;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}

// Bloc « une réception » : quantité + verdict qualité (3 choix colorés) +
// checklist des points vérifiés + commentaire + réclamation. Corrigible.
function ReceiptCard({ receipt, qcItems, canManage, canValidate, onDone, onError }: ReceiptCardProps) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<QcVerdict | null>(receipt.qcVerdict ?? null);
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = {};
    for (const entry of receipt.qcChecklist ?? []) base[entry.code] = entry.ok;
    return base;
  });
  const [comment, setComment] = useState(receipt.qcComment ?? "");
  const [saving, setSaving] = useState(false);

  async function saveQc() {
    if (!verdict) {
      onError("Choisissez un verdict de contrôle qualité (conforme, avec réserves ou non conforme).");
      return;
    }
    setSaving(true);
    try {
      const checklist: QcChecklistEntry[] = qcItems.map((it) => ({ code: it.code, ok: !!checks[it.code] }));
      await setGoodsReceiptQc(receipt.id, { verdict, checklist, comment: comment.trim() || undefined });
      setOpen(false);
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'enregistrement du contrôle qualité.");
    } finally {
      setSaving(false);
    }
  }

  async function correctQuantity() {
    const value = Number(window.prompt("Corriger la quantité reçue", String(receipt.quantityReceived)) ?? "");
    if (!Number.isFinite(value) || value < 0) return;
    try {
      await correctGoodsReceipt(receipt.id, value);
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la correction de la quantité.");
    }
  }

  async function addClaim() {
    const description = window.prompt("Décrire la non-conformité (réclamation à l'imprimeur)")?.trim();
    if (!description) return;
    try {
      await createGoodsReceiptClaim(receipt.id, description);
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'ouverture de la réclamation.");
    }
  }

  const checkedCount = qcItems.filter((it) => checks[it.code]).length;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginTop: 8, background: "var(--card)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{receipt.quantityReceived}</span> ex. reçus
          {receipt.variance !== 0 && (
            <span style={{ marginLeft: 6, color: receipt.variance < 0 ? "#C24B3A" : "#C4661F", fontFamily: "var(--font-mono)" }}>
              (écart {receipt.variance > 0 ? "+" : ""}
              {receipt.variance})
            </span>
          )}
          {canManage && (
            <button onClick={correctQuantity} style={{ ...secondaryButtonStyle, marginTop: 0, marginLeft: 8, padding: "2px 8px" }}>
              Corriger
            </button>
          )}
        </div>
        <VerdictBadge verdict={receipt.qcVerdict} />
      </div>

      {(receipt.qcChecklist ?? []).length > 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          Points vérifiés : {(receipt.qcChecklist ?? []).filter((c) => c.ok).length}/{(receipt.qcChecklist ?? []).length}
        </div>
      )}
      {receipt.qcComment && <div style={{ fontSize: 12, marginTop: 4, fontStyle: "italic" }}>« {receipt.qcComment} »</div>}

      {(receipt.claims ?? []).length > 0 && (
        <div style={{ marginTop: 6 }}>
          {(receipt.claims ?? []).map((c) => (
            <div key={c.id} style={{ fontSize: 11, color: "#C24B3A" }}>
              ⚠ Réclamation : {c.description}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {canValidate && (
          <button onClick={() => setOpen((o) => !o)} style={{ ...secondaryButtonStyle, marginTop: 0 }}>
            {open ? "Fermer" : receipt.qcVerdict ? "Modifier le contrôle qualité" : "Saisir le contrôle qualité"}
          </button>
        )}
        {canManage && (
          <button onClick={addClaim} style={{ ...secondaryButtonStyle, marginTop: 0 }}>
            Ouvrir une réclamation
          </button>
        )}
      </div>

      {open && canValidate && (
        <div style={{ marginTop: 10, borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Verdict</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {VERDICTS.map((v) => (
              <button
                key={v.value}
                onClick={() => setVerdict(v.value)}
                style={{
                  border: `1.5px solid ${v.color}`,
                  background: verdict === v.value ? v.color : "#fff",
                  color: verdict === v.value ? "#fff" : v.color,
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 6px" }}>
            Points à vérifier <span style={{ color: "var(--muted)", fontWeight: 400 }}>({checkedCount}/{qcItems.length})</span>
          </div>
          {qcItems.map((it) => (
            <label key={it.code} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, marginBottom: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!checks[it.code]}
                onChange={(e) => setChecks((prev) => ({ ...prev, [it.code]: e.target.checked }))}
                style={{ marginTop: 2 }}
              />
              <span>{it.label}</span>
            </label>
          ))}

          <div style={{ fontSize: 12, fontWeight: 600, margin: "10px 0 4px" }}>Observations (facultatif)</div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            style={{ width: "100%", fontSize: 12, borderRadius: 6, border: "1px solid var(--line)", padding: 6, boxSizing: "border-box" }}
            placeholder="Ex. : léger défaut de massicot sur 3 exemplaires, acceptable."
          />

          <button
            onClick={saveQc}
            disabled={saving}
            style={{ ...secondaryButtonStyle, background: "var(--eclosion, #d9b21a)", color: "#fff", border: "none", fontWeight: 600 }}
          >
            {saving ? "Enregistrement…" : "Enregistrer le contrôle qualité"}
          </button>
        </div>
      )}
    </div>
  );
}
