import { useEffect, useMemo, useRef, useState } from "react";
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

// Planning annuel des événements. Deux vues :
//  - Liste (détaillée, avec gestion RH/Direction).
//  - Calendrier (aperçu de toute l'année d'un coup d'œil).
// Lecture par tout le personnel (temps quasi réel) ; gestion par RH + Direction.

// Chaque statut porte deux jeux de couleurs :
//  - color/bg : pour les puces et les boutons (fond clair, texte teinté) ;
//  - fill/on  : pour les cases pleines du calendrier (fond franc, texte contrasté).
const STATUS: Record<AnnualEventStatus, { label: string; color: string; bg: string; fill: string; on: string }> = {
  a_venir: { label: "À venir", color: "var(--eclosion-dark)", bg: "var(--eclosion-soft)", fill: "var(--eclosion)", on: "#16233D" },
  a_confirmer: { label: "À confirmer", color: "var(--amber)", bg: "var(--amber-soft, #f9e9db)", fill: "var(--amber)", on: "#FFFFFF" },
  tenu: { label: "Tenu", color: "var(--ink)", bg: "#e7ecf5", fill: "var(--ink)", on: "#FFFFFF" },
  non_tenu: { label: "Non tenu", color: "var(--alert)", bg: "var(--alert-soft, #f9e9e6)", fill: "var(--alert)", on: "#FFFFFF" },
};
const STATUS_ORDER: AnnualEventStatus[] = ["a_venir", "a_confirmer", "tenu", "non_tenu"];

export function AnnualEventsPlanning({ canManage }: { canManage: boolean }) {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const [events, setEvents] = useState<AnnualEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [editing, setEditing] = useState<AnnualEvent | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AnnualEvent | null>(null);
  const [dayDetail, setDayDetail] = useState<{ label: string; events: AnnualEvent[] } | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const yearInit = useRef(false);

  async function refresh() {
    try {
      setEvents(await listAnnualEvents());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 45000);
    return () => window.clearInterval(timer);
  }, []);

  // Au premier chargement, si l'année en cours n'a aucun événement, on se place
  // sur l'année du premier événement (ex. 2026) pour montrer un calendrier utile.
  useEffect(() => {
    if (!events || yearInit.current || events.length === 0) return;
    const y = new Date().getFullYear();
    const hasThisYear = events.some((e) => new Date(e.start_date).getUTCFullYear() === y);
    if (!hasThisYear) setYear(new Date(events[0].start_date).getUTCFullYear());
    yearInit.current = true;
  }, [events]);

  async function setStatus(ev: AnnualEvent, status: AnnualEventStatus) {
    try { await updateAnnualEvent(ev.id, { status }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Modification impossible."); }
  }
  async function onAffiche(ev: AnnualEvent, file: File) {
    try { await uploadAnnualEventAffiche(ev.id, file); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Dépôt de l'affiche impossible."); }
  }

  const nextId = nextUpcomingId(events);
  const action = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <ViewTab active={view === "list"} onClick={() => setView("list")}>{t("events.view_list", "📋 Liste")}</ViewTab>
        <ViewTab active={view === "calendar"} onClick={() => setView("calendar")}>{t("events.view_cal", "📅 Calendrier")}</ViewTab>
      </div>
      {canManage && <Button variant="add" size="sm" onClick={() => setEditing("new")}>{t("events.add", "+ Ajouter")}</Button>}
    </div>
  );

  return (
    <Card
      title={t("events.title", "Planning des événements")}
      subtitle={t("events.subtitle", "Les temps forts de la maison, suivis en direct.")}
      action={action}
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {!events ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("common.loading", "Chargement…")}</p>
      ) : events.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("events.empty", "Aucun événement pour le moment.")}</p>
      ) : view === "calendar" ? (
        <YearCalendar
          events={events}
          year={year}
          onYear={setYear}
          locale={locale}
          lang={lang}
          onDay={(label, evs) => setDayDetail({ label, events: evs })}
          t={t}
        />
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

      {/* Détail d'un jour (depuis le calendrier) */}
      {dayDetail && (
        <Modal title={dayDetail.label} onClose={() => setDayDetail(null)} footer={<Button variant="view" size="sm" onClick={() => setDayDetail(null)}>{t("common.close", "Fermer")}</Button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {dayDetail.events.map((ev) => (
              <div key={ev.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                {ev.has_affiche && <img src={annualEventAfficheUrl(ev.id, ev.updated_at)} alt="" style={{ width: 70, borderRadius: 6, border: "1px solid var(--line)", flexShrink: 0 }} />}
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14 }}>{ev.title}</strong>
                    {ev.dg_present && <span style={dgBadge}>DG</span>}
                    <span style={statusChip(ev.status)}>{STATUS[ev.status].label}</span>
                  </div>
                  {ev.description && <div style={{ fontSize: 12.5, color: "var(--muted)", fontStyle: "italic" }}>{ev.description}</div>}
                  <div style={{ fontSize: 12.5, color: "var(--ink)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{formatRange(ev.start_date, ev.end_date, locale)}{ev.location ? ` · ${ev.location}` : ""}</div>
                  {canManage && <button onClick={() => { setDayDetail(null); setEditing(ev); }} style={{ ...ghostBtn, marginTop: 6 }}>{t("common.edit", "Modifier")}</button>}
                </div>
              </div>
            ))}
          </div>
        </Modal>
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

// ── Vue calendrier : l'année entière (12 mois) ──────────────────────────────
function YearCalendar({ events, year, onYear, locale, lang, onDay, t }: {
  events: AnnualEvent[]; year: number; onYear: (y: number) => void; locale: string; lang: string;
  onDay: (label: string, events: AnnualEvent[]) => void; t: (k: string, d: string) => string;
}) {
  const dayMap = useMemo(() => buildDayMap(events, year), [events, year]);
  const weekdays = lang === "en" ? ["M", "T", "W", "T", "F", "S", "S"] : ["L", "M", "M", "J", "V", "S", "D"];
  const total = events.filter((e) => new Date(e.start_date).getUTCFullYear() === year).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => onYear(year - 1)} style={navBtn} aria-label="année précédente">◀</button>
          <strong style={{ fontFamily: "var(--font-mono)", fontSize: 18 }}>{year}</strong>
          <button onClick={() => onYear(year + 1)} style={navBtn} aria-label="année suivante">▶</button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>· {total} {t("events.count", "événement(s)")}</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {STATUS_ORDER.map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink)", fontWeight: 600 }}>
              <span style={{ width: 13, height: 13, borderRadius: 4, background: STATUS[s].fill }} />
              {STATUS[s].label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
        {Array.from({ length: 12 }, (_, m) => (
          <MiniMonth key={m} year={year} month={m} dayMap={dayMap} weekdays={weekdays} locale={locale} onDay={onDay} />
        ))}
      </div>
    </div>
  );
}

function MiniMonth({ year, month, dayMap, weekdays, locale, onDay }: {
  year: number; month: number; dayMap: Record<string, AnnualEvent[]>; weekdays: string[]; locale: string;
  onDay: (label: string, events: AnnualEvent[]) => void;
}) {
  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleDateString(locale, { month: "long" });
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Lundi = 0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const now = new Date();
  const hasAny = Object.keys(dayMap).some((k) => k.startsWith(`${month}-`));

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 9px", background: "var(--card)", boxShadow: hasAny ? "0 1px 3px rgba(22,35,61,0.06)" : "none" }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--ink)", textTransform: "capitalize", marginBottom: 8, textAlign: "center", letterSpacing: 0.2 }}>{monthName}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {weekdays.map((w, i) => (
          <div key={i} style={{ fontSize: 9.5, color: "var(--muted)", textAlign: "center", fontWeight: 700, paddingBottom: 2 }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const evs = dayMap[`${month}-${d}`];
          const st = evs ? STATUS[evs[0].status] : null;
          const isToday = d === now.getDate() && month === now.getMonth() && year === now.getFullYear();
          // Bande continue : arrondir seulement les extrémités d'une série du même événement.
          const sameL = evs && dayMap[`${month}-${d - 1}`]?.[0]?.id === evs[0].id;
          const sameR = evs && dayMap[`${month}-${d + 1}`]?.[0]?.id === evs[0].id;
          const radius = evs ? `${sameL ? 2 : 7}px ${sameR ? 2 : 7}px ${sameR ? 2 : 7}px ${sameL ? 2 : 7}px` : "6px";
          const multi = evs && evs.length > 1;
          return (
            <button
              key={i}
              onClick={evs ? () => onDay(`${d} ${monthName} ${year}`, evs) : undefined}
              disabled={!evs}
              title={evs ? evs.map((e) => e.title).join(", ") : undefined}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                fontSize: 11,
                border: isToday ? "2px solid var(--ink)" : "1px solid transparent",
                background: st ? st.fill : "transparent",
                color: st ? st.on : "var(--muted)",
                fontWeight: st ? 800 : isToday ? 800 : 400,
                borderRadius: radius,
                cursor: evs ? "pointer" : "default",
                padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {d}
              {multi && (
                <span style={{ position: "absolute", top: 1, right: 3, fontSize: 8, fontWeight: 900, lineHeight: 1 }}>•</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Jours couverts par chaque événement (bornes incluses), pour l'année donnée.
function buildDayMap(events: AnnualEvent[], year: number): Record<string, AnnualEvent[]> {
  const map: Record<string, AnnualEvent[]> = {};
  for (const ev of events) {
    const s = new Date(ev.start_date);
    const e = ev.end_date ? new Date(ev.end_date) : s;
    const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
    const end = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
    let guard = 0;
    while (cur <= end && guard++ < 400) {
      if (cur.getUTCFullYear() === year) {
        const key = `${cur.getUTCMonth()}-${cur.getUTCDate()}`;
        (map[key] ||= []).push(ev);
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return map;
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
          {ev.dg_present && <span title={t("events.dg", "Présence de la Direction générale")} style={dgBadge}>DG</span>}
          <span style={statusChip(ev.status)}>{st.label}</span>
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

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "5px 12px", border: "none",
        background: active ? "var(--eclosion-soft)" : "transparent",
        color: active ? "var(--eclosion-dark)" : "var(--muted)",
      }}
    >
      {children}
    </button>
  );
}

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

function statusChip(status: AnnualEventStatus): React.CSSProperties {
  const st = STATUS[status];
  return { fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.color}`, borderRadius: 999, padding: "1px 9px" };
}
const dgBadge: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-dark)", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 999, padding: "1px 8px" };
const ghostBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, cursor: "pointer", borderRadius: 6, padding: "3px 9px", border: "1px solid var(--line)", background: "transparent", color: "var(--muted)" };
const navBtn: React.CSSProperties = { fontSize: 12, cursor: "pointer", borderRadius: 6, padding: "3px 9px", border: "1px solid var(--line)", background: "transparent", color: "var(--eclosion-dark)" };
function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 10 };
}
