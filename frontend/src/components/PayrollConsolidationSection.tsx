import { useEffect, useState } from "react";
import {
  freezePayroll,
  getPayrollMode,
  getPayrollPeriod,
  getPayrollRubrics,
  preparePayroll,
  setPayrollMode,
  setPayrollRubric,
  transmitPayroll,
  validatePayroll,
  type PayrollPeriod,
  type PayrollRubric,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";
import { useI18n } from "../i18n";

// Consolidation vers la paie (§28-31). Le module fournit les données ; la paie
// reste externe (D-003). Workflow : préparer → valider → geler → transmettre.

function fmt(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}
function fcfa(n: number): string {
  return `${n.toLocaleString("fr-FR")} FCFA`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const STATUS_LABELS: Record<string, string> = {
  brouillon: "Brouillon",
  valide: "Validée",
  gele: "Gelée (figée)",
  transmis: "Transmise à la paie",
};

export function PayrollConsolidationSection({ canAdminister }: { canAdminister: boolean }) {
  const { t } = useI18n();
  const [rubrics, setRubrics] = useState<PayrollRubric[]>([]);
  const [mode, setMode] = useState("manuel");
  const [periodKey, setPeriodKey] = useState(currentPeriod());
  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getPayrollRubrics().then(setRubrics).catch(() => setRubrics([]));
    getPayrollMode().then((r) => setMode(r.mode)).catch(() => {});
  }, []);

  async function loadPeriod(key: string) {
    try {
      setPeriod(await getPayrollPeriod(key));
      setError(null);
    } catch {
      setPeriod(null); // pas encore préparée
    }
  }

  useEffect(() => {
    loadPeriod(periodKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      setMessage(ok);
      setError(null);
      await loadPeriod(periodKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opération impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMode() {
    const next = mode === "auto" ? "manuel" : "auto";
    try {
      await setPayrollMode(next);
      setMode(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Changement de mode impossible.");
    }
  }

  async function toggleRubric(code: string, enabled: boolean) {
    try {
      await setPayrollRubric(code, enabled);
      setRubrics((rs) => rs.map((r) => (r.code === code ? { ...r, enabled } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modification impossible.");
    }
  }

  const status = period?.status;

  return (
    <Card
      title={t("pay.consolidation", "Consolidation vers la paie")}
      icon={<IconAdmin />}
      subtitle={t("pay.consolidation_sub", "Le module fournit les données ; il ne modifie jamais un bulletin. La paie reste externe.")}
    >
      {/* Mode + rubriques */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13 }}>
          {t("pay.integration_mode", "Mode d'intégration :")} <strong>{mode === "auto" ? t("pay.auto", "Automatique") : t("pay.manual", "Manuel")}</strong>
          {canAdminister && <Button variant="view" size="sm" type="button" onClick={toggleMode} style={{ marginLeft: 8 }}>{t("pay.toggle", "Basculer")}</Button>}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {rubrics.map((r) => (
          <label key={r.code} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 10px", opacity: r.enabled ? 1 : 0.55 }}>
            <input type="checkbox" checked={r.enabled} disabled={!canAdminister} onChange={(e) => toggleRubric(r.code, e.target.checked)} />
            {r.label}
          </label>
        ))}
      </div>

      {/* Période + actions du workflow */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <Field label={t("pay.period_field", "Période (AAAA-MM)")}><input value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} placeholder="2026-07" style={{ fontFamily: "var(--font-mono, monospace)" }} /></Field>
        <Button variant="edit" size="sm" type="button" disabled={busy} onClick={() => act(() => preparePayroll(periodKey), t("pay.msg.prepared", "Consolidation préparée."))}>{t("pay.prepare", "Préparer")}</Button>
        {status === "brouillon" && <Button variant="add" size="sm" type="button" disabled={busy} onClick={() => act(() => validatePayroll(periodKey), t("pay.msg.validated", "Consolidation validée."))}>{t("pay.validate", "Valider")}</Button>}
        {status === "valide" && <Button variant="add" size="sm" type="button" disabled={busy} onClick={() => act(() => freezePayroll(periodKey), t("pay.msg.frozen", "Consolidation gelée."))}>{t("pay.freeze", "Geler")}</Button>}
        {status === "gele" && canAdminister && <Button variant="export" size="sm" type="button" disabled={busy} onClick={() => act(() => transmitPayroll(periodKey), t("pay.msg.transmitted", "Transmise aux variables de paie."))}>{t("pay.transmit", "Transmettre à la paie")}</Button>}
      </div>

      {period && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {t("pay.status", "Statut :")} <strong>{t("pay.pst." + period.status, STATUS_LABELS[period.status] ?? period.status)}</strong> · {period.lines.length} {t("pay.employees_count", "employés")} ·
            {" "}{t("pay.proposed_deductions", "Retenues proposées :")} <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>{fcfa(period.totals.deduction_total)}</span>
            {period.transmitted_at && <span style={{ color: "var(--eclosion, #C89A1B)" }}> · {t("pay.transmitted_on", "transmise le")} {period.transmitted_at.slice(0, 10)}</span>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                  <th style={{ padding: "5px 8px" }}>{t("att.col.employee", "Employé")}</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("att.col.worked", "Travaillé")}</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("att.col.late", "Retards")}</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("att.col.overtime", "H. sup")}</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("att.col.absent", "Abs. injust.")}</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("att.col.deduction", "Retenue")}</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {period.lines.slice(0, 100).map((l) => (
                  <tr key={l.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "inherit" }}>{l.employee_name}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(l.worked_minutes)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: l.late_minutes > 0 ? "var(--retard, #C4661F)" : undefined }}>{fmt(l.late_minutes)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: l.overtime_minutes > 0 ? "var(--eclosion, #C89A1B)" : undefined }}>{fmt(l.overtime_minutes)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{l.days_absent_unjustified}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.deduction_proposed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {period.lines.length > 100 && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("pay.rows_limited_100", "Affichage limité à 100 lignes.")}</p>}
          </div>
        </div>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
