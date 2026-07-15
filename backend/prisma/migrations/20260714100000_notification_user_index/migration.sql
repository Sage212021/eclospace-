-- Index de performance pour la cloche de notifications (lecture « mes
-- notifications / non-lues » à chaque page ; le Babillard crée une notification
-- par destinataire). Additif, aucune donnée modifiée.
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
