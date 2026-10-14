-- Avance (acompte) et solde à régler sur une facture (demande responsable Finance) :
-- à l'établissement, la Finance peut saisir une AVANCE déjà versée ; la facture
-- imprime « Avance : … » et « Solde à régler : … » (Total − avance). L'avance est
-- enregistrée comme un encaissement réel (paiement + lettrage), donc le reste à
-- payer et les créances restent justes.
ALTER TABLE "invoices" ADD COLUMN "advance_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "advance_label" TEXT;
-- Mode de paiement de l'avance (code payment_methods.code) : conservé pour pouvoir
-- enregistrer l'encaissement au moment de la validation d'une facture au-dessus du
-- seuil (l'avance n'est encaissée qu'une fois la facture émise).
ALTER TABLE "invoices" ADD COLUMN "advance_method" TEXT;
