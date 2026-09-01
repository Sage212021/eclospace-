import { useEffect, useState } from "react";
import {
  ackAnnouncement,
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  getAnnouncementReceipts,
  getAnnouncementTargetOptions,
  listAnnouncementCategories,
  listAnnouncementFeed,
  listAnnouncementsManage,
  publishAnnouncement,
  remindAnnouncement,
  setNotificationPreferences,
  updateAnnouncement,
  type AnnouncementCategory,
  type AnnouncementDetail,
  type AnnouncementFeedItem,
  type AnnouncementManageItem,
  type AnnouncementPriority,
  type AnnouncementReceiptsReport,
  type AnnouncementTargetType,
  type NotificationPreferences,
  type TargetOptions,
} from "../api/client";
import { Card } from "../components/Card";
import { GuidanceNote } from "../components/GuidanceNote";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { getPushState, enablePush, disablePush, type PushState } from "../lib/pushClient";
import { RichTextEditor } from "../components/RichTextEditor";
import { IconPilotage } from "../components/icons";
import { useI18n } from "../i18n";
import { useConfirm } from "../components/ConfirmProvider";

const PRIORITY_COLORS: Record<AnnouncementPriority, string> = {
  normale: "var(--muted)",
  importante: "var(--eclosion)",
  urgente: "#C4661F",
  critique: "var(--alert)",
};

interface AnnouncementsPageProps {
  canPublish: boolean;
  canAdminister: boolean;
  // Ouverture directe d'une annonce (depuis la cloche de notifications).
  openAnnouncementId?: string | null;
  onOpened?: () => void;
  // Préférences de notification (partagées avec App pour le temps réel).
  prefs?: NotificationPreferences | null;
  onPrefsChange?: (p: NotificationPreferences) => void;
}

interface TargetRow {
  type: AnnouncementTargetType;
  id: string;
}

interface FormState {
  id?: string;
  title: string;
  bodyHtml: string;
  categoryCode: string;
  priority: AnnouncementPriority;
  requireAck: boolean;
  pinned: boolean;
  expiresAt: string;
  targets: TargetRow[];
}

const EMPTY_FORM: FormState = {
  title: "",
  bodyHtml: "",
  categoryCode: "",
  priority: "normale",
  requireAck: false,
  pinned: false,
  expiresAt: "",
  targets: [{ type: "tous", id: "" }],
};

// Centre de Communication Interne — Babillard d'annonces (module « communication »).
export function AnnouncementsPage({ canPublish, canAdminister, openAnnouncementId, onOpened, prefs, onPrefsChange }: AnnouncementsPageProps) {
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<AnnouncementCategory[]>([]);
  const [feed, setFeed] = useState<AnnouncementFeedItem[]>([]);
  const [manage, setManage] = useState<AnnouncementManageItem[]>([]);
  const [filters, setFilters] = useState<{ unread: boolean; category: string; priority: string }>({ unread: false, category: "", priority: "" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [detail, setDetail] = useState<AnnouncementDetail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [options, setOptions] = useState<TargetOptions | null>(null);
  const [receipts, setReceipts] = useState<{ id: string; report: AnnouncementReceiptsReport } | null>(null);

  const priorityLabel = (p: AnnouncementPriority) => t(`cm.prio.${p}`, { normale: "Normale", importante: "Importante", urgente: "Urgente", critique: "Critique" }[p]);
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR") : "—");

  async function refreshFeed() {
    const list = await listAnnouncementFeed({
      unread: filters.unread || undefined,
      category: filters.category || undefined,
      priority: (filters.priority as AnnouncementPriority) || undefined,
    });
    setFeed(list);
  }

  async function refreshManage() {
    if (!canPublish) return;
    setManage(await listAnnouncementsManage());
  }

  useEffect(() => {
    listAnnouncementCategories().then(setCategories).catch(() => {});
    refreshManage().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshFeed().catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Ouverture demandée depuis la cloche : affiche le détail puis acquitte.
  useEffect(() => {
    if (!openAnnouncementId) return;
    openDetail(openAnnouncementId).finally(() => onOpened?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAnnouncementId]);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  async function openDetail(id: string) {
    try {
      setDetail(await getAnnouncement(id));
      await refreshFeed();
    } catch (err) {
      fail(err, "Ouverture impossible.");
    }
  }

  async function doAck(id: string) {
    try {
      await ackAnnouncement(id);
      setDetail(await getAnnouncement(id));
      setMessage(t("cm.msg.ack", "Accusé de réception enregistré."));
    } catch (err) {
      fail(err, "Échec de l'accusé de réception.");
    }
  }

  async function openForm(existing?: AnnouncementManageItem) {
    try {
      if (!options) setOptions(await getAnnouncementTargetOptions());
    } catch (err) {
      fail(err, "Chargement des cibles impossible.");
    }
    if (existing) {
      // On recharge le détail pour récupérer les cibles enregistrées.
      const d = await getAnnouncement(existing.id);
      setForm({
        id: existing.id,
        title: d.title,
        bodyHtml: d.body_html,
        categoryCode: d.category?.code ?? "",
        priority: d.priority,
        requireAck: d.require_ack,
        pinned: d.pinned,
        expiresAt: d.expires_at ? d.expires_at.slice(0, 10) : "",
        targets: (d.targets ?? [{ type: "tous", id: null }]).map((x) => ({ type: x.type, id: x.id ?? "" })),
      });
    } else {
      setForm({ ...EMPTY_FORM, targets: [{ type: "tous", id: "" }] });
    }
  }

  async function submitForm() {
    if (!form || !form.title.trim() || !form.bodyHtml.trim()) return;
    const targets = form.targets
      .filter((row) => row.type === "tous" || row.id)
      .map((row) => (row.type === "tous" ? { type: "tous" as const } : { type: row.type, id: row.id }));
    if (targets.length === 0) {
      setError(t("cm.err.no_target", "Ajoutez au moins une cible."));
      return;
    }
    const payload = {
      title: form.title.trim(),
      body_html: form.bodyHtml,
      category_code: form.categoryCode || null,
      priority: form.priority,
      require_ack: form.requireAck,
      pinned: form.pinned,
      expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      targets,
    };
    try {
      if (form.id) {
        await updateAnnouncement(form.id, payload);
        setMessage(t("cm.msg.saved", "Annonce enregistrée."));
      } else {
        await createAnnouncement(payload);
        setMessage(t("cm.msg.created", "Brouillon créé. Publiez-le pour le diffuser."));
      }
      setForm(null);
      await refreshManage();
    } catch (err) {
      fail(err, "Enregistrement impossible.");
    }
  }

  async function doPublish(id: string) {
    try {
      const r = await publishAnnouncement(id);
      setMessage(
        lang === "en" ? `Announcement published to ${r.recipients} recipient(s).` : `Annonce publiée à ${r.recipients} destinataire(s).`,
      );
      await Promise.all([refreshManage(), refreshFeed()]);
    } catch (err) {
      fail(err, "Publication impossible.");
    }
  }

  async function doArchive(id: string) {
    try {
      await archiveAnnouncement(id);
      setMessage(t("cm.msg.archived", "Annonce archivée."));
      await Promise.all([refreshManage(), refreshFeed()]);
    } catch (err) {
      fail(err, "Archivage impossible.");
    }
  }

  async function doDelete(id: string) {
    const ok = await confirm({
      title: t("cm.delete_title", "Supprimer l'annonce"),
      message: t("cm.delete_confirm", "Supprimer cette annonce du babillard ?"),
      tone: "danger",
      confirmLabel: t("cm.delete", "Supprimer"),
    });
    if (!ok) return;
    try {
      await deleteAnnouncement(id);
      setMessage(t("cm.msg.deleted", "Annonce supprimée."));
      await Promise.all([refreshManage(), refreshFeed()]);
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  async function openReceipts(id: string) {
    try {
      setReceipts({ id, report: await getAnnouncementReceipts(id) });
    } catch (err) {
      fail(err, "Suivi indisponible.");
    }
  }

  async function doRemind(id: string) {
    try {
      const r = await remindAnnouncement(id);
      setMessage(
        lang === "en" ? `Reminder sent to ${r.reminded} person(s).` : `Relance envoyée à ${r.reminded} personne(s).`,
      );
      // Rafraîchit le suivi (les compteurs ne changent pas, mais on garde l'état à jour).
      setReceipts({ id, report: await getAnnouncementReceipts(id) });
    } catch (err) {
      fail(err, "Relance impossible.");
    }
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("page.communication.title", "Communication interne")}</h1>
      <p className="ecl-page__lead">{t("page.communication.lead", "Babillard d'annonces : informations officielles diffusées au personnel.")}</p>

      <GuidanceNote title="Babillard d'annonces">
        Les informations officielles diffusées au personnel. Les profils habilités y publient des annonces (ciblées par
        pôle si besoin) ; chacun les consulte ici et en est notifié.
      </GuidanceNote>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {/* Fil personnel des annonces */}
      <Card
        title={t("cm.feed", "Mes annonces")}
        icon={<IconPilotage />}
        subtitle={t("cm.feed_sub", "Les annonces qui vous sont adressées.")}
        action={
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
              <input type="checkbox" checked={filters.unread} onChange={(e) => setFilters({ ...filters, unread: e.target.checked })} />
              {t("cm.unread_only", "Non lues")}
            </label>
            <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} style={{ fontSize: 12 }}>
              <option value="">{t("cm.all_categories", "Toutes catégories")}</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>{t(`cm.cat.${c.code}`, c.label)}</option>
              ))}
            </select>
            <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} style={{ fontSize: 12 }}>
              <option value="">{t("cm.all_priorities", "Toutes priorités")}</option>
              {(["normale", "importante", "urgente", "critique"] as AnnouncementPriority[]).map((p) => (
                <option key={p} value={p}>{priorityLabel(p)}</option>
              ))}
            </select>
          </div>
        }
      >
        {feed.length === 0 ? (
          <Empty>{t("cm.no_announcement", "Aucune annonce.")}</Empty>
        ) : (
          <div className="ecl-list">
            {feed.map((a) => (
              <button
                key={a.id}
                onClick={() => openDetail(a.id)}
                className="ecl-row"
                style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", padding: "10px 4px" }}
              >
                <div className="ecl-row__main" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {!a.read_at && <span title={t("cm.unread", "Non lue")} style={{ width: 8, height: 8, borderRadius: 999, background: "var(--eclosion)", display: "inline-block" }} />}
                    {a.pinned && <span title={t("cm.pinned", "Épinglée")}>📌</span>}
                    <span className="ecl-row__title" style={{ fontWeight: a.read_at ? 500 : 700 }}>{a.title}</span>
                    <PriorityChip priority={a.priority} label={priorityLabel(a.priority)} />
                    {a.category && <span style={{ fontSize: 11, color: "var(--muted)" }}>{t(`cm.cat.${a.category.code}`, a.category.label)}</span>}
                    {a.require_ack && !a.acknowledged_at && <span style={{ fontSize: 11, color: "var(--alert)" }}>{t("cm.ack_required", "Accusé requis")}</span>}
                  </div>
                  <div className="ecl-row__desc" style={{ margin: 0 }}>{a.preview}</div>
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{fmtDate(a.published_at)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Préférences de notification */}
      <NotificationPrefsCard categories={categories} prefs={prefs ?? null} onSaved={(p) => { onPrefsChange?.(p); setMessage(t("cm.prefs_saved", "Préférences enregistrées.")); }} onError={setError} />

      {/* Gestion des annonces (publieurs) */}
      {canPublish && (
        <Card
          title={t("cm.manage", "Gérer les annonces")}
          icon={<IconPilotage />}
          subtitle={t("cm.manage_sub", "Rédigez, publiez et suivez la lecture de vos annonces.")}
          action={<Button variant="add" size="sm" onClick={() => openForm()}>{t("cm.new", "+ Nouvelle annonce")}</Button>}
        >
          {manage.length === 0 ? (
            <Empty>{t("cm.none_yet", "Aucune annonce pour l'instant.")}</Empty>
          ) : (
            <div className="ecl-list">
              {manage.map((a) => (
                <div key={a.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {a.pinned && <span>📌</span>}
                    <span className="ecl-row__title">{a.title}</span>
                    <PriorityChip priority={a.priority} label={priorityLabel(a.priority)} />
                    <StatusChip label={t(`cm.status.${a.status}`, { brouillon: "Brouillon", publiee: "Publiée", archivee: "Archivée" }[a.status])} />
                    {a.status === "publiee" && (
                      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                        {a.read}/{a.recipients} {t("cm.read_count", "lues")}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <Button variant="view" size="sm" onClick={() => openDetail(a.id)}>{t("cm.view", "Voir")}</Button>
                    {a.status !== "archivee" && <Button variant="edit" size="sm" onClick={() => openForm(a)}>{t("cm.edit", "Modifier")}</Button>}
                    {a.status === "brouillon" && <Button variant="add" size="sm" onClick={() => doPublish(a.id)}>{t("cm.publish", "Publier")}</Button>}
                    {a.status === "publiee" && <Button variant="view" size="sm" onClick={() => openReceipts(a.id)}>{t("cm.tracking", "Suivi")}</Button>}
                    {a.status !== "archivee" && <Button variant="view" size="sm" onClick={() => doArchive(a.id)}>{t("cm.archive", "Archiver")}</Button>}
                    {(canAdminister || a.status === "brouillon") && <Button variant="danger" size="sm" onClick={() => doDelete(a.id)}>{t("cm.delete", "Supprimer")}</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Détail d'une annonce */}
      {detail && (
        <Modal title={detail.title} wide onClose={() => setDetail(null)} footer={<Button variant="view" size="sm" onClick={() => setDetail(null)}>{t("cm.close", "Fermer")}</Button>}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <PriorityChip priority={detail.priority} label={priorityLabel(detail.priority)} />
            {detail.category && <span style={{ fontSize: 12, color: "var(--muted)" }}>{t(`cm.cat.${detail.category.code}`, detail.category.label)}</span>}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {detail.author ? detail.author.username : "—"} · {fmtDate(detail.published_at)}
            </span>
          </div>
          {/* Contenu assaini côté serveur (liste blanche) : rendu sûr. */}
          <div className="ecl-rich" style={{ fontSize: 14, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: detail.body_html }} />
          {detail.require_ack && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              {detail.acknowledged_at ? (
                <span style={{ fontSize: 13, color: "var(--eclosion-dark)" }}>✓ {t("cm.acknowledged", "Réception accusée le")} {fmtDate(detail.acknowledged_at)}</span>
              ) : (
                <Button variant="add" size="sm" onClick={() => doAck(detail.id)}>{t("cm.ack", "Accuser réception")}</Button>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* Formulaire de création / édition */}
      {form && (
        <Modal
          title={form.id ? t("cm.edit_title", "Modifier l'annonce") : t("cm.new_title", "Nouvelle annonce")}
          wide
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setForm(null)}>{t("cm.cancel", "Annuler")}</Button>
              <Button variant="add" size="sm" onClick={submitForm} disabled={!form.title.trim() || !form.bodyHtml.trim()}>
                {form.id ? t("cm.save", "Enregistrer") : t("cm.create", "Créer le brouillon")}
              </Button>
            </>
          }
        >
          <Field label={t("cm.title", "Titre")}>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
          </Field>
          <Field label={t("cm.content", "Contenu")}>
            <RichTextEditor value={form.bodyHtml} onChange={(html) => setForm({ ...form, bodyHtml: html })} placeholder={t("cm.content_ph", "Rédigez votre annonce…")} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Field label={t("cm.category", "Catégorie")}>
              <select value={form.categoryCode} onChange={(e) => setForm({ ...form, categoryCode: e.target.value })}>
                <option value="">{t("cm.no_category", "— Aucune —")}</option>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>{t(`cm.cat.${c.code}`, c.label)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("cm.priority", "Priorité")}>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as AnnouncementPriority })}>
                {(["normale", "importante", "urgente", "critique"] as AnnouncementPriority[]).map((p) => (
                  <option key={p} value={p}>{priorityLabel(p)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("cm.expires", "Expire le (facultatif)")}>
              <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "6px 0 10px", fontSize: 13 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={form.requireAck} onChange={(e) => setForm({ ...form, requireAck: e.target.checked })} />
              {t("cm.require_ack", "Lecture obligatoire (accusé de réception)")}
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
              {t("cm.pin", "Épingler en tête")}
            </label>
          </div>

          {/* Ciblage */}
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("cm.targets", "Destinataires")}</div>
            {form.targets.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={row.type}
                  onChange={(e) => {
                    const type = e.target.value as AnnouncementTargetType;
                    setForm({ ...form, targets: form.targets.map((r, idx) => (idx === i ? { type, id: "" } : r)) });
                  }}
                >
                  <option value="tous">{t("cm.tgt.tous", "Tout le personnel")}</option>
                  <option value="departement">{t("cm.tgt.departement", "Département")}</option>
                  <option value="role">{t("cm.tgt.role", "Profil (rôle)")}</option>
                  <option value="utilisateur">{t("cm.tgt.utilisateur", "Employé précis")}</option>
                </select>
                {row.type !== "tous" && (
                  <select value={row.id} onChange={(e) => setForm({ ...form, targets: form.targets.map((r, idx) => (idx === i ? { ...r, id: e.target.value } : r)) })} style={{ flex: 1, minWidth: 180 }}>
                    <option value="">{t("cm.select", "— sélectionner —")}</option>
                    {row.type === "departement" && options?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    {row.type === "role" && options?.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    {row.type === "utilisateur" && options?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  disabled={form.targets.length === 1}
                  onClick={() => setForm({ ...form, targets: form.targets.filter((_, idx) => idx !== i) })}
                  style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", padding: "6px 8px" }}
                >
                  ✕
                </button>
              </div>
            ))}
            <Button variant="subtle" size="sm" onClick={() => setForm({ ...form, targets: [...form.targets, { type: "departement", id: "" }] })}>
              {t("cm.add_target", "+ Ajouter une cible")}
            </Button>
          </div>
        </Modal>
      )}

      {/* Suivi de lecture */}
      {receipts && (
        <Modal
          title={t("cm.tracking_title", "Suivi de lecture")}
          wide
          onClose={() => setReceipts(null)}
          footer={
            <>
              {(() => {
                const pending = receipts.report.require_ack
                  ? receipts.report.total - receipts.report.acknowledged
                  : receipts.report.total - receipts.report.read;
                return pending > 0 ? (
                  <Button variant="edit" size="sm" onClick={() => doRemind(receipts.id)}>
                    {t("cm.remind", "Relancer les non-lecteurs")} ({pending})
                  </Button>
                ) : null;
              })()}
              <Button variant="view" size="sm" onClick={() => setReceipts(null)}>{t("cm.close", "Fermer")}</Button>
            </>
          }
        >
          <div style={{ display: "flex", gap: 18, fontSize: 13, marginBottom: 10, flexWrap: "wrap" }}>
            <span>{t("cm.recipients", "Destinataires")} : <strong style={{ fontFamily: "var(--font-mono)" }}>{receipts.report.total}</strong></span>
            <span style={{ color: "var(--eclosion-dark)" }}>{t("cm.read", "Lues")} : <strong style={{ fontFamily: "var(--font-mono)" }}>{receipts.report.read}</strong></span>
            {receipts.report.require_ack && <span>{t("cm.acked", "Accusées")} : <strong style={{ fontFamily: "var(--font-mono)" }}>{receipts.report.acknowledged}</strong></span>}
          </div>
          <div className="ecl-list">
            {receipts.report.rows.map((r) => (
              <div key={r.user_id} className="ecl-row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 13 }}>{r.name}</span>
                <span style={{ fontSize: 12, color: r.read_at ? "var(--eclosion-dark)" : "var(--muted)" }}>
                  {r.read_at ? `${t("cm.read_on", "Lue le")} ${fmtDate(r.read_at)}` : t("cm.not_read", "Non lue")}
                  {receipts.report.require_ack && r.acknowledged_at ? ` · ✓` : ""}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// Activation des notifications « push » sur CET appareil (téléphone) : alerte
// même application fermée. Bouton simple, avec message clair selon l'état
// (non compatible, refusé dans les réglages du téléphone, activé, désactivé).
function DevicePushControl() {
  const { t } = useI18n();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getPushState().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  if (state === null || state === "not_configured") return null; // service non activé sur le serveur → on masque.

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      setState(on ? await enablePush() : await disablePush());
    } finally {
      setBusy(false);
    }
  }

  const line: React.CSSProperties = { marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 };
  if (state === "unsupported") {
    return (
      <div style={line}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t("cm.push_title", "Notifications sur cet appareil")}</div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>
          {t("cm.push_unsupported", "Ce navigateur ne gère pas les notifications sur l'appareil. Sur iPhone, installez d'abord Eclospace sur l'écran d'accueil (Partager → Sur l'écran d'accueil).")}
        </p>
      </div>
    );
  }
  return (
    <div style={line}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t("cm.push_title", "Notifications sur cet appareil")}</div>
        {state === "enabled" ? (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => toggle(false)}>
            {busy ? "…" : t("cm.push_disable", "Désactiver sur ce téléphone")}
          </Button>
        ) : (
          <Button variant="add" size="sm" disabled={busy || state === "denied"} onClick={() => toggle(true)}>
            {busy ? "…" : t("cm.push_enable", "🔔 Activer sur ce téléphone")}
          </Button>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>
        {state === "enabled"
          ? t("cm.push_on", "Vous recevrez les alertes qui vous concernent même l'application fermée. La sonnerie suit votre réglage ci-dessus.")
          : state === "denied"
            ? t("cm.push_denied", "Les notifications sont bloquées dans les réglages du téléphone pour Eclospace. Autorisez-les dans les réglages du navigateur, puis réessayez.")
            : t("cm.push_off", "Activez pour être averti (bandeau + son) sur ce téléphone même quand l'application est fermée.")}
      </p>
    </div>
  );
}

// Préférences de notification par utilisateur (sonnerie, volume, visuel,
// e-mail, catégories). Une case « toutes les catégories » (categories = null) ;
// décochée, l'utilisateur choisit finement celles qui le notifient.
function NotificationPrefsCard({
  categories,
  prefs,
  onSaved,
  onError,
}: {
  categories: AnnouncementCategory[];
  prefs: NotificationPreferences | null;
  onSaved: (p: NotificationPreferences) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<NotificationPreferences | null>(prefs);
  useEffect(() => {
    setDraft(prefs);
  }, [prefs]);

  if (!draft) return null;

  const allCats = draft.categories === null;
  const selected = new Set(draft.categories ?? []);

  async function save(next: NotificationPreferences) {
    setDraft(next);
    try {
      await setNotificationPreferences(next);
      onSaved(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  function toggleCat(code: string, on: boolean) {
    const set = new Set(selected);
    if (on) set.add(code);
    else set.delete(code);
    // Toutes cochées → on repasse à « toutes » (null).
    const next = set.size === categories.length ? null : [...set];
    void save({ ...draft!, categories: next });
  }

  const chk: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13 };

  return (
    <Card title={t("cm.prefs", "Mes préférences de notification")} icon={<IconPilotage />} subtitle={t("cm.prefs_sub", "Réglez comment vous êtes averti des annonces.")}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <label style={chk}>
          <input type="checkbox" checked={draft.sound_enabled} onChange={(e) => save({ ...draft, sound_enabled: e.target.checked })} />
          {t("cm.pref_sound", "Sonnerie")}
        </label>
        <label style={{ ...chk, opacity: draft.sound_enabled ? 1 : 0.5 }}>
          {t("cm.pref_volume", "Volume")}
          <input
            type="range"
            min={0}
            max={100}
            value={draft.sound_volume}
            disabled={!draft.sound_enabled}
            onChange={(e) => setDraft({ ...draft, sound_volume: Number(e.target.value) })}
            onMouseUp={(e) => save({ ...draft, sound_volume: Number((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => save({ ...draft, sound_volume: Number((e.target as HTMLInputElement).value) })}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, width: 30 }}>{draft.sound_volume}</span>
        </label>
        <label style={chk}>
          <input type="checkbox" checked={draft.visual_enabled} onChange={(e) => save({ ...draft, visual_enabled: e.target.checked })} />
          {t("cm.pref_visual", "Pop-up visuel")}
        </label>
        <label style={chk}>
          <input type="checkbox" checked={draft.email_enabled} onChange={(e) => save({ ...draft, email_enabled: e.target.checked })} />
          {t("cm.pref_email", "E-mail")}
        </label>
      </div>

      <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <label style={chk}>
          <input type="checkbox" checked={allCats} onChange={(e) => save({ ...draft, categories: e.target.checked ? null : [] })} />
          {t("cm.pref_all_cats", "M'avertir pour toutes les catégories")}
        </label>
        {!allCats && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
            {categories.map((c) => (
              <label key={c.code} style={{ ...chk, fontSize: 12.5 }}>
                <input type="checkbox" checked={selected.has(c.code)} onChange={(e) => toggleCat(c.code, e.target.checked)} />
                {t(`cm.cat.${c.code}`, c.label)}
              </label>
            ))}
          </div>
        )}
      </div>
      <DevicePushControl />
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>
        {t("cm.pref_sound_note", "La sonnerie ne peut retentir qu'après une première action de votre part sur la page (règle des navigateurs).")}
      </p>
    </Card>
  );
}

function PriorityChip({ priority, label }: { priority: AnnouncementPriority; label: string }) {
  const color = PRIORITY_COLORS[priority];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 999, padding: "1px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{children}</p>;
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
