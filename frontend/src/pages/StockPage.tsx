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
import { GuidanceNote } from "../components/GuidanceNote";
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
import { useI18n } from "../i18n";

export function StockPage({ canManage, canAdminister }: StockPageProps) {
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t("stock.err_location", "Échec de la création du lieu."));
    }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 960 }}>
      <h1 className="ecl-page__title">{t("page.stock.title", "Stock et magasin")}</h1>
      <p className="ecl-page__lead">{t("page.stock.lead", "Lieux de stockage, mouvements et alertes de réapprovisionnement.")}</p>

      <GuidanceNote title="Stock & magasin">
        Suivez les quantités par ouvrage et par lieu de stockage. Enregistrez les entrées et sorties (mouvements) ; les
        ouvrages sous le seuil d'alerte remontent en réapprovisionnement.
      </GuidanceNote>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {alerts.length > 0 && (
        <Card title={t("stock.alerts_title", "Alertes de stock")} icon={<IconCommercial />} subtitle={t("stock.alerts_sub", "Ruptures et seuils d'alerte atteints.")}>
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
                  {alert.severity === "rupture" ? t("stock.rupture", "Rupture") : t("stock.alert", "Alerte")} · {alert.quantityAvailable} {t("stock.available_short", "dispo.")}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title={t("stock.locations_title", "Lieux de stockage")}
        icon={<IconCommercial />}
        subtitle={t("stock.locations_sub", "Entrepôts, dépôts et emplacements.")}
        action={canAdminister ? <Button variant="add" size="sm" onClick={() => setNewLocation({ label: "", type: "entrepot" })}>{t("stock.add_location", "+ Lieu")}</Button> : undefined}
      >
        {locations.length === 0 ? (
          <Empty>{t("stock.no_location", "Aucun lieu.")}</Empty>
        ) : (
          <div className="ecl-list">
            {locations.map((location) => (
              <div key={location.id} className="ecl-row">
                <span className="ecl-row__title">{location.label}</span>
                <StatusChip label={t(`stock.loc.${location.type}`, LOCATION_TYPE_LABELS[location.type] ?? location.type)} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t("stock.items_title", "Stock par référence et lieu")} icon={<IconCommercial />} subtitle={t("stock.items_sub", "Quantités physiques, réservées et disponibles.")}>
        {items.length === 0 ? (
          <Empty>{t("stock.no_item", "Aucun article en stock.")}</Empty>
        ) : (
          <div className="ecl-list">
            {items.map((item) => (
              <div key={item.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{item.isbn.isbn13}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{item.location.label} · {t("stock.print_run", "tirage")} {item.printRun}</span>
                  {item.condition === "declasse" && (
                    <span style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 999, padding: "2px 8px", fontSize: 11 }}>{t("stock.declasse", "Déclassé")}</span>
                  )}
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--ink)", whiteSpace: "nowrap" }}>
                  {item.quantityPhysical} / {item.quantityReserved} / <strong>{item.quantityAvailable}</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>{t("stock.pra_note", "Physique / réservé / disponible.")}</p>
      </Card>

      {canManage && (
        <MovementForm
          isbns={isbns}
          locations={locations}
          onRecorded={() => { setMessage(t("stock.movement_recorded", "Mouvement enregistré.")); refresh(); }}
          onError={setError}
        />
      )}

      {newLocation && (
        <Modal
          title={t("stock.new_location_title", "Nouveau lieu de stockage")}
          onClose={() => setNewLocation(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setNewLocation(null)}>{t("common.cancel", "Annuler")}</Button>
              <Button variant="add" size="sm" onClick={submitLocation}>{t("common.create", "Créer")}</Button>
            </>
          }
        >
          <Field label={t("stock.location_name", "Nom du lieu")}><input value={newLocation.label} onChange={(e) => setNewLocation({ ...newLocation, label: e.target.value })} placeholder={t("stock.location_placeholder", "Ex. Entrepôt principal")} autoFocus /></Field>
          <Field label={t("common.type", "Type")}>
            <select value={newLocation.type} onChange={(e) => setNewLocation({ ...newLocation, type: e.target.value as StockLocationType })}>
              {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(`stock.loc.${value}`, label)}</option>)}
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
  const { t } = useI18n();
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
      onError(err instanceof Error ? err.message : t("stock.err_movement", "Échec de l'enregistrement du mouvement."));
    }
  }

  return (
    <Card title={t("stock.movement_title", "Nouveau mouvement de stock")} icon={<IconCommercial />} subtitle={t("stock.movement_sub", "Enregistrer une entrée, une sortie ou un transfert.")}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label={t("common.type", "Type")}>
            <select value={type} onChange={(e) => setType(e.target.value as StockMovementType)}>
              {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(`stock.mv.${value}`, label)}</option>)}
            </select>
          </Field>
          <Field label={t("stock.ref_isbn", "Référence (ISBN)")}>
            <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)}>
              {isbns.map((isbn) => <option key={isbn.id} value={isbn.id}>{isbn.isbn13} — {isbn.manuscript?.title}</option>)}
            </select>
          </Field>
          <Field label={t("stock.quantity", "Quantité")}>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <Field label={t("stock.from", "Lieu d'origine")}>
            <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
              <option value="">—</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label={t("stock.to", "Lieu de destination")}>
            <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              <option value="">—</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label={t("stock.reason", "Motif")}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">{t("stock.record_movement", "Enregistrer le mouvement")}</Button>
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
