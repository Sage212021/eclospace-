import { useEffect, useMemo, useState } from "react";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getAnnouncementTargetOptions,
  getCalendarEvent,
  listCalendarEvents,
  remindCalendarEvent,
  updateCalendarEvent,
  type AnnouncementTargetType,
  type CalendarEvent,
  type CalendarEventType,
  type TargetOptions,
} from "../api/client";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { useI18n } from "../i18n";

const TYPE_COLORS: Record<CalendarEventType, string> = {
  reunion: "var(--eclosion)",
  echeance: "#C4661F",
  formation: "var(--navy)",
  sortie: "var(--success)",
  ceremonie: "var(--eclosion-dark)",
  autre: "var(--muted)",
};

interface CalendarPageProps {
  canPublish: boolean;
}

interface TargetRow {
  type: AnnouncementTargetType;
  id: string;
}

interface FormState {
  id?: string;
  title: string;
  description: string;
  type: CalendarEventType;
  allDay: boolean;
  date: string; // AAAA-MM-JJ
  startTime: string; // HH:MM
  endTime: string;
  location: string;
  targets: TargetRow[];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Lundi comme premier jour de la semaine (usage FR/EN professionnel).
function startOfGrid(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const day = (first.getDay() + 6) % 7; // 0 = lundi
  const d = new Date(first);
  d.setDate(first.getDate() - day);
  return d;
}

export function CalendarPage({ canPublish }: CalendarPageProps) {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [options, setOptions] = useState<TargetOptions | null>(null);

  const typeLabel = (ty: CalendarEventType) =>
    t(`cal.type.${ty}`, { reunion: "Réunion", echeance: "Échéance", formation: "Formation", sortie: "Sortie", ceremonie: "Cérémonie", autre: "Autre" }[ty]);

  // Bornes du mois affiché (grille complète lundi→dimanche, 6 semaines).
  const grid = useMemo(() => {
    const start = startOfGrid(cursor.year, cursor.month);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [cursor]);

  async function refresh() {
    const from = new Date(cursor.year, cursor.month, 1);
    const to = new Date(cursor.year, cursor.month + 1, 1);
    try {
      setEvents(await listCalendarEvents(from.toISOString(), to.toISOString()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  // Regroupe les événements par jour (clé AAAA-MM-JJ, sur la date de début).
  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of events) {
      const key = ymd(new Date(e.starts_at));
      (map[key] ??= []).push(e);
    }
    return map;
  }, [events]);

  async function openForm(date?: string, existing?: CalendarEvent) {
    try {
      if (!options) setOptions(await getAnnouncementTargetOptions());
    } catch (err) {
      fail(err, "Chargement des cibles impossible.");
    }
    if (existing) {
      const d = await getCalendarEvent(existing.id);
      const start = new Date(d.starts_at);
      const end = d.ends_at ? new Date(d.ends_at) : null;
      setForm({
        id: d.id,
        title: d.title,
        description: d.description ?? "",
        type: d.type,
        allDay: d.all_day,
        date: ymd(start),
        startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
        endTime: end ? `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}` : "",
        location: d.location ?? "",
        targets: (d.targets ?? [{ type: "tous", id: null }]).map((x) => ({ type: x.type, id: x.id ?? "" })),
      });
    } else {
      setForm({
        title: "",
        description: "",
        type: "reunion",
        allDay: false,
        date: date ?? ymd(new Date()),
        startTime: "09:00",
        endTime: "10:00",
        location: "",
        targets: [{ type: "tous", id: "" }],
      });
    }
  }

  async function submitForm() {
    if (!form || !form.title.trim()) return;
    const targets = form.targets
      .filter((r) => r.type === "tous" || r.id)
      .map((r) => (r.type === "tous" ? { type: "tous" as const } : { type: r.type, id: r.id }));
    if (targets.length === 0) {
      setError(t("cal.err_no_target", "Ajoutez au moins une cible."));
      return;
    }
    const startISO = form.allDay
      ? new Date(`${form.date}T00:00`).toISOString()
      : new Date(`${form.date}T${form.startTime || "00:00"}`).toISOString();
    const endISO = form.allDay
      ? null
      : form.endTime
        ? new Date(`${form.date}T${form.endTime}`).toISOString()
        : null;
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      type: form.type,
      starts_at: startISO,
      ends_at: endISO,
      all_day: form.allDay,
      location: form.location.trim() || null,
      targets,
    };
    try {
      if (form.id) {
        await updateCalendarEvent(form.id, payload);
        setMessage(t("cal.msg_saved", "Événement enregistré."));
      } else {
        await createCalendarEvent(payload);
        setMessage(t("cal.msg_created", "Événement créé."));
      }
      setForm(null);
      await refresh();
    } catch (err) {
      fail(err, "Enregistrement impossible.");
    }
  }

  async function doDelete(id: string) {
    try {
      await deleteCalendarEvent(id);
      setMessage(t("cal.msg_deleted", "Événement supprimé."));
      setDetail(null);
      await refresh();
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  async function doRemind(id: string) {
    try {
      const r = await remindCalendarEvent(id);
      setMessage(lang === "en" ? `Reminder sent to ${r.reminded} person(s).` : `Rappel envoyé à ${r.reminded} personne(s).`);
    } catch (err) {
      fail(err, "Rappel impossible.");
    }
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
  const weekdays = useMemo(() => {
    const ref = startOfGrid(2024, 0); // un lundi
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ref);
      d.setDate(ref.getDate() + i);
      return d.toLocaleDateString(locale, { weekday: "short" });
    });
  }, [locale]);

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("cal.title", "Calendrier partagé")}</h1>
      <p className="ecl-page__lead">{t("cal.lead", "Les événements de la maison d'édition qui vous concernent.")}</p>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, margin: "14px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button variant="view" size="sm" onClick={() => setCursor((c) => ({ ...monthDelta(c, -1) }))}>‹</Button>
          <Button variant="view" size="sm" onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>{t("cal.today", "Aujourd'hui")}</Button>
          <Button variant="view" size="sm" onClick={() => setCursor((c) => ({ ...monthDelta(c, 1) }))}>›</Button>
          <span style={{ fontSize: 16, fontWeight: 700, textTransform: "capitalize", marginLeft: 6 }}>{monthLabel}</span>
        </div>
        {canPublish && <Button variant="add" size="sm" onClick={() => openForm()}>{t("cal.new", "+ Événement")}</Button>}
      </div>

      {/* Grille mensuelle */}
      <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "var(--paper)" }}>
          {weekdays.map((w) => (
            <div key={w} style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", textAlign: "center" }}>{w}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {grid.map((day) => {
            const key = ymd(day);
            const inMonth = day.getMonth() === cursor.month;
            const isToday = ymd(today) === key;
            const dayEvents = eventsByDay[key] ?? [];
            return (
              <div
                key={key}
                onClick={() => canPublish && openForm(key)}
                style={{
                  minHeight: 96,
                  borderTop: "1px solid var(--line)",
                  borderLeft: "1px solid var(--line)",
                  padding: 5,
                  background: inMonth ? "var(--card)" : "var(--paper)",
                  opacity: inMonth ? 1 : 0.55,
                  cursor: canPublish ? "pointer" : "default",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? "#fff" : "var(--ink)",
                      background: isToday ? "var(--eclosion)" : "transparent",
                      borderRadius: 999,
                      minWidth: 20,
                      height: 20,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 4px",
                    }}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
                  {dayEvents.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      onClick={(ev) => { ev.stopPropagation(); setDetail(e); }}
                      title={e.title}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        borderLeft: `3px solid ${e.birthday ? "var(--eclosion)" : TYPE_COLORS[e.type]}`,
                        background: "var(--paper)",
                        borderRadius: 4,
                        padding: "2px 5px",
                        fontSize: 11,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "var(--ink)",
                      }}
                    >
                      {e.birthday && "🎂 "}
                      {!e.birthday && !e.all_day && <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{fmtTime(e.starts_at)} </span>}
                      {e.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>+{dayEvents.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Détail d'un événement */}
      {detail && (
        <Modal
          title={detail.title}
          onClose={() => setDetail(null)}
          footer={
            <>
              {detail.can_manage && !detail.birthday && <Button variant="danger" size="sm" onClick={() => doDelete(detail.id)}>{t("cal.delete", "Supprimer")}</Button>}
              {detail.can_manage && !detail.birthday && <Button variant="view" size="sm" onClick={() => doRemind(detail.id)}>{t("cal.remind", "Rappeler")}</Button>}
              {detail.can_manage && !detail.birthday && <Button variant="edit" size="sm" onClick={() => { const d = detail; setDetail(null); openForm(undefined, d); }}>{t("cal.edit", "Modifier")}</Button>}
              <Button variant="view" size="sm" onClick={() => setDetail(null)}>{t("cal.close", "Fermer")}</Button>
            </>
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {detail.birthday ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--eclosion-dark)", border: "1px solid var(--eclosion)", borderRadius: 999, padding: "1px 9px" }}>🎂 {t("cal.birthday", "Anniversaire")}</span>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700, color: TYPE_COLORS[detail.type], border: `1px solid ${TYPE_COLORS[detail.type]}`, borderRadius: 999, padding: "1px 9px" }}>{typeLabel(detail.type)}</span>
            )}
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {new Date(detail.starts_at).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
              {!detail.all_day && ` · ${fmtTime(detail.starts_at)}${detail.ends_at ? `–${fmtTime(detail.ends_at)}` : ""}`}
              {detail.all_day && ` · ${t("cal.all_day", "Journée entière")}`}
            </span>
          </div>
          {detail.location && <div style={{ fontSize: 13, marginBottom: 6 }}>📍 {detail.location}</div>}
          {detail.description && <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{detail.description}</div>}
          {detail.author && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>{t("cal.by", "Proposé par")} {detail.author.username}</div>}
        </Modal>
      )}

      {/* Formulaire de création / édition */}
      {form && (
        <Modal
          title={form.id ? t("cal.edit_title", "Modifier l'événement") : t("cal.new_title", "Nouvel événement")}
          wide
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setForm(null)}>{t("cal.cancel", "Annuler")}</Button>
              <Button variant="add" size="sm" onClick={submitForm} disabled={!form.title.trim()}>{form.id ? t("cal.save", "Enregistrer") : t("cal.create", "Créer")}</Button>
            </>
          }
        >
          <Field label={t("cal.f_title", "Titre")}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Field label={t("cal.f_type", "Type")}>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CalendarEventType })}>
                {(["reunion", "echeance", "formation", "sortie", "ceremonie", "autre"] as CalendarEventType[]).map((ty) => (
                  <option key={ty} value={ty}>{typeLabel(ty)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("cal.f_date", "Date")}><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            {!form.allDay && <Field label={t("cal.f_start", "Début")}><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>}
            {!form.allDay && <Field label={t("cal.f_end", "Fin")}><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>}
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, margin: "4px 0 8px" }}>
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
            {t("cal.f_all_day", "Journée entière")}
          </label>
          <Field label={t("cal.f_location", "Lieu (facultatif)")}><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("cal.f_location_ph", "Ex. Salle de réunion")} /></Field>
          <Field label={t("cal.f_description", "Description (facultatif)")}><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

          {/* Ciblage */}
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("cal.targets", "Destinataires")}</div>
            {form.targets.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select value={row.type} onChange={(e) => { const type = e.target.value as AnnouncementTargetType; setForm({ ...form, targets: form.targets.map((r, idx) => (idx === i ? { type, id: "" } : r)) }); }}>
                  <option value="tous">{t("cal.tgt.tous", "Tout le personnel")}</option>
                  <option value="departement">{t("cal.tgt.departement", "Département")}</option>
                  <option value="role">{t("cal.tgt.role", "Profil (rôle)")}</option>
                  <option value="utilisateur">{t("cal.tgt.utilisateur", "Employé précis")}</option>
                </select>
                {row.type !== "tous" && (
                  <select value={row.id} onChange={(e) => setForm({ ...form, targets: form.targets.map((r, idx) => (idx === i ? { ...r, id: e.target.value } : r)) })} style={{ flex: 1, minWidth: 180 }}>
                    <option value="">{t("cal.select", "— sélectionner —")}</option>
                    {row.type === "departement" && options?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    {row.type === "role" && options?.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    {row.type === "utilisateur" && options?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
                <button type="button" disabled={form.targets.length === 1} onClick={() => setForm({ ...form, targets: form.targets.filter((_, idx) => idx !== i) })} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", padding: "6px 8px" }}>✕</button>
              </div>
            ))}
            <Button variant="subtle" size="sm" onClick={() => setForm({ ...form, targets: [...form.targets, { type: "departement", id: "" }] })}>{t("cal.add_target", "+ Ajouter une cible")}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function monthDelta(c: { year: number; month: number }, delta: number): { year: number; month: number } {
  const d = new Date(c.year, c.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
