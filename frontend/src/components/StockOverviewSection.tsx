import { useEffect, useMemo, useState } from "react";
import {
  getStockOverview,
  getStockPolicy,
  putStockPolicy,
  type StockOverviewRow,
  type StockOverview,
  type StockPolicy,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Modal, Field } from "./Modal";
import { TableScroll } from "./TableScroll";
import { IconCommercial } from "./icons";

const nf = (n: number) => n.toLocaleString("fr-FR");
const orDash = (n: number | null) => (n == null ? "—" : nf(n));

const STATUT: Record<StockOverviewRow["statut"], { label: string; color: string; bg: string }> = {
  normal: { label: "Normal", color: "var(--positive, #2F7D4A)", bg: "#e7f1ea" },
  alerte: { label: "Alerte", color: "#8a5a00", bg: "#fbf0d8" },
  reappro: { label: "À réapprovisionner", color: "#B87400", bg: "#faecd2" },
  rupture: { label: "Rupture", color: "var(--alert, #B23A2E)", bg: "var(--alert-soft, #f8e3df)" },
};

type Filter = "all" | "alerte" | "reappro" | "rupture" | "depot" | "transit";

// Tableau récapitulatif du stock PAR OUVRAGE (cahier §4). Chiffres calculés
// automatiquement (mouvements, items, dépôts, transit) ; seuls les seuils et le
// stock cible sont paramétrables (§18). Tableau large → défilant au doigt.
export function StockOverviewSection({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<StockOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editIsbn, setEditIsbn] = useState<{ isbn_id: string; title: string | null } | null>(null);
  const [detailRow, setDetailRow] = useState<StockOverviewRow | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setData(null); setError(null);
    getStockOverview().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Chargement du tableau impossible."));
  }, [reload]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (needle && !(`${r.title ?? ""} ${r.author ?? ""} ${r.isbn13}`.toLowerCase().includes(needle))) return false;
      if (filter === "alerte") return r.statut === "alerte";
      if (filter === "reappro") return r.statut === "reappro" || r.statut === "rupture";
      if (filter === "rupture") return r.statut === "rupture";
      if (filter === "depot") return r.en_depot > 0;
      if (filter === "transit") return r.en_transit > 0;
      return true;
    });
  }, [data, q, filter]);

  return (
    <Card
      title="Stock par ouvrage"
      icon={<IconCommercial />}
      subtitle="Un tableau récapitulatif par ouvrage — tous les chiffres sont calculés automatiquement à partir des mouvements réels (aucun stock théorique)."
      collapsible
      defaultOpen
    >
      {error && <p style={{ color: "var(--alert)", fontSize: 13, margin: 0 }}>{error}</p>}
      {!error && !data && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Chargement…</p>}
      {data && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un titre, un auteur, un ISBN…"
              style={{ flex: "1 1 220px", minWidth: 180 }}
            />
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ fontSize: 13 }}>
              <option value="all">Tous les ouvrages</option>
              <option value="alerte">Stock faible (alerte)</option>
              <option value="reappro">À réapprovisionner / rupture</option>
              <option value="rupture">En rupture</option>
              <option value="depot">En dépôt</option>
              <option value="transit">En transit</option>
            </select>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {rows.length} ouvrage{rows.length > 1 ? "s" : ""}
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <Kpi label="Stock physique" value={data.totals.stock_physique} />
            <Kpi label="Disponible" value={data.totals.disponible} accent />
            <Kpi label="En dépôt" value={data.totals.en_depot} />
            <Kpi label="En transit" value={data.totals.en_transit} />
            <Kpi label="Sous seuil" value={data.counts.sous_seuil} warn={data.counts.sous_seuil > 0} />
            <Kpi label="À réapprovisionner" value={data.counts.a_reapprovisionner} warn={data.counts.a_reapprovisionner > 0} />
            <Kpi label="En rupture" value={data.counts.rupture} danger={data.counts.rupture > 0} />
          </div>

          {rows.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun ouvrage ne correspond.</p>
          ) : (
            <TableScroll>
              <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 1850 }}>
                <thead>
                  <tr style={{ textAlign: "right", borderBottom: "2px solid var(--line)", color: "var(--muted)", fontSize: 11 }}>
                    <th style={{ ...thL, position: "sticky", left: 0, background: "var(--card, #fff)", zIndex: 1 }}>Ouvrage</th>
                    <th style={thR}>Stock initial</th>
                    <th style={thR}>Entrées</th>
                    <th style={thR}>Retours</th>
                    <th style={thR}>Sorties</th>
                    <th style={thR}>Ajust.</th>
                    <th style={thR}>Physique</th>
                    <th style={thR}>Réservé</th>
                    <th style={thR}>Disponible</th>
                    <th style={thR}>En dépôt</th>
                    <th style={thR}>En transit</th>
                    <th style={thR}>Défectueux</th>
                    <th style={thR}>Ventes/mois</th>
                    <th style={thR}>Couverture</th>
                    <th style={thR}>Seuil alerte</th>
                    <th style={thR}>Seuil réappro.</th>
                    <th style={thR}>Stock cible</th>
                    <th style={thR}>À réappro.</th>
                    <th style={thR}>Conseillé</th>
                    <th style={thC}>Statut</th>
                    <th style={thC}>Actions</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {rows.map((r) => {
                    const st = STATUT[r.statut];
                    return (
                      <tr key={r.isbn_id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ ...tdL, position: "sticky", left: 0, background: "var(--card, #fff)", fontFamily: "system-ui", minWidth: 180 }}>
                          <div style={{ fontWeight: 600 }}>{r.title ?? "Sans titre"}</div>
                          {r.author && <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.author}</div>}
                          <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--font-mono, monospace)" }}>{r.isbn13}</div>
                        </td>
                        <td style={tdR}>{nf(r.stock_initial)}</td>
                        <td style={{ ...tdR, color: "var(--positive, #2F7D4A)" }}>+{nf(r.entrees)}</td>
                        <td style={{ ...tdR, color: "var(--positive, #2F7D4A)" }}>+{nf(r.retours)}</td>
                        <td style={tdR}>−{nf(r.sorties)}</td>
                        <td style={tdR}>{r.ajustements >= 0 ? "+" : "−"}{nf(Math.abs(r.ajustements))}</td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{nf(r.stock_physique)}</td>
                        <td style={{ ...tdR, color: "var(--muted)" }}>{nf(r.reserve)}</td>
                        <td style={{ ...tdR, fontWeight: 700, color: r.disponible <= 0 ? "var(--alert, #B23A2E)" : "var(--ink)" }}>{nf(r.disponible)}</td>
                        <td style={tdR}>{nf(r.en_depot)}</td>
                        <td style={tdR}>{nf(r.en_transit)}</td>
                        <td style={{ ...tdR, color: r.defectueux > 0 ? "#8a5a00" : "var(--muted)" }}>{nf(r.defectueux)}</td>
                        <td style={tdR}>{r.ventes_par_mois > 0 ? r.ventes_par_mois.toLocaleString("fr-FR") : "—"}</td>
                        <td style={{ ...tdR, color: r.couverture_mois != null && r.couverture_mois < 2 ? "#B87400" : "var(--ink)" }}>{r.couverture_mois != null ? `${r.couverture_mois.toLocaleString("fr-FR")} m` : "—"}</td>
                        <td style={{ ...tdR, color: "var(--muted)" }}>{nf(r.seuil_alerte)}</td>
                        <td style={{ ...tdR, color: "var(--muted)" }}>{orDash(r.seuil_reappro)}</td>
                        <td style={{ ...tdR, color: "var(--muted)" }}>{orDash(r.stock_cible)}</td>
                        <td style={{ ...tdR, fontWeight: 700, color: (r.qte_a_reapprovisionner ?? 0) > 0 ? "#B87400" : "var(--muted)" }}>{orDash(r.qte_a_reapprovisionner)}</td>
                        <td style={{ ...tdR, fontWeight: 700, color: r.reappro_conseille > 0 ? "var(--eclosion-dark, #9a7a12)" : "var(--muted)" }}>{r.reappro_conseille > 0 ? nf(r.reappro_conseille) : "—"}</td>
                        <td style={tdC}><span style={{ background: st.bg, color: st.color, borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 600, fontFamily: "system-ui", whiteSpace: "nowrap" }}>{st.label}</span></td>
                        <td style={tdC}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                            <Button variant="view" size="sm" onClick={() => setDetailRow(r)}>Détail</Button>
                            {canManage && <Button variant="view" size="sm" onClick={() => setEditIsbn({ isbn_id: r.isbn_id, title: r.title })}>Paramètres</Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>
            Physique = exemplaires réellement présents. Disponible = physique − réservé. « À réappro. » = stock cible − disponible (règle simple). « Conseillé » = proposition tenant compte des ventes réelles, du délai de réimpression, du disponible et du transit (cliquez « Détail » pour le calcul). Couverture = disponible ÷ ventes par mois. Statut : Normal · Alerte · À réapprovisionner · Rupture.
          </p>
        </>
      )}

      {editIsbn && (
        <PolicyDialog
          isbnId={editIsbn.isbn_id}
          title={editIsbn.title}
          onClose={() => setEditIsbn(null)}
          onSaved={() => { setEditIsbn(null); setReload((n) => n + 1); }}
        />
      )}
      {detailRow && <DetailDialog row={detailRow} onClose={() => setDetailRow(null)} />}
    </Card>
  );
}

function DetailDialog({ row, onClose }: { row: StockOverviewRow; onClose: () => void }) {
  const line = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{value}</span>
    </div>
  );
  const block = (title: string) => <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 4px", color: "var(--eclosion-dark, #9a7a12)" }}>{title}</div>;
  return (
    <Modal
      title={row.title ?? row.isbn13}
      onClose={onClose}
      footer={<Button variant="view" size="sm" onClick={onClose}>Fermer</Button>}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
        {row.author ? `${row.author} · ` : ""}<span style={{ fontFamily: "var(--font-mono)" }}>{row.isbn13}</span>
      </div>

      {block("Stock")}
      {line("Stock initial", nf(row.stock_initial))}
      {line("Entrées", `+${nf(row.entrees)}`)}
      {line("Retours", `+${nf(row.retours)}`)}
      {line("Sorties", `−${nf(row.sorties)}`)}
      {line("Ajustements", `${row.ajustements >= 0 ? "+" : "−"}${nf(Math.abs(row.ajustements))}`)}
      {line("Stock physique", nf(row.stock_physique))}
      {line("Réservé", nf(row.reserve))}
      {line("Disponible", nf(row.disponible))}
      {line("En dépôt", nf(row.en_depot))}
      {line("En transit", nf(row.en_transit))}
      {line("Défectueux", nf(row.defectueux))}

      {block("Rotation (ventes réelles)")}
      {line("Ventes 30 derniers jours", nf(row.ventes_1m))}
      {line("Ventes 3 mois", nf(row.ventes_3m))}
      {line("Ventes 6 mois", nf(row.ventes_6m))}
      {line("Ventes 12 mois", nf(row.ventes_12m))}
      {line("Cadence retenue", row.ventes_par_mois > 0 ? `${row.ventes_par_mois.toLocaleString("fr-FR")} / mois` : "—")}
      {line("Couverture estimée", row.couverture_mois != null ? `${row.couverture_mois.toLocaleString("fr-FR")} mois` : "—")}

      {block("Réapprovisionnement conseillé")}
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700, fontSize: 20, color: row.reappro_conseille > 0 ? "var(--eclosion-dark, #9a7a12)" : "var(--muted)" }}>
        {row.reappro_conseille > 0 ? `${nf(row.reappro_conseille)} exemplaires` : "Aucun réappro nécessaire"}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0", lineHeight: 1.5 }}>{row.reappro_explication}</p>
    </Modal>
  );
}

function Kpi({ label, value, accent, warn, danger }: { label: string; value: number; accent?: boolean; warn?: boolean; danger?: boolean }) {
  const color = danger ? "var(--alert, #B23A2E)" : warn ? "#8a5a00" : accent ? "var(--eclosion-dark, #9a7a12)" : "var(--ink)";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", background: accent ? "var(--paper, #faf8f2)" : "var(--card)", minWidth: 108 }}>
      <div style={{ fontSize: 19, fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color }}>{nf(value)}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function PolicyDialog({ isbnId, title, onClose, onSaved }: { isbnId: string; title: string | null; onClose: () => void; onSaved: () => void }) {
  const [policy, setPolicy] = useState<StockPolicy | null>(null);
  const [alerte, setAlerte] = useState("");
  const [reappro, setReappro] = useState("");
  const [cible, setCible] = useState("");
  const [minReprint, setMinReprint] = useState("");
  const [lead, setLead] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    getStockPolicy(isbnId).then((p) => {
      setPolicy(p);
      setAlerte(p.alert_threshold != null ? String(p.alert_threshold) : "");
      setReappro(p.reorder_threshold != null ? String(p.reorder_threshold) : "");
      setCible(p.target_stock != null ? String(p.target_stock) : "");
      setMinReprint(p.min_reprint_qty != null ? String(p.min_reprint_qty) : "");
      setLead(p.reprint_lead_days != null ? String(p.reprint_lead_days) : "");
    }).catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible."));
  }, [isbnId]);

  const numOrNull = (s: string) => { const v = s.trim(); if (!v) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

  async function save() {
    setBusy(true); setErr("");
    try {
      await putStockPolicy(isbnId, {
        alert_threshold: numOrNull(alerte),
        reorder_threshold: numOrNull(reappro),
        target_stock: numOrNull(cible),
        min_reprint_qty: numOrNull(minReprint),
        reprint_lead_days: numOrNull(lead),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Paramètres de stock — ${title ?? "ouvrage"}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="view" size="sm" onClick={onClose}>Annuler</Button>
          <Button variant="add" size="sm" onClick={save} disabled={busy || !policy}>{busy ? "Enregistrement…" : "Enregistrer"}</Button>
        </>
      }
    >
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
        Ces seuils pilotent les alertes et la quantité à réapprovisionner. Laissez vide pour utiliser la valeur par défaut{policy ? ` (alerte par défaut : ${policy.default_alert_threshold})` : ""}.
      </p>
      <Field label="Seuil d'alerte (stock faible)"><input type="number" min={0} value={alerte} onChange={(e) => setAlerte(e.target.value)} placeholder={policy ? String(policy.default_alert_threshold) : ""} /></Field>
      <Field label="Seuil de réapprovisionnement"><input type="number" min={0} value={reappro} onChange={(e) => setReappro(e.target.value)} /></Field>
      <Field label="Stock cible (niveau à reconstituer)"><input type="number" min={0} value={cible} onChange={(e) => setCible(e.target.value)} /></Field>
      <Field label="Quantité minimale de réimpression"><input type="number" min={0} value={minReprint} onChange={(e) => setMinReprint(e.target.value)} /></Field>
      <Field label="Délai moyen de réimpression (jours)"><input type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
      {err && <p style={{ fontSize: 12, color: "var(--alert, #B23A2E)", margin: "6px 0 0" }}>{err}</p>}
    </Modal>
  );
}

const thL: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, textAlign: "left" };
const thR: React.CSSProperties = { padding: "8px 8px", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" };
const thC: React.CSSProperties = { padding: "8px 8px", fontWeight: 600, textAlign: "center", whiteSpace: "nowrap" };
const tdL: React.CSSProperties = { padding: "7px 10px", textAlign: "left", verticalAlign: "top" };
const tdR: React.CSSProperties = { padding: "7px 8px", textAlign: "right", whiteSpace: "nowrap" };
const tdC: React.CSSProperties = { padding: "7px 8px", textAlign: "center" };
