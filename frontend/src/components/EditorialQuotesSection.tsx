import { useEffect, useState } from "react";
import {
  acceptEditorialQuote,
  createEditorialQuote,
  getEditorialQuote,
  deleteEditorialQuote,
  resetEditorialQuoteChain,
  invoiceEditorialQuote,
  handQuoteToEditorial,
  listCustomers,
  listEditorialQuotes,
  listPaymentMethods,
  sendEditorialQuote,
  type Customer,
  type EditorialQuote,
  type EditorialQuoteStatus,
  type PaymentMethodDef,
  type ServiceType,
} from "../api/client";
import { printEditorialQuote, printInvoice } from "../lib/print";
import { downloadEditorialQuotePdf } from "../lib/financePdf";
import { Modal, Field } from "./Modal";
import { Button } from "./Button";
import { DocPrintMenu } from "./DocPrintMenu";
import { useConfirm } from "./ConfirmProvider";
import { CollapsibleSection } from "./CollapsibleSection";

const STATUS_LABELS: Record<EditorialQuoteStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyé — en attente de signature",
  accepted: "Accepté / signé",
  refused: "Refusé",
  expired: "Expiré",
  invoiced: "Facturé",
};

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  editorial: "Éditoriale",
  impression: "Impression",
  communication: "Communication",
};

// Catalogues de départ par métier (libres : on peut saisir toute autre ligne).
const SERVICE_CATALOGS: Record<ServiceType, string[]> = {
  editorial: [
    "Relecture",
    "Correction (orthographe / typographie)",
    "Proposition de couverture",
    "Création de couverture",
    "Maquette intérieure (mise en page)",
    "Accompagnement éditorial",
  ],
  impression: [
    "Tirage offset",
    "Tirage numérique",
    "Papier (fourniture)",
    "Façonnage",
    "Reliure",
    "Pelliculage",
    "Découpe / massicot",
  ],
  communication: [
    "Création de logo",
    "Cartes de visite",
    "Flyers / dépliants",
    "Affiches",
    "Banderole / kakémono",
    "Community management (mensuel)",
    "Charte graphique",
  ],
};

interface Props {
  manuscriptId: string;
  defaultPartnerId: string;
  canCreate: boolean; // finance:saisie
  canValidate: boolean; // finance:validation
  canAdmin?: boolean; // finance:administration (réinitialisation données de test)
}

// Compte d'auteur (Phase B) : gestion des devis de prestation éditoriale d'un
// manuscrit — création, envoi pour signature en ligne, signature interne/papier,
// puis génération de la facture. Hors impression et communication.
export function EditorialQuotesSection({ manuscriptId, defaultPartnerId, canCreate, canValidate, canAdmin }: Props) {
  const confirm = useConfirm();
  const [quotes, setQuotes] = useState<EditorialQuote[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<EditorialQuote | null>(null);
  // Facturation : modal de saisie de l'acompte éventuel avant d'émettre la facture.
  const [invoicing, setInvoicing] = useState<EditorialQuote | null>(null);
  const [invAdv, setInvAdv] = useState({ amount: "", label: "Avance", method: "" });
  const [methods, setMethods] = useState<PaymentMethodDef[]>([]);

  const refresh = () => listEditorialQuotes(manuscriptId).then(setQuotes).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, [manuscriptId]);
  useEffect(() => {
    listPaymentMethods().then((ms) => setMethods(ms.filter((m) => m.active))).catch(() => {});
  }, []);

  async function handleHandToEditorial(q: EditorialQuote) {
    setError(null);
    setInfo(null);
    try {
      await handQuoteToEditorial(q.id);
      setInfo(`Devis ${q.quoteNumber} transmis au responsable éditorial : il l'enverra au client pour validation.`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transmission impossible.");
    }
  }

  async function handleSend(q: EditorialQuote) {
    setError(null);
    setInfo(null);
    try {
      const r = await sendEditorialQuote(q.id);
      setInfo(
        r.email_sent
          ? `Devis envoyé à l'auteur par e-mail pour signature en ligne.`
          : `Lien de signature prêt (l'e-mail n'a pas été envoyé — adresse auteur ou SMTP manquant). À transmettre à l'auteur : ${r.sign_url}`,
      );
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi.");
    }
  }

  async function handleDelete(q: EditorialQuote) {
    const ok = await confirm({
      title: "Supprimer le devis",
      message: `Supprimer le devis ${q.quoteNumber} (brouillon) ?`,
      detail: "Son numéro sera rendu si c'est le dernier de l'année.",
      tone: "danger",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    setError(null);
    setInfo(null);
    try {
      await deleteEditorialQuote(q.id);
      setInfo(`Devis ${q.quoteNumber} supprimé.`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  async function handleReset(q: EditorialQuote) {
    const ok = await confirm({
      title: "Réinitialisation (données de test)",
      message: `Supprimer définitivement le devis ${q.quoteNumber} ET sa facture éventuelle, et rendre les numéros ?`,
      detail: "À n'utiliser qu'en phase de démarrage. Cette action ne touche que ce devis et sa facture — jamais les ventes commerciales. Elle est tracée au journal d'audit.",
      tone: "danger",
      confirmLabel: "Réinitialiser",
    });
    if (!ok) return;
    setError(null);
    setInfo(null);
    try {
      const r = await resetEditorialQuoteChain(q.id);
      setInfo(`Réinitialisé : devis ${r.purged.quoteNumber}${r.purged.invoiceNumber ? ` et facture ${r.purged.invoiceNumber}` : ""} supprimés. Numéros rendus.`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Réinitialisation impossible.");
    }
  }

  function openInvoice(q: EditorialQuote) {
    setInvAdv({ amount: "", label: "Avance", method: "" });
    setInvoicing(q);
  }

  async function doInvoice() {
    const q = invoicing;
    if (!q) return;
    const advAmount = Number(invAdv.amount);
    if (invAdv.amount.trim() && (!Number.isFinite(advAmount) || advAmount < 0)) {
      setError("Montant d'acompte invalide.");
      return;
    }
    const advance = advAmount > 0
      ? { advance_amount: advAmount, advance_label: invAdv.label.trim() || "Avance", advance_method: invAdv.method || methods[0]?.code }
      : undefined;
    setError(null);
    setInfo(null);
    try {
      const invoice = await invoiceEditorialQuote(q.id, advance);
      setInvoicing(null);
      setInfo(`Facture ${invoice.invoiceNumber} générée depuis le devis ${q.quoteNumber}.`);
      refresh();
      printInvoice(invoice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la génération de la facture.");
    }
  }

  return (
    <CollapsibleSection
      title="Devis de prestation"
      subtitle="Éditoriale (facturée à l'auteur), impression ou communication (facturées à un client) — devis → signature → facture."
      storageKey="fiche:devis"
    >
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 10 }}>
        {canCreate && (
          <button onClick={() => setShowForm((v) => !v)} style={secondaryButtonStyle}>
            {showForm ? "Annuler" : "+ Nouveau devis"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}
      {info && <p style={{ color: "var(--eclosion)", fontSize: 12, wordBreak: "break-all" }}>{info}</p>}

      {showForm && (
        <NewQuoteForm
          manuscriptId={manuscriptId}
          defaultPartnerId={defaultPartnerId}
          onCreated={() => {
            setShowForm(false);
            refresh();
          }}
          onError={setError}
        />
      )}

      {quotes.length === 0 && !showForm && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun devis de prestation pour ce manuscrit.</p>}

      {quotes.map((q) => (
        <div key={q.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
              {q.quoteNumber} · {SERVICE_TYPE_LABELS[q.serviceType]}
              {q.partner ? ` · ${q.partner.firstName} ${q.partner.lastName}` : q.customer ? ` · ${q.customer.name}` : ""}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              {new Intl.NumberFormat("fr-FR", { style: "currency", currency: q.currency || "XAF", maximumFractionDigits: 0 }).format(Number(q.totalTtc))}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "2px 10px", fontSize: 11 }}>
              {STATUS_LABELS[q.status]}
            </span>
            <DocPrintMenu onPrint={(o) => getEditorialQuote(q.id).then((quote) => printEditorialQuote(quote, o)).catch((e) => setError(e.message))} onDownloadPdf={() => getEditorialQuote(q.id).then((quote) => downloadEditorialQuotePdf(quote)).catch((e) => setError(e.message))} />
            {canCreate && q.status === "draft" && (
              <button onClick={() => handleHandToEditorial(q)} style={{ ...secondaryButtonStyle, borderColor: "var(--eclosion)", color: "var(--eclosion)", fontWeight: 600 }} title="Remettre le devis au responsable éditorial, qui l'enverra au client">
                → Transmettre à l'éditorial
              </button>
            )}
            {canCreate && (q.status === "draft" || q.status === "sent") && (
              <button onClick={() => handleSend(q)} style={secondaryButtonStyle}>
                {q.status === "sent" ? "Renvoyer le lien" : "✉️ Envoyer pour signature"}
              </button>
            )}
            {canValidate && (q.status === "draft" || q.status === "sent") && (
              <button onClick={() => setAccepting(q)} style={secondaryButtonStyle}>
                ✍️ Signer (interne / papier)
              </button>
            )}
            {canCreate && q.status === "accepted" && (
              <button onClick={() => openInvoice(q)} style={{ ...secondaryButtonStyle, borderColor: "var(--eclosion)", color: "var(--eclosion)", fontWeight: 600 }}>
                Générer la facture
              </button>
            )}
            {canCreate && q.status === "draft" && (
              <button onClick={() => handleDelete(q)} style={{ ...secondaryButtonStyle, borderColor: "var(--alert)", color: "var(--alert)" }}>
                Supprimer
              </button>
            )}
            {canAdmin && (
              <button onClick={() => handleReset(q)} title="Supprime le devis et sa facture, rend les numéros (phase de démarrage)" style={{ ...secondaryButtonStyle, borderColor: "var(--alert)", color: "var(--alert)" }}>
                🧹 Réinitialiser (test)
              </button>
            )}
          </div>
          {q.acceptedAt && q.signerName && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              Signé par {q.signerName} le {new Date(q.acceptedAt).toLocaleDateString("fr-FR")}
              {q.acceptanceMethod === "online_link" ? " (en ligne)" : q.acceptanceMethod === "paper" ? " (devis papier)" : ""}
            </div>
          )}
        </div>
      ))}

      {accepting && (
        <AcceptModal
          quote={accepting}
          onClose={() => setAccepting(null)}
          onAccepted={() => {
            setAccepting(null);
            refresh();
          }}
        />
      )}

      {invoicing && (() => {
        const cur = invoicing.currency || "XAF";
        const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, maximumFractionDigits: 0 });
        const ttc = Number(invoicing.totalTtc);
        const adv = Math.max(0, Math.min(ttc, Number(invAdv.amount) || 0));
        const solde = Math.round((ttc - adv) * 100) / 100;
        return (
          <Modal
            title={`Établir la facture — devis ${invoicing.quoteNumber}`}
            onClose={() => setInvoicing(null)}
            footer={
              <>
                <Button variant="view" size="sm" onClick={() => setInvoicing(null)}>Annuler</Button>
                <Button variant="add" size="sm" onClick={doInvoice}>Établir la facture</Button>
              </>
            }
          >
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>
              Montant total : <strong style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{fmt.format(ttc)}</strong>. Une facture émise est définitive (numérotation légale).
            </p>
            <Field label="Acompte déjà versé par l'auteur (facultatif)">
              <input type="number" min={0} inputMode="decimal" value={invAdv.amount} onChange={(e) => setInvAdv({ ...invAdv, amount: e.target.value })} placeholder="0" style={{ textAlign: "right", fontFamily: "var(--font-mono)" }} />
            </Field>
            <Field label="Libellé imprimé de l'acompte">
              <input value={invAdv.label} onChange={(e) => setInvAdv({ ...invAdv, label: e.target.value })} placeholder="Avance" />
            </Field>
            {methods.length > 0 && (
              <Field label="Mode de paiement de l'acompte">
                <select value={invAdv.method} onChange={(e) => setInvAdv({ ...invAdv, method: e.target.value })}>
                  <option value="">{methods[0]?.label} (par défaut)</option>
                  {methods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                </select>
              </Field>
            )}
            {adv > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--ink)", marginTop: 6 }}>
                {invAdv.label.trim() || "Avance"} : <strong style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(adv)}</strong> → Solde à régler : <strong style={{ fontFamily: "var(--font-mono)", color: "var(--eclosion-dark, #9a7a12)" }}>{fmt.format(solde)}</strong>
              </div>
            )}
          </Modal>
        );
      })()}
    </CollapsibleSection>
  );
}

// Enregistrement de l'accord de l'auteur en interne (① agent) ou papier (② scan).
function AcceptModal({ quote, onClose, onAccepted }: { quote: EditorialQuote; onClose: () => void; onAccepted: () => void }) {
  const [method, setMethod] = useState<"internal" | "paper">("internal");
  const [signerName, setSignerName] = useState(
    quote.partner ? `${quote.partner.firstName} ${quote.partner.lastName}` : quote.customer?.name ?? "",
  );
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (!consent) {
      setError("Cochez la confirmation d'accord de l'auteur.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptEditorialQuote(quote.id, { method, signer_name: signerName.trim(), consent, note: note || undefined });
      onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Signer le devis — ${quote.quoteNumber}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="view" size="sm" onClick={onClose}>Annuler</Button>
          <Button variant="add" size="sm" onClick={handleAccept} disabled={busy || !signerName.trim() || !consent}>
            {busy ? "Enregistrement…" : "Enregistrer la signature"}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
        Pour une signature <b>en ligne par l'auteur</b>, utilisez plutôt « Envoyer pour signature ». Ce formulaire enregistre un accord
        recueilli autrement.
      </p>
      <Field label="Mode de recueil de l'accord">
        <select value={method} onChange={(e) => setMethod(e.target.value as "internal" | "paper")}>
          <option value="internal">① En interne (en personne / téléphone)</option>
          <option value="paper">② Devis papier signé et scanné</option>
        </select>
      </Field>
      <Field label="Nom du signataire (l'auteur)">
        <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Nom et prénom" />
      </Field>
      <Field label="Note (facultatif)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. scan reçu par e-mail le…" />
      </Field>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 4 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>Je confirme l'accord de l'auteur sur ce devis. L'acceptation sera horodatée et inscrite au journal.</span>
      </label>
      {error && <p style={{ color: "var(--alert)", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

interface QuoteLineDraft {
  description: string;
  quantity: number;
  unit_price: number;
}

function NewQuoteForm({
  manuscriptId,
  defaultPartnerId,
  onCreated,
  onError,
}: {
  manuscriptId: string;
  defaultPartnerId: string;
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [serviceType, setServiceType] = useState<ServiceType>("editorial");
  // Destinataire : l'auteur du manuscrit, ou un client commercial (choix C).
  const [targetKind, setTargetKind] = useState<"author" | "customer">(defaultPartnerId ? "author" : "customer");
  const [customerId, setCustomerId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lines, setLines] = useState<QuoteLineDraft[]>([{ description: "", quantity: 1, unit_price: 0 }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listCustomers().then(setCustomers).catch(() => setCustomers([]));
  }, []);

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  function update(i: number, patch: Partial<QuoteLineDraft>) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (targetKind === "author" && !defaultPartnerId) {
      onError("Aucun auteur rattaché à ce manuscrit — choisissez un client.");
      return;
    }
    if (targetKind === "customer" && !customerId) {
      onError("Sélectionnez le client à facturer.");
      return;
    }
    const clean = lines.filter((l) => l.description.trim() && l.quantity > 0);
    if (clean.length === 0) {
      onError("Ajoutez au moins une ligne de prestation.");
      return;
    }
    setBusy(true);
    try {
      await createEditorialQuote({
        service_type: serviceType,
        ...(targetKind === "author" ? { partner_id: defaultPartnerId } : { customer_id: customerId }),
        manuscript_id: manuscriptId,
        lines: clean.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unit_price: l.unit_price, tax_rate: 0 })),
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la création.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 12 }}>
          Type de prestation
          <select
            value={serviceType}
            onChange={(e) => {
              const t = e.target.value as ServiceType;
              setServiceType(t);
              // L'éditorial vise l'auteur ; impression/communication un client.
              setTargetKind(t === "editorial" && defaultPartnerId ? "author" : "customer");
            }}
            style={inputStyle}
          >
            <option value="editorial">Éditoriale (auteur)</option>
            <option value="impression">Impression (client)</option>
            <option value="communication">Communication (client)</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Facturé à
          {targetKind === "author" ? (
            <select value="author" onChange={(e) => setTargetKind(e.target.value as "author" | "customer")} style={inputStyle}>
              <option value="author">Auteur du manuscrit</option>
              <option value="customer">Un client…</option>
            </select>
          ) : (
            <select
              value={customerId}
              onChange={(e) => {
                if (e.target.value === "__author__") setTargetKind("author");
                else setCustomerId(e.target.value);
              }}
              style={inputStyle}
            >
              <option value="">— Choisir un client —</option>
              {defaultPartnerId && <option value="__author__">↩︎ Facturer l'auteur du manuscrit</option>}
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </label>
      </div>

      <datalist id="ecl-service-catalog">
        {SERVICE_CATALOGS[serviceType].map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 70px 120px 32px", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input list="ecl-service-catalog" value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Prestation" style={inputStyle} />
          <input type="number" min={1} value={l.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} style={inputStyle} title="Quantité" />
          <input type="number" min={0} value={l.unit_price} onChange={(e) => update(i, { unit_price: Number(e.target.value) })} placeholder="P.U. FCFA" style={inputStyle} title="Prix unitaire" />
          <button type="button" onClick={() => setLines((cur) => cur.filter((_, idx) => idx !== i))} disabled={lines.length === 1} style={{ ...secondaryButtonStyle, padding: "6px 8px" }} title="Retirer">
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setLines((cur) => [...cur, { description: "", quantity: 1, unit_price: 0 }])} style={secondaryButtonStyle}>
        + Ligne
      </button>
      <div style={{ textAlign: "right", marginTop: 10, fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
        Total : {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(total)}
      </div>
      <button type="submit" disabled={busy} style={{ ...secondaryButtonStyle, marginTop: 8, background: "var(--eclosion)", color: "#fff", border: "none" }}>
        {busy ? "Création…" : "Créer le devis"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, fontSize: 13, boxSizing: "border-box" };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
