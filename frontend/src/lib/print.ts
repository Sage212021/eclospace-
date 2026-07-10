// Impression / export PDF sans dépendance externe (choix économe, guide §6 et
// règle de simplicité technique) : on ouvre une fenêtre dédiée contenant le
// document mis en page pour l'impression, puis on déclenche la boîte
// d'impression du navigateur. L'utilisateur peut alors **imprimer** ou
// **« Enregistrer au format PDF »** (option native de tous les navigateurs).
// Aucune bibliothèque PDF lourde, fonctionne avec une connexion modeste.

import type { InvoiceDetail } from "../api/client";

// En-tête et pied communs à tous les documents officiels (papier à en-tête
// Éclosion Édition, identité Éclospace). Styles inlinés : la fenêtre
// d'impression est isolée de l'application.
function documentShell(title: string, body: string): string {
  const now = new Date().toLocaleString("fr-FR");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #16233d; margin: 0; font-size: 12.5px; line-height: 1.5; }
    .doc { max-width: 720px; margin: 0 auto; padding: 8px; }
    .brand { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #16233d; padding-bottom: 12px; }
    .brand__house { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: #16233d; }
    .brand__sub { font-size: 11px; color: #6b7280; letter-spacing: .5px; }
    .brand__tag { text-align: right; }
    .brand__gold { display: inline-block; height: 6px; width: 46px; background: #c89a1b; border-radius: 3px; margin-top: 6px; }
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
    .foot { margin-top: 34px; border-top: 1px solid #e6e9ef; padding-top: 10px; font-size: 10.5px; color: #6b7280; }
    .actions { text-align: center; margin: 18px 0 4px; }
    .actions button { font: inherit; background: #16233d; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; }
    @media print { .actions { display: none; } .doc { padding: 0; } }
  </style></head>
  <body>
    <div class="doc">
      <div class="brand">
        <div>
          <div class="brand__house">Éclosion Édition</div>
          <div class="brand__sub">Maison d'édition</div>
        </div>
        <div class="brand__tag">
          <div class="brand__sub">Éclospace — ERP éditorial</div>
          <span class="brand__gold"></span>
        </div>
      </div>
      ${body}
      <div class="foot">Document généré par Éclospace le ${escapeHtml(now)}.</div>
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
  const map: Record<string, string> = { issued: "Émise", paid: "Réglée", cancelled: "Annulée", credit_note: "Avoir" };
  return map[status] ?? status;
}
