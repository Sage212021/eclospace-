-- Référence officielle séquentielle des absences/permissions (ex. PERM-2026-00045).
ALTER TABLE "absences" ADD COLUMN "reference" TEXT;
CREATE UNIQUE INDEX "absences_reference_key" ON "absences"("reference");

-- Compteur : une séquence par (préfixe de type, année). Clé « PERM-2026 ».
CREATE TABLE "absence_reference_counters" (
  "key" TEXT NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "absence_reference_counters_pkey" PRIMARY KEY ("key")
);
