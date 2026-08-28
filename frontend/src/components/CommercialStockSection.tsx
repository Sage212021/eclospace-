import { useEffect, useState } from "react";
import { TableScroll } from "./TableScroll";
import {
  listStockCommercials,
  getCommercialStockAll,
  getMyCommercialStock,
  handoverToCommercial,
  returnFromCommercial,
  type CommercialPick,
  type CommercialStockRow,
  type CommercialStockReport,
  type IsbnRef,
  type StockLocation,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Modal, Field } from "./Modal";
import { IconCommercial } from "./icons";

// Stock commercial individuel (§10) : remise magasin → commercial (≠ vente),
// retour, et état par commercial avec les exemplaires « à justifier ».
export function CommercialStockSection({ isbns, locations, canManage, onMessage, onError }: {
  isbns: IsbnRef[];
  locations: StockLocation[];
  canManage: boolean;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [commercials, setCommercials] = useState<CommercialPick[]>([]);
  const [rows, setRows] = useState<CommercialStockRow[] | null>(null);
  const [total, setTotal] = useState<CommercialStockReport | null>(null);
  const [dialog, setDialog] = useState<null | "handover" | "return">(null);

  const magasins = locations.filter((l) => l.type !== "depot_vente");

  async function load() {
    // L'état global n'est visible qu'aux responsables ; on l'ignore en silence sinon.
    getCommercialStockAll().then((d) => { setRows(d.reps); setTotal(d.total); }).catch(() => { setRows(null); setTotal(null); });
    if (canManage) listStockCommercials().then(setCommercials).catch(() => setCommercials([]));
  }
  useEffect(() => { load(); }, [canManage]);

  const fmt = (n: number) => n.toLocaleString("fr-FR");

  return (
    <Card
      title="Stock commercial"
      icon={<IconCommercial />}
      subtitle="Exemplaires confiés à chaque commercial — reçus, vendus, retournés et à justifier (§10)."
      collapsible
      defaultOpen
      action={canManage ? (
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="add" size="sm" onClick={() => setDialog("handover")}>Remettre</Button>
          <Button variant="view" size="sm" onClick={() => setDialog("return")}>Retour</Button>
        </div>
      ) : undefined}
    >
      {rows === null ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          {canManage ? "Aucune remise enregistrée pour l'instant. Utilisez « Remettre » pour confier des exemplaires à un commercial." : "État réservé au responsable commercial."}
        </p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun exemplaire confié à un commercial pour l'instant.</p>
      ) : (
        <TableScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--muted)", fontSize: 11.5 }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Commercial</th>
                <th style={{ padding: "6px 8px" }}>Reçus</th>
                <th style={{ padding: "6px 8px" }}>Vendus</th>
                <th style={{ padding: "6px 8px" }}>Retournés</th>
                <th style={{ padding: "6px 8px" }}>Offerts</th>
                <th style={{ padding: "6px 8px" }}>Pertes</th>
                <th style={{ padding: "6px 8px" }}>À justifier</th>
              </tr>
            </thead>
            <tbody style={{ fontFamily: "var(--font-mono)" }}>
              {rows.map((r) => (
                <tr key={r.location_id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ textAlign: "left", padding: "6px 8px", fontFamily: "var(--font-sans, inherit)" }}>{r.commercial_name ?? "—"}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.recus)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.vendus)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.retournes)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.offerts)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.pertes)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, color: r.a_justifier > 0 ? "var(--alert, #C4661F)" : "var(--ink)" }}>{fmt(r.a_justifier)}</td>
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--eclosion)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  <td style={{ textAlign: "left", padding: "6px 8px", fontFamily: "var(--font-sans, inherit)" }}>Total équipe</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(total.recus)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(total.vendus)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(total.retournes)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(total.offerts)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(total.pertes)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px", color: "var(--alert, #C4661F)" }}>{fmt(total.a_justifier)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>« À justifier » = exemplaires encore détenus par le commercial (à vendre ou à retourner).</p>
        </TableScroll>
      )}

      {dialog && (
        <HandoverDialog
          mode={dialog}
          commercials={commercials}
          isbns={isbns}
          magasins={magasins}
          onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); onMessage(msg); load(); }}
          onError={onError}
        />
      )}
    </Card>
  );
}

// Vue du commercial connecté : son propre stock à justifier (§10, §27).
export function MyCommercialStockCard() {
  const [rep, setRep] = useState<(CommercialStockReport & { location_id: string | null }) | null>(null);
  useEffect(() => { getMyCommercialStock().then(setRep).catch(() => setRep(null)); }, []);
  if (!rep || (rep.location_id === null && rep.recus === 0)) return null;
  const fmt = (n: number) => n.toLocaleString("fr-FR");
  const cell = (label: string, value: number, strong = false) => (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--card, #fff)", minWidth: 96 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, lineHeight: 1, color: strong && value > 0 ? "var(--alert, #C4661F)" : "var(--ink)" }}>{fmt(value)}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{label}</div>
    </div>
  );
  return (
    <Card title="Mon stock commercial" icon={<IconCommercial />} subtitle="Exemplaires qui me sont confiés — à vendre ou à retourner." collapsible defaultOpen>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {cell("Reçus", rep.recus)}
        {cell("Vendus", rep.vendus)}
        {cell("Retournés", rep.retournes)}
        {cell("Offerts", rep.offerts)}
        {cell("Pertes", rep.pertes)}
        {cell("À justifier", rep.a_justifier, true)}
      </div>
    </Card>
  );
}

function HandoverDialog({ mode, commercials, isbns, magasins, onClose, onDone, onError }: {
  mode: "handover" | "return";
  commercials: CommercialPick[];
  isbns: IsbnRef[];
  magasins: StockLocation[];
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (m: string) => void;
}) {
  const [userId, setUserId] = useState(commercials[0]?.id ?? "");
  const [isbnId, setIsbnId] = useState(isbns[0]?.id ?? "");
  const [locationId, setLocationId] = useState(magasins[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [movedAt, setMovedAt] = useState(today);
  const [busy, setBusy] = useState(false);
  const isReturn = mode === "return";

  async function submit() {
    if (!userId || !isbnId || !locationId || quantity <= 0) { onError("Renseignez le commercial, l'ouvrage, le magasin et une quantité."); return; }
    if (!isReturn && movedAt && movedAt > today) { onError("La date de remise ne peut pas être postérieure à aujourd'hui."); return; }
    setBusy(true);
    try {
      const payload = { isbn_id: isbnId, quantity, location_id: locationId, reason: reason.trim() || undefined };
      const name = commercials.find((c) => c.id === userId)?.name ?? "commercial";
      if (isReturn) { await returnFromCommercial(userId, payload); onDone(`Retour de ${quantity} exemplaire(s) de ${name} enregistré.`); }
      else {
        // La date de remise peut être antérieure au jour en cours (remise saisie a posteriori).
        const moved_at = movedAt && movedAt !== today ? new Date(movedAt + "T12:00:00").toISOString() : undefined;
        await handoverToCommercial(userId, { ...payload, moved_at });
        onDone(`Remise de ${quantity} exemplaire(s) à ${name} enregistrée.`);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Opération impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isReturn ? "Retour d'un commercial" : "Remettre à un commercial"}
      onClose={onClose}
      footer={
        <>
          <Button variant="view" size="sm" onClick={onClose}>Annuler</Button>
          <Button variant="add" size="sm" onClick={submit} disabled={busy}>{busy ? "Enregistrement…" : "Valider"}</Button>
        </>
      }
    >
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
        {isReturn ? "Le commercial rend des exemplaires au magasin." : "Confier des exemplaires à un commercial — ce n'est pas une vente."}
      </p>
      <Field label="Commercial">
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {commercials.length === 0 && <option value="">Aucun commercial</option>}
          {commercials.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Ouvrage (ISBN)">
        <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)}>
          {isbns.map((i) => <option key={i.id} value={i.id}>{i.isbn13}{i.manuscript?.title ? ` — ${i.manuscript.title}` : ""}</option>)}
        </select>
      </Field>
      <Field label={isReturn ? "Magasin de destination" : "Magasin d'origine"}>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {magasins.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </Field>
      <Field label="Quantité">
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
      </Field>
      {!isReturn && (
        <Field label="Date de remise">
          <input type="date" max={today} value={movedAt} onChange={(e) => setMovedAt(e.target.value)} />
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0" }}>
            Par défaut aujourd'hui. Une date antérieure est possible si la remise a déjà eu lieu.
          </p>
        </Field>
      )}
      <Field label="Motif (facultatif)">
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
