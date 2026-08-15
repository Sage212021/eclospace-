import { useEffect, useState } from "react";
import {
  getAuthorAccount,
  setAuthorFreeCopies,
  recordAuthorCopy,
  listIsbns,
  listStockLocations,
  type AuthorAccount,
  type AuthorCopyCategory,
  type Isbn,
  type StockLocation,
} from "../api/client";

const CATEGORY_LABELS: Record<AuthorCopyCategory, string> = {
  contractuel: "Au titre du contrat",
  gratuit: "Gratuit",
  promotionnel: "Promotionnel",
  evenement: "Événement",
  achete: "Acheté",
  autre: "Autre",
};

// Compte auteur (§14) : distingue les exemplaires DUS (droit contractuel) des
// exemplaires effectivement REMIS, par catégorie. La remise décrémente le stock.
export function AuthorAccountBlock({ contractId, partnerId, manuscriptId, canManage, canRemit, onError }: {
  contractId: string;
  partnerId: string;
  manuscriptId: string;
  canManage: boolean;
  canRemit: boolean;
  onError: (m: string) => void;
}) {
  const [acc, setAcc] = useState<AuthorAccount | null>(null);
  const [isbns, setIsbns] = useState<Isbn[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [dus, setDus] = useState("");
  const [remise, setRemise] = useState(false);

  const load = () => getAuthorAccount(contractId).then((a) => { setAcc(a); setDus(a.author_free_copies?.toString() ?? ""); }).catch((e) => onError(e instanceof Error ? e.message : "Chargement du compte auteur impossible."));
  useEffect(() => {
    load();
    listIsbns(manuscriptId).then(setIsbns).catch(() => setIsbns([]));
    if (canRemit) listStockLocations().then(setLocations).catch(() => setLocations([]));
  }, [contractId, manuscriptId, canRemit]);

  async function saveDus() {
    try {
      await setAuthorFreeCopies(contractId, dus.trim() === "" ? null : Number(dus));
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : "Enregistrement impossible."); }
  }

  if (!acc) return null;
  const fmt = (n: number) => n.toLocaleString("fr-FR");

  return (
    <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--eclosion)" }}>Compte auteur (exemplaires)</div>

      {/* Dus vs remis vs encore dus */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", minWidth: 110 }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Dus (contrat)</div>
          {canManage ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 3 }}>
              <input type="number" min={0} value={dus} onChange={(e) => setDus(e.target.value)} style={{ width: 64, fontFamily: "var(--font-mono)", fontSize: 15, padding: 2 }} />
              <button onClick={saveDus} style={{ fontSize: 11, cursor: "pointer", border: "1px solid var(--line)", borderRadius: 5, background: "#fff", padding: "3px 6px" }}>OK</button>
            </div>
          ) : (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700 }}>{acc.author_free_copies ?? "—"}</div>
          )}
        </div>
        <Stat label="Remis (total)" value={fmt(acc.remis_total)} />
        <Stat label="Dont au contrat" value={fmt(acc.remis_contractuel)} />
        <Stat label="Encore dus" value={acc.encore_dus === null ? "—" : fmt(acc.encore_dus)} alert={(acc.encore_dus ?? 0) > 0} />
      </div>

      {/* Répartition par catégorie */}
      {acc.remis_total > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
          {(Object.keys(CATEGORY_LABELS) as AuthorCopyCategory[]).filter((c) => acc.by_category[c] > 0).map((c) => (
            <span key={c} style={{ background: "var(--eclosion-soft)", borderRadius: 999, padding: "2px 9px" }}>{CATEGORY_LABELS[c]} : <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{acc.by_category[c]}</b></span>
          ))}
        </div>
      )}

      {canRemit && (
        remise ? (
          <RemiseForm
            partnerId={partnerId}
            contractId={contractId}
            isbns={isbns}
            locations={locations.filter((l) => l.type !== "depot_vente" && l.type !== "stock_commercial")}
            onDone={() => { setRemise(false); load(); }}
            onCancel={() => setRemise(false)}
            onError={onError}
          />
        ) : (
          <button onClick={() => setRemise(true)} style={{ fontSize: 12, cursor: "pointer", border: "1px solid var(--eclosion)", color: "var(--eclosion)", borderRadius: 6, background: "#fff", padding: "5px 10px", fontWeight: 600 }}>
            + Remettre à l'auteur
          </button>
        )
      )}

      {/* Historique des remises */}
      {acc.entries.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
          {acc.entries.slice(0, 6).map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{new Date(e.delivered_at).toLocaleDateString("fr-FR")}</span>
              <span>{e.category_label}</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>×{e.quantity}</span>
              {e.note && <span>· {e.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", minWidth: 96 }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: alert ? "var(--alert, #C4661F)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

function RemiseForm({ partnerId, contractId, isbns, locations, onDone, onCancel, onError }: {
  partnerId: string;
  contractId: string;
  isbns: Isbn[];
  locations: StockLocation[];
  onDone: () => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
  const [isbnId, setIsbnId] = useState(isbns[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [category, setCategory] = useState<AuthorCopyCategory>("contractuel");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!isbnId || !locationId || quantity <= 0) { onError("Renseignez l'ouvrage, le magasin et une quantité."); return; }
    setBusy(true);
    try {
      await recordAuthorCopy({ partner_id: partnerId, isbn_id: isbnId, contract_id: contractId, category, quantity, from_location_id: locationId, note: note.trim() || undefined });
      onDone();
    } catch (e) { onError(e instanceof Error ? e.message : "Remise impossible."); } finally { setBusy(false); }
  }

  const field: React.CSSProperties = { fontSize: 11.5, display: "flex", flexDirection: "column", gap: 2 };
  const input: React.CSSProperties = { fontSize: 13, padding: 5 };
  return (
    <div style={{ border: "1px solid var(--eclosion)", borderRadius: 8, padding: 10, marginTop: 4, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, alignItems: "end" }}>
      <label style={field}>Ouvrage (ISBN)
        <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)} style={input}>
          {isbns.length === 0 && <option value="">Aucun ISBN</option>}
          {isbns.map((i) => <option key={i.id} value={i.id}>{i.isbn13}</option>)}
        </select>
      </label>
      <label style={field}>Catégorie
        <select value={category} onChange={(e) => setCategory(e.target.value as AuthorCopyCategory)} style={input}>
          {(Object.keys(CATEGORY_LABELS) as AuthorCopyCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </label>
      <label style={field}>Magasin
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={input}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <label style={field}>Quantité
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} style={{ ...input, fontFamily: "var(--font-mono)" }} />
      </label>
      <label style={field}>Note
        <input value={note} onChange={(e) => setNote(e.target.value)} style={input} />
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={submit} disabled={busy} style={{ fontSize: 12, cursor: "pointer", border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 6, padding: "6px 10px", fontWeight: 600 }}>{busy ? "…" : "Valider"}</button>
        <button onClick={onCancel} style={{ fontSize: 12, cursor: "pointer", border: "1px solid var(--line)", background: "#fff", borderRadius: 6, padding: "6px 10px" }}>Annuler</button>
      </div>
    </div>
  );
}
