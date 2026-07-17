import { useEffect, useState } from "react";
import { getSitePublication, publishToSite, type SitePublicationView } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { useI18n } from "../i18n";

// Fiche d'ouvrage → « Site vitrine » : publier l'ouvrage sur la boutique
// WordPress (produit rangé dans la catégorie de son genre). Tant que le site
// n'est pas branché (config d'hébergement), l'action montre l'APERÇU de ce qui
// sera envoyé, sans rien publier.
export function SitePublicationSection({ manuscriptId, canPublish }: { manuscriptId: string; canPublish: boolean }) {
  const { t } = useI18n();
  const [view, setView] = useState<SitePublicationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setView(await getSitePublication(manuscriptId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function publish() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await publishToSite(manuscriptId);
      if (r.ok) {
        setMessage(t("sitepub.msg_published", "Ouvrage publié sur le site."));
      } else {
        setMessage(
          t(
            "sitepub.msg_preview",
            "Site non encore branché : voici l'aperçu de ce qui sera envoyé. La publication réelle se fera une fois les accès configurés.",
          ),
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publication impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <Card title={t("sitepub.title", "Site vitrine")}>
        {error ? <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div> : <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("sitepub.loading", "Chargement…")}</p>}
      </Card>
    );
  }

  const p = view.payload;
  const statusChip = () => {
    const map: Record<string, { label: string; color: string }> = {
      publie: { label: t("sitepub.st_published", "Publié sur le site"), color: "var(--success)" },
      erreur: { label: t("sitepub.st_error", "Erreur"), color: "var(--alert)" },
      non_publie: { label: t("sitepub.st_none", "Non publié"), color: "var(--muted)" },
    };
    const s = map[view.status] ?? map.non_publie;
    return <span style={{ fontSize: 11, fontWeight: 700, color: s.color, border: `1px solid ${s.color}`, borderRadius: 999, padding: "1px 9px" }}>{s.label}</span>;
  };

  return (
    <Card
      title={t("sitepub.title", "Site vitrine")}
      subtitle={t("sitepub.subtitle", "Publier cet ouvrage sur la boutique du site, rangé dans la catégorie de son genre.")}
      action={statusChip()}
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={banner("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {!view.configured && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>
          {t("sitepub.not_configured", "La connexion au site n'est pas encore activée : l'action affiche l'aperçu du produit. Le branchement réel se fera au déploiement.")}
        </div>
      )}

      {/* Aperçu du produit qui sera envoyé */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 13 }}>
        <Row label={t("sitepub.f_name", "Nom")} value={p.name} />
        <Row label={t("sitepub.f_author", "Auteur")} value={p.author} />
        <Row label={t("sitepub.f_category", "Catégorie (genre)")} value={p.category} />
        <Row label={t("sitepub.f_price", "Prix")} value={p.price != null ? `${p.price.toLocaleString("fr-FR")} ${p.currency}` : null} mono />
        <Row label={t("sitepub.f_sku", "ISBN")} value={p.sku} mono />
      </div>
      {p.description && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
          <strong>{t("sitepub.f_desc", "Description :")}</strong> {p.description}
        </div>
      )}

      {view.missing.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "#C4661F" }}>
          {t("sitepub.missing", "À compléter avant publication :")} {view.missing.join(", ")}
        </div>
      )}

      {view.external_url && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <a href={view.external_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--eclosion-dark)" }}>
            {t("sitepub.view_online", "Voir la fiche sur le site ↗")}
          </a>
        </div>
      )}

      {canPublish && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <Button variant="add" size="sm" onClick={publish} disabled={busy}>
            {view.status === "publie" ? t("sitepub.update", "Mettre à jour sur le site") : t("sitepub.publish", "Publier sur le site")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ color: value ? "var(--ink)" : "var(--muted)", fontFamily: mono ? "var(--font-mono)" : undefined, marginTop: 2 }}>{value ?? "—"}</div>
    </div>
  );
}

function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 10 };
}
