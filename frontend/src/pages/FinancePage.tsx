import { useEffect, useState } from "react";
import {
  createExpense,
  createPayment,
  generateRoyaltyStatement,
  getCustomerAging,
  listCustomers,
  listExpenses,
  listInvoices,
  listRoyaltyStatements,
  nextDunning,
  payRoyaltyStatement,
  validateExpense,
  type AgingBalance,
  type Customer,
  type Expense,
  type ExpenseCategory,
  type Invoice,
  type RoyaltyStatement,
} from "../api/client";

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
};

interface FinancePageProps {
  canManage: boolean;
  canAdminister: boolean;
}

// Finance et comptabilité (Ch. 18) — Option B (décision opérateur du
// 04/07/2026) : gestion financière opérationnelle, exports vers un cabinet
// externe. Écran transverse regroupant factures, encaissements, dépenses et
// droits d'auteur.
export function FinancePage({ canManage, canAdminister }: FinancePageProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [royaltyStatements, setRoyaltyStatements] = useState<RoyaltyStatement[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [aging, setAging] = useState<AgingBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [invoiceList, customerList, expenseList, statementList] = await Promise.all([
      listInvoices(),
      listCustomers(),
      listExpenses(),
      listRoyaltyStatements(),
    ]);
    setInvoices(invoiceList);
    setCustomers(customerList);
    setExpenses(expenseList);
    setRoyaltyStatements(statementList);
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

  async function handlePayInvoice(invoice: Invoice) {
    const amountStr = window.prompt(`Montant encaissé pour ${invoice.invoiceNumber} (solde : ${invoice.totalTtc})`, invoice.totalTtc);
    if (!amountStr) return;
    const amount = Number(amountStr);
    try {
      await createPayment({ method: "transfer", amount, allocations: [{ invoice_id: invoice.id, amount }] });
      setMessage(`Encaissement de ${amount} enregistré pour ${invoice.invoiceNumber}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'encaissement.");
    }
  }

  async function handleDunning(customerId: string) {
    try {
      const dunning = await nextDunning(customerId);
      setMessage(`Relance envoyée : ${dunning.level === "rappel" ? "rappel courtois" : "mise en demeure"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la relance.");
    }
  }

  async function handleValidateExpense(expense: Expense) {
    try {
      await validateExpense(expense.id);
      setMessage(`Dépense validée.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la validation.");
    }
  }

  async function handleGenerateStatement(contractNumber: string) {
    const contractId = window.prompt(`ID du contrat pour générer le relevé (référence attendue : ${contractNumber})`);
    if (!contractId) return;
    const periodStart = window.prompt("Début de période (AAAA-MM-JJ)", "2026-01-01");
    const periodEnd = window.prompt("Fin de période (AAAA-MM-JJ)", "2026-12-31");
    if (!periodStart || !periodEnd) return;
    try {
      await generateRoyaltyStatement(contractId, {
        period_start: new Date(periodStart).toISOString(),
        period_end: new Date(periodEnd).toISOString(),
      });
      setMessage("Relevé de droits d'auteur généré.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la génération du relevé.");
    }
  }

  async function handlePayStatement(statement: RoyaltyStatement) {
    try {
      await payRoyaltyStatement(statement.id, { method: "transfer" });
      setMessage("Ordre de paiement des droits d'auteur exécuté.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du paiement.");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Finance et comptabilité</h1>
      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Factures</div>
        {invoices.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune facture.</p>}
        {invoices.map((invoice) => (
          <div key={invoice.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {invoice.invoiceNumber} — {invoice.customer.name} — {invoice.totalTtc} — {STATUS_LABELS[invoice.status] ?? invoice.status}
            </span>
            {canManage && invoice.type === "invoice" && invoice.status === "issued" && (
              <button onClick={() => handlePayInvoice(invoice)} style={secondaryButtonStyle}>
                Encaisser
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Encours et relance client (Ch. 18 §18.3)</div>
        <label style={{ fontSize: 12 }}>
          Client
          <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} style={inputStyle}>
            <option value="">— sélectionner —</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        {aging && (
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 13 }}>
            <span>Non échu : <strong>{aging.not_due}</strong></span>
            <span style={{ color: "var(--late, #C4661F)" }}>30 j : <strong>{aging.d30}</strong></span>
            <span style={{ color: "var(--late, #C4661F)" }}>60 j : <strong>{aging.d60}</strong></span>
            <span style={{ color: "var(--alert)" }}>90 j+ : <strong>{aging.d90_plus}</strong></span>
            {canManage && (aging.d30 + aging.d60 + aging.d90_plus > 0) && (
              <button onClick={() => handleDunning(selectedCustomerId)} style={secondaryButtonStyle}>
                Relancer
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Dépenses (Ch. 18 §18.4)</div>
        {expenses.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune dépense.</p>}
        {expenses.map((expense) => (
          <div key={expense.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {CATEGORY_LABELS[expense.category]} — {expense.amount} — {expense.status}
              {expense.description && <span style={{ color: "var(--muted)" }}> ({expense.description})</span>}
            </span>
            {canAdminister && expense.status === "a_valider" && (
              <button onClick={() => handleValidateExpense(expense)} style={secondaryButtonStyle}>
                Valider
              </button>
            )}
          </div>
        ))}
        {canManage && <NewExpenseForm onCreated={() => { setMessage("Dépense enregistrée."); refresh(); }} onError={setError} />}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Relevés de droits d'auteur (Ch. 9 §9.5, Ch. 18 §18.7)</div>
        {royaltyStatements.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun relevé.</p>}
        {royaltyStatements.map((statement) => (
          <div key={statement.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {statement.contract.contractNumber} — {statement.contract.partner.firstName} {statement.contract.partner.lastName} —
              {" "}dû : {statement.balanceDue} — {statement.status}
            </span>
            {canAdminister && statement.status === "issued" && Number(statement.balanceDue) > 0 && (
              <button onClick={() => handlePayStatement(statement)} style={secondaryButtonStyle}>
                Payer
              </button>
            )}
          </div>
        ))}
        {canAdminister && (
          <button onClick={() => handleGenerateStatement("")} style={{ ...secondaryButtonStyle, marginTop: 10 }}>
            + Générer un relevé
          </button>
        )}
      </div>
    </div>
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
    <form onSubmit={handleSubmit} style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr auto", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          Catégorie
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} style={inputStyle}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Montant
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>
          Description
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
        </label>
        <button type="submit" style={{ ...secondaryButtonStyle, alignSelf: "end", background: "var(--eclosion)", color: "#fff", border: "none" }}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13 };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
