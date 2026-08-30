import { useEffect, useState } from "react";
import {
  getEditorialQuotesInbox,
  getEditorialQuote,
  sendEditorialQuote,
  acceptEditorialQuote,
  type EditorialQuoteInboxRow,
} from "../api/client";
import { printEditorialQuote } from "../lib/print";
import { Card } from "./Card";
import { Button } from "./Button";
import { DocPrintMenu } from "./DocPrintMenu";
import { PeriodFilter, currentPeriod, inPeriod, type Period } from "./PeriodFilter";

// Circuit devis → Éditorial → client → facture (côté Éditorial). Les devis
// transmis par la Finance : le responsable / la direction éditoriale les
// IMPRIME et les ENVOIE au client (e-mail, WhatsApp), puis remonte la
// VALIDATION du client. La facture reste établie par la Finance après validation.

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: "À envoyer au client", bg: "#F7E7DA", fg: "#C4661F" },
  sent: { label: "Envoyé — en attente du client", bg: "var(--eclosion-soft)", fg: "var(--eclosion)" },
  accepted: { label: "Validé par le client", bg: "#e6efe4", fg: "#3B7A34" },
  refused: { label: "Refusé", bg: "#f8e3df", fg: "var(--danger, #C24B3A)" },
};

const money = (v: string, cur: string) => `${Math.round(Number(v)).toLocaleString("fr-FR")} ${cur === "XAF" ? "FCFA" : cur}`;

export function EditorialQuotesInbox({ heading = true, manuscriptId }: { heading?: boolean; manuscriptId?: string }) {
  const [rows, setRows] = useState<EditorialQuoteInboxRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);
  const [signer, setSigner] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Filtre par période (D-023) — seulement dans la vue globale (registre des
  // devis) ; sur la fiche d'un manuscrit, on affiche tous ses devis sans filtre.
  const [period, setPeriod] = useState<Period>(currentPeriod());
  const filtered = manuscriptId ? rows : rows.filter((r) => inPeriod(r.handed_at, period));

  const load = () => getEditorialQuotesInbox(manuscriptId).then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [manuscriptId]);

  async function sendEmail(id: string) {
    setBusy(id); setError(null); setInfo(null);
    try {
      const r = await sendEditorialQuote(id);
      setInfo(r.email_sent ? "Devis envoyé au client par e-mail." : `Lien de signature prêt (e-mail non envoyé — adresse ou SMTP manquant) : ${r.sign_url}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); } finally { setBusy(null); }
  }

  async function sendWhatsApp(row: EditorialQuoteInboxRow) {
    setBusy(row.id); setError(null); setInfo(null);
    try {
      const r = await sendEditorialQuote(row.id);
      await load();
      const link = r.sign_url ?? "";
      const text = encodeURIComponent(`Bonjour, voici votre devis ${row.quote_number} (${money(row.total_ttc, row.currency)}). Merci de le valider ici : ${link}`);
      const num = (row.client_whatsapp ?? "").replace(/[^\d]/g, "");
      window.open(num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`, "_blank", "noopener");
    } catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); } finally { setBusy(null); }
  }

  async function confirmValidated(id: string) {
    if (!signer.trim()) { setError("Indiquez le nom de la personne qui a validé le devis."); return; }
    setBusy(id); setError(null);
    try {
      await acceptEditorialQuote(id, { method: "internal", signer_name: signer.trim(), consent: true });
      setInfo("Validation du client enregistrée. La Finance peut établir la facture.");
      setValidating(null); setSigner("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); } finally { setBusy(null); }
  }

  const body = (
    <>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {info && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{info}</div>}
      {!manuscriptId && rows.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <PeriodFilter dates={rows.map((r) => r.handed_at)} value={period} onChange={setPeriod} resultCount={filtered.length} />
        </div>
      )}
      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun devis transmis par la Finance pour le moment.</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun devis pour cette période.</p>
      ) : null}
      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map((r) => {
          const s = STATUS[r.status] ?? STATUS.draft;
          return (
            <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{r.quote_number}</span> · {money(r.total_ttc, r.currency)}{" "}
                    <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "2px 8px", background: s.bg, color: s.fg }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    {r.manuscript?.title ?? "—"}{r.client ? ` · ${r.client}` : ""}
                    {r.client_email ? ` · ✉️ ${r.client_email}` : ""}{r.client_whatsapp ? ` · 💬 ${r.client_whatsapp}` : ""}
                    {r.initiated_by ? ` · initié par ${r.initiated_by}` : ""}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                <DocPrintMenu label="Imprimer le devis" onPrint={(o) => getEditorialQuote(r.id).then((q) => printEditorialQuote(q, o)).catch((e) => setError(e.message))} />
                {(r.status === "draft" || r.status === "sent") && (
                  <>
                    <Button variant="view" size="sm" disabled={busy === r.id} onClick={() => sendEmail(r.id)}>{r.status === "sent" ? "Renvoyer par e-mail" : "Envoyer par e-mail"}</Button>
                    <Button variant="view" size="sm" disabled={busy === r.id} onClick={() => sendWhatsApp(r)}>Envoyer par WhatsApp</Button>
                    <Button variant="edit" size="sm" disabled={busy === r.id} onClick={() => { setValidating(validating === r.id ? null : r.id); setSigner(""); }}>Marquer validé par le client</Button>
                  </>
                )}
              </div>
              {validating === r.id && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
                  <label style={{ fontSize: 11.5 }}>Nom de la personne ayant validé<input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Nom du client / signataire" style={{ display: "block", marginTop: 4, padding: 6, border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, minWidth: 220 }} /></label>
                  <Button variant="add" size="sm" disabled={busy === r.id || !signer.trim()} onClick={() => confirmValidated(r.id)}>Enregistrer la validation</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  if (!heading) return body;
  return <Card title="Devis à transmettre / suivre" subtitle="Devis transmis par la Finance : envoyez-les au client (e-mail, WhatsApp) et remontez leur validation.">{body}</Card>;
}
