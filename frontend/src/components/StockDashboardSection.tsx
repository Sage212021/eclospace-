import { useEffect, useState } from "react";
import {
  getStockDashboard,
  getStockFluctuation,
  getStockFluctuationByBook,
  type StockDashboard,
  type StockFluctuation,
  type StockBookFluctuation,
  type StockMovementType,
} from "../api/client";
import { Card } from "./Card";
import { IconCommercial } from "./icons";

// Libellés des types de mouvement (repris du pôle Stock) pour la fluctuation.
const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  production_in: "Production / impression",
  supplier_in: "Réapprovisionnement fournisseur",
  sale_out: "Vente",
  consignment_out: "Dépôt-vente (sortie)",
  consignment_return: "Retour de dépôt-vente",
  customer_return: "Retour client",
  commercial_return: "Retour commercial",
  transfer: "Transfert",
  press_copy: "Service de presse",
  author_copy: "Exemplaires auteur",
  promotional_out: "Communication / promotion",
  institutional_out: "Sortie institutionnelle",
  event_out: "Événement",
  free_out: "Don / ouvrage offert",
  event_return: "Retour d'événement",
  promotional_return: "Retour de promotion",
  other_return: "Autre retour",
  loss: "Perte",
  damage: "Détérioration / casse",
  destruction: "Destruction",
  pulping: "Mise au pilon",
  inventory_adjustment: "Ajustement d'inventaire",
};

const firstOfMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`; };
const firstOfNextMonth = () => { const d = new Date(); const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); return n.toISOString().slice(0, 10); };
const nf = (n: number) => n.toLocaleString("fr-FR");

const STATE_LABEL: Record<StockBookFluctuation["state"], { label: string; color: string; bg: string }> = {
  rupture: { label: "Rupture", color: "var(--alert, #B23A2E)", bg: "var(--alert-soft, #f8e3df)" },
  faible: { label: "Stock faible", color: "#8a5a00", bg: "#fbf0d8" },
  normal: { label: "Normal", color: "var(--positive, #2F7D4A)", bg: "#e7f1ea" },
};

export function StockDashboardSection() {
  const [dash, setDash] = useState<StockDashboard | null>(null);
  const [books, setBooks] = useState<StockBookFluctuation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStockDashboard().then(setDash).catch((e) => setError(e instanceof Error ? e.message : "Chargement du tableau de bord impossible."));
    getStockFluctuationByBook().then((r) => setBooks(r.rows)).catch(() => setBooks([]));
  }, []);

  return (
    <>
      <Card title="Tableau de bord du stock" icon={<IconCommercial />} subtitle="Indicateurs de pilotage, calculés en temps réel à partir des mouvements." collapsible defaultOpen>
        {error && <p style={{ color: "var(--alert)", fontSize: 13, margin: 0 }}>{error}</p>}
        {!error && !dash && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}
        {dash && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Tile label="Stock total disponible" value={dash.stock_total} accent />
            <Tile label="Ouvrages en stock faible" value={dash.low_stock_count} warn={dash.low_stock_count > 0} />
            <Tile label="Réapprovisionnements en cours" value={dash.replenishments_in_progress} />
            <Tile label={`Entrées (${dash.month})`} value={dash.entries_month} />
            <Tile label={`Sorties (${dash.month})`} value={dash.exits_month} />
            <Tile label={`Détruits / détériorés (${dash.month})`} value={dash.destroyed_damaged_month} warn={dash.destroyed_damaged_month > 0} />
            <Tile label={`Offerts / dons (${dash.month})`} value={dash.offered_month} />
            <Tile label={`Écarts d'inventaire (${dash.month})`} value={dash.inventory_variances_month} warn={dash.inventory_variances_month !== 0} />
          </div>
        )}
      </Card>

      <CategoryFluctuationCard />

      <Card title="Fluctuation par ouvrage" icon={<IconCommercial />} subtitle="Pour chaque ouvrage : stock initial + entrées − sorties ± ajustements = disponible." collapsible defaultOpen>
        {!books && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}
        {books && books.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun ouvrage avec des mouvements de stock.</p>}
        {books && books.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)" }}>
                  <th style={th}>Ouvrage</th>
                  <th style={thR}>Initial</th>
                  <th style={thR}>Entrées</th>
                  <th style={thR}>Sorties</th>
                  <th style={thR}>Ajustements</th>
                  <th style={thR}>Disponible</th>
                  <th style={thR}>Seuil</th>
                  <th style={th}>État</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {books.map((b) => {
                  const st = STATE_LABEL[b.state];
                  return (
                    <tr key={b.isbn_id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ ...td, fontFamily: "inherit" }}>
                        <div style={{ fontWeight: 600 }}>{b.title ?? b.isbn13}</div>
                        {b.author && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{b.author}</div>}
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.isbn13}</div>
                      </td>
                      <td style={tdR}>{nf(b.initial)}</td>
                      <td style={{ ...tdR, color: "var(--positive, #2F7D4A)" }}>+{nf(b.entries)}</td>
                      <td style={{ ...tdR, color: "var(--ink)" }}>−{nf(b.exits)}</td>
                      <td style={tdR}>{b.adjustments >= 0 ? "+" : "−"}{nf(Math.abs(b.adjustments))}</td>
                      <td style={{ ...tdR, fontWeight: 700 }}>{nf(b.available)}</td>
                      <td style={{ ...tdR, color: "var(--muted)" }}>{nf(b.threshold)}</td>
                      <td style={td}><span style={{ background: st.bg, color: st.color, borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 600, fontFamily: "system-ui" }}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function CategoryFluctuationCard() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(firstOfNextMonth());
  const [data, setData] = useState<StockFluctuation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    getStockFluctuation({ from, to }).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, [from, to]);

  const list = (rows: { type: StockMovementType; quantity: number }[], color: string, empty: string) =>
    rows.length === 0 ? <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0" }}>{empty}</p> : (
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "5px 8px" }}>{MOVEMENT_LABELS[r.type] ?? r.type}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 600, color }}>{nf(r.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <Card title="Fluctuation par catégorie" icon={<IconCommercial />} subtitle="Entrées et sorties par motif, sur la période choisie." collapsible defaultOpen>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 12.5 }}>Du<br /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 12.5 }}>Au (exclu)<br /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}
      {!error && !data && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Sorties · total <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{nf(data.total_out)}</span></div>
            {list(data.exits, "var(--ink)", "Aucune sortie sur la période.")}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Entrées · total <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--positive, #2F7D4A)" }}>{nf(data.total_in)}</span></div>
            {list(data.entries, "var(--positive, #2F7D4A)", "Aucune entrée sur la période.")}
          </div>
        </div>
      )}
    </Card>
  );
}

function Tile({ label, value, accent, warn }: { label: string; value: number; accent?: boolean; warn?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", background: accent ? "var(--paper, #faf8f2)" : "var(--card)" }}>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: warn ? "var(--alert, #B23A2E)" : accent ? "var(--eclosion-dark, #9a7a12)" : "var(--ink)" }}>{nf(value)}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.3 }}>{label}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600 };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "7px 10px", verticalAlign: "top" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
