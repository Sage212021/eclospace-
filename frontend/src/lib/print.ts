// Impression / export PDF sans dépendance externe (choix économe, guide §6 et
// règle de simplicité technique) : on ouvre une fenêtre dédiée contenant le
// document mis en page pour l'impression, puis on déclenche la boîte
// d'impression du navigateur. L'utilisateur peut alors **imprimer** ou
// **« Enregistrer au format PDF »** (option native de tous les navigateurs).
// Aucune bibliothèque PDF lourde, fonctionne avec une connexion modeste.

import type { InvoiceDetail, PurchaseOrder, RoyaltyStatementDetail } from "../api/client";

// Coordonnées officielles de la maison — source unique pour tous les documents
// imprimés (facture, avoir, et à venir : relevés, bons de commande, contrats).
// Modifier ici met à jour l'en-tête et le pied de TOUS les documents.
const HOUSE = {
  legalName: "ECLOSION EDITION SARL",
  brand: "Éclosion",
  brandSuffix: "Édition",
  tagline: "L'avenir du livre",
  address: "Carrefour INSTIC – Nouvelle route Kondengui, Yaoundé, Cameroun",
  poBox: "B.P. 33071 Yaoundé",
  phone: "(+237) 698 03 15 02 / 678 70 40 86",
  email: "eclosionedition@gmail.com",
  website: "https://eclosioneditions.cm",
  rccm: "RC/YAO/2019/B/144",
  niu: "M021912751174Y",
  cnps: "C-YAO-2019-0144",
};

// En-tête et pied communs à tous les documents officiels (papier à en-tête
// Éclosion Édition). Styles inlinés : la fenêtre d'impression est isolée de
// l'application.
function documentShell(title: string, body: string): string {
  const now = new Date().toLocaleString("fr-FR");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #16233d; margin: 0; font-size: 12.5px; line-height: 1.5; }
    .doc { max-width: 720px; margin: 0 auto; padding: 8px; }
    .lh { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
    .lh__logo { height: 62px; width: auto; }
    .lh__contact { text-align: right; font-size: 10.5px; color: #4b5563; line-height: 1.7; max-width: 340px; }
    .lh__contact a { color: #4b5563; text-decoration: none; }
    .lh__rule { height: 3px; background: linear-gradient(90deg, #16233d 62%, #c89a1b 62%); border-radius: 2px; margin: 10px 0 4px; }
    .doc__title { font-family: Georgia, serif; font-size: 22px; margin: 20px 0 2px; }
    .num { font-family: ui-monospace, "IBM Plex Mono", monospace; }
    .meta { display: flex; gap: 28px; flex-wrap: wrap; margin: 6px 0 20px; font-size: 12px; color: #444; }
    .meta b { color: #16233d; }
    .party { margin: 0 0 18px; }
    .party__label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: #6b7280; margin-bottom: 3px; }
    .party__name { font-size: 14px; font-weight: 600; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.lines th { background: #16233d; color: #fff; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
    table.lines th.r, table.lines td.r { text-align: right; }
    table.lines td { padding: 8px 10px; border-bottom: 1px solid #e6e9ef; }
    table.lines tr:nth-child(even) td { background: #f8f9fb; }
    .totals { margin-top: 14px; margin-left: auto; width: 280px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
    .totals .ttc { border-top: 2px solid #16233d; margin-top: 6px; padding-top: 8px; font-size: 15px; font-weight: 700; }
    .totals .ttc .num { color: #16233d; }
    .badge { display: inline-block; border: 1px solid #c89a1b; color: #a87d14; border-radius: 999px; padding: 1px 10px; font-size: 11px; font-weight: 600; }
    .foot { margin-top: 34px; border-top: 1px solid #e6e9ef; padding-top: 10px; font-size: 10px; color: #6b7280; line-height: 1.6; }
    .foot__legal { color: #16233d; font-weight: 600; }
    .actions { text-align: center; margin: 18px 0 4px; }
    .actions button { font: inherit; background: #16233d; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; }
    @media print { .actions { display: none; } .doc { padding: 0; } }
  </style></head>
  <body>
    <div class="doc">
      <div class="lh">
        <img class="lh__logo" src="${window.location.origin}/eclosion-logo.png" alt="${HOUSE.brand} ${HOUSE.brandSuffix} — ${HOUSE.tagline}">
        <div class="lh__contact">
          ${escapeHtml(HOUSE.address)}<br>
          ${escapeHtml(HOUSE.poBox)} · Tél. ${escapeHtml(HOUSE.phone)}<br>
          <a href="mailto:${HOUSE.email}">${HOUSE.email}</a> · <a href="${HOUSE.website}">${escapeHtml(HOUSE.website)}</a>
        </div>
      </div>
      <div class="lh__rule"></div>
      ${body}
      <div class="foot">
        <div class="foot__legal">${escapeHtml(HOUSE.legalName)} · RCCM : ${escapeHtml(HOUSE.rccm)} · NIU : ${escapeHtml(HOUSE.niu)} · N° Affil. CNPS : ${escapeHtml(HOUSE.cnps)}</div>
        <div>Document généré par Éclospace le ${escapeHtml(now)}.</div>
      </div>
      <div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
    </div>
    <script>window.addEventListener('load', function(){ setTimeout(function(){ window.focus(); window.print(); }, 250); });</script>
  </body></html>`;
}

function openPrintWindow(title: string, body: string): void {
  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) {
    // Bloqueur de pop-up : on informe plutôt que d'échouer en silence.
    alert("Autorisez les fenêtres pop-up pour imprimer ce document.");
    return;
  }
  w.document.open();
  w.document.write(documentShell(title, body));
  w.document.close();
}

function money(value: string | number, currency: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "XAF", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString("fr-FR")} ${currency}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// Facture / avoir prêt à imprimer (Ch. 18). Reprend les lignes, totaux HT / TVA
// / TTC et la devise tels qu'enregistrés — aucun recalcul côté impression.
export function printInvoice(invoice: InvoiceDetail): void {
  const isCredit = invoice.type === "credit_note";
  const cur = invoice.currency || "XAF";
  const created = invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString("fr-FR") : "—";
  const due = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("fr-FR") : "—";

  const rows = invoice.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.description)}</td>
        <td class="r num">${l.quantity}</td>
        <td class="r num">${money(l.unitPrice, cur)}</td>
        <td class="r num">${Number(l.taxRate)} %</td>
        <td class="r num">${money(l.lineTotal, cur)}</td>
      </tr>`,
    )
    .join("");

  const body = `
    <div class="doc__title">${isCredit ? "Avoir" : "Facture"}</div>
    <div class="meta">
      <span>N° <b class="num">${escapeHtml(invoice.invoiceNumber)}</b></span>
      <span>Émise le <b class="num">${escapeHtml(created)}</b></span>
      <span>Échéance <b class="num">${escapeHtml(due)}</b></span>
      <span><span class="badge">${escapeHtml(statusLabel(invoice.status))}</span></span>
    </div>
    <div class="party">
      <div class="party__label">${isCredit ? "Avoir au profit de" : "Facturé à"}</div>
      <div class="party__name">${escapeHtml(invoice.customer.name)}</div>
    </div>
    <table class="lines">
      <thead><tr><th>Description</th><th class="r">Qté</th><th class="r">P.U. HT</th><th class="r">TVA</th><th class="r">Total HT</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">Aucune ligne.</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div><span>Total HT</span><span class="num">${money(invoice.totalHt, cur)}</span></div>
      <div><span>TVA</span><span class="num">${money(invoice.totalTax, cur)}</span></div>
      <div class="ttc"><span>Total TTC</span><span class="num">${money(invoice.totalTtc, cur)}</span></div>
    </div>`;

  openPrintWindow(`${isCredit ? "Avoir" : "Facture"} ${invoice.invoiceNumber}`, body);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = { issued: "Émise", paid: "Réglée", cancelled: "Annulée", credit_note: "Avoir", draft: "Brouillon" };
  return map[status] ?? status;
}

const ROYALTY_SOURCE_LABELS: Record<string, string> = {
  sales_order_line: "Vente",
  delivery: "Livraison",
  return_line: "Retour",
  consignment_statement: "Dépôt-vente",
  pos_sale: "Vente au comptoir",
};

// Relevé de droits d'auteur prêt à imprimer (Ch. 9 §9.5, Ch. 18 §18.7). Détaille
// les lignes (base, quantité, taux appliqué, montant) puis récapitule droits
// acquis, à-valoir amorti et solde dû. Montants tels qu'enregistrés.
export function printRoyaltyStatement(st: RoyaltyStatementDetail): void {
  const cur = "XAF";
  const start = new Date(st.periodStart).toLocaleDateString("fr-FR");
  const end = new Date(st.periodEnd).toLocaleDateString("fr-FR");
  const author = `${st.contract.partner.firstName} ${st.contract.partner.lastName}`;

  const rows = st.entries
    .map(
      (e) => `<tr>
        <td>${escapeHtml(ROYALTY_SOURCE_LABELS[e.sourceType] ?? e.sourceType)}</td>
        <td class="r num">${e.quantity}</td>
        <td class="r num">${money(e.unitBaseAmount, cur)}</td>
        <td class="r num">${(Number(e.rateApplied) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</td>
        <td class="r num">${money(e.amount, cur)}</td>
      </tr>`,
    )
    .join("");

  const remaining = st.remaining_balance ?? Number(st.balanceDue);
  const body = `
    <div class="doc__title">Relevé de droits d'auteur</div>
    <div class="meta">
      <span>Contrat <b class="num">${escapeHtml(st.contract.contractNumber)}</b></span>
      <span>Période <b class="num">${escapeHtml(start)}</b> → <b class="num">${escapeHtml(end)}</b></span>
      <span><span class="badge">${escapeHtml(statusLabel(st.status))}</span></span>
    </div>
    <div class="party">
      <div class="party__label">Bénéficiaire</div>
      <div class="party__name">${escapeHtml(author)}</div>
    </div>
    <table class="lines">
      <thead><tr><th>Nature</th><th class="r">Qté</th><th class="r">Base unitaire</th><th class="r">Taux</th><th class="r">Droits</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">Aucune ligne sur la période.</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div><span>Droits acquis</span><span class="num">${money(st.totalEarned, cur)}</span></div>
      <div><span>À-valoir amorti</span><span class="num">− ${money(st.advanceRecouped, cur)}</span></div>
      <div><span>Solde du relevé</span><span class="num">${money(st.balanceDue, cur)}</span></div>
      <div class="ttc"><span>Restant à payer</span><span class="num">${money(remaining, cur)}</span></div>
    </div>`;

  openPrintWindow(`Relevé de droits ${st.contract.contractNumber}`, body);
}

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  approved: "Approuvé",
  sent: "Transmis",
  in_production: "En production",
  received: "Reçu",
  closed: "Clôturé",
  cancelled: "Annulé",
};

// Bon de commande imprimeur prêt à imprimer (Ch. 15 §15.4). Récapitule le
// fournisseur, l'ouvrage, la quantité, le montant et les conditions de livraison.
export function printPurchaseOrder(po: PurchaseOrder): void {
  const cur = po.currency || "XAF";
  const printer = po.printer ? `${po.printer.partner.firstName} ${po.printer.partner.lastName}` : "—";
  const book = po.quote?.manuscript;
  const due = po.deliveryDue ? new Date(po.deliveryDue).toLocaleDateString("fr-FR") : "—";
  const tolerance = po.quantityTolerancePct != null && po.quantityTolerancePct !== "" ? `± ${Number(po.quantityTolerancePct)} %` : "—";
  const location = po.deliveryLocation?.label ?? "—";

  const body = `
    <div class="doc__title">Bon de commande</div>
    <div class="meta">
      <span>N° <b class="num">${escapeHtml(po.poNumber)}</b></span>
      <span>Livraison attendue <b class="num">${escapeHtml(due)}</b></span>
      <span><span class="badge">${escapeHtml(PO_STATUS_LABELS[po.status] ?? po.status)}</span></span>
    </div>
    <div class="party">
      <div class="party__label">Fournisseur (imprimeur)</div>
      <div class="party__name">${escapeHtml(printer)}</div>
    </div>
    <table class="lines">
      <thead><tr><th>Désignation</th><th class="r">Quantité</th><th class="r">Montant</th></tr></thead>
      <tbody>
        <tr>
          <td>Impression — ${escapeHtml(book?.title ?? "Ouvrage")}${book?.manuscriptNumber ? ` <span class="num">(${escapeHtml(book.manuscriptNumber)})</span>` : ""}</td>
          <td class="r num">${po.orderedQuantity}</td>
          <td class="r num">${money(po.amount, cur)}</td>
        </tr>
      </tbody>
    </table>
    <div class="meta" style="margin-top:14px">
      <span>Lieu de livraison : <b>${escapeHtml(location)}</b></span>
      <span>Tolérance de quantité : <b>${escapeHtml(tolerance)}</b></span>
    </div>
    <div class="totals">
      <div class="ttc"><span>Total commande</span><span class="num">${money(po.amount, cur)}</span></div>
    </div>`;

  openPrintWindow(`Bon de commande ${po.poNumber}`, body);
}
