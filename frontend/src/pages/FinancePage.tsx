import { Fragment, useEffect, useState } from "react";
import {
  createAccountTransfer,
  createBankAccount,
  createExpense,
  createPayment,
  generateRoyaltyStatement,
  getBankAccountBalance,
  getCustomerAging,
  listBankAccounts,
  listCustomers,
  listExpenses,
  listInvoices,
  markInvoicePrinted,
  cancelInvoiceBeforePrint,
  requestInvoiceCancellation,
  forceCancelInvoice,
  getPendingCancellationInvoices,
  approveInvoiceCancellation,
  rejectInvoiceCancellation,
  createInvoiceCreditNote,
  type PendingCancellationInvoice,
  listRoyaltyStatements,
  listShippingRates,
  getMonthlyBalance,
  type MonthlyBalanceRow,
  nextDunning,
  payRoyaltyStatement,
  setContractBeneficiaries,
  setShippingRate,
  validateExpense,
  type AgingBalance,
  type BankAccount,
  type BankAccountType,
  type Customer,
  type Expense,
  type ExpenseCategory,
  type Invoice,
  type RoyaltyStatement,
  type ShippingRate,
  type ShippingZone,
} from "../api/client";
import {
  getInvoice,
  getRoyaltyStatement,
  listTaxRates,
  previewInvoiceEmail,
  previewRoyaltyStatementEmail,
  sendInvoiceEmail,
  sendRoyaltyStatementEmail,
  setTaxRate,
  type TaxRate,
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  getPaymentReport,
  getInvoiceSchedule,
  setInvoiceSchedule,
  type PaymentMethodDef,
  type PaymentMethodKind,
  type PaymentReport,
  type InvoiceSchedule,
} from "../api/client";
import { Card } from "../components/Card";
import { PendingQuotesCard } from "../components/PendingQuotesCard";
import { FinanceRequestsInbox } from "../components/FinanceRequestsInbox";
import { RevenueByFamilyCard } from "../components/RevenueByFamilyCard";
import { AnnualSummarySection } from "../components/AnnualSummarySection";
import { BillingOrdersSection } from "../components/BillingOrdersSection";
import { useConfirm } from "../components/ConfirmProvider";
import { GuidanceNote } from "../components/GuidanceNote";
import { PeriodFilter, currentPeriod, inPeriod, type Period } from "../components/PeriodFilter";
import { Modal, Field } from "../components/Modal";
import { EmailModal } from "../components/EmailModal";
import { Button } from "../components/Button";
import { IconFinance } from "../components/icons";
import { printInvoice, printRoyaltyStatement, printTreasuryBalance, type PrintOpts } from "../lib/print";
import { downloadInvoicePdf, downloadRoyaltyStatementPdf } from "../lib/financePdf";
import { DocPrintMenu } from "../components/DocPrintMenu";
import { AccountingExportSection } from "../components/AccountingExportSection";

const ZONE_LABELS: Record<ShippingZone, string> = {
  yaounde: "Yaoundé",
  douala: "Douala",
  autres_villes_cameroun: "Autres villes (Cameroun)",
  international: "International",
};

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  loyer: "Loyer",
  salaire: "Salaire",
  prestation: "Prestation",
  transport: "Transport",
  communication: "Communication",
  abonnement: "Abonnements / Services en ligne",
  autre: "Autre",
};

const STATUS_LABELS: Record<string, string> = {
  issued: "Émise",
  paid: "Réglée",
  cancelled: "Annulée",
  cancellation_requested: "Annulation en attente",
  credit_note: "Avoir",
  a_valider: "À valider",
  validee: "Validée",
  draft: "Brouillon",
};

interface FinancePageProps {
  canManage: boolean;
  canAdminister: boolean;
  // Initiation d'une commande à facturer / proforma (Finance, commercial ou DG).
  canInitiateOrder: boolean;
  // Validation de l'annulation d'une facture : réservée à la gouvernance (DG /
  // administrateur général, pilotage:administration). La Finance qui DEMANDE
  // l'annulation ne peut pas la valider (séparation des pouvoirs).
  canValidateCancellation: boolean;
}

// Fenêtres intégrées de la page (remplacent les pop-up du navigateur).
type FinanceModal =
  | { kind: "pay-invoice"; invoice: Invoice; tenders: { method: string; bankAccountId: string; reference: string; amount: string }[] }
  | { kind: "payment-methods" }
  | { kind: "generate-statement"; contractId: string; start: string; end: string }
  | { kind: "pay-statement"; statement: RoyaltyStatement; amount: string }
  | { kind: "beneficiaries"; contractId: string; rows: { partnerId: string; sharePct: string }[] }
  | { kind: "shipping"; zone: ShippingZone; flat: string; perKg: string; freeAbove: string }
  | { kind: "bank-account"; label: string; type: BankAccountType }
  | { kind: "transfer"; fromId: string; toId: string; amount: string };

// Finance et comptabilité (Ch. 18) — Option B (décision opérateur du
// 04/07/2026) : gestion financière opérationnelle, exports vers un cabinet
// externe. Écran transverse regroupant factures, encaissements, dépenses et
// droits d'auteur.
import { useI18n } from "../i18n";

export function FinancePage({ canManage, canAdminister, canInitiateOrder, canValidateCancellation }: FinancePageProps) {
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  // Alias de `t` pour les endroits où la variable de boucle s'appelle aussi `t`
  // (ex. la liste des « tenders » du paiement mixte), afin d'éviter le masquage.
  const tr = t;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  // Historiques repliés (déroulés au clic) : factures émises / réglées / autres.
  const [openEmises, setOpenEmises] = useState(false);
  const [openReglees, setOpenReglees] = useState(false);
  const [openAutres, setOpenAutres] = useState(false);
  // Filtre par période (D-023) sur les historiques de factures : mois en cours par défaut.
  const [invoicePeriod, setInvoicePeriod] = useState<Period>(currentPeriod());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [royaltyStatements, setRoyaltyStatements] = useState<RoyaltyStatement[]>([]);
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodDef[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [aging, setAging] = useState<AgingBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<FinanceModal | null>(null);
  const [emailInvoice, setEmailInvoice] = useState<Invoice | null>(null);
  const [emailStatement, setEmailStatement] = useState<RoyaltyStatement | null>(null);
  const [scheduleInvoice, setScheduleInvoice] = useState<Invoice | null>(null);
  const [pendingCancels, setPendingCancels] = useState<PendingCancellationInvoice[]>([]);

  const refresh = async () => {
    const [invoiceList, customerList, expenseList, statementList, shippingRateList, bankAccountList, methodList] = await Promise.all([
      listInvoices(),
      listCustomers(),
      listExpenses(),
      listRoyaltyStatements(),
      listShippingRates(),
      listBankAccounts(),
      listPaymentMethods(),
    ]);
    getPendingCancellationInvoices().then(setPendingCancels).catch(() => {});
    setInvoices(invoiceList);
    setCustomers(customerList);
    setExpenses(expenseList);
    setRoyaltyStatements(statementList);
    setShippingRates(shippingRateList);
    setBankAccounts(bankAccountList);
    setPaymentMethods(methodList);
    const balanceEntries = await Promise.all(bankAccountList.map(async (a) => [a.id, (await getBankAccountBalance(a.id)).balance] as const));
    setBalances(Object.fromEntries(balanceEntries));
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedCustomerId) {
      setAging(null);
      return;
    }
    getCustomerAging(selectedCustomerId).then(setAging).catch((e) => setError(e.message));
  }, [selectedCustomerId]);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  // Impression / export PDF d'une facture : on récupère son détail (lignes,
  // totaux) puis on ouvre la fenêtre d'impression du navigateur.
  async function handlePrintInvoice(invoiceId: string, opts?: PrintOpts, asPdf = false) {
    try {
      const detail = await getInvoice(invoiceId);
      // Rappel AVANT le premier tirage (demande opérateur) : l'original fait foi
      // et la facture ne pourra plus être corrigée par simple annulation ensuite.
      const firstAuthoritativePrint = detail.type === "invoice" && !detail.printedAt;
      if (firstAuthoritativePrint) {
        const ok = window.confirm(
          `Imprimer l'ORIGINAL de la facture ${detail.invoiceNumber} ?\n\n` +
            `Cet original fait foi. Vérifiez bien les montants et le client : après impression, la facture ne pourra plus être corrigée par une simple annulation ` +
            `(il faudra un avoir ou une annulation validée par la direction).\n\n` +
            `Confirmer l'impression ?`,
        );
        if (!ok) return;
      }
      if (asPdf) downloadInvoicePdf(detail);
      else printInvoice(detail, opts);
      // Une facture imprimée est « tirée » : on la verrouille (plus annulable
      // directement). Au meilleur effort ; on rafraîchit pour actualiser les boutons.
      markInvoicePrinted(invoiceId)
        .then(() => refresh())
        .catch(() => {});
    } catch (err) {
      fail(err, "Échec de l'ouverture de la facture.");
    }
  }

  // Correction avant impression (demande opérateur) : tant qu'une facture n'a pas
  // été tirée, la Finance peut l'annuler directement pour la réémettre corrigée.
  async function handleCancelBeforePrint(invoice: Invoice) {
    const reason = window.prompt(
      `Corriger la facture ${invoice.invoiceNumber} (${invoice.customer.name}) avant impression ?\n\n` +
        `Elle n'a pas encore été imprimée : elle sera annulée (retirée du chiffre d'affaires, tracée) et vous pourrez la refaire depuis la source corrigée.\n\n` +
        `Motif (obligatoire — ex. erreur de montant, mauvais client) :`,
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Un motif de correction est requis.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await cancelInvoiceBeforePrint(invoice.id, reason.trim());
      setMessage(`Facture ${invoice.invoiceNumber} annulée avant impression — vous pouvez la réémettre corrigée.`);
      await refresh();
    } catch (err) {
      fail(err, "Correction avant impression impossible.");
    }
  }

  // Annulation d'une facture : le comptable la DEMANDE (motif obligatoire), le
  // DG la VALIDE. Tant que non validée, la facture reste dans le chiffre d'affaires.
  async function handleRequestCancel(invoice: Invoice) {
    const reason = window.prompt(`Demander l'annulation de la facture ${invoice.invoiceNumber} ?\n\nMotif (obligatoire — ex. erreur de saisie, essai, client désisté) :`, "");
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Un motif d'annulation est requis.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await requestInvoiceCancellation(invoice.id, reason.trim());
      setMessage(`Annulation de ${invoice.invoiceNumber} demandée — en attente de validation du DG.`);
      await refresh();
    } catch (err) {
      fail(err, "Demande d'annulation impossible.");
    }
  }
  // Annulation directe par le DG / administrateur général — possible même sur une
  // facture déjà imprimée (essai / erreur de saisie). Ce n'est pas une
  // suppression : la facture passe « Annulée » (motif obligatoire, audit) et sort
  // du chiffre d'affaires.
  async function handleForceCancel(invoice: Invoice) {
    const reason = window.prompt(
      `Annuler définitivement la facture ${invoice.invoiceNumber} (${invoice.customer.name}) ?\n\nRéservé à la direction. La facture passera « Annulée » et sortira du chiffre d'affaires (elle reste tracée, non supprimée).\n\nMotif (obligatoire — ex. essai, erreur de saisie, client fictif) :`,
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Un motif d'annulation est requis.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await forceCancelInvoice(invoice.id, reason.trim());
      setMessage(`Facture ${invoice.invoiceNumber} annulée (retirée du chiffre d'affaires).`);
      await refresh();
    } catch (err) {
      fail(err, "Annulation impossible.");
    }
  }
  // Avoir (note de crédit) : la voie légale quand la facture ne peut plus être
  // annulée (déjà tirée / réglée). On ne supprime pas, on neutralise, puis on
  // imprime l'avoir.
  async function handleCreditNote(invoice: Invoice) {
    const reason = window.prompt(
      `Établir un AVOIR pour la facture ${invoice.invoiceNumber} ?\n\nCela neutralise la facture : son montant sort du chiffre d'affaires (l'avoir compte en négatif). Motif (facultatif) :`,
      "",
    );
    if (reason === null) return;
    setError(null);
    setMessage(null);
    try {
      const cn = await createInvoiceCreditNote(invoice.id, reason.trim() || undefined);
      setMessage(`Avoir ${cn.invoice_number} établi — la facture ${invoice.invoiceNumber} est neutralisée.`);
      try {
        printInvoice(await getInvoice(cn.id));
      } catch {
        /* impression au meilleur effort */
      }
      await refresh();
    } catch (err) {
      fail(err, "Établissement de l'avoir impossible.");
    }
  }

  async function handleApproveCancel(inv: PendingCancellationInvoice) {
    setError(null);
    try {
      await approveInvoiceCancellation(inv.id);
      setMessage(`Facture ${inv.invoice_number} annulée — retirée du chiffre d'affaires.`);
      await refresh();
    } catch (err) {
      fail(err, "Validation de l'annulation impossible.");
    }
  }
  async function handleRejectCancel(inv: PendingCancellationInvoice) {
    setError(null);
    try {
      await rejectInvoiceCancellation(inv.id);
      setMessage(`Annulation de ${inv.invoice_number} refusée — la facture reste émise.`);
      await refresh();
    } catch (err) {
      fail(err, "Refus impossible.");
    }
  }

  // Impression / export PDF d'un relevé de droits d'auteur.
  async function handlePrintStatement(statementId: string, opts?: PrintOpts, asPdf = false) {
    try {
      const st = await getRoyaltyStatement(statementId);
      if (asPdf) downloadRoyaltyStatementPdf(st);
      else printRoyaltyStatement(st, opts);
    } catch (err) {
      fail(err, "Échec de l'ouverture du relevé.");
    }
  }

  async function submitPayInvoice() {
    if (modal?.kind !== "pay-invoice") return;
    // Paiement simple ou mixte : chaque « mode » saisi devient un encaissement
    // rattaché à la facture (mode + compte + référence propres).
    const tenders = modal.tenders.filter((t) => Number(t.amount) > 0);
    if (tenders.length === 0) return;
    try {
      let total = 0;
      for (const t of tenders) {
        const amount = Number(t.amount);
        await createPayment({
          method: t.method,
          reference: t.reference.trim() || undefined,
          bank_account_id: t.bankAccountId || undefined,
          amount,
          allocations: [{ invoice_id: modal.invoice.id, amount }],
        });
        total += amount;
      }
      setMessage(
        lang === "en"
          ? `Payment of ${total} recorded for ${modal.invoice.invoiceNumber}${tenders.length > 1 ? ` (${tenders.length} methods)` : ""}.`
          : `Encaissement de ${total} enregistré pour ${modal.invoice.invoiceNumber}${tenders.length > 1 ? ` (${tenders.length} modes)` : ""}.`,
      );
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de l'encaissement.");
    }
  }

  async function handleDunning(customerId: string) {
    try {
      const dunning = await nextDunning(customerId);
      setMessage(
        lang === "en"
          ? `Reminder sent: ${dunning.level === "rappel" ? "courtesy reminder" : "formal notice"}.`
          : `Relance envoyée : ${dunning.level === "rappel" ? "rappel courtois" : "mise en demeure"}.`,
      );
    } catch (err) {
      fail(err, "Échec de la relance.");
    }
  }

  async function handleValidateExpense(expense: Expense) {
    const amount = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(Number(expense.amount));
    const ok = await confirm({
      title: t("fin.validate", "Valider"),
      message: t("fin.confirm.expense", "Valider cette dépense ?"),
      detail: [expense.supplier, expense.description, amount].filter(Boolean).join(" · ") || undefined,
      confirmLabel: t("fin.validate", "Valider"),
    });
    if (!ok) return;
    try {
      await validateExpense(expense.id);
      setMessage(t("fin.msg.expense_validated", "Dépense validée."));
      await refresh();
    } catch (err) {
      fail(err, "Échec de la validation.");
    }
  }

  async function submitGenerateStatement() {
    if (modal?.kind !== "generate-statement" || !modal.contractId.trim()) return;
    try {
      await generateRoyaltyStatement(modal.contractId.trim(), {
        period_start: new Date(modal.start).toISOString(),
        period_end: new Date(modal.end).toISOString(),
      });
      setMessage(t("fin.msg.statement_generated", "Relevé de droits d'auteur généré."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de la génération du relevé.");
    }
  }

  async function submitPayStatement() {
    if (modal?.kind !== "pay-statement") return;
    try {
      await payRoyaltyStatement(modal.statement.id, { method: "transfer", amount: modal.amount ? Number(modal.amount) : undefined });
      setMessage(t("fin.msg.royalty_paid", "Ordre de paiement des droits d'auteur exécuté."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec du paiement.");
    }
  }

  async function submitBeneficiaries() {
    if (modal?.kind !== "beneficiaries" || !modal.contractId.trim()) return;
    const beneficiaries = modal.rows
      .filter((r) => r.partnerId.trim())
      .map((r) => ({ partner_id: r.partnerId.trim(), share_pct: Number(r.sharePct) || 0 }));
    if (beneficiaries.length === 0) return;
    try {
      await setContractBeneficiaries(modal.contractId.trim(), beneficiaries);
      setMessage(t("fin.msg.split_saved", "Répartition des droits enregistrée."));
      setModal(null);
    } catch (err) {
      fail(err, "Échec de l'enregistrement de la répartition.");
    }
  }

  async function submitShipping() {
    if (modal?.kind !== "shipping") return;
    try {
      await setShippingRate({
        zone: modal.zone,
        flat_amount: modal.flat ? Number(modal.flat) : undefined,
        per_kg_amount: modal.perKg ? Number(modal.perKg) : undefined,
        free_above_amount: modal.freeAbove ? Number(modal.freeAbove) : undefined,
      });
      setMessage(
        lang === "en"
          ? `${t("com.zone." + modal.zone, ZONE_LABELS[modal.zone])} delivery rate updated.`
          : `Tarif de livraison ${ZONE_LABELS[modal.zone]} mis à jour.`,
      );
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de la mise à jour du tarif.");
    }
  }

  async function submitBankAccount() {
    if (modal?.kind !== "bank-account" || !modal.label.trim()) return;
    try {
      await createBankAccount({ label: modal.label.trim(), type: modal.type });
      setMessage(t("fin.msg.account_created", "Compte créé."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de la création du compte.");
    }
  }

  async function submitTransfer() {
    if (modal?.kind !== "transfer" || !modal.fromId || !modal.toId || modal.fromId === modal.toId) return;
    const amount = Number(modal.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      await createAccountTransfer({ from_account_id: modal.fromId, to_account_id: modal.toId, amount });
      setMessage(t("fin.msg.transfer_saved", "Virement interne enregistré."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec du virement.");
    }
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("page.finance.title", "Finance et comptabilité")}</h1>
      <p className="ecl-page__lead">{t("page.finance.lead", "Factures, encaissements, dépenses, droits d'auteur et trésorerie.")}</p>

      <GuidanceNote title="Finance & comptabilité">
        Établissez et suivez les factures et proforma, enregistrez les encaissements et les dépenses, versez les droits
        d'auteur et suivez la trésorerie. Les commandes à facturer initiées par le DG/commercial se transforment ici en
        facture (validation par seuil au-dessus d'un montant).
      </GuidanceNote>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      <RevenueByFamilyCard />

      <AnnualSummarySection />

      {/* Bilan de trésorerie (demande opérateur) : entrées (encaissements) −
          dépenses (module Dépenses, validées + payées) = solde, sur la
          périodicité choisie (mensuel, trimestriel, semestriel, annuel).
          Imprimable / exportable en PDF. Tout est calculé automatiquement à
          partir des opérations déjà enregistrées. */}
      <MonthlyBalanceSection />

      <PendingQuotesCard />

      {/* Demandes reçues depuis les fiches manuscrit : devis / frais de dépôt. */}
      <FinanceRequestsInbox canManage={canManage} />

      <BillingOrdersSection canCreate={canInitiateOrder} canInvoice={canManage} canValidateThreshold={canValidateCancellation} />

      {(() => {
        // Une ligne de facture (numéro, client, montant, statut + actions).
        const renderRow = (invoice: Invoice) => (
          <div key={invoice.id} className="ecl-row">
            <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{invoice.invoiceNumber}</span>
              <span className="ecl-row__desc" style={{ margin: 0 }}>{invoice.customer.name}</span>
              <Amount value={invoice.totalTtc} />
              <StatusChip label={t("fin.st." + invoice.status, STATUS_LABELS[invoice.status] ?? invoice.status)} />
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
              <DocPrintMenu onPrint={(o) => handlePrintInvoice(invoice.id, o)} onDownloadPdf={() => handlePrintInvoice(invoice.id, {}, true)} />
              <Button variant="view" size="sm" onClick={() => setEmailInvoice(invoice)}>{t("fin.send_email", "Envoyer par e-mail")}</Button>
              {/* Avoir (note de crédit) : voie légale de correction — utile
                  quand la facture est déjà tirée ou réglée (annulation impossible). */}
              {canManage && invoice.type === "invoice" && (invoice.status === "issued" || invoice.status === "paid") && (
                <Button variant="view" size="sm" onClick={() => handleCreditNote(invoice)}>{t("fin.credit_note", "Avoir")}</Button>
              )}
              {canManage && invoice.type === "invoice" && invoice.status === "issued" && (
                <>
                  <Button variant="view" size="sm" onClick={() => setScheduleInvoice(invoice)}>{t("fin.schedule_btn", "Échéancier")}</Button>
                  <Button variant="add" size="sm" onClick={() => setModal({ kind: "pay-invoice", invoice, tenders: [{ method: paymentMethods.find((m) => m.active)?.code ?? "cash", bankAccountId: "", reference: "", amount: String(invoice.totalTtc) }] })}>
                    {t("fin.collect", "Encaisser")}
                  </Button>
                  {/* Correction AVANT impression : tant que la facture n'a pas été
                      tirée, la Finance l'annule directement pour la réémettre corrigée. */}
                  {!invoice.printedAt && <Button variant="view" size="sm" onClick={() => handleCancelBeforePrint(invoice)}>{t("fin.correct_before_print", "Corriger avant impression")}</Button>}
                  {/* Demande d'annulation (soumise au DG) : erreur de saisie, essai,
                      désistement. Impossible une fois la facture imprimée (« tirée »). */}
                  {!invoice.printedAt && <Button variant="view" size="sm" onClick={() => handleRequestCancel(invoice)}>{t("fin.request_cancel", "Demander l'annulation")}</Button>}
                </>
              )}
              {/* Annulation directe par le DG / administrateur général (essai,
                  erreur), avec motif — réservé à la direction. Fonctionne aussi sur
                  une facture déjà imprimée, que la Finance ne peut plus annuler. */}
              {canValidateCancellation && invoice.type === "invoice" && (invoice.status === "issued" || invoice.status === "pending_validation") && (
                <Button variant="danger" size="sm" onClick={() => handleForceCancel(invoice)}>{t("fin.force_cancel", "Annuler (direction)")}</Button>
              )}
            </div>
          </div>
        );
        // Restreint les trois historiques (factures émises / réglées / avoirs & proforma)
        // à la période choisie — sur la date d'émission du document (createdAt).
        const periodInvoices = invoices.filter((i) => inPeriod(i.createdAt, invoicePeriod));
        const emises = periodInvoices.filter((i) => i.type === "invoice" && (i.status === "issued" || i.status === "pending_validation" || i.status === "cancellation_requested"));
        const reglees = periodInvoices.filter((i) => i.type === "invoice" && i.status === "paid");
        const autres = periodInvoices.filter((i) => !emises.includes(i) && !reglees.includes(i)); // proforma, avoirs, annulées
        // Bouton « dérouler / masquer » (compteur + chevron) pour le repli.
        const toggle = (count: number, open: boolean, onToggle: () => void) => (
          <button
            type="button"
            onClick={onToggle}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13, color: "var(--ink)" }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--eclosion-dark)", background: "var(--eclosion-soft)", borderRadius: 999, padding: "0 8px" }}>{count}</span>
            <span style={{ color: "var(--muted)" }}>{open ? t("fin.hide", "Masquer") : t("fin.show", "Dérouler")}</span>
            <span style={{ transition: "transform .15s", transform: open ? "rotate(90deg)" : "none", color: "var(--eclosion-dark)" }}>▸</span>
          </button>
        );
        return (
          <>
            <Card
              title={t("fin.hist_period", "Factures & avoirs par période")}
              icon={<IconFinance />}
              subtitle={t("fin.hist_period_sub", "Choisissez le mois et l'année ; les trois historiques ci-dessous suivent la période.")}
            >
              <PeriodFilter
                dates={invoices.map((i) => i.createdAt)}
                value={invoicePeriod}
                onChange={setInvoicePeriod}
                resultCount={periodInvoices.length}
              />
            </Card>

            <Card
              title={t("fin.hist_emises", "Historique des factures émises")}
              icon={<IconFinance />}
              subtitle={t("fin.hist_emises_sub", "Factures en attente de règlement — cliquez pour dérouler.")}
              action={toggle(emises.length, openEmises, () => setOpenEmises((v) => !v))}
            >
              {openEmises && (emises.length === 0 ? <Empty>{t("fin.no_invoice_emise", "Aucune facture émise en attente.")}</Empty> : <div className="ecl-list">{emises.map(renderRow)}</div>)}
            </Card>

            <Card
              title={t("fin.hist_reglees", "Historique des factures réglées")}
              icon={<IconFinance />}
              subtitle={t("fin.hist_reglees_sub", "Factures entièrement encaissées — cliquez pour dérouler.")}
              action={toggle(reglees.length, openReglees, () => setOpenReglees((v) => !v))}
            >
              {openReglees && (reglees.length === 0 ? <Empty>{t("fin.no_invoice_reglee", "Aucune facture réglée.")}</Empty> : <div className="ecl-list">{reglees.map(renderRow)}</div>)}
            </Card>

            {autres.length > 0 && (
              <Card
                title={t("fin.hist_autres", "Autres documents (proforma, avoirs, annulées)")}
                icon={<IconFinance />}
                action={toggle(autres.length, openAutres, () => setOpenAutres((v) => !v))}
              >
                {openAutres && <div className="ecl-list">{autres.map(renderRow)}</div>}
              </Card>
            )}
          </>
        );
      })()}

      {/* Annulations de factures en attente de validation — réservé à la
          gouvernance (DG / admin général) : la Finance ne valide pas ses propres
          demandes. */}
      {canValidateCancellation && pendingCancels.length > 0 && (
        <Card
          title={t("fin.pending_cancel", "Annulations de factures à valider")}
          icon={<IconFinance />}
          subtitle={t("fin.pending_cancel_sub", "Le comptable a demandé l'annulation ; votre validation (DG) la retire du chiffre d'affaires.")}
        >
          <div className="ecl-list">
            {pendingCancels.map((inv) => (
              <div key={inv.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{inv.invoice_number}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{inv.customer_name}</span>
                  <Amount value={inv.total_ttc} />
                  {inv.reason && <span style={{ fontSize: 12.5, color: "var(--amber)" }}>{t("fin.reason", "Motif :")} {inv.reason}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Button variant="danger" size="sm" onClick={() => handleApproveCancel(inv)}>{t("fin.approve_cancel", "Valider l'annulation")}</Button>
                  <Button variant="view" size="sm" onClick={() => handleRejectCancel(inv)}>{t("fin.reject_cancel", "Refuser")}</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Ch. 18 §18.10-18.11 — Export comptable pour le cabinet externe (D-006) */}
      <AccountingExportSection canAdminister={canAdminister} />

      {/* Ch. 18 §18.3 — Encours et relance client */}
      <Card title={t("fin.outstanding", "Encours et relance client")} icon={<IconFinance />} subtitle={t("fin.outstanding_sub", "Balance âgée d'un client et relances.")}>
        <div className="ecl-field" style={{ maxWidth: 360 }}>
          <label>{t("fin.customer", "Client")}</label>
          <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}>
            <option value="">{t("fin.select", "— sélectionner —")}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
        </div>
        {aging && (
          <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 13, flexWrap: "wrap", alignItems: "center" }}>
            <span>{t("fin.not_due", "Non échu")} : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.not_due}</strong></span>
            <span style={{ color: "var(--amber)" }}>{t("fin.aging30", "30 j")} : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.d30}</strong></span>
            <span style={{ color: "var(--amber)" }}>{t("fin.aging60", "60 j")} : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.d60}</strong></span>
            <span style={{ color: "var(--alert)" }}>{t("fin.aging90", "90 j+")} : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.d90_plus}</strong></span>
            {canManage && aging.d30 + aging.d60 + aging.d90_plus > 0 && (
              <Button variant="edit" size="sm" onClick={() => handleDunning(selectedCustomerId)}>{t("fin.dun", "Relancer")}</Button>
            )}
          </div>
        )}
      </Card>

      {/* Ch. 18 §18.4 — Dépenses */}
      <Card title={t("fin.expenses", "Dépenses")} icon={<IconFinance />} subtitle={t("fin.expenses_sub", "Engagements de dépenses et validations.")}>
        {expenses.length === 0 ? (
          <Empty>{t("fin.no_expense", "Aucune dépense.")}</Empty>
        ) : (
          <div className="ecl-list">
            {expenses.map((expense) => (
              <div key={expense.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title">{t("fin.cat." + expense.category, CATEGORY_LABELS[expense.category])}</span>
                  <Amount value={expense.amount} />
                  <StatusChip label={t("fin.st." + expense.status, STATUS_LABELS[expense.status] ?? expense.status)} />
                  {expense.description && <span className="ecl-row__desc" style={{ margin: 0 }}>{expense.description}</span>}
                </div>
                {canAdminister && expense.status === "a_valider" && (
                  <Button variant="add" size="sm" onClick={() => handleValidateExpense(expense)}>{t("fin.validate", "Valider")}</Button>
                )}
              </div>
            ))}
          </div>
        )}
        {canManage && (
          <div style={{ marginTop: 14 }}>
            <NewExpenseForm onCreated={() => { setMessage(t("fin.msg.expense_recorded", "Dépense enregistrée.")); refresh(); }} onError={setError} />
          </div>
        )}
      </Card>

      {/* Ch. 9 §9.5, Ch. 18 §18.7 — Relevés de droits d'auteur */}
      <Card
        title={t("fin.royalties", "Relevés de droits d'auteur")}
        icon={<IconFinance />}
        subtitle={t("fin.royalties_sub", "Génération et paiement des relevés.")}
        action={
          canAdminister ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="add" size="sm" onClick={() => setModal({ kind: "generate-statement", contractId: "", start: "2026-01-01", end: "2026-12-31" })}>
                {t("fin.new_statement", "+ Relevé")}
              </Button>
              <Button variant="view" size="sm" onClick={() => setModal({ kind: "beneficiaries", contractId: "", rows: [{ partnerId: "", sharePct: "100" }] })}>
                {t("fin.distribute", "Répartir")}
              </Button>
            </div>
          ) : undefined
        }
      >
        {royaltyStatements.length === 0 ? (
          <Empty>{t("fin.no_statement", "Aucun relevé.")}</Empty>
        ) : (
          <div className="ecl-list">
            {royaltyStatements.map((statement) => (
              <div key={statement.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{statement.contract.contractNumber}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{statement.contract.partner.firstName} {statement.contract.partner.lastName}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{t("fin.due_short", "dû :")} <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{statement.balanceDue}</strong></span>
                  <StatusChip label={t("fin.st." + statement.status, STATUS_LABELS[statement.status] ?? statement.status)} />
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  <DocPrintMenu onPrint={(o) => handlePrintStatement(statement.id, o)} onDownloadPdf={() => handlePrintStatement(statement.id, {}, true)} />
                  <Button variant="view" size="sm" onClick={() => setEmailStatement(statement)}>{t("fin.send_email", "Envoyer par e-mail")}</Button>
                  {canAdminister && statement.status !== "paid" && Number(statement.remaining_balance ?? statement.balanceDue) > 0 && (
                    <Button variant="add" size="sm" onClick={() => setModal({ kind: "pay-statement", statement, amount: "" })}>{t("fin.pay", "Payer")}</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 17 §17.5 — Frais de port par zone */}
      <Card title={t("fin.shipping", "Frais de port par zone")} icon={<IconFinance />} subtitle={t("fin.shipping_sub", "Barème de livraison par zone géographique.")}>
        <div className="ecl-list">
          {(Object.keys(ZONE_LABELS) as ShippingZone[]).map((zone) => {
            const rate = shippingRates.find((r) => r.zone === zone);
            return (
              <div key={zone} className="ecl-row">
                <div className="ecl-row__main">
                  <div className="ecl-row__title">{t("com.zone." + zone, ZONE_LABELS[zone])}</div>
                  <div className="ecl-row__desc">
                    {rate
                      ? `${t("fin.flat", "Forfait")} : ${rate.flatAmount ?? "—"} · ${t("fin.per_kg", "au kg")} : ${rate.perKgAmount ?? "—"} · ${t("fin.free_above", "gratuit au-delà de")} : ${rate.freeAboveAmount ?? "—"}`
                      : t("fin.not_configured", "Non paramétré (frais nuls)")}
                  </div>
                </div>
                {canAdminister && (
                  <Button variant="view" size="sm" onClick={() => setModal({ kind: "shipping", zone, flat: String(rate?.flatAmount ?? ""), perKg: String(rate?.perKgAmount ?? ""), freeAbove: String(rate?.freeAboveAmount ?? "") })}>
                    {t("fin.configure", "Paramétrer")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Ch. 18 §18.9 — Taux de TVA */}
      <TaxRatesCard canAdminister={canAdminister} onError={setError} onMessage={setMessage} />

      {/* Modes de paiement configurables */}
      <Card
        title={t("fin.payment_methods", "Modes de paiement")}
        icon={<IconFinance />}
        subtitle={t("fin.payment_methods_sub", "Espèces, virement, chèque, Mobile Money… paramétrables.")}
        action={canAdminister ? <Button variant="view" size="sm" onClick={() => setModal({ kind: "payment-methods" })}>{t("fin.manage", "Gérer")}</Button> : undefined}
      >
        <div className="ecl-list">
          {paymentMethods.filter((m) => m.active).map((m) => (
            <div key={m.id} className="ecl-row" style={{ justifyContent: "space-between" }}>
              <span>{m.label}</span>
              <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                {m.code}
                {m.defaultAccountId ? ` · → ${bankAccounts.find((a) => a.id === m.defaultAccountId)?.label ?? "compte"}` : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Rapport d'encaissements par mode / compte / point de vente */}
      <PaymentReportCard />

      {/* Ch. 18 §18.8 — Trésorerie */}
      <Card
        title={t("fin.treasury", "Trésorerie : comptes, caisses et virements")}
        icon={<IconFinance />}
        subtitle={t("fin.treasury_sub", "Soldes des comptes et virements internes.")}
        action={
          canAdminister ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="add" size="sm" onClick={() => setModal({ kind: "bank-account", label: "", type: "banque" })}>{t("fin.add_account", "+ Compte")}</Button>
              <Button variant="view" size="sm" onClick={() => setModal({ kind: "transfer", fromId: "", toId: "", amount: "" })}>{t("fin.transfer_btn", "Virement")}</Button>
            </div>
          ) : undefined
        }
      >
        {bankAccounts.length === 0 ? (
          <Empty>{t("fin.no_account", "Aucun compte.")}</Empty>
        ) : (
          <div className="ecl-list">
            {bankAccounts.map((account) => (
              <div key={account.id} className="ecl-row">
                <div className="ecl-row__main">
                  <div className="ecl-row__title">{account.label}</div>
                  <div className="ecl-row__desc">{t("fin.acct." + account.type, account.type)}</div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{balances[account.id] ?? "…"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {emailInvoice && (
        <EmailModal
          title={`${t("fin.email.invoice_title", "Envoyer la facture")} ${emailInvoice.invoiceNumber}`}
          initialMessage={lang === "en"
            ? `Dear Sir or Madam,\n\nPlease find below your invoice ${emailInvoice.invoiceNumber}. We hope you receive it well.\n\nKind regards,\nÉclosion Édition`
            : `Madame, Monsieur,\n\nVeuillez trouver ci-dessous votre facture ${emailInvoice.invoiceNumber}. Nous vous en souhaitons bonne réception.\n\nCordialement,\nÉclosion Édition`}
          loadPreview={(msg) => previewInvoiceEmail(emailInvoice.id, msg)}
          onSend={(to, msg) => sendInvoiceEmail(emailInvoice.id, to, msg)}
          onClose={() => setEmailInvoice(null)}
        />
      )}

      {emailStatement && (
        <EmailModal
          title={`${t("fin.email.statement_title", "Envoyer le relevé")} ${emailStatement.contract.contractNumber}`}
          initialMessage={lang === "en"
            ? `Dear author,\n\nPlease find below your royalty statement for contract ${emailStatement.contract.contractNumber}.\n\nKind regards,\nÉclosion Édition`
            : `Cher auteur, chère auteure,\n\nVeuillez trouver ci-dessous votre relevé de droits d'auteur pour le contrat ${emailStatement.contract.contractNumber}.\n\nBien cordialement,\nÉclosion Édition`}
          loadPreview={(msg) => previewRoyaltyStatementEmail(emailStatement.id, msg)}
          onSend={(to, msg) => sendRoyaltyStatementEmail(emailStatement.id, to, msg)}
          onClose={() => setEmailStatement(null)}
        />
      )}

      {/* ── Fenêtres intégrées ─────────────────────────────────────────────── */}
      {modal?.kind === "pay-invoice" && (
        <Modal
          title={`${t("fin.collect", "Encaisser")} ${modal.invoice.invoiceNumber}`}
          wide
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitPayInvoice} confirmLabel={t("fin.collect", "Encaisser")} confirmVariant="add" />}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {t("fin.customer", "Client")} : <strong style={{ color: "var(--ink)" }}>{modal.invoice.customer.name}</strong> · {t("fin.balance", "solde")} {modal.invoice.totalTtc}
          </p>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 8px" }}>
            {t("fin.mixed_hint", "Un ou plusieurs modes (paiement mixte). Compte laissé sur « Auto » = compte par défaut du mode.")}
          </div>
          {modal.tenders.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.1fr 1fr 0.9fr 28px", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <select value={t.method} onChange={(e) => setModal({ ...modal, tenders: modal.tenders.map((x, idx) => (idx === i ? { ...x, method: e.target.value } : x)) })}>
                {paymentMethods.filter((m) => m.active).map((m) => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
              <select value={t.bankAccountId} onChange={(e) => setModal({ ...modal, tenders: modal.tenders.map((x, idx) => (idx === i ? { ...x, bankAccountId: e.target.value } : x)) })}>
                <option value="">{tr("fin.auto_account", "Auto (compte par défaut)")}</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
              <input placeholder={tr("fin.reference_ph", "Référence (n° chèque, ID MoMo…)")} value={t.reference} onChange={(e) => setModal({ ...modal, tenders: modal.tenders.map((x, idx) => (idx === i ? { ...x, reference: e.target.value } : x)) })} />
              <input type="number" min={0} placeholder={tr("fin.amount_ph", "Montant")} value={t.amount} onChange={(e) => setModal({ ...modal, tenders: modal.tenders.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)) })} />
              <button type="button" title={tr("fin.remove", "Retirer")} disabled={modal.tenders.length === 1} onClick={() => setModal({ ...modal, tenders: modal.tenders.filter((_, idx) => idx !== i) })} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", padding: "6px 6px" }}>✕</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setModal({ ...modal, tenders: [...modal.tenders, { method: paymentMethods.find((m) => m.active)?.code ?? "cash", bankAccountId: "", reference: "", amount: "" }] })}
            style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
          >
            {t("fin.add_method", "+ Ajouter un mode (paiement mixte)")}
          </button>
          <div style={{ textAlign: "right", marginTop: 8, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            {t("fin.total_entered", "Total saisi :")} {modal.tenders.reduce((s, t) => s + (Number(t.amount) || 0), 0)}
          </div>
        </Modal>
      )}

      {scheduleInvoice && (
        <ScheduleModal invoice={scheduleInvoice} onClose={() => setScheduleInvoice(null)} onError={(m) => setError(m)} onSaved={() => setMessage(t("fin.msg.schedule_saved", "Échéancier enregistré."))} />
      )}

      {modal?.kind === "payment-methods" && (
        <PaymentMethodsModal
          methods={paymentMethods}
          bankAccounts={bankAccounts}
          onClose={() => setModal(null)}
          onChanged={async () => setPaymentMethods(await listPaymentMethods())}
          onError={(m) => setError(m)}
        />
      )}

      {modal?.kind === "generate-statement" && (
        <Modal
          title={t("fin.gen_statement_title", "Générer un relevé de droits")}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitGenerateStatement} confirmLabel={t("fin.generate", "Générer")} confirmVariant="add" />}
        >
          <Field label={t("fin.contract_id", "Identifiant du contrat")}><input value={modal.contractId} onChange={(e) => setModal({ ...modal, contractId: e.target.value })} autoFocus /></Field>
          <Field label={t("fin.period_start", "Début de période")}><input type="date" value={modal.start} onChange={(e) => setModal({ ...modal, start: e.target.value })} /></Field>
          <Field label={t("fin.period_end", "Fin de période")}><input type="date" value={modal.end} onChange={(e) => setModal({ ...modal, end: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "pay-statement" && (
        <Modal
          title={t("fin.pay_royalty_title", "Payer les droits d'auteur")}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitPayStatement} confirmLabel={t("fin.pay", "Payer")} confirmVariant="add" />}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{t("fin.remaining_due", "Restant dû :")} <strong style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{modal.statement.remaining_balance ?? modal.statement.balanceDue}</strong></p>
          <Field label={t("fin.amount_or_empty", "Montant (laisser vide pour solder le restant)")}>
            <input type="number" min={0} value={modal.amount} onChange={(e) => setModal({ ...modal, amount: e.target.value })} autoFocus />
          </Field>
        </Modal>
      )}

      {modal?.kind === "beneficiaries" && (
        <Modal
          title={t("fin.distribute_title", "Répartir les droits entre bénéficiaires")}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitBeneficiaries} confirmLabel={t("fin.save", "Enregistrer")} confirmVariant="add" />}
        >
          <Field label={t("fin.contract_id", "Identifiant du contrat")}><input value={modal.contractId} onChange={(e) => setModal({ ...modal, contractId: e.target.value })} autoFocus /></Field>
          {modal.rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="ecl-field" style={{ flex: 2 }}>
                <label>{t("fin.partner_id", "Partenaire (identifiant)")}</label>
                <input value={row.partnerId} onChange={(e) => { const rows = [...modal.rows]; rows[i] = { ...row, partnerId: e.target.value }; setModal({ ...modal, rows }); }} />
              </div>
              <div className="ecl-field" style={{ flex: 1 }}>
                <label>{t("fin.share_pct", "Part (%)")}</label>
                <input type="number" min={0} max={100} value={row.sharePct} onChange={(e) => { const rows = [...modal.rows]; rows[i] = { ...row, sharePct: e.target.value }; setModal({ ...modal, rows }); }} />
              </div>
            </div>
          ))}
          <Button variant="subtle" size="sm" onClick={() => setModal({ ...modal, rows: [...modal.rows, { partnerId: "", sharePct: "0" }] })}>
            {t("fin.add_beneficiary", "+ Ajouter un bénéficiaire")}
          </Button>
        </Modal>
      )}

      {modal?.kind === "shipping" && (
        <Modal
          title={`${t("fin.shipping_title", "Frais de port —")} ${t("com.zone." + modal.zone, ZONE_LABELS[modal.zone])}`}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitShipping} confirmLabel={t("fin.save", "Enregistrer")} confirmVariant="add" />}
        >
          <Field label={t("fin.flat_or_empty", "Forfait (laisser vide si non applicable)")}><input type="number" min={0} value={modal.flat} onChange={(e) => setModal({ ...modal, flat: e.target.value })} /></Field>
          <Field label={t("fin.per_kg_rate", "Tarif au kilogramme")}><input type="number" min={0} value={modal.perKg} onChange={(e) => setModal({ ...modal, perKg: e.target.value })} /></Field>
          <Field label={t("fin.free_above_label", "Gratuité au-delà de (montant de commande)")}><input type="number" min={0} value={modal.freeAbove} onChange={(e) => setModal({ ...modal, freeAbove: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "bank-account" && (
        <Modal
          title={t("fin.new_account_title", "Nouveau compte / caisse")}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitBankAccount} confirmLabel={t("common.create", "Créer")} confirmVariant="add" />}
        >
          <Field label={t("fin.label", "Libellé")}><input value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} autoFocus /></Field>
          <Field label={t("fin.type", "Type")}>
            <select value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value as BankAccountType })}>
              <option value="banque">{t("fin.bank", "Banque")}</option>
              <option value="caisse">{t("fin.cash_box", "Caisse")}</option>
              <option value="mobile_money">{t("fin.mobile_money", "Mobile money")}</option>
            </select>
          </Field>
        </Modal>
      )}

      {modal?.kind === "transfer" && (
        <Modal
          title={t("fin.transfer_title", "Virement interne")}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitTransfer} confirmLabel={t("fin.transfer_btn", "Virer")} confirmVariant="add" />}
        >
          {bankAccounts.length < 2 && <p style={{ margin: 0, fontSize: 13, color: "var(--alert)" }}>{t("fin.need_two_accounts", "Il faut au moins deux comptes/caisses.")}</p>}
          <Field label={t("fin.from_account", "Compte source")}>
            <select value={modal.fromId} onChange={(e) => setModal({ ...modal, fromId: e.target.value })}>
              <option value="">{t("fin.select", "— sélectionner —")}</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Field label={t("fin.to_account", "Compte destination")}>
            <select value={modal.toId} onChange={(e) => setModal({ ...modal, toId: e.target.value })}>
              <option value="">{t("fin.select", "— sélectionner —")}</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Field label={t("fin.amount", "Montant")}><input type="number" min={0} value={modal.amount} onChange={(e) => setModal({ ...modal, amount: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

// Réglage des taux de TVA (Ch. 18 §18.9). Le taux appliqué aux nouvelles
// factures est celui du type de produit concerné (« livre » par défaut). Les
// factures déjà émises ne sont jamais recalculées (elles sont immuables) : un
// changement ne vaut que pour l'avenir.
const PRODUCT_LABELS: Record<string, string> = { livre: "Livres", autre: "Autres produits" };
function productLabel(t: string): string {
  return PRODUCT_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

function TaxRatesCard({
  canAdminister,
  onError,
  onMessage,
}: {
  canAdminister: boolean;
  onError: (m: string | null) => void;
  onMessage: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const plabel = (pt: string) => t("fin.prod." + pt, productLabel(pt));
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<{ productType: string; rate: string } | null>(null);

  const refresh = async () => {
    const list = await listTaxRates();
    setRates(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.id, String(r.rate)])));
  };

  useEffect(() => {
    refresh().catch((e) => onError(e instanceof Error ? e.message : "Échec du chargement des taux."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(country: string, productType: string, rateStr: string) {
    const rate = Number(rateStr);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      onError("Le taux doit être un pourcentage entre 0 et 100.");
      return;
    }
    onError(null);
    try {
      await setTaxRate({ country, product_type: productType, rate });
      onMessage(`${t("fin.tax", "Taux de TVA")} « ${plabel(productType)} » = ${rate} %. ${t("fin.tax_applies", "S'applique aux nouvelles factures.")}`);
      setAdding(null);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'enregistrement du taux.");
    }
  }

  return (
    <Card
      title={t("fin.tax", "Taux de TVA")}
      icon={<IconFinance />}
      subtitle={t("fin.tax_sub", "Appliqué aux nouvelles factures. Les factures déjà émises ne changent pas.")}
      action={
        canAdminister && !adding ? (
          <Button variant="view" size="sm" onClick={() => setAdding({ productType: "", rate: "" })}>{t("fin.tax_add_product", "+ Type de produit")}</Button>
        ) : undefined
      }
    >
      {rates.length === 0 && !adding ? (
        <Empty>{t("fin.tax_empty", "Aucun taux défini — la TVA vaut 0 % tant qu'aucun taux n'est enregistré.")}</Empty>
      ) : (
        <div className="ecl-list">
          {rates.map((r) => (
            <div key={r.id} className="ecl-row">
              <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="ecl-row__title">{plabel(r.productType)}</span>
                {r.country !== "default" && <StatusChip label={r.country} />}
              </div>
              {canAdminister ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={drafts[r.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      style={{ width: 76, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)" }}
                    />
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>%</span>
                  </div>
                  <Button variant="add" size="sm" onClick={() => save(r.country, r.productType, drafts[r.id] ?? "")} disabled={drafts[r.id] === String(r.rate)}>
                    {t("fin.save", "Enregistrer")}
                  </Button>
                </div>
              ) : (
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{Number(r.rate)} %</span>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div className="ecl-field" style={{ flex: "1 1 200px" }}>
            <label>{t("fin.product_type", "Type de produit")}</label>
            <input value={adding.productType} onChange={(e) => setAdding({ ...adding, productType: e.target.value })} placeholder={t("fin.product_type_ph", "Ex. livre, papeterie…")} autoFocus />
          </div>
          <div className="ecl-field" style={{ flex: "0 0 120px" }}>
            <label>{t("fin.rate_pct", "Taux (%)")}</label>
            <input type="number" min={0} max={100} step="0.01" value={adding.rate} onChange={(e) => setAdding({ ...adding, rate: e.target.value })} />
          </div>
          <Button variant="add" size="sm" onClick={() => save("default", adding.productType.trim() || "livre", adding.rate)} disabled={!adding.productType.trim() || adding.rate === ""}>
            {t("fin.save", "Enregistrer")}
          </Button>
          <Button variant="view" size="sm" onClick={() => setAdding(null)}>{t("common.cancel", "Annuler")}</Button>
        </div>
      )}

      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "12px 0 0" }}>
        {t("fin.tax_note", "Au Cameroun, les livres peuvent être exonérés de TVA (0 %). Renseignez le taux légal qui vous concerne.")}
      </p>
    </Card>
  );
}

function NewExpenseForm({ onCreated, onError }: { onCreated: () => void; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [category, setCategory] = useState<ExpenseCategory>("autre");
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createExpense({ category, amount, description: description || undefined });
      setAmount(0);
      setDescription("");
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'enregistrement de la dépense.");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div className="ecl-field" style={{ flex: "1 1 140px" }}>
        <label>{t("fin.category", "Catégorie")}</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{t("fin.cat." + value, label)}</option>)}
        </select>
      </div>
      <div className="ecl-field" style={{ flex: "1 1 120px" }}>
        <label>{t("fin.amount", "Montant")}</label>
        <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </div>
      <div className="ecl-field" style={{ flex: "2 1 200px" }}>
        <label>{t("fin.description", "Description")}</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <Button variant="add" size="sm" type="submit">{t("fin.save", "Enregistrer")}</Button>
    </form>
  );
}

function ModalActions({ onCancel, onConfirm, confirmLabel, confirmVariant }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; confirmVariant: "add" | "edit" }) {
  const { t } = useI18n();
  return (
    <>
      <Button variant="view" size="sm" onClick={onCancel}>{t("common.cancel", "Annuler")}</Button>
      <Button variant={confirmVariant} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
    </>
  );
}

const SCHEDULE_STATUS: Record<string, { label: string; color: string }> = {
  paid: { label: "Réglée", color: "var(--eclosion)" },
  partial: { label: "Partielle", color: "#C4661F" },
  pending: { label: "À venir", color: "var(--muted)" },
  overdue: { label: "En retard", color: "var(--alert)" },
};

// Échéancier de crédit : plan de paiement en plusieurs fois d'une facture.
function ScheduleModal({ invoice, onClose, onError, onSaved }: { invoice: Invoice; onClose: () => void; onError: (m: string) => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [schedule, setSchedule] = useState<InvoiceSchedule | null>(null);
  const [rows, setRows] = useState<{ due_date: string; amount: string; note: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getInvoiceSchedule(invoice.id)
      .then((s) => {
        setSchedule(s);
        setRows(s.installments.map((i) => ({ due_date: i.due_date.slice(0, 10), amount: String(i.amount), note: i.note ?? "" })));
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Chargement impossible."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(n);
  const planned = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  async function save() {
    const clean = rows.filter((r) => r.due_date && Number(r.amount) > 0);
    if (clean.length === 0) {
      onError("Ajoutez au moins une échéance.");
      return;
    }
    setBusy(true);
    try {
      const s = await setInvoiceSchedule(invoice.id, clean.map((r) => ({ due_date: new Date(r.due_date).toISOString(), amount: Number(r.amount), note: r.note || undefined })));
      setSchedule(s);
      onSaved();
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${t("fin.schedule_btn", "Échéancier")} — ${invoice.invoiceNumber}`}
      wide
      onClose={onClose}
      footer={<ModalActions onCancel={onClose} onConfirm={save} confirmLabel={busy ? t("fin.saving", "…") : t("fin.save", "Enregistrer")} confirmVariant="add" />}
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
        {t("fin.invoice_total", "Total facture :")} {money(Number(invoice.totalTtc))}
        {schedule ? ` · ${t("fin.already_paid", "déjà réglé :")} ${money(schedule.settled)}` : ""}
      </p>
      <div style={{ margin: "10px 0" }}>
        {rows.map((r, i) => {
          const st = schedule?.installments[i]?.status;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 120px 1fr 90px 28px", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="date" value={r.due_date} onChange={(e) => setRows((c) => c.map((x, idx) => (idx === i ? { ...x, due_date: e.target.value } : x)))} />
              <input type="number" min={0} placeholder={t("fin.amount_ph", "Montant")} value={r.amount} onChange={(e) => setRows((c) => c.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))} />
              <input placeholder={t("fin.note_optional", "Note (facultatif)")} value={r.note} onChange={(e) => setRows((c) => c.map((x, idx) => (idx === i ? { ...x, note: e.target.value } : x)))} />
              <span style={{ fontSize: 11, color: st ? SCHEDULE_STATUS[st].color : "var(--muted)" }}>{st ? t("fin.sch." + st, SCHEDULE_STATUS[st].label) : "—"}</span>
              <button type="button" onClick={() => setRows((c) => c.filter((_, idx) => idx !== i))} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer" }}>✕</button>
            </div>
          );
        })}
        <button type="button" onClick={() => setRows((c) => [...c, { due_date: "", amount: "", note: "" }])} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          {t("fin.add_installment", "+ Échéance")}
        </button>
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: planned - Number(invoice.totalTtc) > 0.01 ? "var(--alert)" : "var(--ink)" }}>
        {t("fin.total_planned", "Total planifié :")} {money(planned)} / {money(Number(invoice.totalTtc))}
      </div>
    </Modal>
  );
}

// Rapport d'encaissements : totaux par mode de paiement, par compte financier
// et ventes au comptoir par point de vente — filtrable par période.
function PaymentReportCard() {
  const { t } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<PaymentReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getPaymentReport({ ...(from ? { from } : {}), ...(to ? { to } : {}) })
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(n);

  return (
    <Card
      title={t("fin.report", "Rapport d'encaissements")}
      icon={<IconFinance />}
      subtitle={t("fin.report_sub", "Par mode de paiement, par compte et par point de vente.")}
      action={
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title={t("fin.since", "Depuis")} style={{ fontSize: 12 }} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title={t("fin.until", "Jusqu'à")} style={{ fontSize: 12 }} />
          <Button variant="view" size="sm" onClick={load}>{t("fin.refresh", "Actualiser")}</Button>
        </div>
      }
    >
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}
      {!report ? (
        <Empty>{t("fin.loading", "Chargement…")}</Empty>
      ) : (
        <>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, marginBottom: 10 }}>{t("fin.total_collected", "Total encaissé :")} {money(report.total_in)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
            <ReportTable title={t("fin.by_method", "Par mode de paiement")} rows={report.by_method.map((r) => ({ label: r.label, total: r.total, count: r.count }))} money={money} />
            <ReportTable title={t("fin.by_account", "Par compte financier")} rows={report.by_account.map((r) => ({ label: r.label, total: r.total, count: r.count }))} money={money} />
            <ReportTable title={t("fin.by_pos", "Ventes par point de vente")} rows={report.by_point_of_sale.map((r) => ({ label: r.name, total: r.total, count: r.count }))} money={money} />
          </div>
        </>
      )}
    </Card>
  );
}

function ReportTable({ title, rows, money }: { title: string; rows: { label: string; total: number; count: number }[]; money: (n: number) => string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>—</div>
      ) : (
        <div className="ecl-list">
          {rows.sort((a, b) => b.total - a.total).map((r, i) => (
            <div key={i} className="ecl-row" style={{ justifyContent: "space-between", fontSize: 13 }}>
              <span>{r.label} <span style={{ color: "var(--muted)", fontSize: 11 }}>×{r.count}</span></span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{money(r.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABELS: Record<PaymentMethodKind, string> = {
  especes: "Espèces",
  virement: "Virement",
  cheque: "Chèque",
  carte: "Carte",
  mobile_money: "Mobile Money",
  autre: "Autre",
};

// Gestion des modes de paiement (administrateur) : activer/désactiver, changer
// le compte financier par défaut, ajouter un mode personnalisé (PayPal, Wave…).
function PaymentMethodsModal({
  methods,
  bankAccounts,
  onClose,
  onChanged,
  onError,
}: {
  methods: PaymentMethodDef[];
  bankAccounts: BankAccount[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<PaymentMethodKind>("autre");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!code.trim() || !label.trim()) return;
    setBusy(true);
    try {
      await createPaymentMethod({ code: code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"), label: label.trim(), kind });
      setCode("");
      setLabel("");
      setKind("autre");
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec de l'ajout.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, input: Parameters<typeof updatePaymentMethod>[1]) {
    try {
      await updatePaymentMethod(id, input);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec de la mise à jour.");
    }
  }

  return (
    <Modal title={t("fin.payment_methods", "Modes de paiement")} wide onClose={onClose} footer={<Button variant="view" size="sm" onClick={onClose}>{t("fin.close", "Fermer")}</Button>}>
      <div className="ecl-list" style={{ marginBottom: 12 }}>
        {methods.map((m) => (
          <div key={m.id} className="ecl-row" style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr 1.3fr 0.8fr", gap: 8, alignItems: "center" }}>
            <span><strong>{m.label}</strong> <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{m.code}</span></span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fin.kind." + m.kind, KIND_LABELS[m.kind])}</span>
            <select value={m.defaultAccountId ?? ""} onChange={(e) => patch(m.id, { default_account_id: e.target.value || null })} title={t("fin.pm_default_account", "Compte financier par défaut")}>
              <option value="">{t("fin.pm_no_default", "Aucun compte par défaut")}</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={m.active} onChange={(e) => patch(m.id, { active: e.target.checked })} /> {t("fin.pm_active", "Actif")}
            </label>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("fin.pm_add", "Ajouter un mode")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
          <input placeholder={t("fin.pm_code_ph", "Code (ex. paypal)")} value={code} onChange={(e) => setCode(e.target.value)} />
          <input placeholder={t("fin.pm_label_ph", "Libellé (ex. PayPal)")} value={label} onChange={(e) => setLabel(e.target.value)} />
          <select value={kind} onChange={(e) => setKind(e.target.value as PaymentMethodKind)}>
            {(Object.keys(KIND_LABELS) as PaymentMethodKind[]).map((k) => (
              <option key={k} value={k}>{t("fin.kind." + k, KIND_LABELS[k])}</option>
            ))}
          </select>
          <Button variant="add" size="sm" onClick={add} disabled={busy || !code.trim() || !label.trim()}>{t("fin.pm_add_btn", "Ajouter")}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Bilan de trésorerie : pour la périodicité choisie (mensuel, trimestriel,
// semestriel ou annuel), on somme les entrées (encaissements enregistrés) et les
// dépenses (module Dépenses, statuts « validée » + « payée »), et on calcule le
// solde = entrées − dépenses. Rien à re-saisir : tout provient des opérations
// déjà enregistrées. Le tableau montre l'évolution sur l'année avec le cumul
// annuel et le détail des dépenses par catégorie (dépliable). Chaque bilan est
// imprimable / exportable en PDF avec l'en-tête officiel de la maison.
const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

type BalanceGranularity = "mensuel" | "trimestriel" | "semestriel" | "annuel";
const GRANULARITY_LABELS: Record<BalanceGranularity, string> = {
  mensuel: "Mensuel",
  trimestriel: "Trimestriel",
  semestriel: "Semestriel",
  annuel: "Annuel",
};

// Une ligne agrégée (période) : libellé + entrées / dépenses / solde + le détail
// des dépenses par catégorie cumulé sur la période.
interface BalancePeriodRow {
  key: string;
  label: string;
  entrees: number;
  depenses: number;
  solde: number;
  depensesParCategorie: Record<string, number>;
}

// Regroupe les 12 mois selon la périodicité choisie. Chaque groupe est décrit par
// les indices de mois qu'il couvre (0 = janvier) et son libellé.
function periodGroups(granularity: BalanceGranularity, year: number): { key: string; label: string; months: number[] }[] {
  switch (granularity) {
    case "mensuel":
      return MONTH_LABELS.map((label, i) => ({ key: String(i), label, months: [i] }));
    case "trimestriel":
      return [
        { key: "T1", label: "1er trimestre (janv.–mars)", months: [0, 1, 2] },
        { key: "T2", label: "2e trimestre (avr.–juin)", months: [3, 4, 5] },
        { key: "T3", label: "3e trimestre (juil.–sept.)", months: [6, 7, 8] },
        { key: "T4", label: "4e trimestre (oct.–déc.)", months: [9, 10, 11] },
      ];
    case "semestriel":
      return [
        { key: "S1", label: "1er semestre (janv.–juin)", months: [0, 1, 2, 3, 4, 5] },
        { key: "S2", label: "2e semestre (juil.–déc.)", months: [6, 7, 8, 9, 10, 11] },
      ];
    case "annuel":
      return [{ key: "A", label: `Année ${year}`, months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }];
  }
}

function aggregatePeriods(rows: MonthlyBalanceRow[], granularity: BalanceGranularity, year: number): BalancePeriodRow[] {
  return periodGroups(granularity, year).map((g) => {
    const agg: BalancePeriodRow = { key: g.key, label: g.label, entrees: 0, depenses: 0, solde: 0, depensesParCategorie: {} };
    for (const mi of g.months) {
      const m = rows[mi];
      if (!m) continue;
      agg.entrees += m.entrees;
      agg.depenses += m.depenses;
      for (const [cat, amt] of Object.entries(m.depensesParCategorie)) {
        agg.depensesParCategorie[cat] = (agg.depensesParCategorie[cat] ?? 0) + amt;
      }
    }
    agg.solde = agg.entrees - agg.depenses;
    return agg;
  });
}

function MonthlyBalanceSection() {
  const { t } = useI18n();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [granularity, setGranularity] = useState<BalanceGranularity>("mensuel");
  const [rows, setRows] = useState<MonthlyBalanceRow[] | null>(null);
  const [totals, setTotals] = useState<{ entrees: number; depenses: number; solde: number } | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    getMonthlyBalance(year)
      .then((r) => { setRows(r.months); setTotals(r.totals); })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement du bilan impossible."));
  }, [year]);

  // Montants en francs CFA (XAF), chiffres à chasse fixe (charte Éclospace).
  const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(n);
  const catLabel = (code: string) => t("fin.cat." + code, CATEGORY_LABELS[code as ExpenseCategory] ?? code);

  // Bornes d'années proposées : de l'année en cours jusqu'à 4 ans en arrière.
  const yearOptions: number[] = [];
  for (let y = now.getUTCFullYear() + 1; y >= now.getUTCFullYear() - 4; y--) yearOptions.push(y);

  const periods = rows ? aggregatePeriods(rows, granularity, year) : [];
  const periodHeader =
    granularity === "mensuel" ? t("fin.month", "Mois")
    : granularity === "trimestriel" ? t("fin.quarter", "Trimestre")
    : granularity === "semestriel" ? t("fin.semester", "Semestre")
    : t("fin.year", "Année");

  // Impression / export PDF (choix natif du navigateur) du bilan sur la
  // périodicité affichée, avec l'en-tête officiel de la maison.
  function print(asPdf: boolean) {
    if (!totals) return;
    printTreasuryBalance(
      {
        year,
        granularityLabel: GRANULARITY_LABELS[granularity],
        periods: periods.map((p) => ({ label: p.label, entrees: p.entrees, depenses: p.depenses, solde: p.solde })),
        totals,
      },
      { letterhead: true, embed: asPdf },
    );
  }

  return (
    <Card
      title={t("fin.treasury_balance", "Bilan de trésorerie")}
      icon={<IconFinance />}
      subtitle={t("fin.treasury_balance_sub", "Entrées − dépenses (validées et payées) = solde. Périodicité au choix : mensuel, trimestriel, semestriel ou annuel. Calcul automatique à partir des opérations enregistrées.")}
      action={
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select value={granularity} onChange={(e) => { setGranularity(e.target.value as BalanceGranularity); setOpenKey(null); }} style={{ fontSize: 13 }} title={t("fin.periodicity", "Périodicité")}>
            {(Object.keys(GRANULARITY_LABELS) as BalanceGranularity[]).map((g) => (
              <option key={g} value={g}>{t("fin.gran." + g, GRANULARITY_LABELS[g])}</option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ fontSize: 13 }} title={t("fin.year", "Année")}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button variant="view" size="sm" onClick={() => print(false)} disabled={!rows}>{t("fin.print", "Imprimer")}</Button>
          <Button variant="view" size="sm" onClick={() => print(true)} disabled={!rows}>{t("fin.pdf", "PDF")}</Button>
        </div>
      }
    >
      {error && <p style={{ color: "var(--alert)", fontSize: 13, margin: 0 }}>{error}</p>}
      {!error && !rows && <Empty>{t("fin.loading", "Chargement…")}</Empty>}
      {rows && totals && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)" }}>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>{periodHeader}</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>{t("fin.entries", "Entrées")}</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>{t("fin.expenses", "Dépenses")}</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>{t("fin.balance_short", "Solde")}</th>
                <th style={{ padding: "8px 10px", width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const hasActivity = p.entrees !== 0 || p.depenses !== 0;
                const cats = Object.entries(p.depensesParCategorie).sort((a, b) => b[1] - a[1]);
                const isOpen = openKey === p.key;
                return (
                  <Fragment key={p.key}>
                    <tr
                      style={{ borderBottom: "1px solid var(--line)", cursor: cats.length > 0 ? "pointer" : "default", opacity: hasActivity ? 1 : 0.5 }}
                      onClick={() => cats.length > 0 && setOpenKey(isOpen ? null : p.key)}
                    >
                      <td style={{ padding: "8px 10px" }}>{p.label}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "var(--font-mono)", color: p.entrees > 0 ? "var(--positive, #2F7D4A)" : "var(--muted)" }}>{money(p.entrees)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "var(--font-mono)", color: p.depenses > 0 ? "var(--ink)" : "var(--muted)" }}>{money(p.depenses)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: p.solde < 0 ? "var(--alert)" : "var(--ink)" }}>{money(p.solde)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--muted)" }}>
                        {cats.length > 0 && <span style={{ transition: "transform .15s", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none" }}>▸</span>}
                      </td>
                    </tr>
                    {isOpen && cats.length > 0 && (
                      <tr style={{ background: "var(--paper)" }}>
                        <td colSpan={5} style={{ padding: "8px 16px" }}>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("fin.expenses_by_cat", "Dépenses par catégorie")}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px" }}>
                            {cats.map(([code, amt]) => (
                              <span key={code} style={{ fontSize: 12.5 }}>
                                {catLabel(code)} : <strong style={{ fontFamily: "var(--font-mono)" }}>{money(amt)}</strong>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                <td style={{ padding: "10px" }}>{t("fin.annual_total", "Total annuel")}</td>
                <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--positive, #2F7D4A)" }}>{money(totals.entrees)}</td>
                <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(totals.depenses)}</td>
                <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)", color: totals.solde < 0 ? "var(--alert)" : "var(--ink)" }}>{money(totals.solde)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>
            {t("fin.monthly_balance_note", "Entrées = encaissements enregistrés. Dépenses = module Dépenses, statuts « validée » et « payée ». Cliquez sur une ligne pour le détail par catégorie ; « Imprimer » / « PDF » édite le bilan de la périodicité choisie.")}
          </p>
        </div>
      )}
    </Card>
  );
}

function Amount({ value }: { value: string | number }) {
  return <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{value}</span>;
}

function StatusChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{children}</p>;
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
