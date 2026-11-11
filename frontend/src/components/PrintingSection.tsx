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
  deletePrintQuote,
  updatePurchaseOrder,
  listStockLocations,
  type StockLocation,
  setGoodsReceiptQc,
  updatePurchaseOrderStatus,
  type DesignationLine,
  type GoodsReceipt,
  type PrintQuote,
  type Printer,
  type ProductionSpecs,
  type PurchaseOrder,
  type QcChecklistEntry,
  type QcChecklistItem,
  type QcVerdict,
  BON_FUNCTION_LABELS,
  purchaseOrderExtras,
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
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [qcItems, setQcItems] = useState<QcChecklistItem[]>([]);
  const [specs, setSpecs] = useState<ProductionSpecs | null>(null);
  const [transferPo, setTransferPo] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Carnet d'imprimeurs (ajout rapide) + formulaire de demande de devis.
  const [showAddPrinter, setShowAddPrinter] = useState(false);
  const [pf, setPf] = useState({ name: "", city: "", phone: "", email: "", specialties: "", payment_terms: "" });
  const [selPrinter, setSelPrinter] = useState("");
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
    listStockLocations().then(setLocations).catch(() => setLocations([]));
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

  // Saisie des montants du devis reçu (formulaire en ligne, plus de fenêtre pop-up).
  // `designations` = détail facultatif par tirage (une ligne par prestation) ;
  // quand il est fourni, le total par tirage est la somme des désignations.
  async function recordAmounts(
    quoteId: string,
    amounts: Record<string, number>,
    leadDays?: number,
    designations?: Record<string, DesignationLine[]>,
  ) {
    try {
      await recordPrintQuoteAmounts(quoteId, amounts, leadDays, designations);
      await refresh();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement du devis.");
    }
  }

  // Sélection motivée d'un devis (formulaire en ligne).
  async function selectQuote(quoteId: string, motive: string, chosenQuantity: number) {
    try {
      await selectPrintQuote(quoteId, motive, chosenQuantity);
      await refresh();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sélection.");
    }
  }

  async function handleDeleteQuote(quote: PrintQuote) {
    const who = `${quote.printer.partner.firstName}${quote.printer.partner.lastName ? " " + quote.printer.partner.lastName : ""}`.trim();
    if (!window.confirm(`Supprimer ce devis (${who} — tirages : ${quote.quantities.join(", ")}) ?`)) return;
    try {
      await deletePrintQuote(quote.id);
      await refresh();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression du devis impossible.");
    }
  }

  async function createPo(quoteId: string, fn: string) {
    try {
      // Fonction au titre de laquelle le bon est établi (traçabilité).
      await createPurchaseOrder(quoteId, fn ? { established_by_function: fn } : {});
      await refresh();
      setError(null);
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
        <QuoteRow
          key={quote.id}
          quote={quote}
          canManage={canManage}
          canValidate={canValidate}
          canManageBon={canManageBon}
          bonFunctions={bonFunctions}
          onRecord={recordAmounts}
          onSelect={selectQuote}
          onDelete={handleDeleteQuote}
          onCreatePo={createPo}
        />
      ))}

      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 16 }}>Bons de commande</div>
      {orders.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Aucun bon de commande pour l'instant. Pour en établir un : saisissez le devis reçu, puis <strong>Sélectionner</strong> le devis retenu ; le bouton <strong>« Générer le bon de commande »</strong> apparaît alors sous ce devis.
          {!canManageBon && <> (l'établissement est réservé aux fonctions Impression, Stock, DAF et Direction générale).</>}
        </p>
      )}
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

          <PoEditPanel po={po} canManage={canManageBon} locations={locations} onSaved={refresh} onError={setError} />

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

// Une ligne de devis avec ses actions EN LIGNE (plus de fenêtres pop-up) :
// saisie des montants reçus, sélection motivée, suppression, génération du bon.
function QuoteRow({ quote, canManage, canValidate, canManageBon, bonFunctions, onRecord, onSelect, onDelete, onCreatePo }: {
  quote: PrintQuote;
  canManage: boolean;
  canValidate: boolean;
  canManageBon: boolean;
  bonFunctions: { value: string; label: string }[];
  onRecord: (quoteId: string, amounts: Record<string, number>, leadDays?: number, designations?: Record<string, DesignationLine[]>) => Promise<void>;
  onSelect: (quoteId: string, motive: string, qty: number) => Promise<void>;
  onDelete: (quote: PrintQuote) => Promise<void>;
  onCreatePo: (quoteId: string, fn: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<null | "record" | "select">(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // Désignations détaillées par tirage (brouillon de saisie : montants en texte).
  // Clé = tirage. Quand un tirage a des désignations, son total = somme des lignes.
  const [designations, setDesignations] = useState<Record<string, { label: string; amount: string }[]>>({});
  const [leadDays, setLeadDays] = useState("");
  const [chosenQty, setChosenQty] = useState(String(quote.quantities[0] ?? ""));
  const [motive, setMotive] = useState("");
  const [bonFn, setBonFn] = useState(bonFunctions[0]?.value ?? "");
  const [busy, setBusy] = useState(false);
  const who = `${quote.printer.partner.firstName}${quote.printer.partner.lastName ? " " + quote.printer.partner.lastName : ""}`.trim();

  function openRecord() {
    const init: Record<string, string> = {};
    const initDes: Record<string, { label: string; amount: string }[]> = {};
    for (const qty of quote.quantities) {
      const key = String(qty);
      init[key] = quote.amounts?.[key] != null ? String(quote.amounts[key]) : "";
      const lines = quote.designations?.[key];
      if (lines && lines.length) initDes[key] = lines.map((l) => ({ label: l.label, amount: String(l.amount) }));
    }
    setAmounts(init);
    setDesignations(initDes);
    setLeadDays(quote.leadTimeDays != null ? String(quote.leadTimeDays) : "");
    setMode("record");
  }
  // Total d'un tirage dans le brouillon : somme des désignations saisies.
  function tirageTotal(key: string): number {
    return (designations[key] ?? []).reduce((s, l) => s + (Number(l.amount) > 0 ? Number(l.amount) : 0), 0);
  }
  function addDesignation(key: string) {
    setDesignations({ ...designations, [key]: [...(designations[key] ?? []), { label: "", amount: "" }] });
  }
  function updateDesignation(key: string, idx: number, patch: Partial<{ label: string; amount: string }>) {
    const lines = [...(designations[key] ?? [])];
    lines[idx] = { ...lines[idx], ...patch };
    setDesignations({ ...designations, [key]: lines });
  }
  function removeDesignation(key: string, idx: number) {
    const lines = (designations[key] ?? []).filter((_, i) => i !== idx);
    const next = { ...designations };
    if (lines.length) next[key] = lines; else delete next[key];
    setDesignations(next);
  }
  async function submitRecord() {
    const parsed: Record<string, number> = {};
    const parsedDes: Record<string, DesignationLine[]> = {};
    for (const qty of quote.quantities) {
      const key = String(qty);
      const lines = (designations[key] ?? [])
        .map((l) => ({ label: l.label.trim(), amount: Number(l.amount) }))
        .filter((l) => l.label && l.amount > 0);
      if (lines.length) {
        // Un tirage détaillé : total = somme des désignations (priment).
        parsedDes[key] = lines;
        parsed[key] = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      } else {
        const v = Number(amounts[key]);
        if (v > 0) parsed[key] = v;
      }
    }
    if (Object.keys(parsed).length === 0) return;
    setBusy(true);
    try {
      await onRecord(
        quote.id,
        parsed,
        leadDays.trim() ? Number(leadDays) : undefined,
        Object.keys(parsedDes).length ? parsedDes : undefined,
      );
      setMode(null);
    } finally { setBusy(false); }
  }
  async function submitSelect() {
    const qty = Number(chosenQty);
    if (!qty || !motive.trim()) return;
    setBusy(true);
    try { await onSelect(quote.id, motive.trim(), qty); setMode(null); } finally { setBusy(false); }
  }
  async function submitPo() {
    setBusy(true);
    try { await onCreatePo(quote.id, bonFn); } finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
      <div>{who} — {quote.status} — tirages : {quote.quantities.join(", ")}</div>
      {quote.amounts && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 12 }}>
          {Object.entries(quote.amounts).map(([quantity, total]) => {
            const qty = Number(quantity);
            const unit = qty > 0 ? Math.round((total / qty) * 100) / 100 : null;
            const lines = quote.designations?.[quantity];
            return (
              <span key={quantity}>
                {qty.toLocaleString("fr-FR")} ex. → <span style={{ fontFamily: "var(--font-mono)" }}>{total.toLocaleString("fr-FR")}</span>
                {unit !== null && <span style={{ fontFamily: "var(--font-mono)" }}> ({unit.toLocaleString("fr-FR")}/u)</span>}
                {lines && lines.length > 0 && (
                  <span style={{ opacity: 0.8 }}> — {lines.length} désignation{lines.length > 1 ? "s" : ""}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {/* Détail des désignations du tirage sélectionné (reporté sur le bon). */}
      {quote.status === "selected" && quote.selectedQuantity != null && quote.designations?.[String(quote.selectedQuantity)]?.length ? (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>Désignations (tirage retenu {Number(quote.selectedQuantity).toLocaleString("fr-FR")} ex.) :</div>
          <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
            {quote.designations[String(quote.selectedQuantity)].map((l, i) => (
              <li key={i}>{l.label} — <span style={{ fontFamily: "var(--font-mono)" }}>{l.amount.toLocaleString("fr-FR")}</span> FCFA</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Saisie du devis reçu — formulaire en ligne */}
      {canManage && quote.status === "requested" && mode !== "record" && (
        <button onClick={openRecord} style={secondaryButtonStyle}>Saisir le devis reçu</button>
      )}
      {mode === "record" && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Pour chaque tirage, indiquez un montant global <strong>ou</strong> détaillez-le ligne par ligne
            (désignation + montant). Si vous ajoutez des désignations, le total du tirage est automatiquement
            la somme de ces lignes.
          </div>
          {quote.quantities.map((qty) => {
            const key = String(qty);
            const lines = designations[key] ?? [];
            const detailed = lines.length > 0;
            return (
              <div key={qty} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", background: "var(--ivory, #FAF8F2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13 }}>Tirage {qty.toLocaleString("fr-FR")} ex.</strong>
                  {detailed && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      Total : <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{tirageTotal(key).toLocaleString("fr-FR")}</span> FCFA
                    </span>
                  )}
                </div>
                {!detailed && (
                  <label style={{ ...fieldLabel, marginTop: 6 }}>Montant global (FCFA)
                    <input type="number" min={0} style={fieldInput} value={amounts[key] ?? ""} onChange={(e) => setAmounts({ ...amounts, [key]: e.target.value })} />
                  </label>
                )}
                {detailed && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                    {lines.map((line, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="text"
                          style={{ ...fieldInput, flex: 1 }}
                          placeholder="Désignation (ex. Impression intérieur N&B)"
                          value={line.label}
                          onChange={(e) => updateDesignation(key, idx, { label: e.target.value })}
                        />
                        <input
                          type="number"
                          min={0}
                          style={{ ...fieldInput, width: 120, fontFamily: "var(--font-mono)" }}
                          placeholder="Montant"
                          value={line.amount}
                          onChange={(e) => updateDesignation(key, idx, { amount: e.target.value })}
                        />
                        <button type="button" onClick={() => removeDesignation(key, idx)} title="Retirer cette désignation" style={{ ...secondaryButtonStyle, marginTop: 0, color: "var(--alert)", padding: "4px 8px" }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => addDesignation(key)} style={{ ...secondaryButtonStyle, marginTop: 6 }}>
                  + Ajouter une désignation
                </button>
              </div>
            );
          })}
          <label style={fieldLabel}>Délai annoncé (jours, facultatif)
            <input type="number" min={0} style={fieldInput} value={leadDays} onChange={(e) => setLeadDays(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitRecord} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0, background: "var(--eclosion, #D9B21A)", border: "none", fontWeight: 700 }}>Enregistrer le devis</button>
            <button onClick={() => setMode(null)} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0 }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Sélection motivée — formulaire en ligne */}
      {canValidate && quote.status === "received" && mode !== "select" && (
        <button onClick={() => { setChosenQty(String(quote.quantities[0] ?? "")); setMotive(""); setMode("select"); }} style={secondaryButtonStyle}>Sélectionner</button>
      )}
      {mode === "select" && (
        <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <label style={fieldLabel}>Tirage retenu
            <select style={fieldInput} value={chosenQty} onChange={(e) => setChosenQty(e.target.value)}>
              {quote.quantities.map((qty) => <option key={qty} value={qty}>{qty.toLocaleString("fr-FR")} ex.</option>)}
            </select>
          </label>
          <label style={{ ...fieldLabel, gridColumn: "1 / -1" }}>Motif du choix
            <textarea rows={2} style={{ ...fieldInput, width: "100%", resize: "vertical" }} value={motive} onChange={(e) => setMotive(e.target.value)} placeholder="Ex. meilleur coût unitaire au tirage de 1000, délai le plus court…" />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button onClick={submitSelect} disabled={busy || !motive.trim()} style={{ ...secondaryButtonStyle, marginTop: 0, background: "var(--eclosion, #D9B21A)", border: "none", fontWeight: 700 }}>Valider la sélection</button>
            <button onClick={() => setMode(null)} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0 }}>Annuler</button>
          </div>
        </div>
      )}

      {(canManage || canManageBon) && (quote.status === "requested" || quote.status === "received") && mode === null && (
        <button onClick={() => onDelete(quote)} style={{ ...secondaryButtonStyle, color: "var(--alert)" }}>Supprimer le devis</button>
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
          <button onClick={submitPo} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0 }}>Générer le bon de commande</button>
        </div>
      )}
    </div>
  );
}

// Aperçu INLINE (HTML, pas de PDF en iframe) du bon de commande : fiable sur
// mobile et dans les webviews, où un PDF « blob: » en iframe est bloqué
// (« Ce contenu est bloqué »). Rend le même contenu que le document imprimé.
function PurchaseOrderPreview({ po }: { po: PurchaseOrder }) {
  const cur = po.currency || "XAF";
  const fmt = (v: string | number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(Number(v));
  const p = po.printer?.partner;
  const supplier = p ? `${p.firstName}${p.lastName ? " " + p.lastName : ""}`.trim() : "—";
  const { author, isbn, specRows, instructions, establishedBy } = purchaseOrderExtras(po);
  const book = po.quote?.manuscript;
  const legal: [string, string][] = [];
  const addL = (k: string, v?: string | null) => { if (v && v.trim()) legal.push([k, v]); };
  addL("Adresse", p?.city);
  addL("Contact", [p?.phone, p?.email].filter(Boolean).join(" · ") || null);
  addL("NIU", p?.niu);
  addL("RCCM", p?.rccm);
  addL("Compte bancaire", p?.bankAccount);
  const label = (k: string, v: React.ReactNode) => (
    <div style={{ fontSize: 12.5 }}><span style={{ color: "var(--muted)" }}>{k} : </span><strong>{v}</strong></div>
  );
  const sec: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", color: "var(--eclosion-dark, #9A7A12)", margin: "10px 0 4px" };
  return (
    <div style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 8, padding: 14, background: "#fff" }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>Bon de commande <span style={{ fontFamily: "var(--font-mono)" }}>{po.poNumber}</span></div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{po.deliveryDue ? `Livraison attendue : ${new Date(po.deliveryDue).toLocaleDateString("fr-FR")}` : "Livraison : date non précisée"}</div>

      <div style={sec}>Fournisseur (imprimeur)</div>
      {label("Raison sociale", supplier)}
      {legal.map(([k, v]) => <div key={k} style={{ fontSize: 12 }}><span style={{ color: "var(--muted)" }}>{k} : </span>{v}</div>)}

      {(author || isbn || book) && <div style={sec}>Ouvrage</div>}
      {book && label("Titre", `${book.title}${book.manuscriptNumber ? ` (${book.manuscriptNumber})` : ""}`)}
      {author && label("Auteur", author)}
      {isbn && label("ISBN", isbn)}

      <div style={sec}>Commande</div>
      {po.lineItems && po.lineItems.length > 0 ? (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 2 }}>
          {po.lineItems.map((li, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
              <span>{li.label}</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(li.amount)}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Tirage : {po.orderedQuantity} ex.</div>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", padding: "6px 0", marginTop: 2 }}>
          <span>Impression — {book?.title ?? "Ouvrage"}</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>{po.orderedQuantity} ex. · {fmt(po.amount)}</span>
        </div>
      )}
      <div style={{ textAlign: "right", fontWeight: 700, marginTop: 4 }}>Total : {fmt(po.amount)}</div>

      {specRows.length > 0 && <>
        <div style={sec}>Fiche technique (à respecter)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px" }}>
          {specRows.map(([k, v]) => <div key={k} style={{ fontSize: 12 }}><span style={{ color: "var(--muted)" }}>{k} : </span><strong>{v}</strong></div>)}
        </div>
      </>}

      {instructions && <>
        <div style={sec}>Consignes à l'imprimeur</div>
        <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{instructions}</div>
      </>}

      <div style={sec}>Livraison</div>
      {label("Lieu", po.deliveryLocation?.label ?? "—")}
      {label("Tolérance de quantité", po.quantityTolerancePct != null && String(po.quantityTolerancePct) !== "" ? `± ${Number(po.quantityTolerancePct)} %` : "—")}
      {establishedBy && label("Établi par", establishedBy)}
    </div>
  );
}

// Aperçu (HTML inline) + modification du bon de commande. La modification des
// champs (livraison, tolérance, consignes) n'est possible qu'au BROUILLON ; une
// fois le bon approuvé/transmis, il est figé (lecture seule) mais reste
// prévisualisable. Les consignes seules restent modifiables après coup.
function PoEditPanel({ po, canManage, locations, onSaved, onError }: { po: PurchaseOrder; canManage: boolean; locations: StockLocation[]; onSaved: () => Promise<void>; onError: (m: string) => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const isDraft = po.status === "draft";
  const [form, setForm] = useState({
    delivery_due: po.deliveryDue ? po.deliveryDue.slice(0, 10) : "",
    delivery_location_id: po.deliveryLocationId ?? "",
    quantity_tolerance_pct: po.quantityTolerancePct != null ? String(po.quantityTolerancePct) : "",
    printer_instructions: po.printerInstructions ?? "",
  });

  function startEdit() {
    setForm({
      delivery_due: po.deliveryDue ? po.deliveryDue.slice(0, 10) : "",
      delivery_location_id: po.deliveryLocationId ?? "",
      quantity_tolerance_pct: po.quantityTolerancePct != null ? String(po.quantityTolerancePct) : "",
      printer_instructions: po.printerInstructions ?? "",
    });
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    try {
      await updatePurchaseOrder(po.id, {
        delivery_due: form.delivery_due ? new Date(form.delivery_due).toISOString() : null,
        delivery_location_id: form.delivery_location_id || null,
        quantity_tolerance_pct: form.quantity_tolerance_pct.trim() === "" ? null : Number(form.quantity_tolerance_pct),
        printer_instructions: form.printer_instructions,
      });
      await onSaved();
      setEditing(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement du bon de commande impossible.");
    } finally {
      setBusy(false);
    }
  }

  const instr = (po.printerInstructions ?? "").trim();
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setShowPreview((v) => !v)} style={{ ...secondaryButtonStyle, marginTop: 0 }}>{showPreview ? "Masquer l'aperçu" : "👁 Aperçu"}</button>
        {canManage && isDraft && !editing && <button onClick={startEdit} style={{ ...secondaryButtonStyle, marginTop: 0 }}>✎ Modifier le bon</button>}
      </div>

      {showPreview && <PurchaseOrderPreview po={po} />}

      {editing ? (
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <label style={fieldLabel}>Date de livraison souhaitée
            <input type="date" style={fieldInput} value={form.delivery_due} onChange={(e) => setForm({ ...form, delivery_due: e.target.value })} />
          </label>
          <label style={fieldLabel}>Lieu de livraison
            <select style={fieldInput} value={form.delivery_location_id} onChange={(e) => setForm({ ...form, delivery_location_id: e.target.value })}>
              <option value="">— Non précisé —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>Tolérance de quantité (%)
            <input type="number" min={0} step="0.5" style={fieldInput} value={form.quantity_tolerance_pct} onChange={(e) => setForm({ ...form, quantity_tolerance_pct: e.target.value })} placeholder="Ex. 2" />
          </label>
          <label style={{ ...fieldLabel, gridColumn: "1 / -1" }}>Consignes à l'imprimeur
            <textarea rows={3} style={{ ...fieldInput, width: "100%", resize: "vertical" }} value={form.printer_instructions} onChange={(e) => setForm({ ...form, printer_instructions: e.target.value })} placeholder="Ex. couleurs Pantone de la couverture, papier recyclé, livraison en cartons de 20…" />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0, background: "var(--eclosion, #D9B21A)", border: "none", fontWeight: 700 }}>Enregistrer</button>
            <button onClick={() => setEditing(false)} disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 0 }}>Annuler</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 12.5 }}>
          <span style={{ color: "var(--muted)" }}>Consignes à l'imprimeur : </span>
          {instr ? <span style={{ whiteSpace: "pre-wrap" }}>{instr}</span> : <span style={{ color: "var(--muted)" }}>aucune</span>}
          {canManage && !isDraft && <span style={{ color: "var(--muted)", marginLeft: 8 }}>— le bon est {po.status === "cancelled" ? "annulé" : "approuvé"}, il n'est plus modifiable.</span>}
        </div>
      )}
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
