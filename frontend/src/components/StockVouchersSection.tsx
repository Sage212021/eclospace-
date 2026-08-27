import { useEffect, useState } from "react";
import {
  listBookReceipts,
  createBookReceipt,
  updateBookReceipt,
  deleteBookReceipt,
  listAuthorWithdrawals,
  createAuthorWithdrawal,
  updateAuthorWithdrawal,
  deleteAuthorWithdrawal,
  type BookReceiptVoucher,
  type BookReceiptLine,
  type AuthorWithdrawalVoucher,
  type AuthorWithdrawalMotive,
  type IsbnRef,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Field } from "./Modal";
import { DocPrintMenu } from "./DocPrintMenu";
import { IsbnCombobox } from "./IsbnCombobox";
import { printBookReceipt, printAuthorWithdrawal } from "../lib/print";
import { useConfirm } from "./ConfirmProvider";

const today = () => new Date().toISOString().slice(0, 10);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

// ============================ Bon de réception ============================

type LineDraft = { isbn_id: string | null; title: string; author: string; qty_ordered: string; qty_received: string; qty_good: string; qty_damaged: string };
const emptyLine = (): LineDraft => ({ isbn_id: null, title: "", author: "", qty_ordered: "", qty_received: "", qty_good: "", qty_damaged: "" });

export function BookReceiptSection({ isbns, canManage, onError }: { isbns: IsbnRef[]; canManage: boolean; onError: (m: string) => void }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<BookReceiptVoucher[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [head, setHead] = useState({ received_at: today(), supplier: "", order_number: "", delivery_note: "", carrier: "", received_by_name: "", received_by_role: "", remarks: "" });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const load = () => listBookReceipts().then(setRows).catch((e) => onError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function reset() {
    setEditingId(null);
    setShowForm(false);
    setHead({ received_at: today(), supplier: "", order_number: "", delivery_note: "", carrier: "", received_by_name: "", received_by_role: "", remarks: "" });
    setLines([emptyLine()]);
  }

  function startEdit(v: BookReceiptVoucher) {
    setEditingId(v.id);
    setShowForm(true);
    setHead({
      received_at: v.receivedAt.slice(0, 10), supplier: v.supplier ?? "", order_number: v.orderNumber ?? "", delivery_note: v.deliveryNote ?? "",
      carrier: v.carrier ?? "", received_by_name: v.receivedByName ?? "", received_by_role: v.receivedByRole ?? "", remarks: v.remarks ?? "",
    });
    setLines(v.lines.length ? v.lines.map((l) => ({ isbn_id: l.isbnId, title: l.title, author: l.author ?? "", qty_ordered: l.qtyOrdered?.toString() ?? "", qty_received: l.qtyReceived?.toString() ?? "", qty_good: l.qtyGood?.toString() ?? "", qty_damaged: l.qtyDamaged?.toString() ?? "" })) : [emptyLine()]);
  }

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function pickIsbn(i: number, id: string) {
    const found = isbns.find((x) => x.id === id);
    setLine(i, { isbn_id: id || null, title: found?.manuscript?.title ?? lines[i].title });
  }

  async function save() {
    const cleanLines: BookReceiptLine[] = lines
      .filter((l) => l.title.trim() !== "")
      .map((l) => ({ isbn_id: l.isbn_id, title: l.title.trim(), author: l.author.trim() || null, qty_ordered: numOrNull(l.qty_ordered), qty_received: numOrNull(l.qty_received), qty_good: numOrNull(l.qty_good), qty_damaged: numOrNull(l.qty_damaged) }));
    if (cleanLines.length === 0) { onError("Ajoutez au moins un ouvrage (titre)."); return; }
    setSaving(true);
    try {
      const payload = { received_at: new Date(head.received_at).toISOString(), supplier: head.supplier || null, order_number: head.order_number || null, delivery_note: head.delivery_note || null, carrier: head.carrier || null, received_by_name: head.received_by_name || null, received_by_role: head.received_by_role || null, remarks: head.remarks || null, lines: cleanLines };
      if (editingId) await updateBookReceipt(editingId, payload);
      else await createBookReceipt(payload);
      reset();
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(v: BookReceiptVoucher) {
    const ok = await confirm({ title: "Supprimer le bon", message: `Supprimer le bon de réception ${v.number} ?`, detail: "Le document est retiré de la liste (annulation tracée).", tone: "danger", confirmLabel: "Supprimer" });
    if (!ok) return;
    try { await deleteBookReceipt(v.id); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Échec."); }
  }

  return (
    <Card title="Bons de réception de livres" subtitle="Réception d'exemplaires livrés par un imprimeur/fournisseur — à saisir et imprimer." collapsible defaultOpen={false}>
      {canManage && !showForm && (
        <div style={{ marginBottom: 12 }}><Button variant="add" size="sm" onClick={() => setShowForm(true)}>Nouveau bon de réception</Button></div>
      )}

      {showForm && canManage && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>{editingId ? "Modifier le bon" : "Nouveau bon de réception"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Field label="Date de réception"><input type="date" value={head.received_at} onChange={(e) => setHead({ ...head, received_at: e.target.value })} /></Field>
            <Field label="Fournisseur"><input value={head.supplier} onChange={(e) => setHead({ ...head, supplier: e.target.value })} /></Field>
            <Field label="N° commande"><input value={head.order_number} onChange={(e) => setHead({ ...head, order_number: e.target.value })} /></Field>
            <Field label="N° bordereau (BL)"><input value={head.delivery_note} onChange={(e) => setHead({ ...head, delivery_note: e.target.value })} /></Field>
            <Field label="Transporteur"><input value={head.carrier} onChange={(e) => setHead({ ...head, carrier: e.target.value })} /></Field>
            <Field label="Réceptionné par (nom)"><input value={head.received_by_name} onChange={(e) => setHead({ ...head, received_by_name: e.target.value })} /></Field>
            <Field label="Poste / service"><input value={head.received_by_role} onChange={(e) => setHead({ ...head, received_by_role: e.target.value })} /></Field>
          </div>

          <div style={{ fontWeight: 600, fontSize: 12.5, margin: "12px 0 6px" }}>Ouvrages reçus</div>
          {lines.map((l, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <div style={{ marginBottom: 6 }}>
                <IsbnCombobox isbns={isbns} value={l.isbn_id ?? ""} onChange={(id) => pickIsbn(i, id)} placeholder="Chercher dans le catalogue (ISBN ou titre) — facultatif" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr", gap: 8, marginBottom: 6 }}>
                <input placeholder="Titre du livre" value={l.title} onChange={(e) => setLine(i, { title: e.target.value })} />
                <input placeholder="Auteur" value={l.author} onChange={(e) => setLine(i, { author: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: 8, alignItems: "center" }}>
                <input type="number" min={0} placeholder="Qté cmd." value={l.qty_ordered} onChange={(e) => setLine(i, { qty_ordered: e.target.value })} />
                <input type="number" min={0} placeholder="Qté reçue" value={l.qty_received} onChange={(e) => setLine(i, { qty_received: e.target.value })} />
                <input type="number" min={0} placeholder="Bon état" value={l.qty_good} onChange={(e) => setLine(i, { qty_good: e.target.value })} />
                <input type="number" min={0} placeholder="Endommagée" value={l.qty_damaged} onChange={(e) => setLine(i, { qty_damaged: e.target.value })} />
                {lines.length > 1 && <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} style={{ border: "1px solid var(--line)", background: "transparent", borderRadius: 6, padding: "6px 8px", cursor: "pointer", color: "#C24B3A" }}>Retirer</button>}
              </div>
            </div>
          ))}
          <div style={{ marginBottom: 10 }}><Button variant="view" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Ajouter un ouvrage</Button></div>
          <Field label="Remarques et réserves"><textarea rows={2} value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Button variant="add" size="sm" onClick={save} disabled={saving}>{saving ? "Enregistrement…" : editingId ? "Enregistrer les modifications" : "Enregistrer le bon"}</Button>
            <Button variant="view" size="sm" onClick={reset}>Annuler</Button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun bon de réception enregistré.</p>
      ) : (
        <div className="ecl-list">
          {rows.map((v) => (
            <div key={v.id} className="ecl-row" style={{ alignItems: "center" }}>
              <div className="ecl-row__main">
                <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{v.number}</span>
                <span className="ecl-row__desc" style={{ margin: 0 }}>{new Date(v.receivedAt).toLocaleDateString("fr-FR")} · {v.supplier ?? "—"} · {v.lines.length} ouvrage(s)</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <DocPrintMenu onPrint={(opts) => printBookReceipt(v, opts)} />
                {canManage && <button onClick={() => startEdit(v)} style={miniBtn}>Modifier</button>}
                {canManage && <button onClick={() => remove(v)} style={{ ...miniBtn, color: "#C24B3A" }}>Supprimer</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ========================= Retrait d'ouvrage auteur =========================

const MOTIVE_LABELS: Record<AuthorWithdrawalMotive, string> = {
  contractuel: "Exemplaires d'auteur (contractuels)",
  achat_remise: "Achat d'exemplaires avec remise auteur",
  restitution_stock: "Restitution de stock après paiement",
  autre: "Autre",
};

export function AuthorWithdrawalSection({ isbns, canManage, onError }: { isbns: IsbnRef[]; canManage: boolean; onError: (m: string) => void }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<AuthorWithdrawalVoucher[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ issued_at: today(), place: "", author_name: "", author_address: "", author_phone: "", author_email: "", work_title: "", isbn_id: null as string | null, quantity: "", motive: "contractuel" as AuthorWithdrawalMotive, motive_other: "" });

  const load = () => listAuthorWithdrawals().then(setRows).catch((e) => onError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function reset() {
    setEditingId(null); setShowForm(false);
    setF({ issued_at: today(), place: "", author_name: "", author_address: "", author_phone: "", author_email: "", work_title: "", isbn_id: null, quantity: "", motive: "contractuel", motive_other: "" });
  }
  function startEdit(v: AuthorWithdrawalVoucher) {
    setEditingId(v.id); setShowForm(true);
    setF({ issued_at: v.issuedAt.slice(0, 10), place: v.place ?? "", author_name: v.authorName, author_address: v.authorAddress ?? "", author_phone: v.authorPhone ?? "", author_email: v.authorEmail ?? "", work_title: v.workTitle, isbn_id: v.isbnId, quantity: v.quantity.toString(), motive: v.motive, motive_other: v.motiveOther ?? "" });
  }

  async function save() {
    if (!f.author_name.trim() || !f.work_title.trim() || !f.quantity.trim()) { onError("Renseignez l'auteur, l'ouvrage et le nombre d'exemplaires."); return; }
    if (f.motive === "autre" && !f.motive_other.trim()) { onError("Précisez le motif « Autre »."); return; }
    setSaving(true);
    try {
      const payload = { issued_at: new Date(f.issued_at).toISOString(), place: f.place || null, author_name: f.author_name.trim(), author_address: f.author_address || null, author_phone: f.author_phone || null, author_email: f.author_email || null, work_title: f.work_title.trim(), isbn_id: f.isbn_id, quantity: Number(f.quantity), motive: f.motive, motive_other: f.motive === "autre" ? f.motive_other.trim() : null };
      if (editingId) await updateAuthorWithdrawal(editingId, payload);
      else await createAuthorWithdrawal(payload);
      reset();
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(v: AuthorWithdrawalVoucher) {
    const ok = await confirm({ title: "Supprimer le retrait", message: `Supprimer le retrait ${v.number} ?`, detail: "Le document est retiré de la liste (annulation tracée).", tone: "danger", confirmLabel: "Supprimer" });
    if (!ok) return;
    try { await deleteAuthorWithdrawal(v.id); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Échec."); }
  }

  return (
    <Card title="Retraits d'ouvrage auteur" subtitle="Décharge signée de la remise d'exemplaires à un auteur — à saisir et imprimer." collapsible defaultOpen={false}>
      {canManage && !showForm && (
        <div style={{ marginBottom: 12 }}><Button variant="add" size="sm" onClick={() => setShowForm(true)}>Nouveau retrait d'ouvrage</Button></div>
      )}

      {showForm && canManage && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>{editingId ? "Modifier le retrait" : "Nouveau retrait d'ouvrage"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Field label="Nom et prénom de l'auteur"><input value={f.author_name} onChange={(e) => setF({ ...f, author_name: e.target.value })} /></Field>
            <Field label="Adresse"><input value={f.author_address} onChange={(e) => setF({ ...f, author_address: e.target.value })} /></Field>
            <Field label="Téléphone"><input value={f.author_phone} onChange={(e) => setF({ ...f, author_phone: e.target.value })} /></Field>
            <Field label="Email"><input value={f.author_email} onChange={(e) => setF({ ...f, author_email: e.target.value })} /></Field>
          </div>
          <div style={{ margin: "8px 0 6px" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Ouvrage (catalogue — facultatif)</div>
            <IsbnCombobox isbns={isbns} value={f.isbn_id ?? ""} onChange={(id) => { const found = isbns.find((x) => x.id === id); setF({ ...f, isbn_id: id || null, work_title: found?.manuscript?.title ?? f.work_title }); }} placeholder="Chercher dans le catalogue (ISBN ou titre)" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Field label="Ouvrage intitulé"><input value={f.work_title} onChange={(e) => setF({ ...f, work_title: e.target.value })} /></Field>
            <Field label="Nombre d'exemplaires"><input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
            <Field label="Fait à (lieu)"><input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></Field>
            <Field label="Date"><input type="date" value={f.issued_at} onChange={(e) => setF({ ...f, issued_at: e.target.value })} /></Field>
          </div>
          <Field label="Motif de la remise">
            <select value={f.motive} onChange={(e) => setF({ ...f, motive: e.target.value as AuthorWithdrawalMotive })}>
              {(Object.keys(MOTIVE_LABELS) as AuthorWithdrawalMotive[]).map((k) => <option key={k} value={k}>{MOTIVE_LABELS[k]}</option>)}
            </select>
          </Field>
          {f.motive === "autre" && <Field label="Préciser le motif"><input value={f.motive_other} onChange={(e) => setF({ ...f, motive_other: e.target.value })} /></Field>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Button variant="add" size="sm" onClick={save} disabled={saving}>{saving ? "Enregistrement…" : editingId ? "Enregistrer les modifications" : "Enregistrer le retrait"}</Button>
            <Button variant="view" size="sm" onClick={reset}>Annuler</Button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun retrait d'ouvrage enregistré.</p>
      ) : (
        <div className="ecl-list">
          {rows.map((v) => (
            <div key={v.id} className="ecl-row" style={{ alignItems: "center" }}>
              <div className="ecl-row__main">
                <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{v.number}</span>
                <span className="ecl-row__desc" style={{ margin: 0 }}>{new Date(v.issuedAt).toLocaleDateString("fr-FR")} · {v.authorName} · {v.quantity} ex. · {v.workTitle}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <DocPrintMenu onPrint={(opts) => printAuthorWithdrawal(v, opts)} />
                {canManage && <button onClick={() => startEdit(v)} style={miniBtn}>Modifier</button>}
                {canManage && <button onClick={() => remove(v)} style={{ ...miniBtn, color: "#C24B3A" }}>Supprimer</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const miniBtn: React.CSSProperties = { fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", color: "var(--ink)" };
