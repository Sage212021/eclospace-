import { useEffect, useState } from "react";
import {
  correctGoodsReceipt,
  createGoodsReceiptClaim,
  createPurchaseOrder,
  createPrinterQuick,
  getProductionSpecs,
  listPrintQuotes,
  listPrinters,
  listPurchaseOrders,
  listQcChecklistItems,
  recordGoodsReceipt,
  recordPrintQuoteAmounts,
  requestPrintQuote,
  selectPrintQuote,
  setGoodsReceiptQc,
  updatePurchaseOrderInstructions,
  updatePurchaseOrderStatus,
  type GoodsReceipt,
  type PrintQuote,
  type Printer,
  type ProductionSpecs,
  type PurchaseOrder,
  type QcChecklistEntry,
  type QcChecklistItem,
  type QcVerdict,
  BON_FUNCTION_LABELS,
} from "../api/client";
import { printPurchaseOrder } from "../lib/print";
import { downloadPurchaseOrderPdf, purchaseOrderPdfFile } from "../lib/financePdf";
import { TransferDocDialog } from "./TransferDocDialog";
import { DocPrintMenu } from "./DocPrintMenu";
import { CollapsibleSection } from "./CollapsibleSection";

interface PrintingSectionProps {
  manuscriptId: string;
  canManage: boolean;   // pilotage devis/imprimeurs (responsable Impression)
  canValidate: boolean;
  // Établissement du BON DE COMMANDE, ouvert à 3 fonctions (Impression / Stock /
  // DAF). `bonFunctions` = les fonctions sous lesquelles l'utilisateur peut agir.
  canManageBon?: boolean;
  bonFunctions?: { value: string; label: string }[];
}

// Impression et fabrication (Ch. 15) : devis comparés, bon de commande,
// suivi de fabrication jusqu'à la réception.
export function PrintingSection({ manuscriptId, canManage, canValidate, canManageBon = canManage, bonFunctions = [] }: PrintingSectionProps) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [quotes, setQuotes] = useState<PrintQuote[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [qcItems, setQcItems] = useState<QcChecklistItem[]>([]);
  const [specs, setSpecs] = useState<ProductionSpecs | null>(null);
  const [transferPo, setTransferPo] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Carnet d'imprimeurs (ajout rapide) + formulaire de demande de devis.
  const [showAddPrinter, setShowAddPrinter] = useState(false);
  const [pf, setPf] = useState({ name: "", city: "", phone: "", email: "", specialties: "", payment_terms: "" });
  const [selPrinter, setSelPrinter] = useState("");
  const [bonFn, setBonFn] = useState(bonFunctions[0]?.value ?? "");
  const [qtys, setQtys] = useState("500, 1000");

  const refresh = async () => {
    const [printerList, quoteData, orderList, specsData] = await Promise.all([
      listPrinters(), listPrintQuotes(manuscriptId), listPurchaseOrders(manuscriptId),
      getProductionSpecs(manuscriptId).catch(() => null),
    ]);
    setPrinters(printerList);
    setQuotes(quoteData.quotes);
    setOrders(orderList);
    setSpecs(specsData);
  };

  useEffect(() => {
    listQcChecklistItems()
      .then((r) => setQcItems(r.items))
      .catch(() => setQcItems([]));
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  async function handleAddPrinter() {
    if (pf.name.trim().length < 2) { setError("Le nom de l'imprimeur est requis."); return; }
    try {
      const created = await createPrinterQuick({
        name: pf.name.trim(),
        city: pf.city.trim() || undefined,
        phone: pf.phone.trim() || undefined,
        email: pf.email.trim() || undefined,
        specialties: pf.specialties.split(",").map((s) => s.trim()).filter(Boolean),
        payment_terms: pf.payment_terms.trim() || undefined,
      });
      await refresh();
      setSelPrinter(created.id); // présélectionné pour le devis
      setPf({ name: "", city: "", phone: "", email: "", specialties: "", payment_terms: "" });
      setShowAddPrinter(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ajout de l'imprimeur.");
    }
  }

  async function handleRequestQuote() {
    if (printers.length === 0) {
      setError("Ajoutez d'abord un imprimeur (bouton « + Ajouter un imprimeur »).");
      setShowAddPrinter(true);
      return;
    }
    const printerId = selPrinter || printers[0].id;
    const quantities = qtys.split(",").map((v) => Number(v.trim())).filter((v) => v > 0);
    if (quantities.length === 0) { setError("Indiquez au moins une hypothèse de tirage (ex. 500, 1000)."); return; }
    try {
      await requestPrintQuote(manuscriptId, printerId, quantities);
      await refresh();
      setError(null);
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
      // Fonction au titre de laquelle le bon est établi (traçabilité).
      await createPurchaseOrder(quote.id, bonFn ? { established_by_function: bonFn } : {});
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
      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {/* Fiche technique de l'ouvrage — RÉCUPÉRÉE automatiquement de la Maquette
          (lecture seule ici ; saisie à l'étape Maquette). Reprise au bon de commande. */}
      <div style={{ marginBottom: 12, padding: 10, border: "1px solid var(--line)", borderRadius: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Fiche technique de l'ouvrage <span style={{ color: "var(--muted)", fontWeight: 400 }}>— renseignée à la Maquette</span></div>
        {(() => {
          const rows: [string, string][] = [];
          const add = (l: string, v: string | number | null | undefined, s = "") => { if (v !== null && v !== undefined && String(v).trim() !== "") rows.push([l, `${v}${s}`]); };
          if (specs) {
            add("Format", specs.trimFormat);
            add("Pages", specs.finalPages);
            add("Papier intérieur", [specs.paperInterior, specs.paperInteriorGsm ? `${specs.paperInteriorGsm} g/m²` : ""].filter(Boolean).join(" · ") || null);
            add("Papier couverture", specs.paperCover);
            add("Reliure", specs.binding);
            add("Finition / pelliculage", specs.lamination);
            add("Dos", specs.spineWidthMm ? `${specs.spineWidthMm} mm` : null);
          }
          return rows.length > 0
            ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px", fontSize: 12.5 }}>
                {rows.map(([k, v]) => <div key={k}><span style={{ color: "var(--muted)" }}>{k} : </span><strong>{v}</strong></div>)}
              </div>
            : <div style={{ fontSize: 12.5, color: "var(--warn, #B87400)" }}>Non renseignée. Complétez-la à l'étape <strong>Maquette / Mise en page</strong> (section Production) — elle apparaîtra ici et sur le bon de commande, sans ressaisie.</div>;
        })()}
      </div>

      {/* Carnet d'imprimeurs : sans imprimeur, impossible de demander un devis. */}
      {canManage && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "var(--paper, #FAF8F2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5 }}>
              <strong>Imprimeurs ({printers.length})</strong>
              {printers.length > 0
                ? <span style={{ color: "var(--muted)" }}> — {printers.map((p) => `${p.partner.firstName} ${p.partner.lastName}`.trim()).join(", ")}</span>
                : <span style={{ color: "var(--muted)" }}> — aucun imprimeur enregistré. Ajoutez-en un pour pouvoir demander des devis.</span>}
            </div>
            <button onClick={() => setShowAddPrinter((v) => !v)} style={{ ...secondaryButtonStyle, marginTop: 0 }}>{showAddPrinter ? "Annuler" : "+ Ajouter un imprimeur"}</button>
          </div>
          {showAddPrinter && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <label style={fieldLabel}>Nom / raison sociale *<input style={fieldInput} value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} placeholder="Ex. Imprimerie Saint-Paul" /></label>
              <label style={fieldLabel}>Ville<input style={fieldInput} value={pf.city} onChange={(e) => setPf({ ...pf, city: e.target.value })} /></label>
              <label style={fieldLabel}>Téléphone<input style={fieldInput} value={pf.phone} onChange={(e) => setPf({ ...pf, phone: e.target.value })} /></label>
              <label style={fieldLabel}>Email<input style={fieldInput} value={pf.email} onChange={(e) => setPf({ ...pf, email: e.target.value })} /></label>
              <label style={fieldLabel}>Spécialités (séparées par des virgules)<input style={fieldInput} value={pf.specialties} onChange={(e) => setPf({ ...pf, specialties: e.target.value })} placeholder="offset, numérique, reliure" /></label>
              <label style={fieldLabel}>Conditions de paiement<input style={fieldInput} value={pf.payment_terms} onChange={(e) => setPf({ ...pf, payment_terms: e.target.value })} placeholder="Ex. 50 % à la commande" /></label>
              <div style={{ gridColumn: "1 / -1" }}>
                <button onClick={handleAddPrinter} style={{ ...secondaryButtonStyle, marginTop: 0, background: "var(--eclosion, #D9B21A)", border: "none", fontWeight: 700 }}>Enregistrer l'imprimeur</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Demander un devis : choix de l'imprimeur + hypothèses de tirage. */}
      {canManage && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={fieldLabel}>Imprimeur
            <select style={fieldInput} value={selPrinter || (printers[0]?.id ?? "")} onChange={(e) => setSelPrinter(e.target.value)} disabled={printers.length === 0}>
              {printers.length === 0 && <option value="">— aucun —</option>}
              {printers.map((p) => <option key={p.id} value={p.id}>{`${p.partner.firstName} ${p.partner.lastName}`.trim()}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>Hypothèses de tirage<input style={fieldInput} value={qtys} onChange={(e) => setQtys(e.target.value)} placeholder="500, 1000" /></label>
          <button onClick={handleRequestQuote} style={{ ...secondaryButtonStyle, marginTop: 0 }}>+ Demander un devis</button>
        </div>
      )}

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
          {canManageBon && quote.status === "selected" && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
              {bonFunctions.length > 1 && (
                <label style={fieldLabel}>Établi au titre de
                  <select style={fieldInput} value={bonFn} onChange={(e) => setBonFn(e.target.value)}>
                    {bonFunctions.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </label>
              )}
              <button onClick={() => handleCreatePurchaseOrder(quote)} style={{ ...secondaryButtonStyle, marginTop: 0 }}>
                Générer le bon de commande
              </button>
            </div>
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
          {po.establishedByName && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Établi par <strong style={{ color: "var(--ink)" }}>{po.establishedByName}</strong>
              {po.establishedByFunction && <> ({BON_FUNCTION_LABELS[po.establishedByFunction] ?? po.establishedByFunction})</>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <DocPrintMenu onPrint={(o) => printPurchaseOrder(po, o)} onDownloadPdf={() => downloadPurchaseOrderPdf(po)} />
            <button onClick={() => setTransferPo(po)} style={{ ...secondaryButtonStyle, marginTop: 0 }}>↗ Transférer</button>
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

          <PoInstructions po={po} canManage={canManageBon} onSaved={refresh} onError={setError} />

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

      {transferPo && (
        <TransferDocDialog
          title={`Bon de commande ${transferPo.poNumber}`}
          fileName={`Bon-de-commande-${transferPo.poNumber}.pdf`}
          subject="Bon de commande"
          getFile={() => purchaseOrderPdfFile(transferPo)}
          partnerWhatsapp={null}
          onClose={() => setTransferPo(null)}
          onError={setError}
        />
      )}
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

const fieldLabel: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", fontWeight: 600, display: "flex", flexDirection: "column", gap: 2 };
const fieldInput: React.CSSProperties = { padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, boxSizing: "border-box" };

// Consignes libres à l'imprimeur pour un bon de commande (reprises à l'impression).
function PoInstructions({ po, canManage, onSaved, onError }: { po: PurchaseOrder; canManage: boolean; onSaved: () => Promise<void>; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(po.printerInstructions ?? "");
  const [busy, setBusy] = useState(false);
  const current = (po.printerInstructions ?? "").trim();

  async function save() {
    setBusy(true);
    try { await updatePurchaseOrderInstructions(po.id, text); await onSaved(); setEditing(false); }
    catch (e) { onError(e instanceof Error ? e.message : "Enregistrement des consignes impossible."); }
    finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div style={{ marginTop: 6, fontSize: 12.5 }}>
        <span style={{ color: "var(--muted)" }}>Consignes à l'imprimeur : </span>
        {current ? <span style={{ whiteSpace: "pre-wrap" }}>{current}</span> : <span style={{ color: "var(--muted)" }}>aucune</span>}
        {canManage && <button onClick={() => { setText(po.printerInstructions ?? ""); setEditing(true); }} style={{ ...secondaryButtonStyle, marginTop: 0, marginLeft: 8, padding: "3px 10px" }}>{current ? "Modifier" : "+ Ajouter"}</button>}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Ex. couleurs Pantone de la couverture, papier recyclé, pré-presse à notre charge, livraison en cartons de 20…" style={{ ...fieldInput, width: "100%", resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={save} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0, background: "var(--eclosion, #D9B21A)", border: "none", fontWeight: 700 }}>Enregistrer</button>
        <button onClick={() => setEditing(false)} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0 }}>Annuler</button>
      </div>
    </div>
  );
}

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
