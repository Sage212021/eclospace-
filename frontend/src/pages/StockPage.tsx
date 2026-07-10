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
import { Card } from "../components/Card";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconCommercial } from "../components/icons";

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

const LOCATION_TYPE_LABELS: Record<StockLocationType, string> = {
  entrepot: "Entrepôt",
  depot: "Dépôt",
  depot_vente: "Dépôt-vente",
  emplacement: "Emplacement",
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
  const [newLocation, setNewLocation] = useState<{ label: string; type: StockLocationType } | null>(null);

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

  async function submitLocation() {
    if (!newLocation || !newLocation.label.trim()) return;
    try {
      await createStockLocation({ type: newLocation.type, label: newLocation.label.trim() });
      setNewLocation(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la création du lieu.");
    }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 960 }}>
      <h1 className="ecl-page__title">Stock et magasin</h1>
      <p className="ecl-page__lead">Lieux de stockage, mouvements et alertes de réapprovisionnement.</p>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {alerts.length > 0 && (
        <Card title="Alertes de stock" icon={<IconCommercial />} subtitle="Ruptures et seuils d'alerte atteints.">
          <div className="ecl-list">
            {alerts.map((alert) => (
              <div key={alert.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{alert.isbn.isbn13}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{alert.location.label}</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: alert.severity === "rupture" ? "var(--alert)" : "var(--amber)",
                    border: `1px solid ${alert.severity === "rupture" ? "var(--alert)" : "var(--amber)"}`,
                    borderRadius: 999,
                    padding: "1px 9px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {alert.severity === "rupture" ? "Rupture" : "Alerte"} · {alert.quantityAvailable} dispo.
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Lieux de stockage"
        icon={<IconCommercial />}
        subtitle="Entrepôts, dépôts et emplacements."
        action={canAdminister ? <Button variant="add" size="sm" onClick={() => setNewLocation({ label: "", type: "entrepot" })}>+ Lieu</Button> : undefined}
      >
        {locations.length === 0 ? (
          <Empty>Aucun lieu.</Empty>
        ) : (
          <div className="ecl-list">
            {locations.map((location) => (
              <div key={location.id} className="ecl-row">
                <span className="ecl-row__title">{location.label}</span>
                <StatusChip label={LOCATION_TYPE_LABELS[location.type] ?? location.type} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Stock par référence et lieu" icon={<IconCommercial />} subtitle="Quantités physiques, réservées et disponibles.">
        {items.length === 0 ? (
          <Empty>Aucun article en stock.</Empty>
        ) : (
          <div className="ecl-list">
            {items.map((item) => (
              <div key={item.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{item.isbn.isbn13}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{item.location.label} · tirage {item.printRun}</span>
                  {item.condition === "declasse" && (
                    <span style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 999, padding: "2px 8px", fontSize: 11 }}>Déclassé</span>
                  )}
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--ink)", whiteSpace: "nowrap" }}>
                  {item.quantityPhysical} / {item.quantityReserved} / <strong>{item.quantityAvailable}</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>Physique / réservé / disponible.</p>
      </Card>

      {canManage && (
        <MovementForm
          isbns={isbns}
          locations={locations}
          onRecorded={() => { setMessage("Mouvement enregistré."); refresh(); }}
          onError={setError}
        />
      )}

      {newLocation && (
        <Modal
          title="Nouveau lieu de stockage"
          onClose={() => setNewLocation(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setNewLocation(null)}>Annuler</Button>
              <Button variant="add" size="sm" onClick={submitLocation}>Créer</Button>
            </>
          }
        >
          <Field label="Nom du lieu"><input value={newLocation.label} onChange={(e) => setNewLocation({ ...newLocation, label: e.target.value })} placeholder="Ex. Entrepôt principal" autoFocus /></Field>
          <Field label="Type">
            <select value={newLocation.type} onChange={(e) => setNewLocation({ ...newLocation, type: e.target.value as StockLocationType })}>
              {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </Modal>
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
    <Card title="Nouveau mouvement de stock" icon={<IconCommercial />} subtitle="Enregistrer une entrée, une sortie ou un transfert.">
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as StockMovementType)}>
              {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Référence (ISBN)">
            <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)}>
              {isbns.map((isbn) => <option key={isbn.id} value={isbn.id}>{isbn.isbn13} — {isbn.manuscript?.title}</option>)}
            </select>
          </Field>
          <Field label="Quantité">
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <Field label="Lieu d'origine">
            <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
              <option value="">—</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label="Lieu de destination">
            <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              <option value="">—</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label="Motif">
            <input value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">Enregistrer le mouvement</Button>
        </div>
      </form>
    </Card>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{children}</p>;
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
