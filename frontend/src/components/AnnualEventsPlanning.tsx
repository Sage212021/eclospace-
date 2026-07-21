import { useEffect, useRef, useState } from "react";
import {
  listAnnualEvents,
  createAnnualEvent,
  updateAnnualEvent,
  deleteAnnualEvent,
  uploadAnnualEventAffiche,
  annualEventAfficheUrl,
  type AnnualEvent,
  type AnnualEventStatus,
  type AnnualEventInput,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Modal, Field } from "./Modal";
import { useI18n } from "../i18n";

// Planning annuel des événements. Vu par tout le personnel (lecture seule, en
// temps quasi réel) ; géré par le RH et la Direction (canManage) : statut,
// dates, lieu, affiche — tout est modifiable depuis l'ERP.

const STATUS: Record<AnnualEventStatus, { label: string; color: string; bg: string }> = {
  a_venir: { label: "À venir", color: "var(--muted)", bg: "var(--paper)" },
  a_confirmer: { label: "À confirmer", color: "#C4661F", bg: "var(--amber-soft, #f9e9db)" },
  tenu: { label: "Tenu", color: "var(--eclosion-dark)", bg: "var(--eclosion-soft)" },
  non_tenu: { label: "Non tenu", color: "var(--alert)", bg: "var(--alert-soft, #f9e9e6)" },
};
const STATUS_ORDER: AnnualEventStatus[] = ["a_venir", "a_confirmer", "tenu", "non_tenu"];

export function AnnualEventsPlanning({ canManage }: { canManage: boolean }) {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const [events, setEvents] = useState<AnnualEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AnnualEvent | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AnnualEvent | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function refresh() {
    try {
      setEvents(await listAnnualEvents());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }
  useEffect(() => {
    refresh();
    // Temps quasi réel : rafraîchit régulièrement pour que les employés voient
    // vite les changements de statut faits par le RH.
    const timer = window.setInterval(refresh, 45000);
    return () => window.clearInterval(timer);
  }, []);

  async function setStatus(ev: AnnualEvent, status: AnnualEventStatus) {
    try {
      await updateAnnualEvent(ev.id, { status });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible.");
    }
  }

  async function onAffiche(ev: AnnualEvent, file: File) {
    try {
      await uploadAnnualEventAffiche(ev.id, file);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt de l'affiche impossible.");
    }
  }

  const nextId = nextUpcomingId(events);

  return (
    <Card
      title={t("events.title", "Planning des événements")}
      subtitle={t("events.subtitle", "Les temps forts de la maison, suivis en direct.")}
      action={canManage ? <Button variant="add" size="sm" onClick={() => setEditing("new")}>{t("events.add", "+ Ajouter")}</Button> : undefined}
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {!events ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("common.loading", "Chargement…")}</p>
      ) : events.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("events.empty", "Aucun événement pour le moment.")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map((ev) => (
            <EventRow
              key={ev.id}
              ev={ev}
              locale={locale}
              highlighted={ev.id === nextId}
              canManage={canManage}
              onStatus={(s) => setStatus(ev, s)}
              onEdit={() => setEditing(ev)}
              onDelete={() => setConfirmDelete(ev)}
              onPickAffiche={() => fileInputs.current[ev.id]?.click()}
              fileRef={(el) => (fileInputs.current[ev.id] = el)}
              onFile={(f) => onAffiche(ev, f)}
              t={t}
            />
          ))}
        </div>
      )}

      {editing && (
        <EventEditor
          event={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); }}
          t={t}
        />
      )}
      {confirmDelete && (
        <Modal
          title={t("events.delete_title", "Supprimer l'événement")}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setConfirmDelete(null)}>{t("common.cancel", "Annuler")}</Button>
              <Button variant="danger" size="sm" onClick={async () => { await deleteAnnualEvent(confirmDelete.id); setConfirmDelete(null); await refresh(); }}>{t("events.delete", "Supprimer")}</Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13.5 }}>{t("events.delete_confirm", "Supprimer")} « <strong>{confirmDelete.title}</strong> » ?</p>
        </Modal>
      )}
    </Card>
  );
}

function EventRow({
  ev, locale, highlighted, canManage, onStatus, onEdit, onDelete, onPickAffiche, fileRef, onFile, t,
}: {
  ev: AnnualEvent; locale: string; highlighted: boolean; canManage: boolean;
  onStatus: (s: AnnualEventStatus) => void; onEdit: () => void; onDelete: () => void;
  onPickAffiche: () => void; fileRef: (el: HTMLInputElement | null) => void; onFile: (f: File) => void;
  t: (k: string, d: string) => string;
}) {
  const st = STATUS[ev.status];
  return (
    <div
      style={{
        border: `1px solid ${highlighted ? "var(--eclosion)" : "var(--line)"}`,
        borderRadius: 12,
        padding: 12,
        background: highlighted ? "var(--eclosion-soft)" : "var(--card)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      {/* Affiche affichée directement (pas de téléchargement) */}
      {ev.has_affiche && (
        <img
          src={annualEventAfficheUrl(ev.id, ev.updated_at)}
          alt={t("events.affiche", "Affiche")}
          style={{ width: 96, height: "auto", maxHeight: 130, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", flexShrink: 0 }}
        />
      )}
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {highlighted && <span style={{ fontSize: 10, fontWeight: 800, color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("events.next", "Prochain")}</span>}
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{ev.title}</span>
          {ev.dg_present && <span title={t("events.dg", "Présence de la Direction générale")} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-dark)", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 999, padding: "1px 8px" }}>DG</span>}
          <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.color}`, borderRadius: 999, padding: "1px 9px" }}>{st.label}</span>
        </div>
        {ev.description && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>{ev.description}</div>}
        <div style={{ fontSize: 12.5, color: "var(--ink)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
          📅 {formatRange(ev.start_date, ev.end_date, locale)}
          {ev.location && <span style={{ fontFamily: "inherit", color: "var(--muted)" }}> · 📍 {ev.location}</span>}
        </div>

        {canManage && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => onStatus(s)}
                style={{
                  fontSize: 11.5, fontWeight: 600, cursor: "pointer", borderRadius: 999, padding: "3px 10px",
                  border: `1px solid ${ev.status === s ? STATUS[s].color : "var(--line)"}`,
                  background: ev.status === s ? STATUS[s].bg : "transparent",
                  color: ev.status === s ? STATUS[s].color : "var(--muted)",
                }}
              >
                {STATUS[s].label}
              </button>
            ))}
            <span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 2px" }} />
            <button onClick={onPickAffiche} style={ghostBtn}>{ev.has_affiche ? t("events.affiche_replace", "Changer l'affiche") : t("events.affiche_add", "Déposer une affiche")}</button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
            <button onClick={onEdit} style={ghostBtn}>{t("common.edit", "Modifier")}</button>
            <button onClick={onDelete} style={{ ...ghostBtn, color: "var(--alert)" }}>{t("events.delete", "Supprimer")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function EventEditor({ event, onClose, onSaved, t }: { event: AnnualEvent | null; onClose: () => void; onSaved: () => void; t: (k: string, d: string) => string }) {
  const [form, setForm] = useState<AnnualEventInput>({
    title: event?.title ?? "",
    description: event?.description ?? "",
    start_date: (event?.start_date ?? "").slice(0, 10),
    end_date: (event?.end_date ?? "")?.slice(0, 10) ?? "",
    location: event?.location ?? "",
    dg_present: event?.dg_present ?? false,
    status: event?.status ?? "a_venir",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!form.title.trim() || !form.start_date) { setErr(t("events.err_required", "Le nom et la date de début sont obligatoires.")); return; }
    setBusy(true); setErr(null);
    try {
      const payload: AnnualEventInput = { ...form, end_date: form.end_date || undefined, description: form.description || undefined, location: form.location || undefined };
      if (event) await updateAnnualEvent(event.id, payload);
      else await createAnnualEvent(payload);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={event ? t("events.edit_title", "Modifier l'événement") : t("events.new_title", "Nouvel événement")}
      onClose={onClose}
      footer={
        <>
          <Button variant="view" size="sm" onClick={onClose}>{t("common.cancel", "Annuler")}</Button>
          <Button variant="add" size="sm" onClick={save} disabled={busy}>{t("common.save", "Enregistrer")}</Button>
        </>
      }
    >
      {err && <div style={banner("var(--alert-soft)", "var(--alert)")}>{err}</div>}
      <Field label={t("events.f_title", "Nom de l'événement")}>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label={t("events.f_desc", "Précision (facultatif)")}>
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("events.f_desc_ph", "ex. atelier de lecture pour enfants")} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("events.f_start", "Début")}>
          <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </Field>
        <Field label={t("events.f_end", "Fin (facultatif)")}>
          <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </Field>
      </div>
      <Field label={t("events.f_location", "Lieu")}>
        <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("events.f_location_ph", "Yaoundé, Douala, Paris…")} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
        <Field label={t("events.f_status", "Statut")}>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AnnualEventStatus })}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "8px 0" }}>
          <input type="checkbox" checked={form.dg_present} onChange={(e) => setForm({ ...form, dg_present: e.target.checked })} />
          {t("events.f_dg", "Présence de la DG")}
        </label>
      </div>
    </Modal>
  );
}

// Prochain événement à venir (la première date future non « non tenu »).
function nextUpcomingId(events: AnnualEvent[] | null): string | null {
  if (!events) return null;
  const now = Date.now();
  const upcoming = events
    .filter((e) => e.status !== "non_tenu" && e.status !== "tenu")
    .filter((e) => new Date(e.end_date ?? e.start_date).getTime() >= now)
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
  return upcoming[0]?.id ?? null;
}

function formatRange(start: string, end: string | null, locale: string): string {
  const opt: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
  const s = new Date(start).toLocaleDateString(locale, opt);
  if (!end || end.slice(0, 10) === start.slice(0, 10)) return s;
  return `${new Date(start).toLocaleDateString(locale, { day: "2-digit", month: "short" })} → ${new Date(end).toLocaleDateString(locale, opt)}`;
}

const ghostBtn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, cursor: "pointer", borderRadius: 6, padding: "3px 9px",
  border: "1px solid var(--line)", background: "transparent", color: "var(--muted)",
};
function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 10 };
}
