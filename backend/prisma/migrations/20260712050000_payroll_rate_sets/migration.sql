-- Module « Paie » natif (D-007) — incrément 1 : barème légal paramétrable et
-- versionné par date d'effet. Additif (une table), aucune donnée impactée.


-- CreateTable
CREATE TABLE "payroll_rate_sets" (
    "id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vid_sal_pct" DECIMAL(6,4) NOT NULL,
    "vid_pat_pct" DECIMAL(6,4) NOT NULL,
    "pf_pct" DECIMAL(6,4) NOT NULL,
    "at_pct" DECIMAL(6,4) NOT NULL,
    "cnps_ceiling" DECIMAL(12,2) NOT NULL,
    "abat_pct" DECIMAL(6,4) NOT NULL,
    "abat_fixe" DECIMAL(12,2) NOT NULL,
    "cac_pct" DECIMAL(6,4) NOT NULL,
    "cfc_sal_pct" DECIMAL(6,4) NOT NULL,
    "cfc_pat_pct" DECIMAL(6,4) NOT NULL,
    "fne_pct" DECIMAL(6,4) NOT NULL,
    "coef_assiette" DECIMAL(6,4) NOT NULL,
    "heures_mois" DECIMAL(7,2) NOT NULL,
    "anc_def_pct" DECIMAL(6,4) NOT NULL,
    "irpp_t1_ceiling" DECIMAL(12,2) NOT NULL,
    "irpp_t1_pct" DECIMAL(6,4) NOT NULL,
    "irpp_t2_ceiling" DECIMAL(12,2) NOT NULL,
    "irpp_t2_pct" DECIMAL(6,4) NOT NULL,
    "irpp_t3_ceiling" DECIMAL(12,2) NOT NULL,
    "irpp_t3_pct" DECIMAL(6,4) NOT NULL,
    "irpp_t4_pct" DECIMAL(6,4) NOT NULL,
    "tc_rav_seuil1" DECIMAL(12,2) NOT NULL,
    "tc1" DECIMAL(12,2) NOT NULL,
    "rav1" DECIMAL(12,2) NOT NULL,
    "tc_rav_seuil2" DECIMAL(12,2) NOT NULL,
    "tc2" DECIMAL(12,2) NOT NULL,
    "rav2" DECIMAL(12,2) NOT NULL,
    "tc3" DECIMAL(12,2) NOT NULL,
    "rav3" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_rate_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_rate_sets_active_effective_from_idx" ON "payroll_rate_sets"("active", "effective_from");

