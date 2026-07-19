import { useEffect, useState } from "react";
import { getSitePublication, setSitePublished, siteCoverDownloadUrl, type SiteFicheView } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { useI18n } from "../i18n";

// Fiche d'ouvrage → « Fiche pour le site » : le site étant sur-mesure (sans API
// de publication automatique), l'ERP prépare une fiche prête à copier/coller
// que le maquettiste ajoute au site. L'ERP garde la trace de ce qui est publié.
export function SitePublicationSection({ manuscriptId, canPublish }: { manuscriptId: string; canPublish: boolean }) {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const [view, setView] = useState<SiteFicheView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const v = await getSitePublication(manuscriptId);
      setView(v);
      setUrl(v.external_url ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function copyFiche() {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.fiche);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(t("sitepub.copy_failed", "Copie impossible — sélectionnez le texte et copiez-le manuellement."));
    }
  }

  async function mark(published: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await setSitePublished(manuscriptId, published, url.trim() || undefined);
      setMessage(published ? t("sitepub.msg_marked", "Marqué comme publié sur le site.") : t("sitepub.msg_unmarked", "Retiré des ouvrages publiés."));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <Card title={t("sitepub.title", "Fiche pour le site")}>
        {error ? <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div> : <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("sitepub.loading", "Chargement…")}</p>}
      </Card>
    );
  }

  const published = view.status === "publie";
  const statusChip = (
    <span style={{ fontSize: 11, fontWeight: 700, color: published ? "var(--success)" : "var(--muted)", border: `1px solid ${published ? "var(--success)" : "var(--line)"}`, borderRadius: 999, padding: "1px 9px", whiteSpace: "nowrap" }}>
      {published ? t("sitepub.st_published", "Publié sur le site") : t("sitepub.st_none", "Non publié")}
    </span>
  );

  return (
    <Card
      title={t("sitepub.title", "Fiche pour le site")}
      subtitle={t("sitepub.subtitle", "Fiche prête à copier pour la page catalogue du site, rangée par genre.")}
      action={statusChip}
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={banner("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>
        {t("sitepub.howto", "Copiez cette fiche et collez-la sur le site, dans la catégorie du genre. N'oubliez pas d'y joindre la couverture de l'ouvrage.")}
      </div>

      {/* Fiche prête à copier */}
      <pre
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: "12px 14px",
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "inherit",
          margin: 0,
          color: "var(--ink)",
        }}
      >
        {view.fiche}
      </pre>

      {/* Couverture associée */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 12, flexWrap: "wrap" }}>
        {view.cover.available && view.cover.is_image ? (
          <>
            <img
              src={siteCoverDownloadUrl(manuscriptId)}
              alt={t("sitepub.cover", "Couverture")}
              style={{ width: 84, height: "auto", borderRadius: 6, border: "1px solid var(--line)", boxShadow: "0 1px 4px rgba(16,35,61,.12)" }}
            />
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("sitepub.cover", "Couverture")}</div>
              <a
                href={siteCoverDownloadUrl(manuscriptId)}
                download
                style={{ fontSize: 13, color: "var(--eclosion-dark)", fontWeight: 600 }}
              >
                {t("sitepub.cover_download", "⬇ Télécharger la couverture (image web légère)")}
              </a>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                {t("sitepub.cover_hint", "Fichier léger, JPG de très bonne qualité, au format portrait du site — prêt à publier.")}
              </div>
            </div>
          </>
        ) : view.cover.available ? (
          <div style={{ fontSize: 12.5, color: "#C4661F" }}>
            {t("sitepub.cover_notimage", "La couverture déposée n'est pas une image (JPG/PNG) — déposez une image pour pouvoir la joindre à la fiche.")}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "#C4661F" }}>
            {t("sitepub.cover_missing", "Aucune couverture (1re) déposée pour cet ouvrage — déposez-la dans les Visuels / Pièces jointes.")}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <Button variant="add" size="sm" onClick={copyFiche}>
          {copied ? t("sitepub.copied", "✓ Copié") : t("sitepub.copy", "Copier la fiche")}
        </Button>
      </div>

      {view.missing.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "#C4661F" }}>
          {t("sitepub.missing", "À compléter dans l'ERP avant publication :")} {view.missing.join(", ")}
        </div>
      )}

      {/* Suivi : marquer publié + lien de la fiche en ligne */}
      {canPublish && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
            {t("sitepub.track", "Une fois la fiche mise sur le site, marquez-la comme publiée (et collez son lien, facultatif) :")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("sitepub.url_ph", "Lien de la fiche sur le site (facultatif)")}
              style={{ flex: 1, minWidth: 220, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 }}
            />
            {published ? (
              <Button variant="view" size="sm" onClick={() => mark(false)} disabled={busy}>{t("sitepub.unmark", "Retirer")}</Button>
            ) : (
              <Button variant="add" size="sm" onClick={() => mark(true)} disabled={busy}>{t("sitepub.mark", "Marquer comme publié")}</Button>
            )}
          </div>
          {published && view.external_url && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <a href={view.external_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--eclosion-dark)" }}>{t("sitepub.view_online", "Voir la fiche sur le site ↗")}</a>
              {view.published_at && <span style={{ color: "var(--muted)" }}> · {new Date(view.published_at).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}</span>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 10 };
}
