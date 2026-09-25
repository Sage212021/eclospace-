import { useEffect, useMemo, useState } from "react";
import {
  listAuthorReceipts, getAuthorReceipt, createAuthorReceipt, getReceiptMethods, searchReceiptManuscripts,
  controlAuthorReceipt, accountAuthorReceipt, getAuthorReceiptStats,
  type AuthorReceiptRow, type AuthorReceiptDetail, type AuthorReceiptType, type ReceiptManuscriptOption, type AuthorReceiptStats,
} from "../api/client";
import { printAuthorReceipt } from "../lib/print";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Modal, Field } from "../components/Modal";
import { TableScroll } from "../components/TableScroll";
import { GuidanceNote } from "../components/GuidanceNote";

const TYPE_LABEL: Record<AuthorReceiptType, string> = {
  frais_depot: "Frais de dépôt (évaluation)",
  prestation_editoriale: "Prestation éditoriale",
};
const STATUS_LABEL: Record<string, string> = {
  enregistre: "Enregistré", a_controler: "À contrôler", controle: "Contrôlé", comptabilise: "Comptabilisé", annule: "Annulé",
};
const STATUS_COLOR: Record<string, string> = {
  enregistre: "#B87400", a_controler: "#B87400", controle: "#2F7D4A", comptabilise: "#2F7D4A", annule: "#B23A2E",
};
const money = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;
const fdate = (s: string) => new Date(s).toLocaleDateString("fr-FR");
const fdatetime = (s: string | null) => (s ? new Date(s).toLocaleString("fr-FR") : "—");

// Écran « Paiements auteurs & Reçus » (pôle Éditorial) et sa vue miroir
// « Encaissements éditoriaux » (pôle Finance) : MÊME donnée, filtres métier.
// `financeView` change les libellés/l'accent ; `canCreate` ouvre l'enregistrement.
export function AuthorReceiptsPage({ canCreate = false, canValidate = false, financeView = false }: { canCreate?: boolean; canValidate?: boolean; financeView?: boolean }) {
  const [rows, setRows] = useState<AuthorReceiptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ from: string; to: string; type: string; status: string; q: string }>({ from: "", to: "", type: "", status: "", q: "" });
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<AuthorReceiptDetail | null>(null);
  const [stats, setStats] = useState<AuthorReceiptStats | null>(null);

  const refresh = () => {
    listAuthorReceipts({ from: filters.from || undefined, to: filters.to || undefined, type: filters.type || undefined, status: filters.status || undefined, q: filters.q || undefined })
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
    if (financeView) {
      getAuthorReceiptStats({ from: filters.from || undefined, to: filters.to || undefined, type: filters.type || undefined })
        .then(setStats).catch(() => setStats(null));
    }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const total = useMemo(() => rows.filter((r) => r.status !== "annule").reduce((s, r) => s + r.amount, 0), [rows]);

  async function openDetail(id: string) {
    try { setDetail(await getAuthorReceipt(id)); } catch (e) { setError(e instanceof Error ? e.message : "Reçu introuvable."); }
  }
  async function printOne(id: string) {
    try { printAuthorReceipt(await getAuthorReceipt(id)); } catch (e) { setError(e instanceof Error ? e.message : "Impression impossible."); }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 1100 }}>
      <h1 className="ecl-page__title">{financeView ? "Encaissements éditoriaux" : "Paiements auteurs & Reçus"}</h1>
      <p className="ecl-page__lead">
        {financeView
          ? "Les reçus enregistrés par l'éditorial, visibles ici sans ressaisie : à contrôler, rapprocher et intégrer en comptabilité."
          : "Enregistrez un paiement d'auteur (frais de dépôt ou prestation éditoriale) et émettez son reçu. L'opération est aussitôt visible côté Finance."}
      </p>

      <GuidanceNote title={financeView ? "Une seule donnée, deux vues" : "Le reçu = l'opération financière"}>
        Chaque reçu est <strong>une opération financière unique</strong> : enregistrée une fois côté éditorial, elle apparaît
        automatiquement côté Finance (aucune double saisie). Le reçu est le <strong>justificatif</strong> de cette opération, avec
        un numéro unique et une traçabilité complète (qui a initié, généré, contrôlé, intégré).
      </GuidanceNote>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, margin: "10px 0" }}>{error}</div>}

      {/* États (vue Finance) : totaux sur le périmètre filtré (hors annulés). */}
      {financeView && stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
          <StatTile label="Total encaissé" value={money(stats.total_amount, "XAF")} accent big />
          <StatTile label="Nombre de reçus" value={String(stats.count)} />
          {stats.by_type.map((t) => <StatTile key={t.key} label={t.label} value={money(t.amount, "XAF")} sub={`${t.count} reçu(s)`} />)}
        </div>
      )}

      {/* Filtres */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "12px 0" }}>
        <label style={lbl}>Du<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={inp} /></label>
        <label style={lbl}>Au<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={inp} /></label>
        <label style={lbl}>Type<select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} style={inp}><option value="">Tous</option><option value="frais_depot">Frais de dépôt</option><option value="prestation_editoriale">Prestation éditoriale</option></select></label>
        <label style={lbl}>Statut<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={inp}><option value="">Tous</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label style={{ ...lbl, flex: 1, minWidth: 180 }}>Recherche<input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="N° reçu, auteur, manuscrit, réf." style={inp} /></label>
        <Button variant="subtle" size="sm" onClick={refresh}>Filtrer</Button>
        {canCreate && <Button variant="add" size="sm" onClick={() => setCreating(true)}>+ Enregistrer un paiement / Émettre un reçu</Button>}
      </div>

      <Card title={`${rows.length} reçu(s)`} subtitle={`Total (hors annulés) : ${money(total, "XAF")}`}>
        <TableScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
            <thead>
              <tr>
                {["N° reçu", "Date", "Auteur", "Manuscrit", "Type", "Prestation", "Montant", "Mode", "Statut", "Enregistré par", ""].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} style={{ ...td, textAlign: "center", color: "var(--muted)" }}>Aucun reçu.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.status === "annule" ? 0.6 : 1 }}>
                  <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{r.receipt_number}</td>
                  <td style={td}>{fdate(r.paid_at)}</td>
                  <td style={td}>{r.author}</td>
                  <td style={td}>{r.manuscript_number ? <span><span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{r.manuscript_number}</span> {r.manuscript}</span> : "—"}</td>
                  <td style={td}>{TYPE_LABEL[r.type]}</td>
                  <td style={td}>{r.service_label ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{money(r.amount, r.currency)}</td>
                  <td style={td}>{r.method_label}</td>
                  <td style={td}><span style={{ fontWeight: 700, color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span></td>
                  <td style={td}>{r.registered_by ?? "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button onClick={() => openDetail(r.id)} style={linkBtn}>Voir</button>
                    <button onClick={() => printOne(r.id)} style={linkBtn}>Imprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      {creating && <CreateReceiptModal onClose={() => setCreating(false)} onCreated={(printNow, id) => { setCreating(false); refresh(); if (printNow) printOne(id); }} />}
      {detail && <ReceiptDetailModal detail={detail} canValidate={canValidate} onClose={() => setDetail(null)} onPrint={() => printAuthorReceipt(detail)} onChanged={async () => { const d = await getAuthorReceipt(detail.id); setDetail(d); refresh(); }} />}
    </div>
  );
}

function CreateReceiptModal({ onClose, onCreated }: { onClose: () => void; onCreated: (printNow: boolean, id: string) => void }) {
  const [methods, setMethods] = useState<{ code: string; label: string }[]>([]);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ReceiptManuscriptOption[]>([]);
  const [selected, setSelected] = useState<ReceiptManuscriptOption | null>(null);
  const [type, setType] = useState<AuthorReceiptType>("frais_depot");
  const [service, setService] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [txRef, setTxRef] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getReceiptMethods().then((m) => { setMethods(m); if (m[0]) setMethod(m[0].code); }).catch(() => setMethods([])); }, []);
  useEffect(() => {
    if (selected) return; // ne pas rechercher tant qu'un manuscrit est choisi
    const t = setTimeout(() => { searchReceiptManuscripts(q).then(setOptions).catch(() => setOptions([])); }, 250);
    return () => clearTimeout(t);
  }, [q, selected]);

  async function submit() {
    setErr(null);
    if (!selected) { setErr("Choisissez le manuscrit concerné."); return; }
    if (!selected.author) { setErr("Ce manuscrit n'a pas d'auteur enregistré."); return; }
    const amt = Number(amount);
    if (!(amt > 0)) { setErr("Montant invalide."); return; }
    if (type === "prestation_editoriale" && !service.trim()) { setErr("Précisez la prestation éditoriale."); return; }
    setBusy(true);
    try {
      const res = await createAuthorReceipt({
        manuscript_id: selected.id, type, amount: amt, method, paid_at: paidAt,
        ...(type === "prestation_editoriale" ? { service_label: service.trim() } : {}),
        ...(txRef.trim() ? { tx_reference: txRef.trim() } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      onCreated(true, res.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Enregistrer un paiement / Émettre un reçu" onClose={onClose} wide footer={
      <>
        <Button variant="subtle" size="sm" onClick={onClose}>Annuler</Button>
        <Button variant="add" size="sm" onClick={submit}>{busy ? "…" : "Enregistrer & imprimer le reçu"}</Button>
      </>
    }>
      {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}

      <Field label="Manuscrit concerné">
        {selected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{selected.manuscript_number}</span>
            <strong>{selected.title}</strong>
            {selected.author && <span style={{ color: "var(--muted)" }}>· {selected.author.name}</span>}
            <button onClick={() => { setSelected(null); setQ(""); }} style={{ ...linkBtn, marginLeft: "auto" }}>Changer</button>
          </div>
        ) : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par titre, référence ou auteur…" autoFocus />
            {options.length > 0 && (
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, marginTop: 6, maxHeight: 200, overflowY: "auto" }}>
                {options.map((o) => (
                  <button key={o.id} onClick={() => setSelected(o)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid var(--line)", background: "#fff", padding: "8px 12px", cursor: "pointer", fontSize: 13 }}>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{o.manuscript_number}</span> <strong>{o.title}</strong>
                    {o.author && <span style={{ color: "var(--muted)" }}> · {o.author.name}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Field>

      {selected?.author && (
        <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 10px" }}>
          Auteur (auto) : <strong style={{ color: "var(--ink)" }}>{selected.author.name}</strong>{selected.author.phone ? ` · ${selected.author.phone}` : ""}{selected.collection ? ` · Collection : ${selected.collection}` : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label="Type de paiement">
          <select value={type} onChange={(e) => setType(e.target.value as AuthorReceiptType)}>
            <option value="frais_depot">Frais de dépôt de manuscrit pour évaluation</option>
            <option value="prestation_editoriale">Frais de prestations éditoriales</option>
          </select>
        </Field>
        {type === "prestation_editoriale" && (
          <Field label="Prestation concernée">
            <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Correction, réécriture, expertise…" list="ar-prestations" />
            <datalist id="ar-prestations">
              {["Correction éditoriale", "Réécriture", "Expertise scientifique", "Relecture", "Préparation éditoriale"].map((p) => <option key={p} value={p} />)}
            </datalist>
          </Field>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label="Montant (FCFA)"><input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Mode de paiement">
          <select value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select>
        </Field>
        <Field label="Date du paiement"><input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label="Référence de transaction (facultatif)"><input value={txRef} onChange={(e) => setTxRef(e.target.value)} placeholder="ID Mobile Money, n° virement…" /></Field>
      </div>
      <Field label="Commentaire (facultatif)"><textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}

function ReceiptDetailModal({ detail: r, canValidate, onClose, onPrint, onChanged }: { detail: AuthorReceiptDetail; canValidate: boolean; onClose: () => void; onPrint: () => void; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accRef, setAccRef] = useState("");
  const line = (label: string, v: React.ReactNode) => <div style={{ fontSize: 13, margin: "3px 0" }}><span style={{ color: "var(--muted)" }}>{label} :</span> {v}</div>;
  const actor = (a: AuthorReceiptDetail["traceability"]["initiated"]) => a ? <>{a.name ?? "—"}{a.role ? ` — ${a.role}` : ""}{a.dept ? ` (${a.dept})` : ""}{a.at ? ` · ${fdatetime(a.at)}` : ""}</> : "—";

  // Circuit Finance : contrôle puis intégration comptable, chaque étape tracée.
  const canControl = canValidate && (r.status === "enregistre" || r.status === "a_controler");
  const canAccount = canValidate && r.status === "controle";

  async function doControl() {
    setBusy(true); setErr(null);
    try { await controlAuthorReceipt(r.id); await onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Contrôle impossible."); }
    finally { setBusy(false); }
  }
  async function doAccount() {
    setBusy(true); setErr(null);
    try { await accountAuthorReceipt(r.id, accRef.trim() || undefined); await onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Intégration comptable impossible."); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Reçu ${r.receipt_number}`} onClose={onClose} wide footer={<><Button variant="subtle" size="sm" onClick={onClose}>Fermer</Button><Button variant="add" size="sm" onClick={onPrint}>Imprimer / Télécharger</Button></>}>
      {line("Statut", <strong style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</strong>)}
      {line("Type", TYPE_LABEL[r.type] + (r.service_label ? ` — ${r.service_label}` : ""))}
      {line("Auteur", `${r.author.name}${r.author.phone ? " · " + r.author.phone : ""}`)}
      {r.manuscript && line("Manuscrit", `${r.manuscript.number} — ${r.manuscript.title}${r.manuscript.collection ? " · " + r.manuscript.collection : ""}`)}
      {line("Montant", <strong>{money(r.amount, r.currency)}</strong>)}
      {line("Mode", r.method_label + (r.tx_reference ? ` · Réf. ${r.tx_reference}` : ""))}
      {line("Date du paiement", fdate(r.paid_at))}
      {r.comment && line("Commentaire", r.comment)}
      {r.accounting_ref && line("Référence comptable", <span style={{ fontFamily: "var(--font-mono)" }}>{r.accounting_ref}</span>)}

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--line)", fontWeight: 700, fontSize: 13 }}>Traçabilité de l'opération</div>
      {line("Initié par", actor(r.traceability.initiated))}
      {line("Reçu généré par", actor(r.traceability.generated))}
      {line("Contrôlé par", actor(r.traceability.controlled))}
      {line("Intégré en comptabilité par", actor(r.traceability.accounted))}
      {r.traceability.cancelled && line("Annulé par", <>{actor(r.traceability.cancelled)}{r.traceability.cancel_reason ? ` — motif : ${r.traceability.cancel_reason}` : ""}</>)}

      {(canControl || canAccount) && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Circuit Finance</div>
          {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
          {canControl && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 6px" }}>Vérifiez le paiement (montant, mode, référence) puis marquez le reçu comme contrôlé.</p>
              <Button variant="add" size="sm" onClick={doControl} disabled={busy}>{busy ? "…" : "Marquer contrôlé"}</Button>
            </div>
          )}
          {canAccount && (
            <div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 6px" }}>Reçu contrôlé : intégrez-le en comptabilité (référence de rapprochement facultative).</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={lbl}>Référence comptable (facultatif)<input value={accRef} onChange={(e) => setAccRef(e.target.value)} placeholder="N° pièce, lot d'export…" style={inp} /></label>
                <Button variant="add" size="sm" onClick={doAccount} disabled={busy}>{busy ? "…" : "Intégrer en comptabilité"}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function StatTile({ label, value, sub, accent = false, big = false }: { label: string; value: string; sub?: string; accent?: boolean; big?: boolean }) {
  return (
    <div style={{
      border: `1px solid ${accent ? "var(--eclosion-gold, #D9B21A)" : "var(--line)"}`,
      background: accent ? "var(--ivoire, #FAF8F2)" : "var(--card, #FFFFFF)",
      borderRadius: 10, padding: "12px 16px", minWidth: 150, flex: big ? "1 1 220px" : "0 1 auto",
    }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: big ? 24 : 19, fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: 3, color: "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 };
const inp: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", color: "var(--muted)", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "7px 10px", borderBottom: "1px solid var(--line)", color: "var(--ink)" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "var(--eclosion-dark)", fontWeight: 600, cursor: "pointer", fontSize: 12.5, marginRight: 8, padding: 0 };
