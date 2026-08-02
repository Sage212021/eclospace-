import { useEffect, useMemo, useState } from "react";
import {
  listCustomers,
  createCustomer,
  createBillingOrder,
  getBillingOrders,
  invoiceBillingOrder,
  cancelBillingOrder,
  getInvoice,
  markInvoicePrinted,
  getPendingValidationInvoices,
  validateInvoice,
  rejectInvoiceValidation,
  getValidationThreshold,
  setValidationThreshold,
  listIsbnCatalogue,
  type Customer,
  type CustomerCategory,
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
  { key: "livre_general", label: "Livre général / simple" },
  { key: "autre", label: "Autre" },
];
const CUSTOMER_CATS: { key: CustomerCategory; label: string }[] = [
  { key: "institution", label: "Institution (ministère, école…)" },
  { key: "librairie", label: "Librairie" },
  { key: "distributeur", label: "Distributeur" },
  { key: "particulier", label: "Particulier" },
  { key: "plateforme", label: "Plateforme" },
  { key: "auteur", label: "Auteur" },
];

// Ligne d'ouvrage (livre scolaire) en cours de saisie.
type BookLine = { isbn_id: string; description: string; quantity: string; unit_price_ht: string; royalty_rate: string };
const emptyLine = (): BookLine => ({ isbn_id: "", description: "", quantity: "", unit_price_ht: "", royalty_rate: "" });

// canValidateThreshold : validation des factures au-dessus du seuil — décision
// de GOUVERNANCE (DG / administrateur général, pilotage:administration), pas la
// Finance. Sert aussi le réglage du seuil (que seuls ces décideurs pilotent ici).
export function BillingOrdersSection({ canCreate, canInvoice, canValidateThreshold }: { canCreate: boolean; canInvoice: boolean; canValidateThreshold: boolean }) {
  const confirm = useConfirm();
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [pending, setPending] = useState<PendingValidationInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customer_id: "", category: "livre_scolaire" as BillingOrderCategory, label: "", amount_ht: "", tax_rate: "0", discount_pct: 0 });
  const [bookLines, setBookLines] = useState<BookLine[]>([emptyLine()]);
  const [isbns, setIsbns] = useState<IsbnCatalogueItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Création rapide d'un client, sans quitter le formulaire de commande.
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", category: "institution" as CustomerCategory });
  // Remise (%) choisie par commande, appliquée à l'établissement de la facture.
  const [remises, setRemises] = useState<Record<string, number>>({});
  const getRemise = (id: string) => remises[id] ?? 0;

  const reload = () => {
    getBillingOrders("pending").then((os) => {
      setOrders(os);
      // Pré-remplit le déroulé de remise de chaque ligne avec la remise prévue sur la commande.
      setRemises((prev) => { const next = { ...prev }; for (const o of os) if (next[o.id] == null) next[o.id] = o.discount_pct ?? 0; return next; });
    }).catch(() => {});
    getPendingValidationInvoices().then(setPending).catch(() => {});
    getValidationThreshold().then((t) => setThreshold(t.threshold)).catch(() => {});
  };
  useEffect(() => {
    reload();
    listCustomers().then(setCustomers).catch(() => {});
    // Catalogue des ISBN imprimés (livre papier) pour le sélecteur d'ouvrage.
    listIsbnCatalogue("print").then(setIsbns).catch(() => {});
  }, []);

  // Le livre (scolaire ou général) se saisit par ouvrage → droits d'auteur par livre.
  const detailed = form.category === "livre_scolaire" || form.category === "livre_general";
  // Segment attendu du catalogue selon la catégorie (scolaire ↔ manuels ;
  // général ↔ ouvrages simples). Le sélecteur d'ouvrage ne montre que le bon segment.
  const wantSegment: "scolaire" | "general" | null =
    form.category === "livre_scolaire" ? "scolaire" : form.category === "livre_general" ? "general" : null;
  const linesTotalHt = bookLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price_ht) || 0), 0);
  // Brut TTC du formulaire (selon le mode) et net à payer après remise saisie.
  const formGrossTtc = (detailed ? linesTotalHt : Number(form.amount_ht) || 0) * (1 + (Number(form.tax_rate) || 0) / 100);
  const formNet = Math.round(formGrossTtc * (1 - form.discount_pct / 100) * 100) / 100;

  // Menu d'ouvrages groupé par matière (le sous-titre porte « Matière · Classe »).
  // Les ouvrages sans matière connue tombent dans « Autres ouvrages », en dernier.
  const groupedIsbns = useMemo(() => {
    const groups = new Map<string, IsbnCatalogueItem[]>();
    for (const x of isbns) {
      // On ne propose que les ouvrages du segment correspondant à la catégorie
      // (scolaire ↔ manuels, général ↔ ouvrages simples) pour ne pas les mélanger.
      if (wantSegment && (x.manuscript?.editorialSegment ?? "general") !== wantSegment) continue;
      const st = x.manuscript?.subtitle ?? "";
      // Scolaire : « Matière · Classe » → groupe par matière. Général : « Collection … » → groupe par collection.
      const grp = st.includes("·") ? st.split("·")[0].trim() : st.trim() || "Autres ouvrages";
      if (!groups.has(grp)) groups.set(grp, []);
      groups.get(grp)!.push(x);
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === "Autres ouvrages") return 1;
      if (b[0] === "Autres ouvrages") return -1;
      return a[0].localeCompare(b[0], "fr");
    });
  }, [isbns, wantSegment]);

  function setLine(i: number, patch: Partial<BookLine>) {
    setBookLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function pickIsbn(i: number, isbnId: string) {
    const item = isbns.find((x) => x.id === isbnId);
    setBookLines((ls) =>
      ls.map((l, idx) =>
        idx === i
          ? {
              ...l,
              isbn_id: isbnId,
              // On pré-remplit le titre et le prix depuis le catalogue (modifiables).
              description: l.description || item?.manuscript?.title || "",
              unit_price_ht: l.unit_price_ht || (item?.price_ht != null ? String(item.price_ht) : ""),
            }
          : l,
      ),
    );
  }
  function resetForm() {
    setForm({ customer_id: "", category: "livre_scolaire", label: "", amount_ht: "", tax_rate: "0", discount_pct: 0 });
    setBookLines([emptyLine()]);
  }

  async function submitNewCustomer() {
    if (busy) return;
    const name = newCustomer.name.trim();
    if (!name) {
      setError("Le nom du client est requis.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createCustomer({ name, category: newCustomer.category });
      // Recharge la liste et sélectionne d'emblée le client créé.
      const list = await listCustomers();
      setCustomers(list);
      setForm((f) => ({ ...f, customer_id: created.id }));
      setShowNewCustomer(false);
      setNewCustomer({ name: "", category: "institution" });
      setMsg(`Client « ${created.name} » créé et sélectionné.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création du client impossible.");
    } finally {
      setBusy(false);
    }
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
        discount_pct: form.discount_pct || 0,
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
    const d = getRemise(o.id);
    const factor = 1 - d / 100;
    const doc: InvoiceDetail = {
      id: "proforma",
      invoiceNumber: `PRO-${o.reference}`,
      type: "proforma",
      status: "proforma",
      // Totaux NETS (après remise) ; la remise se lit à l'impression.
      totalHt: String(Math.round(o.amount_ht * factor * 100) / 100),
      totalTax: String(Math.round(tax * factor * 100) / 100),
      discountPct: String(d),
      totalTtc: String(Math.round(o.amount_ttc * factor * 100) / 100),
      dueDate: null,
      createdAt: new Date().toISOString(),
      currency: "XAF",
      customer: { name: o.customer_name },
      lines: [{ id: "1", description: o.label, quantity: 1, unitPrice: String(o.amount_ht), taxRate: String(o.tax_rate), lineTotal: String(o.amount_ht) }],
    };
    printInvoice(doc);
  }

  async function establish(o: BillingOrder) {
    const d = getRemise(o.id);
    const nap = Math.round(o.amount_ttc * (1 - d / 100) * 100) / 100;
    const remiseLine = d > 0 ? ` Remise ${d} % : −${fmt.format(o.amount_ttc - nap)} → Net à payer ${fmt.format(nap)}.` : "";
    const ok = await confirm({
      title: "Établir la facture",
      message: `Établir la facture officielle pour « ${o.label} » ?`,
      detail: `Client : ${o.customer_name} · Montant : ${fmt.format(o.amount_ttc)}.${remiseLine} Une facture émise ne peut plus être supprimée (numérotation légale).`,
      confirmLabel: "Établir la facture",
    });
    if (!ok) return;
    setError(null);
    setMsg(null);
    try {
      const r = await invoiceBillingOrder(o.id, d);
      if (r.needs_validation) {
        setMsg(`Facture ${r.invoice_number} créée — en attente de validation du DG (montant ≥ seuil). Impression possible une fois validée.`);
      } else {
        setMsg(`Facture ${r.invoice_number} émise — ouverture de l'impression…`);
        // La facture est émise : on ouvre directement le document imprimable/PDF.
        try {
          const detail = await getInvoice(r.id);
          printInvoice(detail);
          // Ce tout premier tirage est l'original : on l'enregistre pour que
          // toute réimpression ultérieure porte la mention « DUPLICATA ».
          markInvoicePrinted(r.id).catch(() => {});
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

  // Refus (DG) d'une facture au-dessus du seuil : motif obligatoire. La facture
  // est annulée (hors CA) et la commande d'origine repasse « à facturer ».
  async function reject(inv: PendingValidationInvoice) {
    const reason = window.prompt(`Refuser la facture ${inv.invoice_number} (${inv.customer_name} · ${fmt.format(inv.total_ttc)}) ?\n\nMotif du refus (obligatoire) :`, "");
    if (reason === null) return; // abandon
    if (!reason.trim()) {
      setError("Un motif de refus est requis.");
      return;
    }
    setError(null);
    setMsg(null);
    try {
      await rejectInvoiceValidation(inv.id, reason.trim());
      setMsg(`Facture ${inv.invoice_number} refusée — la commande repasse « à facturer ».`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refus impossible.");
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
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} style={{ ...inp, flex: 1 }}>
                <option value="">— Choisir un client —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" onClick={() => { setShowNewCustomer((v) => !v); setError(null); }} style={btnGhost} title="Créer un nouveau client sans quitter le formulaire">
                {showNewCustomer ? "Fermer" : "+ Nouveau client"}
              </button>
            </div>
            {showNewCustomer && (
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 8, background: "var(--eclosion-soft, #f6efd8)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--eclosion-dark)" }}>Nouveau client</div>
                <input value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} placeholder="Nom du client (ex. Ministère de l'Éducation)" style={inp} />
                <select value={newCustomer.category} onChange={(e) => setNewCustomer((c) => ({ ...c, category: e.target.value as CustomerCategory }))} style={inp}>
                  {CUSTOMER_CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => { setShowNewCustomer(false); setNewCustomer({ name: "", category: "institution" }); }} style={btnGhost}>Annuler</button>
                  <button type="button" onClick={submitNewCustomer} disabled={busy} style={btnPrimary}>Créer le client</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={form.category}
                onChange={(e) => {
                  // Changer de catégorie repart d'une ligne vierge : le catalogue
                  // proposé change de segment (scolaire ↔ général).
                  setForm((f) => ({ ...f, category: e.target.value as BillingOrderCategory }));
                  setBookLines([emptyLine()]);
                }}
                style={{ ...inp, flex: 1 }}
              >
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
                        {groupedIsbns.map(([matiere, items]) => (
                          <optgroup key={matiere} label={matiere}>
                            {items.map((x) => {
                              const t = x.manuscript?.title ?? "Sans titre";
                              const st = x.manuscript?.subtitle; // « Matière · Classe »
                              const classe = st && st.includes("·") ? st.split("·")[1].trim() : null;
                              return <option key={x.id} value={x.id}>{classe ? `${t} — ${classe}` : t} · {x.isbn13}</option>;
                            })}
                          </optgroup>
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

            {/* Remise commerciale (0 à 100 %) : calcul immédiat du net à payer.
                Enregistrée sur la commande et reprise à l'établissement de la facture. */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--eclosion-soft, #f6efd8)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
              <label style={{ fontSize: 12.5, color: "var(--eclosion-dark)", fontWeight: 600 }}>Remise</label>
              <select value={form.discount_pct} onChange={(e) => setForm((f) => ({ ...f, discount_pct: Number(e.target.value) }))} style={{ ...inp, width: 84 }}>
                {Array.from({ length: 101 }, (_, i) => i).map((p) => <option key={p} value={p}>{p} %</option>)}
              </select>
              <span style={{ fontSize: 12.5, color: "var(--muted)", marginLeft: "auto" }}>
                {form.discount_pct > 0 && <>Remise −<span style={{ fontFamily: "var(--font-mono)", color: "var(--alert)" }}>{fmt.format(formGrossTtc - formNet)}</span> · </>}
                Net à payer <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{fmt.format(formNet)}</span>
              </span>
            </div>

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
            {orders.map((o) => {
              const d = getRemise(o.id);
              const nap = Math.round(o.amount_ttc * (1 - d / 100) * 100) / 100;
              return (
                <div key={o.id} style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{o.label}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{o.reference}</span> · {o.customer_name} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(o.amount_ttc)}</span>
                    </div>
                  </div>
                  {(canCreate || canInvoice) && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
                      {/* Remise commerciale : déroulé 0 à 100 %, calcul immédiat du
                          net à payer (comme sur une facture proforma classique). */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                        <label style={{ color: "var(--muted)" }}>Remise</label>
                        <select value={d} onChange={(e) => setRemises((m) => ({ ...m, [o.id]: Number(e.target.value) }))} style={{ ...inp, width: 78, padding: "6px 8px" }}>
                          {Array.from({ length: 101 }, (_, i) => i).map((p) => <option key={p} value={p}>{p} %</option>)}
                        </select>
                        {d > 0 && (
                          <span style={{ color: "var(--muted)" }}>
                            −<span style={{ fontFamily: "var(--font-mono)", color: "var(--alert)" }}>{fmt.format(o.amount_ttc - nap)}</span> · Net à payer <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{fmt.format(nap)}</span>
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => proforma(o)} style={btnGhost} title="Imprimer une facture proforma (document préparatoire, non fiscal)">Proforma (PDF)</button>
                        <button onClick={() => cancelOrder(o)} style={btnDanger} title="Annuler la commande (client désisté)">Annuler la commande</button>
                        {canInvoice && <button onClick={() => establish(o)} style={btnPrimary}>Établir la facture</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {canValidateThreshold && (
        <Card title="Factures à valider (au-dessus du seuil)" icon={<IconFinance />} subtitle={`Décision du DG : valider (émettre la facture) ou refuser. Seuil actuel : ${threshold != null ? fmt.format(threshold) : "…"}.`}>
          <button onClick={editThreshold} style={{ ...btnGhost, marginBottom: 10 }}>Modifier le seuil</button>
          {pending.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>Aucune facture en attente de validation.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {pending.map((i) => (
                <div key={i.id} style={row}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-mono)" }}>{i.invoice_number}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{i.customer_name} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(i.total_ttc)}</span></div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => reject(i)} style={btnDanger} title="Refuser : la facture est annulée et la commande repasse « à facturer »">Refuser</button>
                    <button onClick={() => approve(i)} style={btnPrimary}>Valider</button>
                  </div>
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
