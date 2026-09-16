import { useEffect, useState } from "react";
import {
  listReplenishments,
  createReplenishment,
  approveReplenishment,
  orderReplenishment,
  receiveReplenishment,
  cancelReplenishment,
  type Replenishment,
  type ReplenishmentStatus,
  type IsbnRef,
  type StockLocation,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IsbnCombobox } from "./IsbnCombobox";
import { IconCommercial } from "./icons";

const STATUS: Record<ReplenishmentStatus, { label: string; color: string; bg: string }> = {
  requested: { label: "Demandé", color: "#6b5b00", bg: "#fbf0d8" },
  approved: { label: "Validé", color: "var(--eclosion-dark, #9a7a12)", bg: "var(--eclosion-soft, #f6efdc)" },
  in_progress: { label: "En cours", color: "#2a4a7a", bg: "#e6eef8" },
  partially_received: { label: "Partiellement reçu", color: "#8a5a00", bg: "#fbf0d8" },
  received: { label: "Reçu", color: "var(--positive, #2F7D4A)", bg: "#e7f1ea" },
  cancelled: { label: "Annulé", color: "var(--alert, #B23A2E)", bg: "var(--alert-soft, #f8e3df)" },
};

export type ReplenishmentPrefill = { isbnId: string; quantity?: number; nonce: number };

export function ReplenishmentSection({ isbns, locations, canManage, canValidate, prefill, onMessage, onError, onChanged, collapsible, defaultOpen }: {
  isbns: IsbnRef[];
  locations: StockLocation[];
  canManage: boolean;
  canValidate: boolean;
  prefill?: ReplenishmentPrefill | null;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
  onChanged?: () => void;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [list, setList] = useState<Replenishment[] | null>(null);
  const [isbnId, setIsbnId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(100);
  const [supplier, setSupplier] = useState("");
  const [unitCost, setUnitCost] = useState<string>("");
  const [orderRef, setOrderRef] = useState("");
  const [note, setNote] = useState("");

  const reload = () => listReplenishments().then(setList).catch((e) => onError(e instanceof Error ? e.message : "Chargement des réapprovisionnements impossible."));
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (!locationId && locations[0]) setLocationId(locations[0].id); }, [locations]);
  useEffect(() => { if (prefill) { setIsbnId(prefill.isbnId); if (prefill.quantity) setQuantity(prefill.quantity); } }, [prefill?.nonce]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isbnId) { onError("Choisissez un ouvrage (ISBN ou titre)."); return; }
    if (!locationId) { onError("Choisissez le lieu de réception."); return; }
    try {
      await createReplenishment({ isbn_id: isbnId, location_id: locationId, quantity_requested: quantity, supplier: supplier.trim() || undefined, unit_cost: unitCost === "" ? undefined : Number(unitCost), order_ref: orderRef.trim() || undefined, note: note.trim() || undefined });
      onMessage("Demande de réapprovisionnement enregistrée (le stock ne bougera qu'à la réception).");
      setSupplier(""); setOrderRef(""); setNote(""); setUnitCost("");
      reload(); onChanged?.();
    } catch (err) { onError(err instanceof Error ? err.message : "Enregistrement impossible."); }
  }

  async function approve(r: Replenishment) {
    if (!window.confirm(`Valider la demande de ${r.quantityRequested} exemplaire(s) de « ${r.title ?? r.isbn13} » ?`)) return;
    try { await approveReplenishment(r.id); onMessage("Demande validée."); reload(); } catch (e) { onError(e instanceof Error ? e.message : "Validation impossible."); }
  }
  async function order(r: Replenishment) {
    const ref = window.prompt("Commande passée à l'imprimeur / fournisseur.\nRéférence de commande (facultatif) :", r.orderRef ?? "");
    if (ref === null) return;
    try { await orderReplenishment(r.id, { order_ref: ref.trim() || undefined }); onMessage("Réapprovisionnement marqué « en cours »."); reload(); } catch (e) { onError(e instanceof Error ? e.message : "Opération impossible."); }
  }
  async function receive(r: Replenishment) {
    const s = window.prompt(`Réception d'exemplaires.\nQuantité reçue (il reste ${r.remaining} à recevoir) :`, String(r.remaining));
    if (s === null) return;
    const q = Number(s);
    if (!Number.isFinite(q) || q <= 0) { onError("Quantité reçue invalide."); return; }
    const ref = window.prompt("Référence du bon de livraison / réception (facultatif) :", r.receiptRef ?? "");
    if (ref === null) return;
    try {
      const up = await receiveReplenishment(r.id, { quantity: q, receipt_ref: ref.trim() || undefined });
      onMessage(`Réception enregistrée : +${q} en stock. ${up.status === "received" ? "Réapprovisionnement clôturé." : `Reste ${up.remaining} à recevoir.`}`);
      reload(); onChanged?.();
    } catch (e) { onError(e instanceof Error ? e.message : "Réception impossible."); }
  }
  async function cancel(r: Replenishment) {
    const reason = window.prompt("Annuler cette demande de réapprovisionnement ?\nMotif (facultatif) :", "");
    if (reason === null) return;
    try { await cancelReplenishment(r.id, reason.trim() || undefined); onMessage("Demande annulée."); reload(); } catch (e) { onError(e instanceof Error ? e.message : "Annulation impossible."); }
  }

  return (
    <Card title="Réapprovisionnements" icon={<IconCommercial />} subtitle="Cycle : demande → validation → en cours → réception. Le stock n'augmente qu'à la réception effective." collapsible={collapsible} defaultOpen={defaultOpen}>
      {canManage && (
        <form onSubmit={submit} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Field label="Ouvrage (ISBN / titre)"><IsbnCombobox isbns={isbns} value={isbnId} onChange={setIsbnId} /></Field>
            <Field label="Lieu de réception">
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Quantité demandée"><input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field>
            <Field label="Fournisseur / imprimeur (facultatif)"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
            <Field label="Coût unitaire (facultatif)"><input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
            <Field label="Référence de commande (facultatif)"><input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} /></Field>
            <Field label="Note (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div style={{ marginTop: 12 }}><Button variant="add" size="md" type="submit">Demander un réapprovisionnement</Button></div>
        </form>
      )}

      {!list && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}
      {list && list.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune demande de réapprovisionnement.</p>}
      {list && list.length > 0 && (
        <div className="ecl-list">
          {list.map((r) => {
            const st = STATUS[r.status];
            const open = r.status !== "received" && r.status !== "cancelled";
            return (
              <div key={r.id} className="ecl-row" style={{ alignItems: "flex-start" }}>
                <div className="ecl-row__main" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="ecl-row__title">{r.title ?? r.isbn13}</span>
                    <span style={{ background: st.bg, color: st.color, borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 600 }}>{st.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.quantityReceived}/{r.quantityRequested} reçus{r.remaining > 0 && open ? ` · reste ${r.remaining}` : ""}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {r.location_label ? `→ ${r.location_label}` : ""}
                    {r.supplier ? ` · ${r.supplier}` : ""}
                    {r.total_cost != null ? ` · coût prévu ${r.total_cost.toLocaleString("fr-FR")} FCFA` : ""}
                    {r.orderRef ? ` · cmd ${r.orderRef}` : ""}
                    {r.receiptRef ? ` · BL ${r.receiptRef}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    Demandé le {new Date(r.requestedAt).toLocaleDateString("fr-FR")}{r.requested_by_name ? ` par ${r.requested_by_name}` : ""}
                    {r.validated_by_name ? ` · validé par ${r.validated_by_name}` : ""}
                    {r.status === "cancelled" && r.cancelReason ? ` · motif : ${r.cancelReason}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {r.status === "requested" && canValidate && <Button variant="add" size="sm" onClick={() => approve(r)}>Valider</Button>}
                  {r.status === "approved" && canManage && <Button variant="edit" size="sm" onClick={() => order(r)}>Commande passée</Button>}
                  {open && r.status !== "requested" && canManage && <Button variant="add" size="sm" onClick={() => receive(r)}>Réceptionner</Button>}
                  {open && canManage && <Button variant="view" size="sm" onClick={() => cancel(r)}>Annuler</Button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
