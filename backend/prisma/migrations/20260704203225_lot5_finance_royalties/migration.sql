-- CreateEnum
CREATE TYPE "RoyaltyStatementStatus" AS ENUM ('draft', 'issued', 'paid');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('invoice', 'credit_note');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('issued', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('transfer', 'cheque', 'cash', 'mobile_money');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('loyer', 'salaire', 'prestation', 'transport', 'communication', 'autre');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('a_valider', 'validee', 'payee', 'rejetee');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('advance', 'royalties', 'editorial_services', 'manufacturing', 'promotion', 'overhead_allocation');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "AccountingExportFormat" AS ENUM ('csv');

-- CreateTable
CREATE TABLE "invoice_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "royalty_entries" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_base_amount" DECIMAL(10,2) NOT NULL,
    "rate_applied" DECIMAL(5,4) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statement_id" TEXT,

    CONSTRAINT "royalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "royalty_statements" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_earned" DECIMAL(12,2) NOT NULL,
    "advance_recouped" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance_due" DECIMAL(12,2) NOT NULL,
    "status" "RoyaltyStatementStatus" NOT NULL DEFAULT 'draft',
    "document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "royalty_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "royalty_payments" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(12,2) NOT NULL,
    "tax_withheld" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_id" TEXT,

    CONSTRAINT "royalty_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'invoice',
    "parent_invoice_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "total_ht" DECIMAL(12,2) NOT NULL,
    "total_tax" DECIMAL(12,2) NOT NULL,
    "total_ttc" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "due_date" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'issued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "isbn_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bank_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'a_valider',
    "supplier" TEXT,
    "manuscript_id" TEXT,
    "description" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_entries" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "cost_type" "CostType" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expense_id" TEXT,

    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT,
    "department_id" TEXT,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "cost_type" "CostType" NOT NULL,
    "planned_amount" DECIMAL(12,2) NOT NULL,
    "revised_amount" DECIMAL(12,2),
    "revision_reason" TEXT,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_mobile_money" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_lines" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "matched_payment_id" TEXT,
    "reconciled_at" TIMESTAMP(3),

    CONSTRAINT "statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'open',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_exports" (
    "id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "format" "AccountingExportFormat" NOT NULL DEFAULT 'csv',
    "line_count" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "file_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "accounting_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "royalty_payments_payment_id_key" ON "royalty_payments"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "statement_lines_matched_payment_id_key" ON "statement_lines"("matched_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_country_product_type_key" ON "tax_rates"("country", "product_type");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_period_key_key" ON "accounting_periods"("period_key");

-- AddForeignKey
ALTER TABLE "royalty_entries" ADD CONSTRAINT "royalty_entries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_entries" ADD CONSTRAINT "royalty_entries_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "royalty_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_payments" ADD CONSTRAINT "royalty_payments_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "royalty_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_payments" ADD CONSTRAINT "royalty_payments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_invoice_id_fkey" FOREIGN KEY ("parent_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

