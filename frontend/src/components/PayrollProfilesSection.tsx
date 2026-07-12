import { useEffect, useState } from "react";
import {
  getPayrollProfile,
  savePayrollProfile,
  type Employee,
  type PayrollProfileInput,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Fiche paie par employé (D-007, incrément 2) : données propres au bulletin
// (matricule, N° CNPS, NIU, brut contractuel, parts fiscales, ancienneté…).

const EMPTY: PayrollProfileInput = {
  matricule: "",
  cnps_number: "",
  niu: "",
  category: "",
  payment_mode: "",
  account_number: "",
  gross_contractual: 0,
  base_pct: 0.6,
  fiscal_base: null,
  fiscal_parts: 1,
  apply_fiscal_parts: true,
  seniority_years: 0,
  seniority_rate: null,
  seniority_threshold: null,
  apply_seniority: false,
};

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}

export function PayrollProfilesSection({ employees, canManage }: { employees: Employee[]; canManage: boolean }) {
  const [employeeId, setEmployeeId] = useState("");
  const [form, setForm] = useState<PayrollProfileInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    getPayrollProfile(employeeId)
      .then((r) => {
        if (r.profile) {
          const { base_salary: _b, complements: _c, ...rest } = r.profile;
          setForm(rest);
        } else {
          setForm(EMPTY);
        }
        setMessage(null);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Chargement impossible."));
  }, [employeeId]);

  async function save() {
    if (!employeeId) return;
    try {
      await savePayrollProfile(employeeId, {
        ...form,
        matricule: form.matricule || null,
        cnps_number: form.cnps_number || null,
        niu: form.niu || null,
        category: form.category || null,
        payment_mode: form.payment_mode || null,
        account_number: form.account_number || null,
      });
      setMessage("Fiche paie enregistrée.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  const base = Math.round(form.gross_contractual * form.base_pct);

  function txt(label: string, key: keyof PayrollProfileInput) {
    return (
      <Field label={label}>
        <input value={(form[key] as string) ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} disabled={!canManage} />
      </Field>
    );
  }
  function n(label: string, key: keyof PayrollProfileInput, step = "any") {
    return (
      <Field label={label}>
        <input type="number" step={step} value={(form[key] as number) ?? 0} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} disabled={!canManage} style={{ fontFamily: "var(--font-mono, monospace)" }} />
      </Field>
    );
  }

  return (
    <Card title="Fiches paie (par employé)" icon={<IconAdmin />} subtitle="Données de rémunération servant au calcul du bulletin.">
      <Field label="Employé">
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">— Choisir un employé —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
        </select>
      </Field>

      {employeeId && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 10 }}>
            {txt("Matricule", "matricule")}
            {txt("N° CNPS", "cnps_number")}
            {txt("NIU (contribuable)", "niu")}
            {txt("Catégorie / échelon", "category")}
            {n("Brut contractuel (FCFA)", "gross_contractual")}
            {n("% salaire de base (0-1)", "base_pct")}
            {n("Parts fiscales", "fiscal_parts")}
            {n("Ancienneté (ans)", "seniority_years", "1")}
            {txt("Mode de paiement", "payment_mode")}
            {txt("N° de compte", "account_number")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 13 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={form.apply_fiscal_parts} disabled={!canManage} onChange={(e) => setForm({ ...form, apply_fiscal_parts: e.target.checked })} /> Appliquer les parts fiscales
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={form.apply_seniority} disabled={!canManage} onChange={(e) => setForm({ ...form, apply_seniority: e.target.checked })} /> Appliquer la prime d'ancienneté
            </label>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
            Salaire de base calculé : <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--ink)" }}>{fcfa(base)}</strong> · Compléments : <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--ink)" }}>{fcfa(form.gross_contractual - base)}</strong>
          </div>
          {canManage && (
            <div style={{ marginTop: 10 }}>
              <Button variant="add" size="sm" type="button" onClick={save}>Enregistrer la fiche paie</Button>
            </div>
          )}
        </>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
