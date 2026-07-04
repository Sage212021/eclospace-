import { useEffect, useState } from "react";
import {
  createStockLocation,
  createStockMovement,
  listIsbnRefs,
  listStockAlerts,
  listStockItems,
  listStockLocations,
  type IsbnRef,
  type StockItem,
  type StockLocation,
  type StockLocationType,
  type StockMovementType,
} from "../api/client";

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  production_in: "Réception de fabrication",
  sale_out: "Sortie vente",
  consignment_out: "Mise en dépôt-vente",
  consignment_return: "Retour de dépôt-vente",
  customer_return: "Retour client",
  transfer: "Transfert",
  press_copy: "Service de presse",
  author_copy: "Exemplaire d'auteur",
  pulping: "Mise au pilon",
  inventory_adjustment: "Régularisation d'inventaire",
};

interface StockPageProps {
  canManage: boolean;
  canAdminister: boolean;
}

// Stock et magasin (Ch. 16) : lieux, mouvements typés, alertes. Écran
// transverse (un article de stock ne se rattache pas à un seul manuscrit).
export function StockPage({ canManage, canAdminister }: StockPageProps) {
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [items, setItems] = useState<StockItem[]>([]);
  const [alerts, setAlerts] = useState<(StockItem & { severity: string })[]>([]);
  const [isbns, setIsbns] = useState<IsbnRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [locationList, itemList, alertList, isbnList] = await Promise.all([
      listStockLocations(),
      listStockItems(),
      listStockAlerts(),
      listIsbnRefs("print"),
    ]);
    setLocations(locationList);
    setItems(itemList);
    setAlerts(alertList);
    setIsbns(isbnList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function handleCreateLocation() {
    const label = window.prompt("Nom du lieu (ex. Entrepôt principal)");
    if (!label) return;
    const type = (window.prompt("Type (entrepot, depot, depot_vente, emplacement)", "entrepot") ?? "entrepot") as StockLocationType;
    try {
      await createStockLocation({ type, label });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la création du lieu.");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 960 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Stock et magasin</h1>
      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}

      {alerts.length > 0 && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Alertes de stock</div>
          {alerts.map((alert) => (
            <div key={alert.id} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
              <span>
                {alert.isbn.isbn13} — {alert.location.label}
              </span>
              <span style={{ color: alert.severity === "rupture" ? "var(--alert)" : "var(--eclosion)" }}>
                {alert.severity === "rupture" ? "Rupture" : "Alerte"} ({alert.quantityAvailable} disponible)
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Lieux de stockage</div>
          {canAdminister && (
            <button onClick={handleCreateLocation} style={secondaryButtonStyle}>
              + Nouveau lieu
            </button>
          )}
        </div>
        {locations.map((location) => (
          <div key={location.id} style={{ fontSize: 13, padding: "4px 0" }}>
            {location.label} ({location.type})
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Stock par référence et lieu</div>
        {items.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun article en stock.</p>}
        {items.map((item) => (
          <div key={item.id} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {item.isbn.isbn13} — {item.location.label} (tirage {item.printRun})
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {item.quantityPhysical} physique / {item.quantityReserved} réservé / {item.quantityAvailable} disponible
            </span>
          </div>
        ))}
      </div>

      {canManage && (
        <MovementForm
          isbns={isbns}
          locations={locations}
          onRecorded={() => {
            setMessage("Mouvement enregistré.");
            refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function MovementForm({
  isbns,
  locations,
  onRecorded,
  onError,
}: {
  isbns: IsbnRef[];
  locations: StockLocation[];
  onRecorded: () => void;
  onError: (m: string) => void;
}) {
  const [type, setType] = useState<StockMovementType>("production_in");
  const [isbnId, setIsbnId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!isbnId && isbns[0]) setIsbnId(isbns[0].id);
    if (!toLocationId && locations[0]) setToLocationId(locations[0].id);
  }, [isbns, locations]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createStockMovement({
        type,
        isbn_id: isbnId,
        from_location_id: fromLocationId || undefined,
        to_location_id: toLocationId || undefined,
        quantity,
        reason,
      });
      setReason("");
      onRecorded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'enregistrement du mouvement.");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Nouveau mouvement de stock</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as StockMovementType)} style={inputStyle}>
            {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Référence (ISBN)
          <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)} style={inputStyle}>
            {isbns.map((isbn) => (
              <option key={isbn.id} value={isbn.id}>
                {isbn.isbn13} — {isbn.manuscript?.title}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Quantité
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>
          Lieu d'origine
          <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Lieu de destination
          <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Motif
          <input value={reason} onChange={(e) => setReason(e.target.value)} required style={inputStyle} />
        </label>
      </div>
      <button type="submit" style={{ ...secondaryButtonStyle, marginTop: 10, background: "var(--eclosion)", color: "#fff", border: "none" }}>
        Enregistrer le mouvement
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13 };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
