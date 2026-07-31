import { useEffect, useState } from "react";
import {
  listCustomers,
  createBillingOrder,
  getBillingOrders,
  invoiceBillingOrder,
  cancelBillingOrder,
  getInvoice,
  getPendingValidationInvoices,
  validateInvoice,
  getValidationThreshold,
  setValidationThreshold,
  listIsbnCatalogue,
  type Customer,
  type BillingOrder,
  type BillingOrderCategory,
  type BillingOrderLineInput,
  type PendingValidationInvoice,
  type InvoiceDetail,
  type IsbnCatalogueItem,
} from "../api/client";
import { Card } from "./Card";
import { IconFinance } from "./icons";
import { printInvoice } from "../lib/print";
import { useConfirm } from "./ConfirmProvider";

// Commandes à facturer (Finance étape 3) : une commande (ex. livre scolaire),
// initiée par le DG / le commercial / la Finance, est reçue par la Finance qui
// établit la facture. Validation par seuil : au-dessus du seuil, le DG valide.

const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 });
const CATS: { key: BillingOrderCategory; label: string }[] = [
  { key: "livre_scolaire", label: "Livre scolaire" },
  { key: "autre", label: "Autre" },
];

// Ligne d'ouvrage (livre scolaire) en cours de saisie.
type BookLine = { isbn_id: string; description: string; quantity: string; unit_price_ht: string; royalty_rate: string };
const emptyLine = (): BookLine => ({ isbn_id: "", description: "", quantity: "", unit_price_ht: "", royalty_rate: "" });

export function BillingOrdersSection({ canCreate, canInvoice, canAdmin }: { canCreate: boolean; canInvoice: boolean; canAdmin: boolean }) {
  const confirm = useConfirm();
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [pending, setPending] = useState<PendingValidationInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customer_id: "", category: "livre_scolaire" as BillingOrderCategory, label: "", amount_ht: "", tax_rate: "0" });
  const [bookLines, setBookLines] = useState<BookLine[]>([emptyLine()]);
  const [isbns, setIsbns] = useState<IsbnCatalogueItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    getBillingOrders("pending").then(setOrders).catch(() => {});
    getPendingValidationInvoices().then(setPending).catch(() => {});
    getValidationThreshold().then((t) => setThreshold(t.threshold)).catch(() => {});
  };
  useEffect(() => {
    reload();
    listCustomers().then(setCustomers).catch(() => {});
    // Catalogue des ISBN imprimés (livre papier) pour le sélecteur d'ouvrage.
    listIsbnCatalogue("print").then(setIsbns).catch(() => {});
  }, []);

  const detailed = form.category === "livre_scolaire"; // le scolaire se saisit par ouvrage → droits d'auteur
  const linesTotalHt = bookLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price_ht) || 0), 0);

  function setLine(i: number, patch: Partial<BookLine>) {
    setBookLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function pickIsbn(i: number, isbnId: string) {
    const item = isbns.find((x) => x.id === isbnId);
    setBookLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, isbn_id: isbnId, description: l.description || item?.manuscript?.title || "" } : l)));
  }
  function resetForm() {
    setForm({ customer_id: "", category: "livre_scolaire", label: "", amount_ht: "", tax_rate: "0" });
    setBookLines([emptyLine()]);
  }

  async function submitOrder() {
    if (busy) return;
    if (!form.customer_id || !form.label.trim()) {
      setError("Client et intitulé sont requis.");
      return;
    }
    let payloadLines: BillingOrderLineInput[] | undefined;
    if (detailed) {
      const filled = bookLines.filter((l) => l.description.trim() || l.quantity || l.unit_price_ht);
      if (filled.length === 0) {
        setError("Ajoutez au moins un ouvrage (titre, quantité, prix unitaire).");
        return;
      }
      for (const l of filled) {
        if (!l.description.trim() || !(Number(l.quantity) > 0) || !(Number(l.unit_price_ht) > 0)) {
          setError("Chaque ouvrage doit avoir un titre, une quantité et un prix unitaire (> 0).");
          return;
        }
        const r = l.royalty_rate.trim();
        if (r && !(Number(r) > 0 && Number(r) <= 100)) {
          setError("Le taux de droits par ouvrage doit être un pourcentage entre 0 et 100.");
          return;
        }
      }
      payloadLines = filled.map((l) => ({
        isbn_id: l.isbn_id || undefined,
        description: l.description.trim(),
        quantity: Number(l.quantity),
        unit_price_ht: Number(l.unit_price_ht),
        royalty_rate: l.royalty_rate.trim() ? Number(l.royalty_rate) / 100 : undefined,
      }));
    } else if (!(Number(form.amount_ht) > 0)) {
      setError("Le montant HT (> 0) est requis.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createBillingOrder({
        customer_id: form.customer_id,
        category: form.category,
        label: form.label.trim(),
        tax_rate: Number(form.tax_rate) || 0,
        ...(detailed ? { lines: payloadLines } : { amount_ht: Number(form.amount_ht) }),
      });
      setShowForm(false);
      resetForm();
      setMsg(detailed ? "Commande enregistrée. Les droits d'auteur seront calculés à l'établissement de la facture." : "Commande enregistrée.");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Proforma : document préparatoire NON fiscal, imprimé à la volée depuis la
  // commande (ne consomme pas la numérotation légale des factures).
  function proforma(o: BillingOrder) {
    const tax = Math.round((o.amount_ht * o.tax_rate) / 100 * 100) / 100;
    const doc: InvoiceDetail = {
      id: "proforma",
      invoiceNumber: `PRO-${o.reference}`,
      type: "proforma",
      status: "proforma",
      totalHt: String(o.amount_ht),
      totalTax: String(tax),
      totalTtc: String(o.amount_ttc),
      dueDate: null,
      createdAt: new Date().toISOString(),
      currency: "XAF",
      customer: { name: o.customer_name },
      lines: [{ id: "1", description: o.label, quantity: 1, unitPrice: String(o.amount_ht), taxRate: String(o.tax_rate), lineTotal: String(o.amount_ht) }],
    };
    printInvoice(doc);
  }

  async function establish(o: BillingOrder) {
    const ok = await confirm({
      title: "Établir la facture",
      message: `Établir la facture officielle pour « ${o.label} » ?`,
      detail: `Client : ${o.customer_name} · Montant : ${fmt.format(o.amount_ttc)}. Une facture émise ne peut plus être supprimée (numérotation légale).`,
      confirmLabel: "Établir la facture",
    });
    if (!ok) return;
    setError(null);
    setMsg(null);
    try {
      const r = await invoiceBillingOrder(o.id);
      if (r.needs_validation) {
        setMsg(`Facture ${r.invoice_number} créée — en attente de validation du DG (montant ≥ seuil). Impression possible une fois validée.`);
      } else {
        setMsg(`Facture ${r.invoice_number} émise — ouverture de l'impression…`);
        // La facture est émise : on ouvre directement le document imprimable/PDF.
        try {
          const detail = await getInvoice(r.id);
          printInvoice(detail);
        } catch {
          setMsg(`Facture ${r.invoice_number} émise. Retrouvez-la dans « Factures » pour l'imprimer.`);
        }
      }
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Facturation impossible.");
    }
  }

  // Annulation d'une commande (client désisté) — ouverte au commercial, au DG et
  // au comptable. Impossible une fois la commande facturée (→ avoir). On demande
  // le motif (facultatif) : « Annuler » du prompt = abandon, sinon on annule.
  async function cancelOrder(o: BillingOrder) {
    const reason = window.prompt(
      `Annuler la commande « ${o.label} » (${o.customer_name}) ?\n\nMotif de l'annulation (facultatif — ex. client désisté) :`,
      "",
    );
    if (reason === null) return; // abandon
    setError(null);
    setMsg(null);
    try {
      await cancelBillingOrder(o.id, reason.trim() || undefined);
      setMsg(`Commande « ${o.label} » annulée.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible.");
    }
  }

  async function approve(inv: PendingValidationInvoice) {
    const ok = await confirm({
      title: "Valider la facture",
      message: `Valider et émettre la facture ${inv.invoice_number} ?`,
      detail: `Client : ${inv.customer_name} · Montant : ${fmt.format(inv.total_ttc)}. Cette validation (DG) émet définitivement la facture.`,
      confirmLabel: "Valider",
    });
    if (!ok) return;
    setError(null);
    try {
      await validateInvoice(inv.id);
      setMsg(`Facture ${inv.invoice_number} validée et émise.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation impossible.");
    }
  }

  async function editThreshold() {
    const cur = threshold ?? 0;
    const input = window.prompt("Seuil de validation du DG (XAF). Au-dessus de ce montant, une facture doit être validée par le DG. Mettre 0 pour désactiver.", String(cur));
    if (input === null) return;
    const val = Number(input);
    if (!(val >= 0)) {
      setError("Seuil invalide.");
      return;
    }
    try {
      const r = await setValidationThreshold(val);
      setThreshold(r.threshold);
      setMsg("Seuil mis à jour.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mise à jour impossible.");
    }
  }

  return (
    <>
      <Card title="Commandes à facturer" icon={<IconFinance />} subtitle="Commandes (ex. livre scolaire) initiées par la direction, le commercial ou la Finance — à transformer en facture.">
        {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {msg && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

        {canCreate && !showForm && (
          <button onClick={() => { setShowForm(true); setError(null); }} style={{ border: "1px solid var(--eclosion)", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 12 }}>+ Nouvelle commande</button>
        )}
        {showForm && (
          <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 12, marginBottom: 12, display: "grid", gap: 8 }}>
            <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} style={inp}>
              <option value="">— Choisir un client —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {customers.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>Aucun client : créez-en un dans le module Commercial.</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as BillingOrderCategory }))} style={{ ...inp, flex: 1 }}>
                {CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Intitulé (ex. Manuels 6e — lot de 200)" style={inp} />

            {detailed ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  Détail par ouvrage — sert au calcul des droits d'auteur (12&nbsp;% par défaut, sauf taux précisé).
                </div>
                {bookLines.map((l, i) => (
                  <div key={i} style={{ display: "grid", gap: 6, border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select value={l.isbn_id} onChange={(e) => pickIsbn(i, e.target.value)} style={{ ...inp, flex: 1 }}>
                        <option value="">— Ouvrage / ISBN (facultatif) —</option>
                        {isbns.map((x) => (
                          <option key={x.id} value={x.id}>{(x.manuscript?.title ?? "Sans titre") + " · " + x.isbn13}</option>
                        ))}
                      </select>
                      {bookLines.length > 1 && (
                        <button type="button" onClick={() => setBookLines((ls) => ls.filter((_, idx) => idx !== i))} style={btnDanger} title="Retirer cet ouvrage">✕</button>
                      )}
                    </div>
                    <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Titre de l'ouvrage" style={inp} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="Quantité" inputMode="numeric" style={{ ...inp, flex: 1 }} />
                      <input value={l.unit_price_ht} onChange={(e) => setLine(i, { unit_price_ht: e.target.value })} placeholder="Prix unit. HT" inputMode="numeric" style={{ ...inp, flex: 1 }} />
                      <input value={l.royalty_rate} onChange={(e) => setLine(i, { royalty_rate: e.target.value })} placeholder="Taux % (déf. 12)" inputMode="numeric" style={{ ...inp, width: 120 }} title="Taux de droits d'auteur pour cet ouvrage. Laisser vide = taux maison (12 % par défaut)." />
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button type="button" onClick={() => setBookLines((ls) => [...ls, emptyLine()])} style={btnGhost}>+ Ajouter un ouvrage</button>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Total HT :</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{fmt.format(linesTotalHt)}</span>
                    <input value={form.tax_rate} onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value }))} placeholder="TVA %" inputMode="numeric" style={{ ...inp, width: 84 }} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={form.amount_ht} onChange={(e) => setForm((f) => ({ ...f, amount_ht: e.target.value }))} placeholder="Montant HT (XAF)" inputMode="numeric" style={{ ...inp, flex: 1 }} />
                <input value={form.tax_rate} onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value }))} placeholder="TVA %" inputMode="numeric" style={{ ...inp, width: 90 }} />
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={btnGhost}>Annuler</button>
              <button onClick={submitOrder} disabled={busy} style={btnPrimary}>Enregistrer la commande</button>
            </div>
          </div>
        )}

        {orders.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>Aucune commande en attente de facturation.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {orders.map((o) => (
              <div key={o.id} style={row}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{o.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{o.reference}</span> · {o.customer_name} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(o.amount_ttc)}</span>
                  </div>
                </div>
                {(canCreate || canInvoice) && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {/* Proforma : document préparatoire non fiscal — disponible à
                        l'initiateur (DG / commercial) comme à la Finance. */}
                    <button onClick={() => proforma(o)} style={btnGhost} title="Imprimer une facture proforma (document préparatoire, non fiscal)">Proforma (PDF)</button>
                    {/* Annuler la commande (client désisté) : commercial, DG, comptable. */}
                    <button onClick={() => cancelOrder(o)} style={btnDanger} title="Annuler la commande (client désisté)">Annuler la commande</button>
                    {/* Établir la facture officielle : réservé à la Finance. */}
                    {canInvoice && <button onClick={() => establish(o)} style={btnPrimary}>Établir la facture</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canAdmin && (
        <Card title="Factures en attente de validation" icon={<IconFinance />} subtitle={`Factures au-dessus du seuil (${threshold != null ? fmt.format(threshold) : "…"}) — à valider par le DG.`}>
          <button onClick={editThreshold} style={{ ...btnGhost, marginBottom: 10 }}>Modifier le seuil</button>
          {pending.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>Aucune facture en attente de validation.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {pending.map((i) => (
                <div key={i.id} style={row}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-mono)" }}>{i.invoice_number}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{i.customer_name} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(i.total_ttc)}</span></div>
                  </div>
                  <button onClick={() => approve(i)} style={btnPrimary}>Valider</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

const inp: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, boxSizing: "border-box", width: "100%" };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "9px 13px" };
const btnPrimary: React.CSSProperties = { border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 };
const btnGhost: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", color: "var(--ink)", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer" };
const btnDanger: React.CSSProperties = { border: "1px solid var(--alert)", background: "#fff", color: "var(--alert)", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer", flexShrink: 0 };
