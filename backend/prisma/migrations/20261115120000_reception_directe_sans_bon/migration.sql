-- D-061 : réception DIRECTE sans bon de commande (ouvrage déjà paru / importé).
-- Le bon de commande devient optionnel sur une réception, et une réception peut
-- être rattachée directement à l'ouvrage (manuscrit). La procédure réception →
-- contrôle qualité → entrée en stock reste identique.

-- 1) Le bon de commande n'est plus obligatoire.
ALTER TABLE "goods_receipts" ALTER COLUMN "po_id" DROP NOT NULL;

-- 2) Rattachement direct à l'ouvrage (pour une réception sans bon de commande).
ALTER TABLE "goods_receipts" ADD COLUMN "manuscript_id" TEXT;

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_manuscript_id_fkey"
  FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Intégrité : une réception a TOUJOURS un rattachement — soit un bon de
--    commande, soit un ouvrage (jamais les deux à null).
ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_po_or_manuscript"
  CHECK ("po_id" IS NOT NULL OR "manuscript_id" IS NOT NULL);
