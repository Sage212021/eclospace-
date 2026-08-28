import { useEffect, useState } from "react";
import { getTeamPerformance, type TeamPerformance } from "../api/client";
import { Card } from "./Card";
import { IconCommercial } from "./icons";

// Performance PAR commercial + total de l'équipe — réservé au responsable
// commercial et à la Direction (chaque commercial y voit sa contribution).
const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export function TeamPerformanceSection() {
  const today = new Date();
  const y = today.getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [data, setData] = useState<TeamPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    getTeamPerformance({ from, to })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const inp: React.CSSProperties = { padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 8, fontFamily: "var(--font-mono, monospace)", fontSize: 13 };
  const th: React.CSSProperties = { padding: "6px 10px", textAlign: "right", color: "var(--muted)", fontSize: 11.5 };
  const td: React.CSSProperties = { padding: "6px 10px", textAlign: "right", fontFamily: "var(--font-mono, monospace)" };

  return (
    <Card title="Performance par commercial" icon={<IconCommercial />} subtitle="Ventes de chaque commercial et total de l'équipe.">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Du<br /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Au<br /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} /></label>
        <button onClick={load} disabled={loading} style={{ ...inp, cursor: "pointer", background: "var(--eclosion)", color: "#fff", border: "none", fontFamily: "inherit", fontWeight: 700 }}>{loading ? "…" : "Générer"}</button>
      </div>
      {error && <div style={{ fontSize: 13, color: "var(--alert, #C4661F)" }}>{error}</div>}
      {data && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Commercial</th>
                <th style={th}>Ventes comptoir</th>
                <th style={th}>Commandes</th>
                <th style={th}>Chiffre d'affaires</th>
              </tr>
            </thead>
            <tbody>
              {data.reps.length === 0 && (
                <tr><td colSpan={4} style={{ padding: "10px", color: "var(--muted)", fontSize: 13 }}>Aucune vente sur la période.</td></tr>
              )}
              {data.reps.map((r) => (
                <tr key={r.user_id ?? "none"} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.username}</td>
                  <td style={td}>{r.pos_count}</td>
                  <td style={td}>{r.orders_count}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fcfa(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)" }}>
                <td style={{ padding: "6px 10px", fontWeight: 800 }}>TOTAL ÉQUIPE</td>
                <td style={{ ...td, fontWeight: 800 }}>{data.total.pos_count}</td>
                <td style={{ ...td, fontWeight: 800 }}>{data.total.orders_count}</td>
                <td style={{ ...td, fontWeight: 800, color: "var(--eclosion, #d9b21a)" }}>{fcfa(data.total.revenue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
