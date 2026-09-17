import { Fragment, useEffect, useState } from "react";
import { TableScroll } from "./TableScroll";
import {
  listStockCommercials,
  getCommercialStockAll,
  getMyCommercialStock,
  handoverToCommercial,
  returnFromCommercial,
  createCommercialGood,
  getCommercialMovements,
  type CommercialMovement,
  type CommercialPick,
  type CommercialStockRow,
  type CommercialStockReport,
  type IsbnRef,
  type StockLocation,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Modal, Field } from "./Modal";
import { IsbnCombobox } from "./IsbnCombobox";
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
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, CommercialMovement[] | "loading">>({});

  function toggleDetail(row: CommercialStockRow) {
    if (openDetail === row.location_id) { setOpenDetail(null); return; }
    setOpenDetail(row.location_id);
    if (!detail[row.location_id] && row.user_id) {
      setDetail((d) => ({ ...d, [row.location_id]: "loading" }));
      getCommercialMovements(row.user_id)
        .then((r) => setDetail((d) => ({ ...d, [row.location_id]: r.movements })))
        .catch(() => setDetail((d) => ({ ...d, [row.location_id]: [] })));
    }
  }

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
                <Fragment key={r.location_id}>
                  <tr style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ textAlign: "left", padding: "6px 8px", fontFamily: "var(--font-sans, inherit)" }}>
                      <button
                        type="button"
                        onClick={() => toggleDetail(r)}
                        title="Voir le détail des mouvements"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--ink)", font: "inherit", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <span style={{ color: "var(--eclosion-dark, #9a7a12)", transform: openDetail === r.location_id ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform .15s" }}>▸</span>
                        {r.commercial_name ?? "—"}
                      </button>
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.recus)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.vendus)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.retournes)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.offerts)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(r.pertes)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, color: r.a_justifier > 0 ? "var(--alert, #C4661F)" : "var(--ink)" }}>{fmt(r.a_justifier)}</td>
                  </tr>
                  {openDetail === r.location_id && (
                    <tr>
                      <td colSpan={7} style={{ padding: "4px 8px 12px", background: "var(--ivoire, #FAF8F2)", fontFamily: "var(--font-sans, inherit)" }}>
                        <DetailMovements data={detail[r.location_id]} recus={r.recus} vendus={r.vendus} retournes={r.retournes} offerts={r.offerts} pertes={r.pertes} detenus={r.a_justifier} />
                      </td>
                    </tr>
                  )}
                </Fragment>
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

const MOVEMENT_FR: Record<string, string> = {
  transfer: "Remise / transfert", supplier_in: "Entrée fournisseur", production_in: "Entrée production",
  sale_out: "Vente", commercial_return: "Retour au magasin", consignment_out: "Dépôt-vente",
  author_copy: "Exemplaire auteur", press_copy: "Service de presse", promotional_out: "Promotion",
  institutional_out: "Institutionnel", event_out: "Événement", free_out: "Don / offert",
  loss: "Perte", damage: "Détérioration", destruction: "Destruction", pulping: "Pilon",
  inventory_adjustment: "Ajustement d'inventaire",
};

// Détail des mouvements d'un commercial : trace chaque exemplaire reçu / rendu /
// vendu, et vérifie la cohérence « reçus − sorties = détenus (à justifier) ».
function DetailMovements({ data, recus, vendus, retournes, offerts, pertes, detenus }: {
  data: CommercialMovement[] | "loading" | undefined;
  recus: number; vendus: number; retournes: number; offerts: number; pertes: number; detenus: number;
}) {
  if (data === "loading" || data === undefined) return <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>Chargement du détail…</p>;
  if (data.length === 0) return <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>Aucun mouvement enregistré pour ce commercial.</p>;
  const attendu = recus - vendus - retournes - offerts - pertes;
  const ecart = detenus - attendu;
  const fdate = (s: string) => new Date(s).toLocaleDateString("fr-FR");
  return (
    <div>
      <div style={{ fontSize: 12, margin: "6px 0 8px", color: ecart === 0 ? "var(--positive, #2F7D4A)" : "var(--alert, #B23A2E)" }}>
        Contrôle : reçus {recus} − vendus {vendus} − retournés {retournes} − offerts {offerts} − pertes {pertes} = <strong>{attendu}</strong> ; détenus (à justifier) = <strong>{detenus}</strong>
        {ecart === 0 ? " — cohérent." : ` — écart de ${ecart} (à vérifier ci-dessous).`}
      </div>
      <TableScroll>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 620 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "4px 8px" }}>Date</th>
              <th style={{ padding: "4px 8px" }}>Sens</th>
              <th style={{ padding: "4px 8px" }}>Ouvrage</th>
              <th style={{ padding: "4px 8px", textAlign: "right" }}>Quantité</th>
              <th style={{ padding: "4px 8px" }}>Nature</th>
              <th style={{ padding: "4px 8px" }}>Par</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)" }}>{fdate(m.moved_at)}</td>
                <td style={{ padding: "4px 8px", color: m.direction === "in" ? "var(--positive, #2F7D4A)" : "var(--ink)" }}>{m.direction === "in" ? "Reçu" : "Sorti"}</td>
                <td style={{ padding: "4px 8px" }}>{m.title ?? m.isbn13 ?? "—"}</td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{m.direction === "in" ? "+" : "−"}{m.quantity.toLocaleString("fr-FR")}</td>
                <td style={{ padding: "4px 8px" }}>{MOVEMENT_FR[m.type] ?? m.type}{m.reason ? ` · ${m.reason}` : ""}</td>
                <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{m.by_name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
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
  // Catalogue local : on part des ouvrages fournis, mais un ajout rapide (D-042)
  // peut y insérer une nouvelle fiche sans recharger toute la page.
  const [localIsbns, setLocalIsbns] = useState<IsbnRef[]>(isbns);
  const [isbnId, setIsbnId] = useState(isbns[0]?.id ?? "");
  const [locationId, setLocationId] = useState(magasins[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [movedAt, setMovedAt] = useState(today);
  const [busy, setBusy] = useState(false);
  const isReturn = mode === "return";

  // Ajout rapide d'un ouvrage/bien absent du catalogue (remise uniquement).
  const [quickOpen, setQuickOpen] = useState(false);
  const [qgTitle, setQgTitle] = useState("");
  const [qgIsbn, setQgIsbn] = useState("");
  const [qgAuthor, setQgAuthor] = useState("");
  const [qgPrice, setQgPrice] = useState("");
  const [qgBusy, setQgBusy] = useState(false);
  const [qgMsg, setQgMsg] = useState("");
  const [qgDupExisting, setQgDupExisting] = useState<IsbnRef | null>(null);

  function selectCatalogEntry(entry: IsbnRef) {
    setLocalIsbns((prev) => (prev.some((i) => i.id === entry.id) ? prev : [entry, ...prev]));
    setIsbnId(entry.id);
    setQuickOpen(false);
    setQgTitle(""); setQgIsbn(""); setQgAuthor(""); setQgPrice("");
    setQgDupExisting(null);
  }

  async function submitQuickGood() {
    if (!qgTitle.trim()) { setQgMsg("Indiquez au moins le titre de l'ouvrage."); return; }
    setQgBusy(true); setQgMsg(""); setQgDupExisting(null);
    try {
      const priceNum = qgPrice.trim() ? Number(qgPrice) : undefined;
      const res = await createCommercialGood({
        title: qgTitle.trim(),
        isbn13: qgIsbn.trim() || undefined,
        author_name: qgAuthor.trim() || undefined,
        price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : undefined,
      });
      if ("isbn" in res) {
        const label = res.isbn.manuscript?.title ?? qgTitle.trim();
        selectCatalogEntry(res.isbn);
        setQgMsg(`« ${label} » ajouté au catalogue et sélectionné pour la remise.`);
      } else {
        setQgMsg(res.duplicate.message);
        setQgDupExisting(res.duplicate.existing);
      }
    } catch (e) {
      setQgMsg(e instanceof Error ? e.message : "Ajout impossible.");
    } finally {
      setQgBusy(false);
    }
  }

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
      <Field label="Ouvrage — tapez le titre, l'ISBN ou l'auteur">
        <IsbnCombobox isbns={localIsbns} value={isbnId} onChange={setIsbnId} placeholder="Ex. « MAN » pour Manuel…" />
        {!isReturn && (
          <button
            type="button"
            onClick={() => { setQuickOpen((v) => !v); setQgMsg(""); setQgDupExisting(null); }}
            style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: "var(--eclosion)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
          >
            {quickOpen ? "Fermer l'ajout rapide" : "＋ L'ouvrage n'est pas dans la liste ? L'ajouter au catalogue"}
          </button>
        )}
      </Field>
      {!isReturn && quickOpen && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", margin: "0 0 10px", background: "var(--ivoire, #FAF8F2)" }}>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
            Crée une fiche minimale dans le <strong>catalogue central</strong> (l'éditorial pourra la compléter). Un contrôle évite les doublons.
          </p>
          <Field label="Titre de l'ouvrage / du bien">
            <input value={qgTitle} onChange={(e) => setQgTitle(e.target.value)} placeholder="Titre" autoFocus />
          </Field>
          <Field label="ISBN (facultatif — 13 chiffres)">
            <input value={qgIsbn} onChange={(e) => setQgIsbn(e.target.value)} placeholder="978… (laisser vide si inconnu)" />
          </Field>
          <Field label="Auteur (facultatif)">
            <input value={qgAuthor} onChange={(e) => setQgAuthor(e.target.value)} placeholder="Prénom Nom" />
          </Field>
          <Field label="Prix public FRS CFA (facultatif)">
            <input type="number" min={0} value={qgPrice} onChange={(e) => setQgPrice(e.target.value)} placeholder="0" />
          </Field>
          {qgMsg && (
            <p style={{ fontSize: 12, color: qgDupExisting || qgMsg.startsWith("«") ? "var(--ink)" : "var(--danger, #B23A2E)", margin: "0 0 8px" }}>{qgMsg}</p>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="add" size="sm" onClick={submitQuickGood} disabled={qgBusy}>{qgBusy ? "Ajout…" : "Ajouter au catalogue"}</Button>
            {qgDupExisting && (
              <Button variant="view" size="sm" onClick={() => selectCatalogEntry(qgDupExisting)}>Sélectionner l'ouvrage existant</Button>
            )}
          </div>
        </div>
      )}
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
