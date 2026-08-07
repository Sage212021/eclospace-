import { useEffect, useState } from "react";
import { getManuscriptStock, listStockLocations, createStockMovement, type ManuscriptStock, type StockLocation } from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconCommercial } from "./icons";

// Panneau « Stock » de la fiche manuscrit : stock de l'ouvrage par ISBN et par
// zone (vendable / déclassé), et saisie du stock initial (chargement de
// l'inventaire) — enregistré comme régularisation de stock tracée.
export function ManuscriptStockSection({ manuscriptId, canManage }: { manuscriptId: string; canManage: boolean }) {
  const [stock, setStock] = useState<ManuscriptStock | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{ isbn_id: string; location_id: string; quantity: string }>({ isbn_id: "", location_id: "", quantity: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [s, locs] = await Promise.all([getManuscriptStock(manuscriptId), listStockLocations()]);
      setStock(s);
      setLocations(locs);
      setForm((f) => ({ ...f, isbn_id: f.isbn_id || s.isbns[0]?.isbn_id || "" }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement du stock impossible.");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function addInitial() {
    const qty = Math.round(Number(form.quantity) || 0);
    if (!form.isbn_id || !form.location_id || qty <= 0) {
      setError("Choisissez l'ISBN, la zone et une quantité positive.");
      return;
    }
    setBusy(true);
    try {
      await createStockMovement({ type: "inventory_adjustment", isbn_id: form.isbn_id, to_location_id: form.location_id, quantity: qty, reason: "Stock initial (chargement inventaire)" });
      setMessage(`Stock initial ajouté (${qty} exemplaire(s)).`);
      setForm((f) => ({ ...f, quantity: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  }

  const num = (n: number) => n.toLocaleString("fr-FR");

  return (
    <Card title="Stock de l'ouvrage" icon={<IconCommercial />} subtitle="Quantités par ISBN et par zone (vendable / déclassé)." collapsible defaultOpen={false}>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {stock && !stock.has_isbn && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun ISBN attribué à cet ouvrage : le stock se gère une fois l'ISBN attribué (étape ISBN & dépôt légal).</p>
      )}

      {stock?.isbns.map((isbn) => (
        <div key={isbn.isbn_id} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>{isbn.isbn13}</span> <span style={{ color: "var(--muted)" }}>({isbn.format})</span> ·{" "}
            Total : <strong style={{ fontFamily: "var(--font-mono)" }}>{num(isbn.total)}</strong>
            {isbn.declasse > 0 && <span style={{ color: "var(--alert, #C4661F)" }}> · dont {num(isbn.declasse)} déclassé(s)</span>}
          </div>
          {isbn.by_location.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>Aucun stock enregistré pour cet ISBN.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 320 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
                  <th style={{ padding: "3px 8px" }}>Zone</th>
                  <th style={{ padding: "3px 8px", textAlign: "right" }}>Vendable</th>
                  <th style={{ padding: "3px 8px", textAlign: "right" }}>Déclassé</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--font-mono)" }}>
                {isbn.by_location.map((l) => (
                  <tr key={l.location_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "3px 8px", fontFamily: "var(--font-sans, inherit)" }}>{l.location_label}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right" }}>{num(l.vendable)}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right", color: l.declasse ? "var(--alert, #C4661F)" : undefined }}>{num(l.declasse)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {stock?.has_isbn && canManage && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          {stock.isbns.length > 1 && (
            <Field label="ISBN">
              <select value={form.isbn_id} onChange={(e) => setForm((f) => ({ ...f, isbn_id: e.target.value }))}>
                {stock.isbns.map((i) => <option key={i.isbn_id} value={i.isbn_id}>{i.isbn13}</option>)}
              </select>
            </Field>
          )}
          <Field label="Zone de stockage">
            <select value={form.location_id} onChange={(e) => setForm((f) => ({ ...f, location_id: e.target.value }))}>
              <option value="">— choisir —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Field>
          <Field label="Quantité (stock initial)">
            <input type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} style={{ width: 120, fontFamily: "var(--font-mono)" }} />
          </Field>
          <Button variant="add" size="sm" type="button" disabled={busy} onClick={addInitial}>Ajouter au stock</Button>
        </div>
      )}
    </Card>
  );
}
