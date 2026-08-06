-- Évaluation annuelle des collaborateurs (note, points forts, axes, objectifs).
CREATE TABLE "employee_evaluations" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "rating" INTEGER NOT NULL,
  "strengths" TEXT,
  "areas_to_improve" TEXT,
  "objectives" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_evaluations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_evaluations_employee_id_year_key" ON "employee_evaluations"("employee_id", "year");
ALTER TABLE "employee_evaluations" ADD CONSTRAINT "employee_evaluations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
