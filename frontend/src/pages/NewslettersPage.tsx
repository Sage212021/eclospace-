import { useEffect, useState } from "react";
import {
  createNewsletter,
  deleteNewsletter,
  getNewsletter,
  listNewsletters,
  previewNewsletter,
  sendNewsletter,
  updateNewsletter,
  type NewsletterDetail,
  type NewsletterItem,
  type NewsletterSummary,
} from "../api/client";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { useI18n } from "../i18n";

interface NewslettersPageProps {
  canManage: boolean;
}

interface FormState {
  id?: string;
  title: string;
  intro: string;
  periodStart: string; // AAAA-MM-JJ
  periodEnd: string;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Bulletin d'actualités : composer un digest périodique (annonces + événements
// de portée « maison »), le prévisualiser, l'envoyer par e-mail à tout le
// personnel, puis consulter les bulletins déjà envoyés.
export function NewslettersPage({ canManage }: NewslettersPageProps) {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "fr-FR";

  const [rows, setRows] = useState<NewsletterSummary[]>([]);
  const [detail, setDetail] = useState<NewsletterDetail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [previewItems, setPreviewItems] = useState<NewsletterItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  async function refresh() {
    try {
      setRows(await listNewsletters());
    } catch (err) {
      fail(err, "Chargement impossible.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const fmtDateTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  function openCreate() {
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 30);
    setForm({ title: "", intro: "", periodStart: ymd(from), periodEnd: ymd(now) });
    setPreviewItems(null);
  }

  function openEdit(d: NewsletterDetail) {
    setForm({
      id: d.id,
      title: d.title,
      intro: d.intro ?? "",
      periodStart: ymd(new Date(d.period_start)),
      periodEnd: ymd(new Date(d.period_end)),
    });
    setPreviewItems(d.items);
    setDetail(null);
  }

  // Aperçu en direct : compte et liste des actualités « maison » de la période.
  async function runPreview(f: FormState) {
    if (!f.periodStart || !f.periodEnd || f.periodStart > f.periodEnd) {
      setPreviewItems(null);
      return;
    }
    try {
      const start = new Date(`${f.periodStart}T00:00`).toISOString();
      const end = new Date(`${f.periodEnd}T23:59:59`).toISOString();
      const res = await previewNewsletter(start, end);
      setPreviewItems(res.items);
    } catch {
      setPreviewItems(null);
    }
  }

  useEffect(() => {
    if (form) runPreview(form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.periodStart, form?.periodEnd]);

  async function submitForm() {
    if (!form || !form.title.trim()) return;
    if (form.periodStart > form.periodEnd) {
      setError(t("nlt.err_period", "La date de début doit précéder la date de fin."));
      return;
    }
    const payload = {
      title: form.title.trim(),
      intro: form.intro.trim() || null,
      period_start: new Date(`${form.periodStart}T00:00`).toISOString(),
      period_end: new Date(`${form.periodEnd}T23:59:59`).toISOString(),
    };
    setBusy(true);
    try {
      if (form.id) {
        await updateNewsletter(form.id, payload);
        setMessage(t("nlt.msg_saved", "Brouillon enregistré."));
      } else {
        await createNewsletter(payload);
        setMessage(t("nlt.msg_created", "Brouillon créé."));
      }
      setForm(null);
      setPreviewItems(null);
      await refresh();
    } catch (err) {
      fail(err, "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    try {
      setDetail(await getNewsletter(id));
    } catch (err) {
      fail(err, "Bulletin introuvable.");
    }
  }

  async function doSend(d: NewsletterDetail) {
    const ok = window.confirm(
      t("nlt.confirm_send", "Envoyer ce bulletin par e-mail à tout le personnel ? Cette action est définitive : le bulletin ne sera plus modifiable."),
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await sendNewsletter(d.id);
      setMessage(
        lang === "en"
          ? `Newsletter sent to ${r.recipients} recipient(s) — ${r.items} item(s).`
          : `Bulletin envoyé à ${r.recipients} destinataire(s) — ${r.items} actualité(s).`,
      );
      setDetail(null);
      await refresh();
    } catch (err) {
      fail(err, "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(id: string) {
    if (!window.confirm(t("nlt.confirm_delete", "Supprimer ce bulletin ?"))) return;
    try {
      await deleteNewsletter(id);
      setMessage(t("nlt.msg_deleted", "Bulletin supprimé."));
      setDetail(null);
      await refresh();
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  function statusBadge(status: string) {
    const sent = status === "envoyee";
    return (
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: sent ? "var(--success)" : "var(--muted)",
          border: `1px solid ${sent ? "var(--success)" : "var(--line)"}`,
          borderRadius: 999,
          padding: "1px 9px",
          whiteSpace: "nowrap",
        }}
      >
        {sent ? t("nlt.status_sent", "Envoyé") : t("nlt.status_draft", "Brouillon")}
      </span>
    );
  }

  function ItemList({ items }: { items: NewsletterItem[] }) {
    if (items.length === 0) {
      return <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("nlt.no_items", "Aucune actualité « maison » sur cette période.")}</p>;
    }
    return (
      <div style={{ borderTop: "1px solid var(--line)" }}>
        {items.map((it) => (
          <div key={`${it.kind}-${it.id}`} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>{it.kind === "announcement" ? "📣" : "📅"}</span>
              <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{fmtDate(it.date)}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{it.title}</span>
            </div>
            {it.preview && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{it.preview}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("nlt.title", "Bulletin d'actualités")}</h1>
      <p className="ecl-page__lead">
        {t("nlt.lead", "Un digest périodique des annonces et événements de la maison, diffusé par e-mail à tout le personnel.")}
      </p>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "14px 0" }}>
          <Button variant="add" size="sm" onClick={openCreate}>{t("nlt.new", "+ Nouveau bulletin")}</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>{t("nlt.empty", "Aucun bulletin pour l'instant.")}</p>
      ) : (
        <div style={{ marginTop: canManage ? 0 : 14, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {rows.map((n) => (
            <button
              key={n.id}
              onClick={() => openDetail(n.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                background: "var(--card)",
                border: "none",
                borderBottom: "1px solid var(--line)",
                cursor: "pointer",
                padding: "11px 14px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  {fmtDate(n.period_start)} — {fmtDate(n.period_end)}
                  {n.status === "envoyee" && n.recipients != null && ` · ${n.recipients} ${t("nlt.recipients", "destinataire(s)")}`}
                </div>
              </div>
              {statusBadge(n.status)}
            </button>
          ))}
        </div>
      )}

      {/* Détail / consultation d'un bulletin */}
      {detail && (
        <Modal
          title={detail.title}
          wide
          onClose={() => setDetail(null)}
          footer={
            <>
              {canManage && detail.status === "brouillon" && (
                <Button variant="danger" size="sm" onClick={() => doDelete(detail.id)}>{t("nlt.delete", "Supprimer")}</Button>
              )}
              {canManage && detail.status === "brouillon" && (
                <Button variant="edit" size="sm" onClick={() => openEdit(detail)}>{t("nlt.edit", "Modifier")}</Button>
              )}
              {canManage && detail.status === "brouillon" && (
                <Button variant="add" size="sm" onClick={() => doSend(detail)} disabled={busy}>{t("nlt.send", "Envoyer")}</Button>
              )}
              <Button variant="view" size="sm" onClick={() => setDetail(null)}>{t("nlt.close", "Fermer")}</Button>
            </>
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {statusBadge(detail.status)}
            <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
              {fmtDate(detail.period_start)} — {fmtDate(detail.period_end)}
            </span>
            {detail.status === "envoyee" && (
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {t("nlt.sent_on", "Envoyé le")} {fmtDateTime(detail.sent_at)} · {detail.recipients ?? 0} {t("nlt.recipients", "destinataire(s)")}
              </span>
            )}
          </div>
          {detail.intro && <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", marginBottom: 12 }}>{detail.intro}</div>}
          <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)", marginBottom: 4 }}>
            {t("nlt.contents", "Au sommaire")} ({detail.items.length})
          </div>
          <ItemList items={detail.items} />
          {detail.status === "brouillon" && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
              {t("nlt.draft_hint", "Aperçu en direct : seules les actualités destinées à tout le personnel sont incluses. Le contenu sera figé au moment de l'envoi.")}
            </p>
          )}
        </Modal>
      )}

      {/* Formulaire de composition */}
      {form && (
        <Modal
          title={form.id ? t("nlt.edit_title", "Modifier le bulletin") : t("nlt.new_title", "Nouveau bulletin")}
          wide
          onClose={() => { setForm(null); setPreviewItems(null); }}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => { setForm(null); setPreviewItems(null); }}>{t("nlt.cancel", "Annuler")}</Button>
              <Button variant="add" size="sm" onClick={submitForm} disabled={!form.title.trim() || busy}>
                {form.id ? t("nlt.save", "Enregistrer") : t("nlt.create", "Créer le brouillon")}
              </Button>
            </>
          }
        >
          <Field label={t("nlt.f_title", "Titre du bulletin")}>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("nlt.f_title_ph", "Ex. Les nouvelles de juin")} autoFocus />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Field label={t("nlt.f_start", "Période — du")}>
              <input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
            </Field>
            <Field label={t("nlt.f_end", "au")}>
              <input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
            </Field>
          </div>
          <Field label={t("nlt.f_intro", "Introduction (facultatif)")}>
            <textarea rows={3} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} placeholder={t("nlt.f_intro_ph", "Un mot d'accueil en tête du bulletin…")} />
          </Field>

          {/* Aperçu en direct des actualités « maison » de la période */}
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)", marginBottom: 6 }}>
              {t("nlt.preview", "Aperçu du sommaire")} {previewItems ? `(${previewItems.length})` : ""}
            </div>
            {previewItems === null ? (
              <p style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("nlt.preview_hint", "Choisissez une période pour voir les actualités incluses.")}</p>
            ) : (
              <ItemList items={previewItems} />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
