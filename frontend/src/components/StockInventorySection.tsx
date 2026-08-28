import { useEffect, useState } from "react";
import { TableScroll } from "./TableScroll";
import {
  listInventories,
  getInventory,
  createInventory,
  countInventoryLine,
  adjustInventoryLine,
  closeInventory,
  type InventorySummary,
  type InventoryDetail,
  type InventoryType,
  type StockLocation,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconCommercial } from "./icons";

// Inventaire physique (Ch. 16 §16.8) — campagnes, comptage à l'aveugle, suivi de
// l'avancement (comptées / écarts / à recompter), régularisation et clôture.
// Répond au rapport d'inventaire de l'opérateur (comptage par lieu, écarts).

const TYPE_LABEL: Record<InventoryType, string> = { full: "Complet", rotating: "Tournant" };

export function StockInventorySection({
  locations,
  canManage,
  canValidate,
  collapsible,
  defaultOpen,
}: {
  locations: StockLocation[];
  canManage: boolean;
  canValidate: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [list, setList] = useState<InventorySummary[]>([]);
  const [current, setCurrent] = useState<InventoryDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ location_id: string; type: InventoryType; blind: boolean }>({ location_id: "", type: "full", blind: true });
  // Saisie locale des quantités comptées + exemplaires abîmés (par ligne).
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});

  async function loadList() {
    try {
      setList(await listInventories());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }
  useEffect(() => {
    loadList();
  }, []);

  async function openInventory(id: string) {
    setBusy(true);
    try {
      const inv = await getInventory(id);
      setCurrent(inv);
      const c: Record<string, string> = {};
      const dmg: Record<string, string> = {};
      for (const l of inv.lines) {
        c[l.id] = l.countedQty != null ? String(l.countedQty) : "";
        dmg[l.id] = l.countedDamaged != null ? String(l.countedDamaged) : "";
      }
      setCounts(c);
      setDamaged(dmg);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ouverture impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!form.location_id) {
      setError("Choisissez un lieu de stockage pour la campagne.");
      return;
    }
    setBusy(true);
    try {
      const inv = await createInventory(form);
      setCreating(false);
      setMessage(`Campagne d'inventaire ouverte (${inv.lines.length} référence(s)).`);
      await loadList();
      await openInventory(inv.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCount(lineId: string) {
    if (!current) return;
    const raw = counts[lineId];
    if (raw === "" || raw == null) return;
    const dmg = Math.max(Number(damaged[lineId]) || 0, 0);
    try {
      await countInventoryLine(lineId, Math.max(Number(raw) || 0, 0), dmg);
      await openInventory(current.id);
      await loadList();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement du comptage impossible.");
    }
  }

  async function adjust(lineId: string) {
    if (!current) return;
    try {
      await adjustInventoryLine(lineId);
      setMessage("Écart régularisé (mouvement de stock créé).");
      await openInventory(current.id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Régularisation impossible.");
    }
  }

  async function close() {
    if (!current) return;
    if (!window.confirm("Clôturer cette campagne d'inventaire ? Le stock est figé à l'issue.")) return;
    setBusy(true);
    try {
      await closeInventory(current.id);
      setMessage("Inventaire clôturé.");
      await openInventory(current.id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clôture impossible.");
    } finally {
      setBusy(false);
    }
  }

  const closed = current?.status === "closed";

  return (
    <Card
      title="Inventaire physique"
      icon={<IconCommercial />}
      subtitle="Campagnes de comptage par lieu, suivi de l'avancement, écarts et régularisation."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
      action={canManage && !creating ? <Button variant="add" size="sm" type="button" onClick={() => setCreating(true)}>+ Nouvelle campagne</Button> : undefined}
    >
      {creating && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <Field label="Lieu de stockage">
            <select value={form.location_id} onChange={(e) => setForm((f) => ({ ...f, location_id: e.target.value }))}>
              <option value="">— choisir —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as InventoryType }))}>
              <option value="full">Complet</option>
              <option value="rotating">Tournant</option>
            </select>
          </Field>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={form.blind} onChange={(e) => setForm((f) => ({ ...f, blind: e.target.checked }))} style={{ width: "auto" }} />
            Comptage à l'aveugle (quantités théoriques masquées)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="view" size="sm" type="button" onClick={() => setCreating(false)}>Annuler</Button>
            <Button variant="add" size="sm" type="button" disabled={busy} onClick={create}>Ouvrir la campagne</Button>
          </div>
        </div>
      )}

      {/* Liste des campagnes + avancement */}
      {list.length === 0 && !current && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune campagne d'inventaire. Créez-en une pour démarrer le comptage.</p>}
      {list.length > 0 && (
        <TableScroll style={{ marginBottom: current ? 16 : 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "5px 8px" }}>Lieu</th>
                <th style={{ padding: "5px 8px" }}>Type</th>
                <th style={{ padding: "5px 8px" }}>Avancement</th>
                <th style={{ padding: "5px 8px" }}>Écarts</th>
                <th style={{ padding: "5px 8px" }}>Statut</th>
                <th style={{ padding: "5px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((inv) => {
                const pct = inv.total_lines ? Math.round((inv.counted_lines / inv.total_lines) * 100) : 0;
                return (
                  <tr key={inv.id} style={{ borderTop: "1px solid var(--line)", background: current?.id === inv.id ? "var(--eclosion-soft)" : undefined }}>
                    <td style={{ padding: "5px 8px" }}>{inv.location_label ?? "—"}</td>
                    <td style={{ padding: "5px 8px" }}>{TYPE_LABEL[inv.type]}</td>
                    <td style={{ padding: "5px 8px", minWidth: 160 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: "#e6e9f0", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--eclosion, #d9b21a)" }} />
                        </div>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{inv.counted_lines}/{inv.total_lines}</span>
                      </div>
                    </td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>
                      {inv.variance_lines > 0 ? <span style={{ color: "var(--alert, #C4661F)" }}>{inv.variance_lines}</span> : "0"}
                      {inv.damaged_lines > 0 && <span title="Lignes avec exemplaires abîmés" style={{ color: "var(--alert, #C4661F)", marginLeft: 6 }}>⚠{inv.damaged_lines}</span>}
                      {inv.recount_lines > 0 && <span style={{ color: "var(--danger, #C24B3A)", marginLeft: 6 }}>↻{inv.recount_lines}</span>}
                    </td>
                    <td style={{ padding: "5px 8px" }}>{inv.status === "closed" ? <span style={{ color: "var(--muted)" }}>Clôturé</span> : <span style={{ color: "var(--eclosion-dark, #9a7a12)", fontWeight: 600 }}>Ouvert</span>}</td>
                    <td style={{ padding: "5px 8px" }}><Button variant="view" size="sm" type="button" onClick={() => openInventory(inv.id)}>Ouvrir</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}

      {/* Détail : comptage des lignes */}
      {current && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>
              {current.location_label ?? "—"} · {TYPE_LABEL[current.type]} {current.blind && !closed ? "· à l'aveugle" : ""}
              {closed && <span style={{ color: "var(--muted)", fontWeight: 400 }}> · clôturé le {current.closed_at?.slice(0, 10)}</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="view" size="sm" type="button" onClick={() => setCurrent(null)}>Fermer</Button>
              {!closed && canValidate && <Button variant="add" size="sm" type="button" disabled={busy} onClick={close}>Clôturer l'inventaire</Button>}
            </div>
          </div>
          <TableScroll>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                  <th style={{ padding: "5px 8px" }}>Ouvrage</th>
                  <th style={{ padding: "5px 8px" }}>ISBN</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>Théorique</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>Compté</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }} title="Parmi les comptés, exemplaires abîmés (déclassés à la régularisation)">dont abîmés</th>
                  <th style={{ padding: "5px 8px", textAlign: "right" }}>Écart</th>
                  <th style={{ padding: "5px 8px" }}></th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {current.lines.map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "4px 8px", fontFamily: "inherit" }}>{l.title ?? "—"}</td>
                    <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{l.isbn13}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }}>{l.theoreticalQty != null ? l.theoreticalQty : "•••"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }}>
                      {closed ? (l.countedQty ?? "—") : (
                        <input
                          type="number"
                          min={0}
                          value={counts[l.id] ?? ""}
                          onChange={(e) => setCounts((c) => ({ ...c, [l.id]: e.target.value }))}
                          onBlur={() => saveCount(l.id)}
                          style={{ width: 80, padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)", border: "1px solid var(--line)", borderRadius: 5 }}
                        />
                      )}
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }}>
                      {closed ? (l.countedDamaged ?? "—") : (
                        <input
                          type="number"
                          min={0}
                          value={damaged[l.id] ?? ""}
                          onChange={(e) => setDamaged((d) => ({ ...d, [l.id]: e.target.value }))}
                          onBlur={() => saveCount(l.id)}
                          disabled={!counts[l.id]}
                          style={{ width: 64, padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--alert, #C4661F)" }}
                        />
                      )}
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: l.variance ? "var(--alert, #C4661F)" : undefined }}>
                      {l.variance != null ? (l.variance > 0 ? `+${l.variance}` : l.variance) : "—"}
                      {l.recountRequired && <span title="À recompter" style={{ color: "var(--danger, #C24B3A)", marginLeft: 4 }}>↻</span>}
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      {!closed && !l.adjustmentMovementId && !l.recountRequired && canValidate && ((l.variance != null && l.variance !== 0) || (l.countedDamaged ?? 0) > 0) && (
                        <Button variant="edit" size="sm" type="button" onClick={() => adjust(l.id)}>Régulariser</Button>
                      )}
                      {l.adjustmentMovementId && <span style={{ color: "var(--eclosion-dark, #9a7a12)", fontSize: 11.5 }}>✓ régularisé</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {!closed && (
            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
              Saisissez la quantité comptée et, le cas échéant, le nombre d'exemplaires « abîmés » (déclassés à la régularisation). En cas d'écart, un second comptage (↻) est demandé, puis la Direction régularise. La clôture exige que tous les écarts et exemplaires abîmés soient régularisés.
            </p>
          )}
        </div>
      )}

      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
