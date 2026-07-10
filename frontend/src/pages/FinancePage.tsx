import { useEffect, useState } from "react";
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
  listRoyaltyStatements,
  listShippingRates,
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
} from "../api/client";
import { Card } from "../components/Card";
import { Modal, Field } from "../components/Modal";
import { EmailModal } from "../components/EmailModal";
import { Button } from "../components/Button";
import { IconFinance } from "../components/icons";
import { printInvoice, printRoyaltyStatement } from "../lib/print";

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
  autre: "Autre",
};

const STATUS_LABELS: Record<string, string> = {
  issued: "Émise",
  paid: "Réglée",
  cancelled: "Annulée",
  credit_note: "Avoir",
  a_valider: "À valider",
  validee: "Validée",
  draft: "Brouillon",
};

interface FinancePageProps {
  canManage: boolean;
  canAdminister: boolean;
}

// Fenêtres intégrées de la page (remplacent les pop-up du navigateur).
type FinanceModal =
  | { kind: "pay-invoice"; invoice: Invoice; amount: string }
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
export function FinancePage({ canManage, canAdminister }: FinancePageProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [royaltyStatements, setRoyaltyStatements] = useState<RoyaltyStatement[]>([]);
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [aging, setAging] = useState<AgingBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<FinanceModal | null>(null);
  const [emailInvoice, setEmailInvoice] = useState<Invoice | null>(null);
  const [emailStatement, setEmailStatement] = useState<RoyaltyStatement | null>(null);

  const refresh = async () => {
    const [invoiceList, customerList, expenseList, statementList, shippingRateList, bankAccountList] = await Promise.all([
      listInvoices(),
      listCustomers(),
      listExpenses(),
      listRoyaltyStatements(),
      listShippingRates(),
      listBankAccounts(),
    ]);
    setInvoices(invoiceList);
    setCustomers(customerList);
    setExpenses(expenseList);
    setRoyaltyStatements(statementList);
    setShippingRates(shippingRateList);
    setBankAccounts(bankAccountList);
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
  async function handlePrintInvoice(invoiceId: string) {
    try {
      printInvoice(await getInvoice(invoiceId));
    } catch (err) {
      fail(err, "Échec de l'ouverture de la facture.");
    }
  }

  // Impression / export PDF d'un relevé de droits d'auteur.
  async function handlePrintStatement(statementId: string) {
    try {
      printRoyaltyStatement(await getRoyaltyStatement(statementId));
    } catch (err) {
      fail(err, "Échec de l'ouverture du relevé.");
    }
  }

  async function submitPayInvoice() {
    if (modal?.kind !== "pay-invoice") return;
    const amount = Number(modal.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      await createPayment({ method: "transfer", amount, allocations: [{ invoice_id: modal.invoice.id, amount }] });
      setMessage(`Encaissement de ${amount} enregistré pour ${modal.invoice.invoiceNumber}.`);
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de l'encaissement.");
    }
  }

  async function handleDunning(customerId: string) {
    try {
      const dunning = await nextDunning(customerId);
      setMessage(`Relance envoyée : ${dunning.level === "rappel" ? "rappel courtois" : "mise en demeure"}.`);
    } catch (err) {
      fail(err, "Échec de la relance.");
    }
  }

  async function handleValidateExpense(expense: Expense) {
    try {
      await validateExpense(expense.id);
      setMessage("Dépense validée.");
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
      setMessage("Relevé de droits d'auteur généré.");
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
      setMessage("Ordre de paiement des droits d'auteur exécuté.");
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
      setMessage("Répartition des droits enregistrée.");
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
      setMessage(`Tarif de livraison ${ZONE_LABELS[modal.zone]} mis à jour.`);
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
      setMessage("Compte créé.");
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
      setMessage("Virement interne enregistré.");
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec du virement.");
    }
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">Finance et comptabilité</h1>
      <p className="ecl-page__lead">Factures, encaissements, dépenses, droits d'auteur et trésorerie.</p>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      <Card title="Factures" icon={<IconFinance />} subtitle="Suivi des factures et encaissements.">
        {invoices.length === 0 ? (
          <Empty>Aucune facture.</Empty>
        ) : (
          <div className="ecl-list">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{invoice.invoiceNumber}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{invoice.customer.name}</span>
                  <Amount value={invoice.totalTtc} />
                  <StatusChip label={STATUS_LABELS[invoice.status] ?? invoice.status} />
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  <Button variant="view" size="sm" onClick={() => handlePrintInvoice(invoice.id)}>Imprimer / PDF</Button>
                  <Button variant="view" size="sm" onClick={() => setEmailInvoice(invoice)}>Envoyer par e-mail</Button>
                  {canManage && invoice.type === "invoice" && invoice.status === "issued" && (
                    <Button variant="add" size="sm" onClick={() => setModal({ kind: "pay-invoice", invoice, amount: String(invoice.totalTtc) })}>
                      Encaisser
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 18 §18.3 — Encours et relance client */}
      <Card title="Encours et relance client" icon={<IconFinance />} subtitle="Balance âgée d'un client et relances.">
        <div className="ecl-field" style={{ maxWidth: 360 }}>
          <label>Client</label>
          <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}>
            <option value="">— sélectionner —</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
        </div>
        {aging && (
          <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 13, flexWrap: "wrap", alignItems: "center" }}>
            <span>Non échu : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.not_due}</strong></span>
            <span style={{ color: "var(--amber)" }}>30 j : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.d30}</strong></span>
            <span style={{ color: "var(--amber)" }}>60 j : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.d60}</strong></span>
            <span style={{ color: "var(--alert)" }}>90 j+ : <strong style={{ fontFamily: "var(--font-mono)" }}>{aging.d90_plus}</strong></span>
            {canManage && aging.d30 + aging.d60 + aging.d90_plus > 0 && (
              <Button variant="edit" size="sm" onClick={() => handleDunning(selectedCustomerId)}>Relancer</Button>
            )}
          </div>
        )}
      </Card>

      {/* Ch. 18 §18.4 — Dépenses */}
      <Card title="Dépenses" icon={<IconFinance />} subtitle="Engagements de dépenses et validations.">
        {expenses.length === 0 ? (
          <Empty>Aucune dépense.</Empty>
        ) : (
          <div className="ecl-list">
            {expenses.map((expense) => (
              <div key={expense.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title">{CATEGORY_LABELS[expense.category]}</span>
                  <Amount value={expense.amount} />
                  <StatusChip label={STATUS_LABELS[expense.status] ?? expense.status} />
                  {expense.description && <span className="ecl-row__desc" style={{ margin: 0 }}>{expense.description}</span>}
                </div>
                {canAdminister && expense.status === "a_valider" && (
                  <Button variant="add" size="sm" onClick={() => handleValidateExpense(expense)}>Valider</Button>
                )}
              </div>
            ))}
          </div>
        )}
        {canManage && (
          <div style={{ marginTop: 14 }}>
            <NewExpenseForm onCreated={() => { setMessage("Dépense enregistrée."); refresh(); }} onError={setError} />
          </div>
        )}
      </Card>

      {/* Ch. 9 §9.5, Ch. 18 §18.7 — Relevés de droits d'auteur */}
      <Card
        title="Relevés de droits d'auteur"
        icon={<IconFinance />}
        subtitle="Génération et paiement des relevés."
        action={
          canAdminister ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="add" size="sm" onClick={() => setModal({ kind: "generate-statement", contractId: "", start: "2026-01-01", end: "2026-12-31" })}>
                + Relevé
              </Button>
              <Button variant="view" size="sm" onClick={() => setModal({ kind: "beneficiaries", contractId: "", rows: [{ partnerId: "", sharePct: "100" }] })}>
                Répartir
              </Button>
            </div>
          ) : undefined
        }
      >
        {royaltyStatements.length === 0 ? (
          <Empty>Aucun relevé.</Empty>
        ) : (
          <div className="ecl-list">
            {royaltyStatements.map((statement) => (
              <div key={statement.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{statement.contract.contractNumber}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{statement.contract.partner.firstName} {statement.contract.partner.lastName}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>dû : <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{statement.balanceDue}</strong></span>
                  <StatusChip label={STATUS_LABELS[statement.status] ?? statement.status} />
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  <Button variant="view" size="sm" onClick={() => handlePrintStatement(statement.id)}>Imprimer / PDF</Button>
                  <Button variant="view" size="sm" onClick={() => setEmailStatement(statement)}>Envoyer par e-mail</Button>
                  {canAdminister && statement.status !== "paid" && Number(statement.remaining_balance ?? statement.balanceDue) > 0 && (
                    <Button variant="add" size="sm" onClick={() => setModal({ kind: "pay-statement", statement, amount: "" })}>Payer</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 17 §17.5 — Frais de port par zone */}
      <Card title="Frais de port par zone" icon={<IconFinance />} subtitle="Barème de livraison par zone géographique.">
        <div className="ecl-list">
          {(Object.keys(ZONE_LABELS) as ShippingZone[]).map((zone) => {
            const rate = shippingRates.find((r) => r.zone === zone);
            return (
              <div key={zone} className="ecl-row">
                <div className="ecl-row__main">
                  <div className="ecl-row__title">{ZONE_LABELS[zone]}</div>
                  <div className="ecl-row__desc">
                    {rate
                      ? `Forfait : ${rate.flatAmount ?? "—"} · au kg : ${rate.perKgAmount ?? "—"} · gratuit au-delà de : ${rate.freeAboveAmount ?? "—"}`
                      : "Non paramétré (frais nuls)"}
                  </div>
                </div>
                {canAdminister && (
                  <Button variant="view" size="sm" onClick={() => setModal({ kind: "shipping", zone, flat: String(rate?.flatAmount ?? ""), perKg: String(rate?.perKgAmount ?? ""), freeAbove: String(rate?.freeAboveAmount ?? "") })}>
                    Paramétrer
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Ch. 18 §18.9 — Taux de TVA */}
      <TaxRatesCard canAdminister={canAdminister} onError={setError} onMessage={setMessage} />

      {/* Ch. 18 §18.8 — Trésorerie */}
      <Card
        title="Trésorerie : comptes, caisses et virements"
        icon={<IconFinance />}
        subtitle="Soldes des comptes et virements internes."
        action={
          canAdminister ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="add" size="sm" onClick={() => setModal({ kind: "bank-account", label: "", type: "banque" })}>+ Compte</Button>
              <Button variant="view" size="sm" onClick={() => setModal({ kind: "transfer", fromId: "", toId: "", amount: "" })}>Virement</Button>
            </div>
          ) : undefined
        }
      >
        {bankAccounts.length === 0 ? (
          <Empty>Aucun compte.</Empty>
        ) : (
          <div className="ecl-list">
            {bankAccounts.map((account) => (
              <div key={account.id} className="ecl-row">
                <div className="ecl-row__main">
                  <div className="ecl-row__title">{account.label}</div>
                  <div className="ecl-row__desc">{account.type}</div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{balances[account.id] ?? "…"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {emailInvoice && (
        <EmailModal
          title={`Envoyer la facture ${emailInvoice.invoiceNumber}`}
          initialMessage={`Madame, Monsieur,\n\nVeuillez trouver ci-dessous votre facture ${emailInvoice.invoiceNumber}. Nous vous en souhaitons bonne réception.\n\nCordialement,\nÉclosion Édition`}
          loadPreview={(msg) => previewInvoiceEmail(emailInvoice.id, msg)}
          onSend={(to, msg) => sendInvoiceEmail(emailInvoice.id, to, msg)}
          onClose={() => setEmailInvoice(null)}
        />
      )}

      {emailStatement && (
        <EmailModal
          title={`Envoyer le relevé ${emailStatement.contract.contractNumber}`}
          initialMessage={`Cher auteur, chère auteure,\n\nVeuillez trouver ci-dessous votre relevé de droits d'auteur pour le contrat ${emailStatement.contract.contractNumber}.\n\nBien cordialement,\nÉclosion Édition`}
          loadPreview={(msg) => previewRoyaltyStatementEmail(emailStatement.id, msg)}
          onSend={(to, msg) => sendRoyaltyStatementEmail(emailStatement.id, to, msg)}
          onClose={() => setEmailStatement(null)}
        />
      )}

      {/* ── Fenêtres intégrées ─────────────────────────────────────────────── */}
      {modal?.kind === "pay-invoice" && (
        <Modal
          title={`Encaisser ${modal.invoice.invoiceNumber}`}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitPayInvoice} confirmLabel="Encaisser" confirmVariant="add" />}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Client : <strong style={{ color: "var(--ink)" }}>{modal.invoice.customer.name}</strong> · solde {modal.invoice.totalTtc}</p>
          <Field label="Montant encaissé">
            <input type="number" min={0} value={modal.amount} onChange={(e) => setModal({ ...modal, amount: e.target.value })} autoFocus />
          </Field>
        </Modal>
      )}

      {modal?.kind === "generate-statement" && (
        <Modal
          title="Générer un relevé de droits"
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitGenerateStatement} confirmLabel="Générer" confirmVariant="add" />}
        >
          <Field label="Identifiant du contrat"><input value={modal.contractId} onChange={(e) => setModal({ ...modal, contractId: e.target.value })} autoFocus /></Field>
          <Field label="Début de période"><input type="date" value={modal.start} onChange={(e) => setModal({ ...modal, start: e.target.value })} /></Field>
          <Field label="Fin de période"><input type="date" value={modal.end} onChange={(e) => setModal({ ...modal, end: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "pay-statement" && (
        <Modal
          title="Payer les droits d'auteur"
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitPayStatement} confirmLabel="Payer" confirmVariant="add" />}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Restant dû : <strong style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{modal.statement.remaining_balance ?? modal.statement.balanceDue}</strong></p>
          <Field label="Montant (laisser vide pour solder le restant)">
            <input type="number" min={0} value={modal.amount} onChange={(e) => setModal({ ...modal, amount: e.target.value })} autoFocus />
          </Field>
        </Modal>
      )}

      {modal?.kind === "beneficiaries" && (
        <Modal
          title="Répartir les droits entre bénéficiaires"
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitBeneficiaries} confirmLabel="Enregistrer" confirmVariant="add" />}
        >
          <Field label="Identifiant du contrat"><input value={modal.contractId} onChange={(e) => setModal({ ...modal, contractId: e.target.value })} autoFocus /></Field>
          {modal.rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="ecl-field" style={{ flex: 2 }}>
                <label>Partenaire (identifiant)</label>
                <input value={row.partnerId} onChange={(e) => { const rows = [...modal.rows]; rows[i] = { ...row, partnerId: e.target.value }; setModal({ ...modal, rows }); }} />
              </div>
              <div className="ecl-field" style={{ flex: 1 }}>
                <label>Part (%)</label>
                <input type="number" min={0} max={100} value={row.sharePct} onChange={(e) => { const rows = [...modal.rows]; rows[i] = { ...row, sharePct: e.target.value }; setModal({ ...modal, rows }); }} />
              </div>
            </div>
          ))}
          <Button variant="subtle" size="sm" onClick={() => setModal({ ...modal, rows: [...modal.rows, { partnerId: "", sharePct: "0" }] })}>
            + Ajouter un bénéficiaire
          </Button>
        </Modal>
      )}

      {modal?.kind === "shipping" && (
        <Modal
          title={`Frais de port — ${ZONE_LABELS[modal.zone]}`}
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitShipping} confirmLabel="Enregistrer" confirmVariant="add" />}
        >
          <Field label="Forfait (laisser vide si non applicable)"><input type="number" min={0} value={modal.flat} onChange={(e) => setModal({ ...modal, flat: e.target.value })} /></Field>
          <Field label="Tarif au kilogramme"><input type="number" min={0} value={modal.perKg} onChange={(e) => setModal({ ...modal, perKg: e.target.value })} /></Field>
          <Field label="Gratuité au-delà de (montant de commande)"><input type="number" min={0} value={modal.freeAbove} onChange={(e) => setModal({ ...modal, freeAbove: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "bank-account" && (
        <Modal
          title="Nouveau compte / caisse"
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitBankAccount} confirmLabel="Créer" confirmVariant="add" />}
        >
          <Field label="Libellé"><input value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} autoFocus /></Field>
          <Field label="Type">
            <select value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value as BankAccountType })}>
              <option value="banque">Banque</option>
              <option value="caisse">Caisse</option>
              <option value="mobile_money">Mobile money</option>
            </select>
          </Field>
        </Modal>
      )}

      {modal?.kind === "transfer" && (
        <Modal
          title="Virement interne"
          onClose={() => setModal(null)}
          footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitTransfer} confirmLabel="Virer" confirmVariant="add" />}
        >
          {bankAccounts.length < 2 && <p style={{ margin: 0, fontSize: 13, color: "var(--alert)" }}>Il faut au moins deux comptes/caisses.</p>}
          <Field label="Compte source">
            <select value={modal.fromId} onChange={(e) => setModal({ ...modal, fromId: e.target.value })}>
              <option value="">— sélectionner —</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Compte destination">
            <select value={modal.toId} onChange={(e) => setModal({ ...modal, toId: e.target.value })}>
              <option value="">— sélectionner —</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Montant"><input type="number" min={0} value={modal.amount} onChange={(e) => setModal({ ...modal, amount: e.target.value })} /></Field>
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
      onMessage(`Taux de TVA « ${productLabel(productType)} » enregistré à ${rate} %. Il s'applique aux nouvelles factures.`);
      setAdding(null);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'enregistrement du taux.");
    }
  }

  return (
    <Card
      title="Taux de TVA"
      icon={<IconFinance />}
      subtitle="Appliqué aux nouvelles factures. Les factures déjà émises ne changent pas."
      action={
        canAdminister && !adding ? (
          <Button variant="view" size="sm" onClick={() => setAdding({ productType: "", rate: "" })}>+ Type de produit</Button>
        ) : undefined
      }
    >
      {rates.length === 0 && !adding ? (
        <Empty>Aucun taux défini — la TVA vaut 0 % tant qu'aucun taux n'est enregistré.</Empty>
      ) : (
        <div className="ecl-list">
          {rates.map((r) => (
            <div key={r.id} className="ecl-row">
              <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="ecl-row__title">{productLabel(r.productType)}</span>
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
                    Enregistrer
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
            <label>Type de produit</label>
            <input value={adding.productType} onChange={(e) => setAdding({ ...adding, productType: e.target.value })} placeholder="Ex. livre, papeterie…" autoFocus />
          </div>
          <div className="ecl-field" style={{ flex: "0 0 120px" }}>
            <label>Taux (%)</label>
            <input type="number" min={0} max={100} step="0.01" value={adding.rate} onChange={(e) => setAdding({ ...adding, rate: e.target.value })} />
          </div>
          <Button variant="add" size="sm" onClick={() => save("default", adding.productType.trim() || "livre", adding.rate)} disabled={!adding.productType.trim() || adding.rate === ""}>
            Enregistrer
          </Button>
          <Button variant="view" size="sm" onClick={() => setAdding(null)}>Annuler</Button>
        </div>
      )}

      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "12px 0 0" }}>
        Au Cameroun, les livres peuvent être exonérés de TVA (0 %). Renseignez le taux légal qui vous concerne.
      </p>
    </Card>
  );
}

function NewExpenseForm({ onCreated, onError }: { onCreated: () => void; onError: (m: string) => void }) {
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
        <label>Catégorie</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="ecl-field" style={{ flex: "1 1 120px" }}>
        <label>Montant</label>
        <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </div>
      <div className="ecl-field" style={{ flex: "2 1 200px" }}>
        <label>Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <Button variant="add" size="sm" type="submit">Enregistrer</Button>
    </form>
  );
}

function ModalActions({ onCancel, onConfirm, confirmLabel, confirmVariant }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; confirmVariant: "add" | "edit" }) {
  return (
    <>
      <Button variant="view" size="sm" onClick={onCancel}>Annuler</Button>
      <Button variant={confirmVariant} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
    </>
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
