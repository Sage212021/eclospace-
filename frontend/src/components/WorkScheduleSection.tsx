import { useEffect, useState } from "react";
import {
  createHoliday,
  getResolvedSchedule,
  listHolidays,
  listWorkSchedules,
  updateWorkSchedule,
  type PublicHoliday,
  type ResolvedSchedule,
  type WorkSchedule,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// RH → Paramètres → Horaires de travail (§9). Affiche l'horaire officiel
// applicable, permet à l'administrateur RH de le modifier et d'ajouter des
// jours fériés. La pause déjeuner est exclue de tous les calculs.

const DAY_LABELS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function workingDaysLabel(csv: string): string {
  return csv
    .split(",")
    .map((d) => DAY_LABELS[Number(d)] ?? d)
    .join(", ");
}

const SOURCE_LABELS: Record<ResolvedSchedule["source"], string> = {
  employee: "spécifique à l'employé",
  department: "spécifique au département",
  company: "officiel (maison)",
  default: "valeur par défaut (aucun horaire enregistré)",
};

export function WorkScheduleSection({ canAdminister }: { canAdminister: boolean }) {
  const [resolved, setResolved] = useState<ResolvedSchedule | null>(null);
  const [companySchedule, setCompanySchedule] = useState<WorkSchedule | null>(null);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ day_start: "", lunch_start: "", lunch_end: "", day_end: "", working_days: "" });
  const [newHoliday, setNewHoliday] = useState({ day: "", label: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [r, list, hol] = await Promise.all([getResolvedSchedule(), listWorkSchedules(), listHolidays()]);
      setResolved(r);
      const company = list.find((s) => s.scope === "company" && s.active) ?? null;
      setCompanySchedule(company);
      setHolidays(hol);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement des horaires impossible.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function startEdit() {
    if (!companySchedule) return;
    setForm({
      day_start: companySchedule.day_start,
      lunch_start: companySchedule.lunch_start,
      lunch_end: companySchedule.lunch_end,
      day_end: companySchedule.day_end,
      working_days: companySchedule.working_days,
    });
    setEditing(true);
    setMessage(null);
    setError(null);
  }

  async function saveSchedule() {
    if (!companySchedule) return;
    try {
      await updateWorkSchedule(companySchedule.id, form);
      setEditing(false);
      setMessage("Horaire officiel mis à jour.");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    }
  }

  async function addHoliday() {
    if (!newHoliday.day || !newHoliday.label.trim()) return;
    try {
      await createHoliday({ day: newHoliday.day, label: newHoliday.label.trim() });
      setNewHoliday({ day: "", label: "" });
      setMessage("Jour férié ajouté.");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout du jour férié impossible.");
    }
  }

  return (
    <Card
      title="Horaires de travail"
      icon={<IconAdmin />}
      subtitle="Horaire officiel de l'entreprise — la pause déjeuner est exclue de tous les calculs de présence."
    >
      {resolved && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontFamily: "var(--font-mono, monospace)", fontSize: 15 }}>
            <span>Journée : <strong>{resolved.day_start}</strong> → <strong>{resolved.day_end}</strong></span>
            <span>Pause : <strong>{resolved.lunch_start}</strong> → <strong>{resolved.lunch_end}</strong></span>
            <span>Jours : <strong>{workingDaysLabel(resolved.working_days)}</strong></span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Horaire appliqué : {SOURCE_LABELS[resolved.source]}.</div>
        </div>
      )}

      {canAdminister && !editing && companySchedule && (
        <Button variant="edit" size="sm" type="button" onClick={startEdit}>Modifier l'horaire officiel</Button>
      )}

      {canAdminister && editing && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <Field label="Début de journée">
              <input type="time" value={form.day_start} onChange={(e) => setForm({ ...form, day_start: e.target.value })} />
            </Field>
            <Field label="Début de pause">
              <input type="time" value={form.lunch_start} onChange={(e) => setForm({ ...form, lunch_start: e.target.value })} />
            </Field>
            <Field label="Fin de pause">
              <input type="time" value={form.lunch_end} onChange={(e) => setForm({ ...form, lunch_end: e.target.value })} />
            </Field>
            <Field label="Fin de journée">
              <input type="time" value={form.day_end} onChange={(e) => setForm({ ...form, day_end: e.target.value })} />
            </Field>
            <Field label="Jours ouvrables (1=Lun … 7=Dim)">
              <input value={form.working_days} onChange={(e) => setForm({ ...form, working_days: e.target.value })} placeholder="1,2,3,4,5" />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Button variant="add" size="sm" type="button" onClick={saveSchedule}>Enregistrer</Button>
            <Button variant="subtle" size="sm" type="button" onClick={() => setEditing(false)}>Annuler</Button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Jours fériés / chômés</div>
        {holidays.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun jour férié enregistré.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {holidays.map((h) => (
              <li key={h.id}><span style={{ fontFamily: "var(--font-mono, monospace)" }}>{h.day}</span> — {h.label}</li>
            ))}
          </ul>
        )}
        {canAdminister && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, marginTop: 10 }}>
            <Field label="Date">
              <input type="date" value={newHoliday.day} onChange={(e) => setNewHoliday({ ...newHoliday, day: e.target.value })} />
            </Field>
            <Field label="Libellé">
              <input value={newHoliday.label} onChange={(e) => setNewHoliday({ ...newHoliday, label: e.target.value })} placeholder="Ex : Fête nationale" />
            </Field>
            <Button variant="add" size="sm" type="button" onClick={addHoliday}>Ajouter</Button>
          </div>
        )}
      </div>

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
