import { useEffect, useState } from "react";
import {
  getAttendanceDashboard,
  getMonthlyReport,
  type AttendanceDashboard,
  type MonthlyReport,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";
import { useI18n } from "../i18n";

// Tableau de bord RH + rapport mensuel (§32-33) avec exports Excel (CSV) et
// impression (PDF via le navigateur). Réservé aux profils de supervision.

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function fcfa(n: number): string {
  return `${n.toLocaleString("fr-FR")} FCFA`;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function Indicator({ label, value, tone }: { label: string; value: string; tone?: "warn" | "over" | "ok" }) {
  const color = tone === "warn" ? "var(--retard, #C4661F)" : tone === "over" ? "var(--eclosion, #C89A1B)" : tone === "ok" ? "var(--eclosion, #C89A1B)" : "var(--ink)";
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

export function AttendanceReportSection() {
  const { t, lang } = useI18n();
  const [dash, setDash] = useState<AttendanceDashboard | null>(null);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAttendanceDashboard().then(setDash).catch(() => setDash(null));
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setLoading(true);
    try {
      setReport(await getMonthlyReport({ from, to }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Génération impossible.");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!report) return;
    const header = lang === "en"
      ? ["Employee", "Department", "Time worked (min)", "Lateness (min)", "Early departures (min)", "Overtime (min)", "Days worked", "Unjustified absences", "Proposed deduction (FCFA)"]
      : ["Employé", "Département", "Temps travaillé (min)", "Retards (min)", "Départs anticipés (min)", "Heures sup (min)", "Jours travaillés", "Absences injustifiées", "Retenue proposée (FCFA)"];
    const lines = report.rows.map((r) => [r.employee_name, r.department ?? "", r.worked_minutes, r.late_minutes, r.early_leave_minutes, r.overtime_minutes, r.days_worked, r.days_absent_unjustified, r.deduction_proposed]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lang === "en" ? "attendance-report" : "rapport-presence"}_${report.from}_${report.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function print() {
    if (!report) return;
    const rowsHtml = report.rows
      .map((r) => `<tr><td>${r.employee_name}</td><td>${r.department ?? ""}</td><td style="text-align:right">${fmt(r.worked_minutes)}</td><td style="text-align:right">${fmt(r.late_minutes)}</td><td style="text-align:right">${fmt(r.early_leave_minutes)}</td><td style="text-align:right">${fmt(r.overtime_minutes)}</td><td style="text-align:right">${r.days_absent_unjustified}</td><td style="text-align:right">${fcfa(r.deduction_proposed)}</td></tr>`)
      .join("");
    const title = lang === "en" ? "Attendance report" : "Rapport de présence";
    const th = lang === "en"
      ? ["Employee", "Department", "Worked", "Lateness", "Early dep.", "Overtime", "Unjust. abs.", "Deduction"]
      : ["Employé", "Département", "Travaillé", "Retards", "Départs ant.", "Heures sup", "Abs. injust.", "Retenue"];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${report.from} → ${report.to}</title>
      <style>body{font-family:Georgia,serif;color:#16233D;padding:24px}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px;font-family:monospace}th,td{border:1px solid #ccc;padding:4px 6px}th{background:#16233D;color:#fff;text-align:left}</style>
      </head><body><h1>${title} — ${report.from} ${lang === "en" ? "to" : "au"} ${report.to}</h1>
      <table><thead><tr>${th.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rowsHtml}</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    }
  }

  return (
    <Card
      title={t("att.dashboard", "Tableau de bord & rapports RH")}
      icon={<IconAdmin />}
      subtitle={t("att.dashboard_sub", "Indicateurs de présence et rapport exportable (Excel / impression).")}
    >
      {dash && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
          <Indicator label={t("att.present_today", "Présents (jour)")} value={String(dash.present_today)} tone="ok" />
          <Indicator label={t("att.absent_today", "Absents (jour)")} value={String(dash.absent_today)} tone={dash.absent_today > 0 ? "warn" : undefined} />
          <Indicator label={t("att.late_today", "En retard (jour)")} value={String(dash.late_today)} tone={dash.late_today > 0 ? "warn" : undefined} />
          <Indicator label={t("att.early_leave_today", "Départs anticipés")} value={String(dash.early_leave_today)} tone={dash.early_leave_today > 0 ? "warn" : undefined} />
          <Indicator label={t("att.presence_rate", "Taux de présence")} value={dash.presence_rate_pct != null ? `${dash.presence_rate_pct}%` : "—"} />
          <Indicator label={t("att.overtime_month", "Heures sup (mois)")} value={fmt(dash.overtime_minutes_month)} tone="over" />
          <Indicator label={t("att.deduction_month", "Retenues (mois)")} value={fcfa(dash.deduction_month_total)} tone={dash.deduction_month_total > 0 ? "warn" : undefined} />
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
        <Field label={t("att.from", "Du")}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t("att.to", "Au")}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="edit" size="sm" type="button" onClick={generate}>{loading ? "…" : t("att.generate", "Générer")}</Button>
        {report && report.rows.length > 0 && <Button variant="export" size="sm" type="button" onClick={exportCsv}>{t("att.export_excel", "Export Excel")}</Button>}
        {report && report.rows.length > 0 && <Button variant="view" size="sm" type="button" onClick={print}>{t("att.print_pdf", "Imprimer / PDF")}</Button>}
      </div>

      {report && (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "6px 8px" }}>{t("att.col.employee", "Employé")}</th>
                <th style={{ padding: "6px 8px" }}>{t("att.col.department", "Département")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("att.col.worked", "Travaillé")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("att.col.late", "Retards")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("att.col.early", "Départs ant.")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("att.col.overtime", "H. sup")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("att.col.absent", "Abs. injust.")}</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("att.col.deduction", "Retenue")}</th>
              </tr>
            </thead>
            <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {report.rows.slice(0, 200).map((r) => (
                <tr key={r.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 8px", fontFamily: "inherit" }}>{r.employee_name}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "inherit", color: "var(--muted)" }}>{r.department ?? "—"}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(r.worked_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: r.late_minutes > 0 ? "var(--retard, #C4661F)" : undefined }}>{fmt(r.late_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: r.early_leave_minutes > 0 ? "var(--retard, #C4661F)" : undefined }}>{fmt(r.early_leave_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: r.overtime_minutes > 0 ? "var(--eclosion, #C89A1B)" : undefined }}>{fmt(r.overtime_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.days_absent_unjustified}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fcfa(r.deduction_proposed)}</td>
                </tr>
              ))}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700, fontFamily: "var(--font-mono, monospace)" }}>
                  <td style={{ padding: "6px 8px" }} colSpan={2}>{lang === "en" ? `Total (${report.headcount} employees)` : `Total (${report.headcount} employés)`}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(report.totals.worked_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(report.totals.late_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(report.totals.early_leave_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(report.totals.overtime_minutes)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{report.totals.days_absent_unjustified}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fcfa(report.totals.deduction_total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          {report.rows.length > 200 && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{t("att.rows_limited", "Affichage limité à 200 lignes ; l'export Excel contient tout.")}</p>}
        </div>
      )}

      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
