-- Canal de la conversation SAGE : null = conversation libre du DG ;
-- "sage_direction" = le fil où SAGE écrit de lui-même au DG (points, alertes).
ALTER TABLE "ai_conversations" ADD COLUMN "kind" TEXT;
