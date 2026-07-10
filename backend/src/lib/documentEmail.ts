// Construction d'e-mails « document » (Phase A) : le corps de l'e-mail EST le
// document (facture, relevé…), mis en page avec le papier à en-tête Éclosion
// Édition. Rendu côté serveur (le contenu n'est jamais fourni par le client),
// styles inlinés pour la compatibilité des messageries. Choix économe : aucune
// génération de PDF, l'e-mail se suffit à lui-même.

// Coordonnées de la maison — cohérentes avec l'en-tête des documents imprimés.
const HOUSE = {
  legalName: "ECLOSION EDITION SARL",
  brand: "Éclosion Édition",
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

export interface DocumentEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
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

// Coquille commune : en-tête maison, message personnel, corps du document, pied
// légal. Un seul endroit à modifier pour tous les e-mails-documents.
function emailShell(opts: { title: string; message: string; body: string }): string {
  const messageHtml = opts.message.trim()
    ? `<p style="margin:0 0 18px;white-space:pre-wrap">${esc(opts.message.trim())}</p>`
    : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#eef1f6;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:#16233d">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e9ef;border-radius:12px;overflow:hidden">
      <div style="padding:20px 24px;border-bottom:3px solid #16233d">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#16233d">${esc(HOUSE.brand)}</div>
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#a87d14">${esc(HOUSE.tagline)}</div>
      </div>
      <div style="padding:24px">
        ${messageHtml}
        ${opts.body}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e6e9ef;font-size:11px;color:#6b7280;line-height:1.6">
        <div style="color:#16233d;font-weight:bold">${esc(HOUSE.legalName)}</div>
        ${esc(HOUSE.address)}<br>${esc(HOUSE.poBox)} · Tél. ${esc(HOUSE.phone)}<br>
        ${esc(HOUSE.email)} · ${esc(HOUSE.website)}<br>
        RCCM : ${esc(HOUSE.rccm)} · NIU : ${esc(HOUSE.niu)} · N° Affil. CNPS : ${esc(HOUSE.cnps)}
      </div>
    </div>
  </body></html>`;
}

const INVOICE_STATUS: Record<string, string> = { issued: "Émise", paid: "Réglée", cancelled: "Annulée", credit_note: "Avoir" };

interface InvoiceForEmail {
  invoiceNumber: string;
  type: string;
  status: string;
  currency: string;
  totalHt: unknown;
  totalTax: unknown;
  totalTtc: unknown;
  dueDate: Date | null;
  createdAt: Date;
  customer: { name: string };
  lines: { description: string; quantity: number; unitPrice: unknown; taxRate: unknown; lineTotal: unknown }[];
}

// E-mail d'une facture / d'un avoir : récapitulatif complet dans le corps.
export function buildInvoiceEmail(inv: InvoiceForEmail, message: string): DocumentEmail {
  const isCredit = inv.type === "credit_note";
  const label = isCredit ? "Avoir" : "Facture";
  const cur = inv.currency || "XAF";
  const created = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("fr-FR") : "—";
  const due = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("fr-FR") : "—";

  const rows = inv.lines
    .map(
      (l) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef">${esc(l.description)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef;text-align:right">${l.quantity}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef;text-align:right">${money(l.unitPrice as string, cur)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef;text-align:right">${money(l.lineTotal as string, cur)}</td>
      </tr>`,
    )
    .join("");

  const body = `
    <div style="font-family:Georgia,serif;font-size:20px;margin:0 0 4px">${label} ${esc(inv.invoiceNumber)}</div>
    <div style="font-size:13px;color:#4b5563;margin-bottom:16px">Émise le ${esc(created)} · Échéance ${esc(due)} · ${esc(INVOICE_STATUS[inv.status] ?? inv.status)}</div>
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">${isCredit ? "Avoir au profit de" : "Facturé à"}</div>
    <div style="font-size:15px;font-weight:bold;margin-bottom:14px">${esc(inv.customer.name)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#16233d;color:#fff">
        <th style="padding:8px 10px;text-align:left">Description</th>
        <th style="padding:8px 10px;text-align:right">Qté</th>
        <th style="padding:8px 10px;text-align:right">P.U. HT</th>
        <th style="padding:8px 10px;text-align:right">Total HT</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:8px 10px">Aucune ligne.</td></tr>`}</tbody>
    </table>
    <table style="margin-top:14px;margin-left:auto;font-size:13px">
      <tr><td style="padding:3px 10px;color:#4b5563">Total HT</td><td style="padding:3px 0;text-align:right">${money(inv.totalHt as string, cur)}</td></tr>
      <tr><td style="padding:3px 10px;color:#4b5563">TVA</td><td style="padding:3px 0;text-align:right">${money(inv.totalTax as string, cur)}</td></tr>
      <tr><td style="padding:8px 10px;font-weight:bold;border-top:2px solid #16233d">Total TTC</td><td style="padding:8px 0;text-align:right;font-weight:bold;border-top:2px solid #16233d">${money(inv.totalTtc as string, cur)}</td></tr>
    </table>`;

  const subject = `${label} ${inv.invoiceNumber} — ${HOUSE.brand}`;
  const text = `${message ? message.trim() + "\n\n" : ""}${label} ${inv.invoiceNumber}\nClient : ${inv.customer.name}\nTotal TTC : ${money(inv.totalTtc as string, cur)}\n\n${HOUSE.legalName} · ${HOUSE.website}`;
  return { subject, html: emailShell({ title: subject, message, body }), text };
}

const ROYALTY_SOURCE: Record<string, string> = {
  sales_order_line: "Vente",
  delivery: "Livraison",
  return_line: "Retour",
  consignment_statement: "Dépôt-vente",
  pos_sale: "Vente au comptoir",
};

interface StatementForEmail {
  contract: { contractNumber: string; partner: { firstName: string; lastName: string } };
  periodStart: Date;
  periodEnd: Date;
  totalEarned: unknown;
  advanceRecouped: unknown;
  balanceDue: unknown;
  entries: { sourceType: string; quantity: number; unitBaseAmount: unknown; rateApplied: unknown; amount: unknown }[];
  remaining_balance?: number;
}

// E-mail d'un relevé de droits d'auteur : récapitulatif dans le corps.
export function buildRoyaltyStatementEmail(st: StatementForEmail, message: string): DocumentEmail {
  const cur = "XAF";
  const start = new Date(st.periodStart).toLocaleDateString("fr-FR");
  const end = new Date(st.periodEnd).toLocaleDateString("fr-FR");
  const author = `${st.contract.partner.firstName} ${st.contract.partner.lastName}`;

  const rows = st.entries
    .map(
      (e) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef">${esc(ROYALTY_SOURCE[e.sourceType] ?? e.sourceType)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef;text-align:right">${e.quantity}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef;text-align:right">${money(e.unitBaseAmount as string, cur)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef;text-align:right">${(Number(e.rateApplied) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6e9ef;text-align:right">${money(e.amount as string, cur)}</td>
      </tr>`,
    )
    .join("");

  const remaining = st.remaining_balance ?? Number(st.balanceDue);
  const body = `
    <div style="font-family:Georgia,serif;font-size:20px;margin:0 0 4px">Relevé de droits d'auteur</div>
    <div style="font-size:13px;color:#4b5563;margin-bottom:16px">Contrat ${esc(st.contract.contractNumber)} · Période du ${esc(start)} au ${esc(end)}</div>
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Bénéficiaire</div>
    <div style="font-size:15px;font-weight:bold;margin-bottom:14px">${esc(author)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#16233d;color:#fff">
        <th style="padding:8px 10px;text-align:left">Nature</th>
        <th style="padding:8px 10px;text-align:right">Qté</th>
        <th style="padding:8px 10px;text-align:right">Base unit.</th>
        <th style="padding:8px 10px;text-align:right">Taux</th>
        <th style="padding:8px 10px;text-align:right">Droits</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="5" style="padding:8px 10px">Aucune ligne sur la période.</td></tr>`}</tbody>
    </table>
    <table style="margin-top:14px;margin-left:auto;font-size:13px">
      <tr><td style="padding:3px 10px;color:#4b5563">Droits acquis</td><td style="padding:3px 0;text-align:right">${money(st.totalEarned as string, cur)}</td></tr>
      <tr><td style="padding:3px 10px;color:#4b5563">À-valoir amorti</td><td style="padding:3px 0;text-align:right">− ${money(st.advanceRecouped as string, cur)}</td></tr>
      <tr><td style="padding:8px 10px;font-weight:bold;border-top:2px solid #16233d">Restant à payer</td><td style="padding:8px 0;text-align:right;font-weight:bold;border-top:2px solid #16233d">${money(remaining, cur)}</td></tr>
    </table>`;

  const subject = `Relevé de droits ${st.contract.contractNumber} — ${HOUSE.brand}`;
  const text = `${message ? message.trim() + "\n\n" : ""}Relevé de droits d'auteur ${st.contract.contractNumber}\nBénéficiaire : ${author}\nRestant à payer : ${money(remaining, cur)}\n\n${HOUSE.legalName} · ${HOUSE.website}`;
  return { subject, html: emailShell({ title: subject, message, body }), text };
}
