-- AlterTable
ALTER TABLE "bat_records" ADD COLUMN     "checklist_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bat_records_checklist_id_key" ON "bat_records"("checklist_id");

-- AddForeignKey
ALTER TABLE "bat_records" ADD CONSTRAINT "bat_records_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

