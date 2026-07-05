-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('salarie', 'prestataire_externe', 'stagiaire', 'benevole');

-- CreateEnum
CREATE TYPE "HrContractType" AS ENUM ('cdi', 'cdd', 'stage', 'prestation');

-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('conge', 'maladie', 'mission', 'teletravail');

-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('en_attente', 'validee', 'refusee');

-- CreateEnum
CREATE TYPE "AccessReviewStatus" AS ENUM ('en_cours', 'terminee');

-- CreateEnum
CREATE TYPE "AccessReviewDecision" AS ENUM ('confirme', 'anomalie_signalee');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('faible', 'moyenne', 'elevee', 'critique');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('open', 'treated', 'ignored', 'postponed');

-- CreateEnum
CREATE TYPE "ReportDomain" AS ENUM ('editorial', 'production', 'commercial', 'financier', 'rh');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "departure_date" TIMESTAMP(3),
ADD COLUMN     "hire_date" TIMESTAMP(3),
ADD COLUMN     "leave_balance_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "manager_id" TEXT,
ADD COLUMN     "position" TEXT,
ADD COLUMN     "status" "EmployeeStatus" NOT NULL DEFAULT 'salarie';

-- CreateTable
CREATE TABLE "hr_contracts" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "HrContractType" NOT NULL,
    "linked_contract_id" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "renewal_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "hr_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_confidential" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "base_salary" DECIMAL(12,2),
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "employee_confidential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "from_date" TIMESTAMP(3) NOT NULL,
    "to_date" TIMESTAMP(3) NOT NULL,
    "status" "AbsenceStatus" NOT NULL DEFAULT 'en_attente',
    "reason" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_skills" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "level" INTEGER,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_variables" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "presence_days" DECIMAL(5,1),
    "absence_days" DECIMAL(5,1),
    "bonus_amount" DECIMAL(12,2),
    "missions_amount" DECIMAL(12,2),
    "exported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_reviews" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "launched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "launched_by" TEXT,
    "status" "AccessReviewStatus" NOT NULL DEFAULT 'en_cours',

    CONSTRAINT "access_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_review_items" (
    "id" TEXT NOT NULL,
    "access_review_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "decision" "AccessReviewDecision",
    "comment" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "access_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_rules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "params" JSONB NOT NULL,
    "priority" "RecommendationPriority" NOT NULL DEFAULT 'moyenne',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "smart_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" "RecommendationPriority" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'open',
    "treated_by" TEXT,
    "treated_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "domain" "ReportDomain" NOT NULL,
    "description" TEXT,
    "owner_id" TEXT,
    "schedule_cron" TEXT,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "params" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" TEXT,
    "row_count" INTEGER,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_analyses" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "shared_with" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promoted_report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_confidential_employee_id_key" ON "employee_confidential"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_category_label_key" ON "skills"("category", "label");

-- CreateIndex
CREATE UNIQUE INDEX "employee_skills_employee_id_skill_id_key" ON "employee_skills"("employee_id", "skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_variables_employee_id_period_key_key" ON "payroll_variables"("employee_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "smart_rules_code_key" ON "smart_rules"("code");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_definitions_code_key" ON "kpi_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "reports_key_key" ON "reports"("key");

-- CreateIndex
CREATE UNIQUE INDEX "saved_analyses_promoted_report_id_key" ON "saved_analyses"("promoted_report_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_linked_contract_id_fkey" FOREIGN KEY ("linked_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_confidential" ADD CONSTRAINT "employee_confidential_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_variables" ADD CONSTRAINT "payroll_variables_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_access_review_id_fkey" FOREIGN KEY ("access_review_id") REFERENCES "access_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "smart_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_analyses" ADD CONSTRAINT "saved_analyses_promoted_report_id_fkey" FOREIGN KEY ("promoted_report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
