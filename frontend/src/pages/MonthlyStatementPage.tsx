import { useEffect, useState } from "react";
import { getMonthlyStatement, type MonthlyStatement } from "../api/client";

// Bilan financier mensuel détaillé (Ch. 18) : sélecteur mois+année, synthèse
// (solde initial / entrées / sorties / solde net / solde final), détail ligne
// par ligne des entrées et des sorties, et situation excédent/déficit. Calculé
// à partir des écritures réelles du mois.
const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
const frDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export function MonthlyStatementPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<MonthlyStatement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setErr(null);
    getMonthlyStatement(month)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Chargement impossible."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [month]);

  const positive = data ? data.situation === "excedent" : false;
  const negative = data ? data.situation === "deficit" : false;
  const resultColor = positive ? "#2F7D4A" : negative ? "#B23A2E" : "var(--muted)";

  return (
    <div style={{ maxWidth: 940 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>Bilan financier mensuel</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px" }}>Éclosion Édition — état de trésorerie du mois (calculé sur les écritures réelles).</p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Mois :
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginLeft: 8, fontFamily: "var(--font-mono, monospace)", padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 6 }} />
        </label>
        {busy && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Chargement…</span>}
      </div>

      {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", border: "1px solid #E4B8AF", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 14 }}>{err}</div>}

      {data && (
        <>
          {/* 1. Synthèse */}
          <section style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Synthèse — {monthLabel(data.month)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <Stat label="Solde initial" value={fcfa(data.solde_initial)} />
              <Stat label="Total des entrées" value={fcfa(data.total_entrees)} color="#2F7D4A" />
              <Stat label="Total des sorties" value={fcfa(data.total_sorties)} color="#B23A2E" />
              <Stat label="Solde net du mois" value={fcfa(data.solde_net)} color={resultColor} />
              <Stat label="Solde final" value={fcfa(data.solde_final)} />
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: positive ? "#E7F2EB" : negative ? "#F6E2DE" : "var(--ivory, #FAF8F2)", border: `1px solid ${positive ? "#2F7D4A" : negative ? "#B23A2E" : "var(--line)"}`, fontWeight: 700, color: resultColor }}>
              Situation du mois : {positive ? `EXCÉDENTAIRE — excédent de ${fcfa(data.solde_net)}` : negative ? `DÉFICITAIRE — déficit de ${fcfa(-data.solde_net)}` : "À L'ÉQUILIBRE"}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 0 0" }}>Solde net = total des entrées − total des sorties. Solde final = solde initial + solde net. Il s'agit du solde de trésorerie du mois (distinct d'un résultat comptable).</p>
          </section>

          {/* 2. Détail des entrées */}
          <section style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Entrées — {monthLabel(data.month)} ({data.entrees.length})</div>
            <MovementTable rows={data.entrees.map((e) => ({ date: e.date, reference: e.reference, label: e.label, extra: e.origin, amount: e.amount }))} extraHeader="Origine" emptyLabel="Aucune entrée ce mois." />
            <Total label="Total des entrées" value={fcfa(data.total_entrees)} color="#2F7D4A" />
          </section>

          {/* 3. Détail des sorties */}
          <section style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Sorties — {monthLabel(data.month)} ({data.sorties.length})</div>
            <MovementTable rows={data.sorties.map((e) => ({ date: e.date, reference: e.reference, label: e.label, extra: e.category, amount: e.amount }))} extraHeader="Catégorie" emptyLabel="Aucune sortie ce mois." />
            <Total label="Total des sorties" value={fcfa(data.total_sorties)} color="#B23A2E" />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 11px", background: "#fff" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: color ?? "var(--ink)" }}>{value}</div>
    </div>
  );
}

function Total({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "baseline", marginTop: 8, paddingTop: 8, borderTop: "2px solid var(--line)" }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{label} :</span>
      <span style={{ fontWeight: 700, fontSize: 15, fontFamily: "var(--font-mono, monospace)", color }}>{value}</span>
    </div>
  );
}

function MovementTable({ rows, extraHeader, emptyLabel }: { rows: { date: string; reference: string; label: string; extra: string; amount: number }[]; extraHeader: string; emptyLabel: string }) {
  if (rows.length === 0) return <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>{emptyLabel}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
            <th style={th}>Date</th><th style={th}>Référence</th><th style={th}>Libellé</th><th style={th}>{extraHeader}</th><th style={{ ...th, textAlign: "right" }}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>{frDate(r.date)}</td>
              <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>{r.reference || "—"}</td>
              <td style={td}>{r.label}</td>
              <td style={td}>{r.extra}</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>{Math.round(r.amount).toLocaleString("fr-FR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const card: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper, #FAF8F2)", padding: 14, marginBottom: 14 };
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "6px 8px" };
