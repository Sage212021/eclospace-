-- AlterEnum (isolé : les ajouts de valeurs d'enum ne se mélangent pas au reste)
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'proforma';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'pending_validation';
