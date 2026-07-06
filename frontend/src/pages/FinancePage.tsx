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
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [aging, setAging] = useState<AgingBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    const amountStr = window.prompt(
      `Montant à payer (brut, laisser vide pour le solde restant : ${statement.remaining_balance ?? statement.balanceDue})`,
      "",
    );
    try {
      await payRoyaltyStatement(statement.id, { method: "transfer", amount: amountStr ? Number(amountStr) : undefined });
      setMessage("Ordre de paiement des droits d'auteur exécuté.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du paiement.");
    }
  }

  async function handleSetBeneficiaries(contractNumber: string) {
    const contractId = window.prompt(`ID du contrat pour répartir les droits (référence attendue : ${contractNumber})`);
    if (!contractId) return;
    const beneficiaries: { partner_id: string; share_pct: number }[] = [];
    let addAnother = true;
    while (addAnother) {
      const partnerId = window.prompt("ID du partenaire bénéficiaire (laisser vide pour terminer)");
      if (!partnerId) break;
      const sharePct = Number(window.prompt(`Part de ${partnerId} (%)`, "100") ?? "0");
      beneficiaries.push({ partner_id: partnerId, share_pct: sharePct });
      addAnother = window.confirm("Ajouter un autre bénéficiaire ?");
    }
    if (beneficiaries.length === 0) return;
    try {
      await setContractBeneficiaries(contractId, beneficiaries);
      setMessage("Répartition des droits enregistrée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement de la répartition.");
    }
  }

  async function handleSetShippingRate(zone: ShippingZone) {
    const flat = window.prompt(`Forfait pour ${ZONE_LABELS[zone]} (laisser vide si non applicable)`, "");
    const perKg = window.prompt(`Tarif au kilogramme pour ${ZONE_LABELS[zone]} (laisser vide si non applicable)`, "");
    const freeAbove = window.prompt(`Gratuité au-delà de (montant de commande, laisser vide si non applicable)`, "");
    try {
      await setShippingRate({
        zone,
        flat_amount: flat ? Number(flat) : undefined,
        per_kg_amount: perKg ? Number(perKg) : undefined,
        free_above_amount: freeAbove ? Number(freeAbove) : undefined,
      });
      setMessage(`Tarif de livraison ${ZONE_LABELS[zone]} mis à jour.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la mise à jour du tarif.");
    }
  }

  async function handleCreateBankAccount() {
    const label = window.prompt("Libellé du compte/caisse");
    if (!label) return;
    const type = (window.prompt("Type (banque, caisse, mobile_money)", "banque") ?? "banque") as BankAccountType;
    try {
      await createBankAccount({ label, type });
      setMessage("Compte créé.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la création du compte.");
    }
  }

  async function handleTransfer() {
    if (bankAccounts.length < 2) {
      setError("Il faut au moins deux comptes/caisses pour effectuer un virement interne.");
      return;
    }
    const fromLabel = window.prompt(`Compte source (${bankAccounts.map((a) => a.label).join(", ")})`);
    const from = bankAccounts.find((a) => a.label === fromLabel);
    const toLabel = window.prompt(`Compte destination (${bankAccounts.map((a) => a.label).join(", ")})`);
    const to = bankAccounts.find((a) => a.label === toLabel);
    const amountStr = window.prompt("Montant du virement");
    if (!from || !to || !amountStr) return;
    try {
      await createAccountTransfer({ from_account_id: from.id, to_account_id: to.id, amount: Number(amountStr) });
      setMessage("Virement interne enregistré.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du virement.");
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
        {/* Ch. 18 §18.3 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Encours et relance client</div>
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
        {/* Ch. 18 §18.4 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Dépenses</div>
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
        {/* Ch. 9 §9.5, Ch. 18 §18.7 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Relevés de droits d'auteur</div>
        {royaltyStatements.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun relevé.</p>}
        {royaltyStatements.map((statement) => (
          <div key={statement.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {statement.contract.contractNumber} — {statement.contract.partner.firstName} {statement.contract.partner.lastName} —
              {" "}dû : {statement.balanceDue} — restant : {statement.remaining_balance ?? statement.balanceDue} — {statement.status}
            </span>
            {canAdminister && statement.status !== "paid" && Number(statement.remaining_balance ?? statement.balanceDue) > 0 && (
              <button onClick={() => handlePayStatement(statement)} style={secondaryButtonStyle}>
                Payer
              </button>
            )}
          </div>
        ))}
        {canAdminister && (
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => handleGenerateStatement("")} style={secondaryButtonStyle}>
              + Générer un relevé
            </button>
            <button onClick={() => handleSetBeneficiaries("")} style={secondaryButtonStyle}>
              Répartir entre bénéficiaires
            </button>
          </div>
        )}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        {/* Ch. 17 §17.5 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Frais de port par zone</div>
        {(Object.keys(ZONE_LABELS) as ShippingZone[]).map((zone) => {
          const rate = shippingRates.find((r) => r.zone === zone);
          return (
            <div key={zone} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
              <span>
                {ZONE_LABELS[zone]}
                {rate
                  ? ` — forfait : ${rate.flatAmount ?? "—"}, au kg : ${rate.perKgAmount ?? "—"}, gratuit au-delà de : ${rate.freeAboveAmount ?? "—"}`
                  : " — non paramétré (frais nuls)"}
              </span>
              {canAdminister && (
                <button onClick={() => handleSetShippingRate(zone)} style={secondaryButtonStyle}>
                  Paramétrer
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        {/* Ch. 18 §18.8 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Trésorerie : comptes, caisses et virements</div>
        {bankAccounts.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun compte.</p>}
        {bankAccounts.map((account) => (
          <div key={account.id} style={{ fontSize: 13, padding: "4px 0" }}>
            {account.label} ({account.type}) — solde : {balances[account.id] ?? "…"}
          </div>
        ))}
        {canAdminister && (
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={handleCreateBankAccount} style={secondaryButtonStyle}>
              + Compte/caisse
            </button>
            <button onClick={handleTransfer} style={secondaryButtonStyle}>
              Virement interne
            </button>
          </div>
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
