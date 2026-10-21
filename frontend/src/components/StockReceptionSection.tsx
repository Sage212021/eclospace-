import { useEffect, useState } from "react";
import {
  createStockReception,
  listStockFicheRequests,
  createStockFicheRequest,
  fulfillStockFicheRequest,
  rejectStockFicheRequest,
  type IsbnRef,
  type StockLocation,
  type ReceptionProvenance,
  type StockFicheRequest,
} from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

// Réception du magasinier (demande opérateur) : entrée COMPLÉMENTAIRE directe
// (achat/don/régularisation — les réceptions imprimerie passent par le bon de
// commande et les retours par le module retours, pour éviter tout double
// comptage) ET signalement d'un ouvrage reçu ABSENT du catalogue (Cas B), avec
// demande de création de fiche au service habilité qui rattache ensuite le stock.

const PROVENANCES: { value: ReceptionProvenance; label: string }[] = [
  { value: "fournisseur", label: "Fournisseur (achat direct)" },
  { value: "don", label: "Don reçu" },
  { value: "regularisation", label: "Régularisation d'entrée" },
  { value: "autre", label: "Autre" },
];
const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending: { label: "À traiter", color: "#B87400" },
  fulfilled: { label: "Fiche créée & stock rattaché", color: "#2F7D4A" },
  rejected: { label: "Rejetée", color: "var(--muted)" },
};
const inp: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };
const goldBtn: React.CSSProperties = { background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "8px 15px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" };

function isbnLabel(i: IsbnRef): string {
  return `${i.isbn13} — ${i.manuscript?.title ?? i.author ?? "sans titre"}`;
}

export function StockReceptionSection({ isbns, locations, canFulfillFiche, onChange }: { isbns: IsbnRef[]; locations: StockLocation[]; canFulfillFiche: boolean; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Réception directe (Cas A).
  const [rec, setRec] = useState({ isbn_id: "", location_id: "", quantity: "", provenance: "fournisseur" as ReceptionProvenance, received_at: new Date().toISOString().slice(0, 10), observations: "" });

  // Signalement d'un ouvrage absent (Cas B).
  const [absent, setAbsent] = useState({ title: "", author_name: "", isbn: "", collection: "", format: "", provenance: "imprimerie", quantity: "", location_id: "", observations: "" });

  const [requests, setRequests] = useState<StockFicheRequest[]>([]);
  const loadRequests = () => listStockFicheRequests().then((r) => setRequests(r.requests)).catch(() => setRequests([]));
  useEffect(() => { loadRequests(); }, []);

  async function submitReception() {
    const qty = Number(rec.quantity);
    if (!rec.isbn_id || !rec.location_id || !(qty > 0)) { setError("Choisissez l'ouvrage, le lieu et une quantité positive."); return; }
    setError(null); setMessage(null);
    try {
      await createStockReception({ isbn_id: rec.isbn_id, location_id: rec.location_id, quantity: qty, provenance: rec.provenance, received_at: rec.received_at || undefined, observations: rec.observations.trim() || undefined });
      setMessage("Réception enregistrée — le stock a été mis à jour.");
      setRec((r) => ({ ...r, quantity: "", observations: "" }));
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  async function submitAbsent() {
    if (!absent.title.trim()) { setError("Le titre de l'ouvrage est requis."); return; }
    setError(null); setMessage(null);
    try {
      await createStockFicheRequest({
        title: absent.title.trim(), author_name: absent.author_name.trim() || undefined, isbn: absent.isbn.trim() || undefined,
        collection: absent.collection.trim() || undefined, format: absent.format.trim() || undefined, provenance: absent.provenance,
        quantity: Number(absent.quantity) || 0, location_id: absent.location_id || undefined, observations: absent.observations.trim() || undefined,
      });
      setMessage("Ouvrage signalé — une demande de création de fiche a été transmise au service habilité.");
      setAbsent({ title: "", author_name: "", isbn: "", collection: "", format: "", provenance: "imprimerie", quantity: "", location_id: "", observations: "" });
      loadRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signalement impossible.");
    }
  }

  async function fulfill(r: StockFicheRequest) {
    const isbn_id = window.prompt(`Rattacher « ${r.title} » à une fiche existante.\n\nCollez l'identifiant de l'ISBN (fiche) à rattacher :`, "");
    if (!isbn_id || !isbn_id.trim()) return;
    const location_id = locations[0]?.id;
    if (!location_id) { setError("Aucun lieu de stockage disponible."); return; }
    try {
      await fulfillStockFicheRequest(r.id, { isbn_id: isbn_id.trim(), location_id });
      setMessage(`« ${r.title} » rattaché au catalogue et stock mis à jour.`);
      loadRequests(); onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rattachement impossible.");
    }
  }
  async function reject(r: StockFicheRequest) {
    const reason = window.prompt(`Rejeter la demande « ${r.title} » ?\n\nMotif :`, "");
    if (reason === null || !reason.trim()) return;
    try { await rejectStockFicheRequest(r.id, reason.trim()); loadRequests(); } catch (e) { setError(e instanceof Error ? e.message : "Rejet impossible."); }
  }

  return (
    <CollapsibleSection title="Réception des ouvrages (magasin)" subtitle="Enregistrer une entrée directe (achat, don, régularisation) et signaler un ouvrage reçu absent du catalogue." storageKey="stock:reception">
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--positive-soft, #e6f2ea)", color: "var(--positive, #2F7D4A)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {/* Cas A — réception directe d'un ouvrage déjà au catalogue. */}
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Entrée directe (ouvrage déjà au catalogue)</div>
      <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "0 0 8px", lineHeight: 1.45 }}>
        Pour les réceptions non couvertes ailleurs (achat direct, don, régularisation). Les réceptions d'imprimerie passent par le bon de commande ; les retours clients par le module retours.
      </p>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr", maxWidth: 560 }}>
        <select value={rec.isbn_id} onChange={(e) => setRec({ ...rec, isbn_id: e.target.value })} style={inp}>
          <option value="">— choisir l'ouvrage (titre / ISBN) —</option>
          {isbns.map((i) => <option key={i.id} value={i.id}>{isbnLabel(i)}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={rec.location_id} onChange={(e) => setRec({ ...rec, location_id: e.target.value })} style={{ ...inp, flex: 1, minWidth: 160 }}>
            <option value="">— lieu de stockage —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <input type="number" min={1} value={rec.quantity} onChange={(e) => setRec({ ...rec, quantity: e.target.value })} placeholder="Quantité reçue" style={{ ...inp, width: 130, textAlign: "right", fontFamily: "var(--font-mono)" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={rec.provenance} onChange={(e) => setRec({ ...rec, provenance: e.target.value as ReceptionProvenance })} style={{ ...inp, flex: 1, minWidth: 160 }}>
            {PROVENANCES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>Reçu le
            <input type="date" value={rec.received_at} onChange={(e) => setRec({ ...rec, received_at: e.target.value })} style={inp} />
          </label>
        </div>
        <input value={rec.observations} onChange={(e) => setRec({ ...rec, observations: e.target.value })} placeholder="Observations (facultatif)" style={inp} />
        <div><button onClick={submitReception} style={goldBtn}>Enregistrer l'entrée</button></div>
      </div>

      {/* Cas B — ouvrage reçu absent du catalogue. */}
      <div style={{ fontSize: 13, fontWeight: 700, margin: "16px 0 6px" }}>Ouvrage reçu absent du catalogue</div>
      <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "0 0 8px", lineHeight: 1.45 }}>
        Renseignez ce que vous avez (n'inventez pas un ISBN ou une date manquante). La demande de création de fiche est transmise au service habilité, qui rattachera le stock après validation.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
        <input value={absent.title} onChange={(e) => setAbsent({ ...absent, title: e.target.value })} placeholder="Titre de l'ouvrage *" style={inp} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={absent.author_name} onChange={(e) => setAbsent({ ...absent, author_name: e.target.value })} placeholder="Auteur(s)" style={{ ...inp, flex: 1, minWidth: 160 }} />
          <input value={absent.isbn} onChange={(e) => setAbsent({ ...absent, isbn: e.target.value })} placeholder="ISBN (si attribué)" style={{ ...inp, width: 160 }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={absent.collection} onChange={(e) => setAbsent({ ...absent, collection: e.target.value })} placeholder="Collection" style={{ ...inp, flex: 1, minWidth: 140 }} />
          <input value={absent.format} onChange={(e) => setAbsent({ ...absent, format: e.target.value })} placeholder="Format" style={{ ...inp, width: 140 }} />
          <input type="number" min={0} value={absent.quantity} onChange={(e) => setAbsent({ ...absent, quantity: e.target.value })} placeholder="Qté reçue" style={{ ...inp, width: 110, textAlign: "right", fontFamily: "var(--font-mono)" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={absent.provenance} onChange={(e) => setAbsent({ ...absent, provenance: e.target.value })} style={{ ...inp, flex: 1, minWidth: 160 }}>
            {["imprimerie", "fournisseur", "don", "retour_librairie", "autre"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={absent.location_id} onChange={(e) => setAbsent({ ...absent, location_id: e.target.value })} style={{ ...inp, flex: 1, minWidth: 160 }}>
            <option value="">— lieu (facultatif) —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <input value={absent.observations} onChange={(e) => setAbsent({ ...absent, observations: e.target.value })} placeholder="Observations (facultatif)" style={inp} />
        <div><button onClick={submitAbsent} style={{ ...goldBtn, background: "#fff", color: "var(--eclosion-dark, #9a7a12)", border: "1px solid var(--eclosion, #D9B21A)" }}>Signaler et transmettre</button></div>
      </div>

      {/* Suivi des demandes de fiche. */}
      {requests.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Demandes de fiche {canFulfillFiche ? "(à traiter / traitées)" : "(suivi)"}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {requests.map((r) => {
              const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending;
              return (
                <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", background: "var(--ivory, #FAF8F2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}{r.author_name ? ` — ${r.author_name}` : ""}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: badge.color }}>{badge.label}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {r.quantity > 0 ? `${r.quantity} ex. · ` : ""}{r.provenance ?? "provenance non précisée"}{r.isbn ? ` · ISBN ${r.isbn}` : ""} · signalé par {r.requested_by ?? "?"}
                    {r.reject_reason ? ` · motif : ${r.reject_reason}` : ""}
                  </div>
                  {canFulfillFiche && r.status === "pending" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
                      <button onClick={() => fulfill(r)} style={{ ...goldBtn, padding: "5px 12px", fontSize: 12 }}>Rattacher à une fiche</button>
                      <button onClick={() => reject(r)} style={{ background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>Rejeter</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
