// Impression / export PDF sans dépendance externe (choix économe, guide §6 et
// règle de simplicité technique) : on ouvre une fenêtre dédiée contenant le
// document mis en page pour l'impression, puis on déclenche la boîte
// d'impression du navigateur. L'utilisateur peut alors **imprimer** ou
// **« Enregistrer au format PDF »** (option native de tous les navigateurs).
// Aucune bibliothèque PDF lourde, fonctionne avec une connexion modeste.

import type { ContractDetail, EditorialQuote, InvoiceDetail, PurchaseOrder, RoyaltyStatementDetail } from "../api/client";

// Coordonnées officielles de la maison — source unique pour tous les documents
// imprimés (facture, avoir, et à venir : relevés, bons de commande, contrats).
// Modifier ici met à jour l'en-tête et le pied de TOUS les documents.
// Coordonnées officielles de la maison — les données des documents numériques
// font foi (décision opérateur du 11/07/2026). Source unique pour tous les docs.
const HOUSE = {
  legalName: "ECLOSION EDITION SARL",
  brand: "Éclosion",
  brandSuffix: "Édition",
  tagline: "L'avenir du livre",
  address: "Carrefour INSTIC – Nouvelle route Kondengui, Yaoundé, Cameroun",
  poBox: "B.P. 33071 Yaoundé",
  phone: "(+237) 654 366 663 / 698 03 15 02 / 678 70 40 86",
  email: "eclosionedition@gmail.com",
  website: "https://eclosioneditions.cm",
  rccm: "RC/YAO/2019/B/144",
  niu: "M021912751174Y",
  cnps: "C-YAO-2019-0144",
};

// Options d'impression, partagées par tous les documents (facture, devis,
// relevé, bon de commande, contrat). Trois présentations :
//   • défaut (numérique) : logo + mentions légales complètes, pour envoi/écran ;
//   • letterhead : version NEUTRE (sans logo ni mentions) pour imprimer sur le
//     papier à en-tête PHYSIQUE — espaces réservés en haut/bas ;
//   • embed : papier à en-tête NUMÉRIQUE intégré (image de fond A4 officielle) —
//     à imprimer sur papier ordinaire, l'en-tête est reproduit à l'impression.
export interface PrintOpts {
  letterhead?: boolean;
  embed?: boolean;
}

// En-tête et pied communs à tous les documents officiels. Styles inlinés : la
// fenêtre d'impression est isolée de l'application.
function documentShell(title: string, body: string, opts?: PrintOpts): string {
  const now = new Date().toLocaleString("fr-FR");
  const embed = opts?.embed ?? false;
  const letterhead = opts?.letterhead ?? false;

  // En mode « en-tête intégré », l'image A4 officielle fournit en-tête et pied :
  // aucun logo/mention ajouté, le contenu se place dans la zone centrale libre.
  const head = embed
    ? ""
    : letterhead
      ? `<div class="lh-space" aria-hidden="true"></div>`
      : `<div class="lh">
        <img class="lh__logo" src="${window.location.origin}/eclosion-logo.png" alt="${HOUSE.brand} ${HOUSE.brandSuffix} — ${HOUSE.tagline}">
        <div class="lh__contact">
          ${escapeHtml(HOUSE.address)}<br>
          ${escapeHtml(HOUSE.poBox)} · Tél. ${escapeHtml(HOUSE.phone)}<br>
          <a href="mailto:${HOUSE.email}">${HOUSE.email}</a> · <a href="${HOUSE.website}">${escapeHtml(HOUSE.website)}</a>
        </div>
      </div>
      <div class="lh__rule"></div>`;

  const foot = embed
    ? ""
    : letterhead
      ? `<div class="lh-foot-space" aria-hidden="true"></div>`
      : `<div class="foot">
        <div class="foot__legal">${escapeHtml(HOUSE.legalName)} · RCCM : ${escapeHtml(HOUSE.rccm)} · NIU : ${escapeHtml(HOUSE.niu)} · N° Affil. CNPS : ${escapeHtml(HOUSE.cnps)}</div>
        <div>Document généré par Éclospace le ${escapeHtml(now)}.</div>
      </div>`;

  // Filigrane d'authenticité : l'ampoule du papier à en-tête, en très léger, au
  // centre — uniquement sur la version numérique élégante (ni en-tête intégré,
  // qui la porte déjà, ni papier vierge, imprimé sur le papier physique).
  const digital = !embed && !letterhead;
  const watermarkStyle = digital
    ? `body { background: url("${window.location.origin}/eclosion-filigrane.png") center 54% / 52% auto no-repeat; }`
    : "";

  const pageMargin = embed ? "0" : "18mm 16mm";
  // Fond « papier à en-tête » A4 officiel (forcé à l'impression). La zone centrale
  // libre est réservée par le padding du bloc document.
  const embedStyle = embed
    ? `body { background: url("${window.location.origin}/eclosion-papier-entete.png") top center / 210mm 297mm no-repeat; }
       .doc { max-width: none; padding: 58mm 20mm 58mm; }
       body, .doc { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`
    : "";

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: ${pageMargin}; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #16233d; margin: 0; font-size: 12.5px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .doc { max-width: 720px; margin: 0 auto; padding: 8px; }
    /* Espace réservé à l'en-tête / au pied pré-imprimés (bandeaux ~56 mm ;
       la marge @page de 18 mm compte déjà, on complète ici). */
    .lh-space { height: 40mm; }
    .lh-foot-space { height: 40mm; }
    ${embedStyle}
    ${watermarkStyle}
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
    @media print { .actions { display: none; } ${embed ? "" : ".doc { padding: 0; }"} }
  </style></head>
  <body>
    <div class="doc">
      ${head}
      ${body}
      ${foot}
      <div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
    </div>
    <script>window.addEventListener('load', function(){ setTimeout(function(){ window.focus(); window.print(); }, 250); });</script>
  </body></html>`;
}

function openPrintWindow(title: string, body: string, opts?: PrintOpts): void {
  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) {
    // Bloqueur de pop-up : on informe plutôt que d'échouer en silence.
    alert("Autorisez les fenêtres pop-up pour imprimer ce document.");
    return;
  }
  w.document.open();
  w.document.write(documentShell(title, body, opts));
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
export function printInvoice(invoice: InvoiceDetail, opts?: PrintOpts): void {
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

  openPrintWindow(`${isCredit ? "Avoir" : "Facture"} ${invoice.invoiceNumber}`, body, opts);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = { issued: "Émise", paid: "Réglée", cancelled: "Annulée", credit_note: "Avoir", draft: "Brouillon" };
  return map[status] ?? status;
}

const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  accepted: "Accepté / signé",
  refused: "Refusé",
  expired: "Expiré",
  invoiced: "Facturé",
};

const QUOTE_METHOD_LABELS: Record<string, string> = {
  online_link: "en ligne",
  internal: "enregistrée par la maison",
  paper: "sur devis papier signé",
};

// Devis de prestation éditoriale prêt à imprimer / PDF (compte d'auteur). Reprend
// le papier à en-tête. Mentionne l'exclusion (impression/communication) et, si le
// devis est signé, l'acceptation de l'auteur (nom, date, mode).
export function printEditorialQuote(quote: EditorialQuote, opts?: PrintOpts): void {
  const cur = quote.currency || "XAF";
  const validUntil = quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("fr-FR") : null;
  const author = quote.partner ? `${quote.partner.firstName} ${quote.partner.lastName}` : quote.customer?.name ?? "";
  const QUOTE_TITLES: Record<string, string> = {
    editorial: "Devis de prestation éditoriale",
    impression: "Devis d'impression",
    communication: "Devis de communication",
  };
  const quoteTitle = QUOTE_TITLES[quote.serviceType] ?? "Devis de prestation";

  const rows = quote.lines
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

  const acceptance =
    quote.acceptedAt && quote.signerName
      ? `<div class="party" style="margin-top:18px">
           <div class="party__label">Devis accepté et signé</div>
           <div class="party__name">${escapeHtml(quote.signerName)}</div>
           <div style="font-size:12px;color:#555">Le ${escapeHtml(new Date(quote.acceptedAt).toLocaleDateString("fr-FR"))}${
             quote.acceptanceMethod ? ` · signature ${escapeHtml(QUOTE_METHOD_LABELS[quote.acceptanceMethod] ?? quote.acceptanceMethod)}` : ""
           }</div>
         </div>`
      : "";

  const body = `
    <div class="doc__title">${escapeHtml(quoteTitle)}</div>
    <div class="meta">
      <span>N° <b class="num">${escapeHtml(quote.quoteNumber)}</b></span>
      ${validUntil ? `<span>Valable jusqu'au <b class="num">${escapeHtml(validUntil)}</b></span>` : ""}
      <span><span class="badge">${escapeHtml(QUOTE_STATUS_LABELS[quote.status] ?? quote.status)}</span></span>
    </div>
    <div class="party">
      <div class="party__label">Établi pour</div>
      <div class="party__name">${escapeHtml(author)}</div>
      ${quote.manuscript ? `<div style="font-size:12px;color:#555">Ouvrage : ${escapeHtml(quote.manuscript.title)}</div>` : ""}
    </div>
    <table class="lines">
      <thead><tr><th>Prestation</th><th class="r">Qté</th><th class="r">P.U. HT</th><th class="r">TVA</th><th class="r">Total HT</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">Aucune ligne.</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div><span>Total HT</span><span class="num">${money(quote.totalHt, cur)}</span></div>
      <div><span>TVA</span><span class="num">${money(quote.totalTax, cur)}</span></div>
      <div class="ttc"><span>Total TTC</span><span class="num">${money(quote.totalTtc, cur)}</span></div>
    </div>
    ${quote.exclusionsNote ? `<p style="margin-top:16px;font-size:12px;color:#555;font-style:italic">${escapeHtml(quote.exclusionsNote)}</p>` : ""}
    ${acceptance}`;

  openPrintWindow(`Devis ${quote.quoteNumber}`, body, opts);
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
export function printRoyaltyStatement(st: RoyaltyStatementDetail, opts?: PrintOpts): void {
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

  openPrintWindow(`Relevé de droits ${st.contract.contractNumber}`, body, opts);
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
export function printPurchaseOrder(po: PurchaseOrder, opts?: PrintOpts): void {
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

  openPrintWindow(`Bon de commande ${po.poNumber}`, body, opts);
}

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  edition: "Contrat d'édition",
  cession: "Contrat de cession",
  prestation: "Contrat de prestation",
  coedition: "Contrat de coédition",
  traduction: "Contrat de traduction",
};
const CONTRACT_STATUS_LABELS: Record<string, string> = {
  preparation: "En préparation",
  legal_review: "Revue juridique",
  direction_approval: "Approbation direction",
  awaiting_signature: "En attente de signature",
  active: "Actif",
  expired: "Expiré",
  terminated: "Résilié",
};
const ROYALTY_BASE_LABELS: Record<string, string> = {
  prix_public_ht: "Prix public HT",
  prix_net_editeur: "Prix net éditeur",
};
const PERIODICITY_LABELS: Record<string, string> = {
  mensuelle: "Mensuelle",
  trimestrielle: "Trimestrielle",
  semestrielle: "Semestrielle",
  annuelle: "Annuelle",
};

// Fiche contractuelle prête à imprimer (Ch. 9). Récapitule les parties, l'ouvrage,
// la portée (territoires, langues, formats) et les clauses de droits d'auteur
// (base, paliers, à-valoir, retenue, périodicité). Résumé structuré du contrat.
export function printContract(c: ContractDetail, opts?: PrintOpts): void {
  const cur = "XAF";
  const partner = `${c.partner.firstName} ${c.partner.lastName}`;
  const signed = c.signedAt ? new Date(c.signedAt).toLocaleDateString("fr-FR") : "—";
  const effective = c.effectiveAt ? new Date(c.effectiveAt).toLocaleDateString("fr-FR") : "—";
  const duration = c.durationMonths ? `${c.durationMonths} mois` : "—";
  const list = (arr: string[]) => (arr && arr.length ? arr.map(escapeHtml).join(", ") : "—");

  const rt = c.royaltyTerms;
  const tiersRows = rt?.tiers?.length
    ? rt.tiers
        .map(
          (t) => `<tr>
            <td>${t.up_to == null ? "Au-delà" : `Jusqu'à ${t.up_to.toLocaleString("fr-FR")} ex.`}</td>
            <td class="r num">${(Number(t.rate) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</td>
          </tr>`,
        )
        .join("")
    : "";

  const royaltyBlock = rt
    ? `
      <div class="party__label" style="margin-top:20px">Droits d'auteur</div>
      <div class="meta" style="margin:6px 0 8px">
        <span>Base : <b>${escapeHtml(ROYALTY_BASE_LABELS[rt.base] ?? rt.base)}</b></span>
        ${rt.advanceAmount ? `<span>À-valoir : <b class="num">${money(rt.advanceAmount, cur)}</b></span>` : ""}
        ${rt.taxWithholdingPct ? `<span>Retenue fiscale : <b>${Number(rt.taxWithholdingPct)} %</b></span>` : ""}
        ${rt.statementPeriodicity ? `<span>Relevés : <b>${escapeHtml(PERIODICITY_LABELS[rt.statementPeriodicity] ?? rt.statementPeriodicity)}</b></span>` : ""}
      </div>
      ${tiersRows ? `<table class="lines"><thead><tr><th>Palier de ventes</th><th class="r">Taux</th></tr></thead><tbody>${tiersRows}</tbody></table>` : ""}`
    : "";

  const body = `
    <div class="doc__title">${escapeHtml(CONTRACT_TYPE_LABELS[c.type] ?? "Contrat")}</div>
    <div class="meta">
      <span>N° <b class="num">${escapeHtml(c.contractNumber)}</b></span>
      <span>Signé le <b class="num">${escapeHtml(signed)}</b></span>
      <span>Effet <b class="num">${escapeHtml(effective)}</b></span>
      <span>Durée <b>${escapeHtml(duration)}</b></span>
      <span><span class="badge">${escapeHtml(CONTRACT_STATUS_LABELS[c.status] ?? c.status)}</span></span>
    </div>
    <div style="display:flex; gap:40px; flex-wrap:wrap; margin-bottom:6px">
      <div class="party"><div class="party__label">Éditeur</div><div class="party__name">Éclosion Édition</div></div>
      <div class="party"><div class="party__label">Cocontractant</div><div class="party__name">${escapeHtml(partner)}</div></div>
    </div>
    ${c.manuscript ? `<div class="party"><div class="party__label">Ouvrage</div><div class="party__name">${escapeHtml(c.manuscript.title)} <span class="num" style="font-weight:400;color:#6b7280">(${escapeHtml(c.manuscript.manuscriptNumber)})</span></div></div>` : ""}
    <div class="meta" style="margin-top:14px">
      <span>Territoires : <b>${list(c.territories)}</b></span>
      <span>Langues : <b>${list(c.languages)}</b></span>
      <span>Formats : <b>${list(c.formats)}</b></span>
    </div>
    ${royaltyBlock}
    <div style="margin-top:40px; display:flex; gap:60px; flex-wrap:wrap">
      <div style="flex:1; min-width:200px"><div class="party__label">L'éditeur</div><div style="border-top:1px solid #16233d; margin-top:44px; padding-top:4px; font-size:10.5px; color:#6b7280">Signature &amp; cachet</div></div>
      <div style="flex:1; min-width:200px"><div class="party__label">Le cocontractant</div><div style="border-top:1px solid #16233d; margin-top:44px; padding-top:4px; font-size:10.5px; color:#6b7280">Signature</div></div>
    </div>`;

  openPrintWindow(`Contrat ${c.contractNumber}`, body, opts);
}

// Bulletin de paie prêt à imprimer / PDF (D-007, incrément 4). En-tête maison
// commun (documentShell) ; ventilation reprise du moteur de calcul, sans
// recalcul côté impression. Mentions légales du Code du travail camerounais.
export interface PayslipPrintData {
  employee_name: string;
  period: string; // AAAA-MM
  matricule?: string | null;
  cnps_number?: string | null;
  niu?: string | null;
  fiscal_parts?: number | null;
  payslip: {
    base: number; complements: number; prime_anciennete: number; retenue_absence: number;
    salaire_brut: number; assiette_cnps: number;
    pvid_salarie: number; pvid_patronal: number; prestations_familiales: number; accidents_travail: number;
    cfc_salarie: number; cfc_patronal: number; fne: number; taxe_communale: number; rav: number;
    irpp_cac: number; total_retenues_internes: number; total_retenues_salariales: number;
    total_charges_patronales: number; net_a_payer: number; cout_employeur: number;
  };
}

export function printPayslip(d: PayslipPrintData, opts?: PrintOpts): void {
  const p = d.payslip;
  const m = (n: number) => money(n, "XAF");
  const line = (label: string, value: number, neg = false) =>
    `<tr><td>${escapeHtml(label)}</td><td class="r num">${neg ? "− " : ""}${m(value)}</td></tr>`;

  const remuneration = `
    <table class="lines"><thead><tr><th>Éléments de rémunération</th><th class="r">Montant</th></tr></thead><tbody>
      ${line("Salaire de base", p.base)}
      ${line("Compléments de salaire", p.complements)}
      ${p.prime_anciennete > 0 ? line("Prime d'ancienneté", p.prime_anciennete) : ""}
      ${p.retenue_absence > 0 ? line("Retenue absence injustifiée", p.retenue_absence, true) : ""}
      <tr><td><b>SALAIRE BRUT DU MOIS</b></td><td class="r num"><b>${m(p.salaire_brut)}</b></td></tr>
    </tbody></table>`;

  const cotisations = `
    <table class="lines" style="margin-top:14px"><thead><tr><th>Cotisations sociales &amp; fiscales — législation camerounaise</th><th class="r">Salarié</th></tr></thead><tbody>
      ${line("CNPS – PVID (vieillesse/invalidité/décès)", p.pvid_salarie)}
      ${line("CFC – Crédit Foncier du Cameroun", p.cfc_salarie)}
      ${line("Taxe communale", p.taxe_communale)}
      ${line("Redevance audiovisuelle (RAV)", p.rav)}
      ${line("IRPP + CAC (barème progressif)", p.irpp_cac)}
      <tr><td><b>TOTAL RETENUES SALARIALES</b></td><td class="r num"><b>${m(p.total_retenues_salariales)}</b></td></tr>
    </tbody></table>`;

  const internes = p.total_retenues_internes > 0
    ? `<table class="lines" style="margin-top:14px"><thead><tr><th>Retenues internes</th><th class="r">Montant</th></tr></thead><tbody>
        <tr><td>Total retenues internes</td><td class="r num">${m(p.total_retenues_internes)}</td></tr></tbody></table>`
    : "";

  const totals = `
    <div class="totals">
      <div><span>Total charges patronales</span><span class="num">${m(p.total_charges_patronales)}</span></div>
      <div><span>Coût total employeur</span><span class="num">${m(p.cout_employeur)}</span></div>
      <div class="ttc"><span>NET À PAYER</span><span class="num">${m(p.net_a_payer)}</span></div>
    </div>`;

  const mentions = `
    <div style="margin-top:26px;font-size:10px;color:#6b7280;line-height:1.6">
      Congés payés : acquisition 1,5 jour ouvrable par mois de service effectif (art. 89 du Code du travail camerounais).<br>
      Document à conserver sans limitation de durée (art. 68 du Code du travail camerounais). Moteur de paie Éclospace.
    </div>`;

  const body = `
    <div class="doc__title">Bulletin de paie</div>
    <div class="meta">
      <span>Matricule : <b class="num">${escapeHtml(d.matricule ?? "—")}</b></span>
      <span>Période : <b class="num">${escapeHtml(d.period)}</b></span>
      <span>Édité le <b class="num">${new Date().toLocaleDateString("fr-FR")}</b></span>
    </div>
    <div class="party">
      <div class="party__label">Salarié</div>
      <div class="party__name">${escapeHtml(d.employee_name)}</div>
      <div style="font-size:11px;color:#4b5563;margin-top:2px">
        N° CNPS : <span class="num">${escapeHtml(d.cnps_number ?? "—")}</span> ·
        NIU : <span class="num">${escapeHtml(d.niu ?? "—")}</span> ·
        Parts fiscales : <span class="num">${d.fiscal_parts ?? "—"}</span>
      </div>
    </div>
    ${remuneration}
    ${cotisations}
    ${internes}
    ${totals}
    ${mentions}`;

  openPrintWindow(`Bulletin de paie — ${d.employee_name} — ${d.period}`, body, opts);
}

export interface CommissionStatementData {
  agentName: string;
  periodLabel: string; // ex. « Mois — du 01/01/2026 au 25/07/2026 »
  ratePct: number; // taux en pourcentage, ex. 10
  books: { title: string; units: number; amount: number; commission: number }[];
  totals: { units: number; amount: number; commission: number };
}

// État de commission d'un commercial sur une période (demande opérateur : la
// maison peut payer les commissions par semaine ou par mois). Détail par
// ouvrage — exemplaires, montant vendu, commission — puis totaux. La commission
// est « due » (calculée par l'application) ; le versement effectif est constaté
// à part. Prêt à imprimer / enregistrer en PDF.
export function printCommissionStatement(d: CommissionStatementData, opts?: PrintOpts): void {
  const cur = "XAF";
  const rows = d.books
    .map(
      (b) => `<tr>
        <td>${escapeHtml(b.title)}</td>
        <td class="r num">${b.units.toLocaleString("fr-FR")}</td>
        <td class="r num">${money(b.amount, cur)}</td>
        <td class="r num">${money(b.commission, cur)}</td>
      </tr>`,
    )
    .join("");

  const body = `
    <div class="doc__title">État de commission</div>
    <div class="meta">
      <span>Période : <b>${escapeHtml(d.periodLabel)}</b></span>
      <span>Taux appliqué : <b class="num">${d.ratePct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</b></span>
      <span>Édité le <b class="num">${new Date().toLocaleDateString("fr-FR")}</b></span>
    </div>
    <div class="party">
      <div class="party__label">Commercial</div>
      <div class="party__name">${escapeHtml(d.agentName)}</div>
    </div>
    <table class="lines" style="margin-top:12px">
      <thead><tr><th>Ouvrage</th><th class="r">Exempl. vendus</th><th class="r">Montant vendu</th><th class="r">Commission due</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4">Aucune vente sur la période.</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div><span>Exemplaires vendus</span><span class="num">${d.totals.units.toLocaleString("fr-FR")}</span></div>
      <div><span>Montant vendu</span><span class="num">${money(d.totals.amount, cur)}</span></div>
      <div class="ttc"><span>Commission due</span><span class="num">${money(d.totals.commission, cur)}</span></div>
    </div>
    <div style="margin-top:26px;font-size:10.5px;color:#6b7280;line-height:1.6">
      Commission calculée à ${d.ratePct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % du montant vendu sur la période.
      Montant dû ; le versement effectif au commercial est constaté séparément.
    </div>
    <div style="margin-top:34px; display:flex; gap:60px; flex-wrap:wrap">
      <div style="flex:1; min-width:200px"><div class="party__label">La direction financière</div><div style="border-top:1px solid #16233d; margin-top:44px; padding-top:4px; font-size:10.5px; color:#6b7280">Signature &amp; cachet</div></div>
      <div style="flex:1; min-width:200px"><div class="party__label">Le commercial</div><div style="border-top:1px solid #16233d; margin-top:44px; padding-top:4px; font-size:10.5px; color:#6b7280">Reçu — signature</div></div>
    </div>`;

  openPrintWindow(`État de commission — ${d.agentName}`, body, opts);
}

const READING_RECO_LABELS: Record<string, string> = {
  accept: "Acceptation sans modification",
  accept_minor: "Acceptation sous réserve de corrections mineures",
  accept_major: "Acceptation sous réserve de corrections majeures",
  rewrite: "Demande de réécriture",
  new_expertise: "Nouvelle expertise",
  reject: "Refus motivé",
};

export interface ReadingReportData {
  manuscriptTitle: string;
  manuscriptNumber: string;
  readerName: string;
  submittedAt: string;
  recommendation: string;
  globalScore: number;
  overallComment: string | null;
  scores: { label: string; coefficient: number; score: number; comment: string | null }[];
}

// Rapport de lecture d'un relecteur : reprend l'évaluation remise (critères
// notés, score global, recommandation, appréciation) en document imprimable/PDF.
export function printReadingReport(d: ReadingReportData, opts?: PrintOpts): void {
  const rows = d.scores
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.label)}</td><td class="r num">${s.coefficient}</td><td class="r num">${s.score} / 10</td><td>${escapeHtml(s.comment ?? "")}</td></tr>`,
    )
    .join("");

  const body = `
    <div class="doc__title">Rapport de lecture</div>
    <div class="meta">
      <span>Manuscrit : <b class="num">${escapeHtml(d.manuscriptNumber)}</b></span>
      <span>Remis le <b class="num">${new Date(d.submittedAt).toLocaleDateString("fr-FR")}</b></span>
    </div>
    <div class="party">
      <div class="party__label">Ouvrage</div>
      <div class="party__name">${escapeHtml(d.manuscriptTitle)}</div>
    </div>
    <div class="party" style="margin-top:10px">
      <div class="party__label">Relecteur</div>
      <div class="party__name">${escapeHtml(d.readerName)}</div>
    </div>
    <table class="lines" style="margin-top:16px"><thead><tr><th>Critère</th><th class="r">Coef.</th><th class="r">Note</th><th>Commentaire</th></tr></thead><tbody>
      ${rows}
      <tr><td colspan="2"><b>Score global</b></td><td class="r num"><b>${d.globalScore} / 10</b></td><td></td></tr>
    </tbody></table>
    <div class="party" style="margin-top:16px">
      <div class="party__label">Recommandation</div>
      <div class="party__name">${escapeHtml(READING_RECO_LABELS[d.recommendation] ?? d.recommendation)}</div>
    </div>
    ${
      d.overallComment
        ? `<div style="margin-top:14px"><div class="party__label">Appréciation générale</div><div style="font-size:12.5px;color:#1f2937;white-space:pre-wrap;margin-top:4px">${escapeHtml(d.overallComment)}</div></div>`
        : ""
    }`;

  openPrintWindow(`Rapport de lecture — ${d.manuscriptTitle}`, body, opts);
}
