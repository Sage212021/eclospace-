import { useEffect, useState } from "react";
import {
  listDeliveries,
  listEligibleOrdersForDelivery,
  getDeliveryNote,
  createDelivery,
  confirmDelivery,
  uploadDeliveryProof,
  deliveryProofUrl,
  type DeliveryRow,
  type EligibleOrder,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Modal, Field } from "./Modal";
import { DocPrintMenu } from "./DocPrintMenu";
import { PeriodFilter, currentPeriod, inPeriod, type Period } from "./PeriodFilter";
import { useConfirm } from "./ConfirmProvider";
import { IconCommercial } from "./icons";
import { printDeliveryNote, type PrintOpts } from "../lib/print";

// Registre des livraisons — bons de livraison (Ch. 17 §17.8). Rubrique PARTAGÉE
// entre le pôle Magasin/Stock et le pôle Commercial (même composant rendu dans
// les deux pages). On peut : suivre les livraisons, en créer une depuis une
// commande encore livrable (choix des quantités par ligne, transporteur),
// imprimer le bon de livraison professionnel, et confirmer la réception.
// La preuve signée (scan/photo) sera rattachée dans un second temps.
export function DeliveriesSection({ canManage }: { canManage: boolean }) {
  const confirm = useConfirm();
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [eligible, setEligible] = useState<EligibleOrder[]>([]);
  const [period, setPeriod] = useState<Period>(currentPeriod());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Modal « nouvelle livraison » : commande choisie + transporteur + quantités.
  const [form, setForm] = useState<{ orderId: string; carrier: string; qty: Record<string, string> } | null>(null);

  async function refresh() {
    const [dels, orders] = await Promise.all([listDeliveries(), listEligibleOrdersForDelivery()]);
    setDeliveries(dels);
    setEligible(orders);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Chargement des livraisons impossible."));
  }, []);

  const money = new Intl.NumberFormat("fr-FR");

  // Impression du bon de livraison (trois présentations via le menu maison).
  async function printNote(id: string, opts: PrintOpts) {
    try {
      const n = await getDeliveryNote(id);
      printDeliveryNote(
        {
          deliveryNumber: n.delivery_number,
          orderNumber: n.order_number,
          invoiceNumber: n.invoice_number,
          carrier: n.carrier,
          shippedAt: n.shipped_at,
          deliveredAt: n.delivered_at,
          complete: n.complete,
          customer: {
            name: n.customer.name,
            contactName: n.customer.contact_name,
            phone: n.customer.phone,
            email: n.customer.email,
            address: n.customer.address,
          },
          lines: n.lines,
        },
        opts,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impression du bon de livraison impossible.");
    }
  }

  function openNewDelivery(order: EligibleOrder) {
    // Quantités par défaut = reliquat restant de chaque ligne.
    const qty: Record<string, string> = {};
    for (const l of order.lines) qty[l.isbn_id] = String(l.remaining);
    setForm({ orderId: order.id, carrier: "", qty });
    setError(null);
    setMessage(null);
  }

  async function submitDelivery() {
    if (!form) return;
    const order = eligible.find((o) => o.id === form.orderId);
    if (!order) return;
    const lines = order.lines
      .map((l) => ({ isbn_id: l.isbn_id, quantity: Number(form.qty[l.isbn_id] ?? 0) }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      setError("Indiquez au moins une quantité à livrer.");
      return;
    }
    // Garde-fou : ne pas livrer plus que le reliquat restant.
    for (const l of lines) {
      const ref = order.lines.find((x) => x.isbn_id === l.isbn_id)!;
      if (l.quantity > ref.remaining) {
        setError(`Quantité livrée (${l.quantity}) supérieure au reliquat (${ref.remaining}) pour « ${ref.title} ».`);
        return;
      }
    }
    try {
      const created = await createDelivery(form.orderId, { carrier: form.carrier.trim() || undefined, lines });
      setForm(null);
      setMessage(`Livraison ${created.deliveryNumber} créée — vous pouvez imprimer le bon de livraison.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création de la livraison impossible.");
    }
  }

  async function handleProofUpload(deliveryId: string, file: File | null) {
    if (!file) return;
    setError(null);
    setMessage(null);
    try {
      await uploadDeliveryProof(deliveryId, file);
      setMessage("Preuve de livraison signée rattachée.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt de la preuve impossible.");
    }
  }

  async function handleConfirm(d: DeliveryRow) {
    const ok = await confirm({
      title: "Confirmer la réception",
      message: `Confirmer la réception de la livraison ${d.delivery_number} ?`,
      detail: `${d.order_number} · ${d.customer_name}`,
      confirmLabel: "Confirmer",
    });
    if (!ok) return;
    try {
      await confirmDelivery(d.id);
      setMessage(`Réception de ${d.delivery_number} confirmée.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmation impossible.");
    }
  }

  const filtered = deliveries.filter((d) => inPeriod(d.shipped_at, period));
  const formOrder = form ? eligible.find((o) => o.id === form.orderId) : null;

  return (
    <Card
      title="Livraisons — bons de livraison"
      icon={<IconCommercial />}
      subtitle="Suivez les livraisons et imprimez le bon de livraison (à signer à la réception). Une commande peut être livrée en plusieurs fois (reliquats)."
      collapsible
      defaultOpen
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={banner("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {/* Créer une livraison depuis une commande encore livrable. */}
      {canManage && (
        <div style={{ marginBottom: 14 }}>
          {eligible.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Aucune commande livrable pour le moment.</p>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Nouvelle livraison depuis :</span>
              {eligible.map((o) => (
                <Button key={o.id} variant="add" size="sm" onClick={() => openNewDelivery(o)}>
                  {o.order_number} — {o.customer_name} ({o.remaining_total} à livrer)
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {deliveries.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune livraison enregistrée.</p>
      ) : (
        <>
          <PeriodFilter dates={deliveries.map((d) => d.shipped_at)} value={period} onChange={setPeriod} resultCount={filtered.length} />
          {filtered.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 0" }}>Aucune livraison pour cette période.</p>
          ) : (
            <div className="ecl-list">
              {filtered.map((d) => (
                <div key={d.id} className="ecl-row">
                  <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{d.delivery_number}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{(d.shipped_at ?? "").slice(0, 10)}</span>
                    <span className="ecl-row__desc" style={{ margin: 0 }}>{d.order_number} · {d.customer_name}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{money.format(d.total_quantity)} ex.</span>
                    <span
                      style={{
                        fontSize: 11, fontWeight: 600, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap",
                        color: d.complete ? "var(--positive, #2F7D4A)" : "var(--amber, #B87400)",
                        border: `1px solid ${d.complete ? "var(--positive, #2F7D4A)" : "var(--amber, #B87400)"}`,
                      }}
                    >
                      {d.complete ? "Complète" : "Partielle"}
                    </span>
                    {d.delivered_at && <span style={{ fontSize: 11, color: "var(--positive, #2F7D4A)" }}>Reçue le {d.delivered_at.slice(0, 10)}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <DocPrintMenu label="Imprimer le bon de livraison" onPrint={(o) => printNote(d.id, o)} />
                    {d.has_proof && (
                      <a href={deliveryProofUrl(d.id)} target="_blank" rel="noopener noreferrer" style={proofLinkStyle} title="Ouvrir la preuve de livraison signée">
                        ✓ Voir la preuve
                      </a>
                    )}
                    {canManage && (
                      <label style={proofUploadStyle} title="Photo ou scan du bon de livraison signé (image ou PDF)">
                        {d.has_proof ? "Remplacer la preuve" : "Joindre la preuve signée"}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          style={{ display: "none" }}
                          onChange={(e) => { handleProofUpload(d.id, e.target.files?.[0] ?? null); e.target.value = ""; }}
                        />
                      </label>
                    )}
                    {canManage && !d.delivered_at && (
                      <Button variant="view" size="sm" onClick={() => handleConfirm(d)}>Confirmer la réception</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Fenêtre : nouvelle livraison (quantités par ligne + transporteur). */}
      {form && formOrder && (
        <Modal
          title={`Nouvelle livraison — ${formOrder.order_number}`}
          wide
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setForm(null)}>Annuler</Button>
              <Button variant="add" size="sm" onClick={submitDelivery}>Créer la livraison</Button>
            </>
          }
        >
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>
            Client : <strong style={{ color: "var(--ink)" }}>{formOrder.customer_name}</strong>. Ajustez les quantités livrées (par défaut, le reliquat restant).
          </p>
          <Field label="Transporteur (facultatif)">
            <input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} placeholder="Ex. Coursier interne, société de transport…" />
          </Field>
          <div style={{ marginTop: 8 }}>
            {formOrder.lines.map((l) => (
              <div key={l.isbn_id} style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13 }}>{l.title}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                    {l.isbn13} · commandé {l.ordered} · déjà livré {l.delivered} · reste <strong>{l.remaining}</strong>
                  </div>
                </div>
                <input
                  type="number"
                  min={0}
                  max={l.remaining}
                  value={form.qty[l.isbn_id] ?? "0"}
                  onChange={(e) => setForm({ ...form, qty: { ...form.qty, [l.isbn_id]: e.target.value } })}
                  disabled={l.remaining === 0}
                  style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)" }}
                />
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 };
}

const proofLinkStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600,
  color: "var(--positive, #2F7D4A)", textDecoration: "none",
  border: "1px solid var(--positive, #2F7D4A)", borderRadius: 6, padding: "6px 10px",
};

const proofUploadStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", fontSize: 12, cursor: "pointer",
  background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 10px",
};
