import { useEffect, useMemo, useState } from "react";
import { listIsbnRefs, listStockLocations, createStockMovement, type IsbnRef, type StockLocation } from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconCommercial } from "./icons";

// Chargement de l'inventaire initial (rapport de stock) : on choisit une zone,
// on saisit les quantités par ouvrage, puis on charge tout en une fois. Chaque
// ligne crée une régularisation de stock tracée. Idéal pour intégrer le fichier
// d'inventaire (titres + quantités) d'un coup.
export function StockInitialImportSection({ canManage, collapsible, defaultOpen }: { canManage: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const [isbns, setIsbns] = useState<IsbnRef[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [filter, setFilter] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listIsbnRefs("print"), listStockLocations()])
      .then(([refs, locs]) => {
        setIsbns(refs);
        setLocations(locs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return isbns;
    return isbns.filter((i) => (i.manuscript?.title ?? "").toLowerCase().includes(q) || i.isbn13.includes(q));
  }, [isbns, filter]);

  const entries = Object.entries(qty).filter(([, v]) => Number(v) > 0);

  async function load() {
    if (!locationId) {
      setError("Choisissez d'abord la zone de stockage.");
      return;
    }
    if (entries.length === 0) {
      setError("Saisissez au moins une quantité.");
      return;
    }
    if (!window.confirm(`Charger le stock de ${entries.length} ouvrage(s) dans « ${locations.find((l) => l.id === locationId)?.label} » ?`)) return;
    setBusy(true);
    setError(null);
    let ok = 0;
    const failed: string[] = [];
    for (const [isbnId, v] of entries) {
      try {
        await createStockMovement({ type: "inventory_adjustment", isbn_id: isbnId, to_location_id: locationId, quantity: Math.round(Number(v)), reason: "Chargement inventaire initial" });
        ok += 1;
      } catch {
        failed.push(isbns.find((i) => i.id === isbnId)?.isbn13 ?? isbnId);
      }
    }
    setBusy(false);
    setQty({});
    setMessage(`${ok} ouvrage(s) chargé(s).${failed.length ? ` Échecs : ${failed.join(", ")}.` : ""}`);
    if (failed.length) setError(`Certaines lignes ont échoué : ${failed.join(", ")}.`);
  }

  if (!canManage) return null;

  return (
    <Card
      title="Chargement de l'inventaire initial"
      icon={<IconCommercial />}
      subtitle="Choisissez une zone, saisissez les quantités par ouvrage, puis chargez tout en une fois."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
        <Field label="Zone de stockage">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">— choisir —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Rechercher un ouvrage">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Titre ou ISBN…" />
        </Field>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{entries.length} ligne(s) à charger</div>
        <Button variant="add" size="sm" type="button" disabled={busy || !locationId || entries.length === 0} onClick={load}>{busy ? "Chargement…" : "Charger le stock"}</Button>
      </div>

      {isbns.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun ouvrage avec ISBN imprimé. Attribuez d'abord les ISBN.</p>
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--card, #fff)" }}>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "5px 8px" }}>Ouvrage</th>
                <th style={{ padding: "5px 8px" }}>ISBN</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Quantité</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "4px 8px" }}>{i.manuscript?.title ?? "—"}</td>
                  <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{i.isbn13}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      value={qty[i.id] ?? ""}
                      onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
                      style={{ width: 90, padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)", border: "1px solid var(--line)", borderRadius: 5 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
        Astuce : sélectionnez une zone (ex. « Magasin — cartons »), saisissez les quantités du rapport en face de chaque ouvrage, puis « Charger le stock ». Répétez par zone.
      </p>
    </Card>
  );
}
