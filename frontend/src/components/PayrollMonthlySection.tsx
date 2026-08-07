import { useEffect, useState } from "react";
import { getPayrollMonth, preparePayrollMonth, savePayrollMonthLine, type PayrollMonth, type PayrollMonthLine, type PayrollMonthElements } from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Cycle mensuel de paie (chantier 07/08/2026) — Étape 1 : grille éditable.
// Le RH prépare le mois pour tous les salariés, saisit les éléments variables
// (primes, heures sup, absences, retards, avances, prêts, sanctions, autres) ;
// le NET se recalcule automatiquement. Le mois reste modifiable (brouillon).

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const COLS: { key: keyof PayrollMonthElements; label: string; hint: string }[] = [
  { key: "primes", label: "Primes", hint: "Primes exceptionnelles (imposable)" },
  { key: "heures_sup", label: "H. sup", hint: "Heures supplémentaires — montant (imposable)" },
  { key: "retenue_absence", label: "Absences", hint: "Retenue d'absence (avant impôt)" },
  { key: "retard", label: "Retards", hint: "Retenue de retard (net)" },
  { key: "avance", label: "Avances", hint: "Avance sur salaire (net)" },
  { key: "pret", label: "Prêts", hint: "Remboursement de prêt (net)" },
  { key: "sanction", label: "Sanctions", hint: "Sanction (net)" },
  { key: "autres", label: "Autres", hint: "Autres retenues internes (net)" },
];

export function PayrollMonthlySection({ canManage, collapsible, defaultOpen }: { canManage: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [month, setMonth] = useState<PayrollMonth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Copie éditable locale des éléments par salarié (saisie fluide).
  const [draft, setDraft] = useState<Record<string, PayrollMonthElements>>({});

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const m = await getPayrollMonth(period);
      setMonth(m);
      const d: Record<string, PayrollMonthElements> = {};
      for (const l of m.lines ?? []) d[l.employee_id] = { ...l.elements };
      setDraft(d);
    } catch (err) {
      setMonth(null);
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      await preparePayrollMonth(period);
      setMessage(`Mois ${period} préparé pour tous les salariés dotés d'une fiche paie.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Préparation impossible.");
    } finally {
      setBusy(false);
    }
  }

  const locked = month?.status === "valide";

  async function saveRow(l: PayrollMonthLine) {
    if (locked) return;
    try {
      await savePayrollMonthLine(period, l.employee_id, draft[l.employee_id], l.note);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  function setCell(employeeId: string, key: keyof PayrollMonthElements, value: string) {
    setDraft((cur) => ({ ...cur, [employeeId]: { ...cur[employeeId], [key]: Math.max(Number(value) || 0, 0) } }));
  }

  return (
    <Card
      title="Génération mensuelle (tous les salariés)"
      icon={<IconAdmin />}
      subtitle="Préparez le mois, saisissez les éléments variables par salarié ; le net se recalcule automatiquement."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
        <Field label="Mois de paie (AAAA-MM)"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono, monospace)" }} /></Field>
        {month && !month.exists && canManage && (
          <Button variant="add" size="sm" type="button" disabled={busy} onClick={prepare}>{busy ? "…" : "Préparer le mois de paie"}</Button>
        )}
        {month?.exists && (
          <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", ...(locked ? { background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #8A6A12)" } : { background: "#eef1f6", color: "var(--muted)" }) }}>
            {locked ? `✓ Validé${month.validated_at ? ` le ${month.validated_at.slice(0, 10)}` : ""}` : "● Brouillon (modifiable)"}
          </span>
        )}
      </div>

      {month?.exists && month.lines && (
        <>
          <div style={{ marginTop: 10, fontSize: 13 }}>
            {month.lines.length} salarié(s) · barème depuis le {month.rate_effective_from} · Net total :{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--eclosion, #C89A1B)" }}>{fcfa(month.totals?.net ?? 0)}</span> · Coût employeur :{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{fcfa(month.totals?.cout ?? 0)}</span>
          </div>
          {!locked && <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>Saisissez les montants (FCFA) ; l'enregistrement se fait en quittant la case. Le net se met à jour.</p>}

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--muted)", fontSize: 11.5 }}>
                  <th style={{ padding: "5px 8px", textAlign: "left", position: "sticky", left: 0, background: "var(--card, #fff)" }}>Salarié</th>
                  {COLS.map((c) => <th key={c.key} style={{ padding: "5px 6px" }} title={c.hint}>{c.label}</th>)}
                  <th style={{ padding: "5px 8px" }}>Net à payer</th>
                </tr>
              </thead>
              <tbody>
                {month.lines.map((l) => (
                  <tr key={l.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--card, #fff)" }}>
                      {l.employee_name}
                      {l.matricule && <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", marginLeft: 6 }}>{l.matricule}</span>}
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} style={{ padding: "2px 4px" }}>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          disabled={locked}
                          value={draft[l.employee_id]?.[c.key] ?? 0}
                          onChange={(e) => setCell(l.employee_id, c.key, e.target.value)}
                          onBlur={() => saveRow(l)}
                          style={{ width: 84, padding: "4px 6px", textAlign: "right", fontFamily: "var(--font-mono, monospace)", border: "1px solid var(--line)", borderRadius: 5, background: locked ? "#f4f5f8" : "#fff" }}
                        />
                      </td>
                    ))}
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 700, color: "var(--eclosion, #C89A1B)", whiteSpace: "nowrap" }}>{fcfa(l.net_a_payer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
            Prochaine étape (à venir) : validation par le Directeur général, puis impression des bulletins PDF, livre de paie et états CNPS/fiscaux.
          </p>
        </>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
