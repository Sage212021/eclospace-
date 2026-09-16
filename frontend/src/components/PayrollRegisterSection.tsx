import { useState } from "react";
import { closePayrollPeriod, getPayrollRegister, type PayrollRegister, type RegisterLine } from "../api/client";
import { Card } from "./Card";
import { TableScroll } from "./TableScroll";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";
import { useI18n } from "../i18n";

// Livre de paie mensuel + clôture/gel + exports déclarations CNPS/fiscales
// (D-007, incrément 5). La clôture fige la période (journal immuable).

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// Décale une période « AAAA-MM » de `delta` mois (robuste au passage d'année).
function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PayrollRegisterSection({ canClose, collapsible, defaultOpen }: { canClose: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState(currentPeriod());
  const [reg, setReg] = useState<PayrollRegister | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    try {
      setReg(await getPayrollRegister(period));
      setError(null);
    } catch (err) {
      setReg(null);
      setError(err instanceof Error ? err.message : "Génération impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      const r = await closePayrollPeriod(period);
      setMessage(
        lang === "en"
          ? `Period ${period} closed: ${r.employees} employee(s), total net ${fcfa(r.total_net)}. The journal is frozen.`
          : `Période ${period} clôturée : ${r.employees} salarié(s), net total ${fcfa(r.total_net)}. Le journal est figé.`,
      );
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clôture impossible.");
    } finally {
      setBusy(false);
    }
  }

  function exportCnps() {
    if (!reg) return;
    downloadCsv(
      `declaration-cnps_${reg.period}.csv`,
      lang === "en"
        ? ["Employee", "Staff no.", "CNPS no.", "CNPS base", "Employee PVID", "Employer PVID", "Family benefits", "Work accidents"]
        : ["Salarié", "Matricule", "N° CNPS", "Assiette CNPS", "PVID salarié", "PVID patronal", "Prest. familiales", "Accidents travail"],
      reg.lines.map((l: RegisterLine) => [l.employee_name, l.matricule ?? "", l.cnps_number ?? "", l.assiette_cnps, l.pvid_salarie, l.pvid_patronal, l.prestations_familiales, l.accidents_travail]),
    );
  }
  function exportFiscal() {
    if (!reg) return;
    downloadCsv(
      `declaration-fiscale_${reg.period}.csv`,
      lang === "en"
        ? ["Employee", "NIU", "IRPP + CAC", "Employee CFC", "Employer CFC", "FNE", "Communal tax", "RAV"]
        : ["Salarié", "NIU", "IRPP + CAC", "CFC salarié", "CFC patronal", "FNE", "Taxe communale", "RAV"],
      reg.lines.map((l: RegisterLine) => [l.employee_name, l.niu ?? "", l.irpp_cac, l.cfc_salarie, l.cfc_patronal, l.fne, l.taxe_communale, l.rav]),
    );
  }

  return (
    <Card
      title={t("pay.register", "Livre de paie & clôture")}
      icon={<IconAdmin />}
      subtitle={t("pay.register_sub", "Livre mensuel de tous les salariés, clôture (journal figé) et déclarations CNPS / fiscales.")}
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
        <Field label={t("pay.period_field", "Période (AAAA-MM)")}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" title={t("pay.prev_month", "Mois précédent")} onClick={() => setPeriod(shiftMonth(period, -1))} style={{ cursor: "pointer", border: "1px solid var(--line)", borderRadius: 6, background: "#fff", padding: "4px 9px", fontSize: 14, lineHeight: 1 }}>◀</button>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono, monospace)" }} />
            <button type="button" title={t("pay.next_month", "Mois suivant")} onClick={() => setPeriod(shiftMonth(period, 1))} style={{ cursor: "pointer", border: "1px solid var(--line)", borderRadius: 6, background: "#fff", padding: "4px 9px", fontSize: 14, lineHeight: 1 }}>▶</button>
          </div>
        </Field>
        <Button variant="edit" size="sm" type="button" disabled={busy} onClick={load}>{busy ? "…" : t("pay.gen_register", "Générer le livre de paie")}</Button>
        {reg && reg.lines.length > 0 && <Button variant="export" size="sm" type="button" onClick={exportCnps}>{t("pay.export_cnps", "Export CNPS (CSV)")}</Button>}
        {reg && reg.lines.length > 0 && <Button variant="export" size="sm" type="button" onClick={exportFiscal}>{t("pay.export_fiscal", "Export fiscal (CSV)")}</Button>}
        {reg && !reg.closed && reg.lines.length > 0 && canClose && <Button variant="add" size="sm" type="button" disabled={busy} onClick={close}>{t("pay.close_period", "Clôturer la période")}</Button>}
      </div>

      {reg && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {reg.closed ? (
              <span style={{ color: "var(--eclosion, #d9b21a)", fontWeight: 700 }}>{t("pay.period_closed", "Période clôturée (journal figé)")}{reg.closed_at ? `${t("pay.on", " le ")}${reg.closed_at.slice(0, 10)}` : ""}</span>
            ) : (
              <span>{reg.lines.length} {t("pay.employees_count", "salarié(s)")} · {t("pay.scale_since", "barème depuis le")} {reg.rate_effective_from}</span>
            )}
            {" · "}{t("pay.net_total", "Net total :")} <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>{fcfa(reg.totals.net)}</span> ·
            {" "}{t("pay.employer_cost", "Coût employeur :")} <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{fcfa(reg.totals.brut + reg.totals.charges_pat)}</span>
            {reg.monthly_status && (
              <span style={{ display: "block", marginTop: 4, fontSize: 12, color: reg.monthly_status === "valide" ? "var(--eclosion-dark, #9a7a12)" : "var(--muted)" }}>
                {reg.monthly_status === "valide"
                  ? t("pay.reg_from_validated", "Montants issus du mois de paie validé (éléments variables inclus).")
                  : t("pay.reg_from_draft", "Montants issus du mois de paie préparé (brouillon — à valider par la Direction avant clôture).")}
              </span>
            )}
          </div>
          {reg.lines.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("pay.no_employee_period", "Aucun salarié avec fiche paie sur cette période.")}</p>
          ) : (
            <TableScroll>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                    <th style={{ padding: "5px 8px" }}>{t("att.col.employee", "Salarié")}</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("pay.col.gross", "Brut")}</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("pay.col.emp_deductions", "Retenues sal.")}</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("pay.col.emp_charges", "Charges pat.")}</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("pay.col.net", "Net à payer")}</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>{t("pay.col.employer_cost", "Coût employeur")}</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {reg.lines.slice(0, 150).map((l) => (
                    <tr key={l.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "inherit" }}>{l.employee_name}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.salaire_brut)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.total_retenues_salariales)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.total_charges_patronales)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--eclosion, #d9b21a)", fontWeight: 700 }}>{fcfa(l.net_a_payer)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.cout_employeur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reg.lines.length > 150 && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("pay.rows_limited_150", "Affichage limité à 150 lignes ; les exports CSV contiennent tout.")}</p>}
            </TableScroll>
          )}
        </div>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
