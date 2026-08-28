import { useState } from "react";
import { getErpConnections, type Employee, type ErpConnectionRecord } from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { GuidanceNote } from "./GuidanceNote";
import { IconAdmin } from "./icons";

// Relevé des connexions ERP (spec opérateur 12/08/2026) — remplace l'ancien
// module « Anomalies de présence ». Simple CONSULTATION à but d'arbitrage : les
// connexions/déconnexions à l'ERP sont indicatives et n'ont AUCUN effet sur la
// paie. Références officielles de présence = pointeur physique + registre manuel.

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

export function ErpConnectionsSection({ employees }: { employees: Employee[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const active = employees.filter((e) => !e.departureDate || e.departureDate >= today);
  const [employeeId, setEmployeeId] = useState<string>(active[0]?.id ?? "");
  const [month, setMonth] = useState<string>(currentMonth());
  const [record, setRecord] = useState<ErpConnectionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!employeeId) { setError("Choisissez un employé."); return; }
    setLoading(true);
    try {
      setRecord(await getErpConnections(employeeId, month));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Consultation impossible.");
      setRecord(null);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!record) return;
    const header = ["Date", "Jour", "1re connexion", "Dernière déconnexion", "Nb connexions", "Nb déconnexions"];
    const lines = record.days.map((d) => [d.date, WEEKDAYS[d.weekday], d.first_login ?? "", d.last_logout ?? "", d.nb_logins, d.nb_logouts]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `releve-connexions-erp_${record.employee.name.replace(/\s+/g, "-")}_${record.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function print() {
    if (!record) return;
    const rowsHtml = record.days
      .map((d) => `<tr${d.has_connection ? "" : ' style="color:#8a94a6"'}><td>${d.date}</td><td>${WEEKDAYS[d.weekday]}</td><td>${d.first_login ?? "—"}</td><td>${d.last_logout ?? "—"}</td><td style="text-align:right">${d.nb_logins}</td><td style="text-align:right">${d.nb_logouts}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relevé connexions ERP — ${record.employee.name} — ${record.month}</title>
      <style>body{font-family:Georgia,serif;color:#0b0b0c;padding:24px}h1{font-size:18px;margin-bottom:2px}p.note{font-size:11px;color:#555;max-width:640px}table{width:100%;border-collapse:collapse;font-size:12px;font-family:monospace;margin-top:12px}th,td{border:1px solid #ccc;padding:4px 6px}th{background:#0b0b0c;color:#fff;text-align:left}</style>
      </head><body><h1>Relevé des connexions ERP</h1>
      <div style="font-size:13px">${record.employee.name} — ${record.month} · ${record.recap.days_with_connection}/${record.recap.days_in_month} jour(s) avec connexion · ${record.recap.total_logins} connexion(s), ${record.recap.total_logouts} déconnexion(s)</div>
      <p class="note">${record.notice}</p>
      <table><thead><tr><th>Date</th><th>Jour</th><th>1re connexion</th><th>Dernière déconnexion</th><th>Nb connexions</th><th>Nb déconnexions</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  return (
    <Card
      title="Relevé des connexions ERP"
      icon={<IconAdmin />}
      subtitle="Trace indicative des connexions/déconnexions — outil d'arbitrage RH, sans effet sur la paie"
      collapsible
    >
      <GuidanceNote title="À quoi sert ce relevé (et à quoi il ne sert pas)">
        Ce relevé montre <b>quand</b> un employé s'est connecté/déconnecté de l'ERP. C'est une simple trace technique, utile
        comme <b>élément d'arbitrage</b> quand une présence doit être vérifiée. Ce <b>n'est pas un pointage</b> : il ne prouve
        pas la présence physique et n'a <b>aucun effet automatique sur la paie</b> (jamais d'absence, de retard ni de retenue
        générés d'ici). Les références officielles restent le <b>pointeur physique</b> et le <b>registre manuel signé</b>.
        Toute retenue éventuelle passe par le processus RH habituel, dans le bulletin.
      </GuidanceNote>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, marginTop: 8 }}>
        <Field label="Employé">
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">— choisir —</option>
            {active.map((e) => <option key={e.id} value={e.id}>{e.lastName} {e.firstName}</option>)}
          </select>
        </Field>
        <Field label="Mois"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Button variant="edit" size="sm" type="button" onClick={generate}>{loading ? "…" : "Consulter"}</Button>
        {record && <Button variant="export" size="sm" type="button" onClick={exportCsv}>Export Excel</Button>}
        {record && <Button variant="view" size="sm" type="button" onClick={print}>Imprimer / PDF</Button>}
      </div>

      {record && !record.employee.has_erp_account && (
        <div style={{ background: "#fdf3e6", color: "var(--retard, #C4661F)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          Cet employé n'a pas de compte ERP relié : aucune connexion ne peut être enregistrée à son nom.
        </div>
      )}

      {record && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, margin: "14px 0", paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
            <Recap label="Jours avec connexion" value={`${record.recap.days_with_connection} / ${record.recap.days_in_month}`} />
            <Recap label="Connexions (mois)" value={String(record.recap.total_logins)} />
            <Recap label="Déconnexions (mois)" value={String(record.recap.total_logouts)} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                  <th style={{ padding: "6px 8px" }}>Date</th>
                  <th style={{ padding: "6px 8px" }}>Jour</th>
                  <th style={{ padding: "6px 8px" }}>1re connexion</th>
                  <th style={{ padding: "6px 8px" }}>Dernière déconnexion</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Nb connexions</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Nb déconnexions</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {record.days.map((d) => (
                  <tr key={d.date} style={{ borderTop: "1px solid var(--line)", color: d.has_connection ? undefined : "var(--muted)" }}>
                    <td style={{ padding: "6px 8px" }}>{d.date}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "inherit" }}>{WEEKDAYS[d.weekday]}</td>
                    <td style={{ padding: "6px 8px" }}>{d.first_login ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{d.last_logout ?? "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{d.nb_logins || "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{d.nb_logouts || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
