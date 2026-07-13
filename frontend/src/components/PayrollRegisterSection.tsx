import { useState } from "react";
import { closePayrollPeriod, getPayrollRegister, type PayrollRegister, type RegisterLine } from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Livre de paie mensuel + clôture/gel + exports déclarations CNPS/fiscales
// (D-007, incrément 5). La clôture fige la période (journal immuable).

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}
function currentPeriod(): string {
  const d = new Date();
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

export function PayrollRegisterSection({ canClose }: { canClose: boolean }) {
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
      setMessage(`Période ${period} clôturée : ${r.employees} salarié(s), net total ${fcfa(r.total_net)}. Le journal est figé.`);
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
      ["Salarié", "Matricule", "N° CNPS", "Assiette CNPS", "PVID salarié", "PVID patronal", "Prest. familiales", "Accidents travail"],
      reg.lines.map((l: RegisterLine) => [l.employee_name, l.matricule ?? "", l.cnps_number ?? "", l.assiette_cnps, l.pvid_salarie, l.pvid_patronal, l.prestations_familiales, l.accidents_travail]),
    );
  }
  function exportFiscal() {
    if (!reg) return;
    downloadCsv(
      `declaration-fiscale_${reg.period}.csv`,
      ["Salarié", "NIU", "IRPP + CAC", "CFC salarié", "CFC patronal", "FNE", "Taxe communale", "RAV"],
      reg.lines.map((l: RegisterLine) => [l.employee_name, l.niu ?? "", l.irpp_cac, l.cfc_salarie, l.cfc_patronal, l.fne, l.taxe_communale, l.rav]),
    );
  }

  return (
    <Card
      title="Livre de paie & clôture"
      icon={<IconAdmin />}
      subtitle="Livre mensuel de tous les salariés, clôture (journal figé) et déclarations CNPS / fiscales."
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
        <Field label="Période (AAAA-MM)"><input value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono, monospace)" }} /></Field>
        <Button variant="edit" size="sm" type="button" disabled={busy} onClick={load}>{busy ? "…" : "Générer le livre de paie"}</Button>
        {reg && reg.lines.length > 0 && <Button variant="export" size="sm" type="button" onClick={exportCnps}>Export CNPS (CSV)</Button>}
        {reg && reg.lines.length > 0 && <Button variant="export" size="sm" type="button" onClick={exportFiscal}>Export fiscal (CSV)</Button>}
        {reg && !reg.closed && reg.lines.length > 0 && canClose && <Button variant="add" size="sm" type="button" disabled={busy} onClick={close}>Clôturer la période</Button>}
      </div>

      {reg && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {reg.closed ? (
              <span style={{ color: "var(--eclosion, #C89A1B)", fontWeight: 700 }}>Période clôturée (journal figé){reg.closed_at ? ` le ${reg.closed_at.slice(0, 10)}` : ""}</span>
            ) : (
              <span>{reg.lines.length} salarié(s) · barème depuis le {reg.rate_effective_from}</span>
            )}
            {" · "}Net total : <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>{fcfa(reg.totals.net)}</span> ·
            {" "}Coût employeur : <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{fcfa(reg.totals.brut + reg.totals.charges_pat)}</span>
          </div>
          {reg.lines.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun salarié avec fiche paie sur cette période.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                    <th style={{ padding: "5px 8px" }}>Salarié</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Brut</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Retenues sal.</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Charges pat.</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Net à payer</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Coût employeur</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {reg.lines.slice(0, 150).map((l) => (
                    <tr key={l.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "inherit" }}>{l.employee_name}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.salaire_brut)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.total_retenues_salariales)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.total_charges_patronales)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--eclosion, #C89A1B)", fontWeight: 700 }}>{fcfa(l.net_a_payer)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{fcfa(l.cout_employeur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reg.lines.length > 150 && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Affichage limité à 150 lignes ; les exports CSV contiennent tout.</p>}
            </div>
          )}
        </div>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
