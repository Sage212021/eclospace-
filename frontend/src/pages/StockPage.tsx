import { useEffect, useState } from "react";
import {
  createStockLocation,
  createStockMovement,
  listIsbnRefs,
  listStockAlerts,
  listStockItems,
  listStockLocations,
  listStockMovements,
  updateStockMovement,
  cancelStockMovement,
  type IsbnRef,
  type StockItem,
  type StockLocation,
  type StockLocationType,
  type StockMovement,
  type StockMovementType,
  type StockConsolidatedRow,
} from "../api/client";
import { Card } from "../components/Card";
import { StockInventorySection } from "../components/StockInventorySection";
import { IsbnCombobox } from "../components/IsbnCombobox";
import { CommercialStockSection } from "../components/CommercialStockSection";
import { BookReceiptSection, AuthorWithdrawalSection } from "../components/StockVouchersSection";
import { StockConsolidatedSection } from "../components/StockConsolidatedSection";
import { StockInitialImportSection } from "../components/StockInitialImportSection";
import { GuidanceNote } from "../components/GuidanceNote";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconCommercial } from "../components/icons";

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  production_in: "Réception de fabrication",
  supplier_in: "Entrée fournisseur",
  sale_out: "Sortie vente",
  consignment_out: "Mise en dépôt-vente",
  consignment_return: "Retour de dépôt-vente",
  customer_return: "Retour client",
  commercial_return: "Retour commercial",
  transfer: "Transfert interne",
  press_copy: "Service de presse",
  author_copy: "Exemplaire d'auteur",
  promotional_out: "Sortie promotionnelle",
  institutional_out: "Sortie institutionnelle",
  event_out: "Sortie événementielle",
  free_out: "Sortie gratuite",
  event_return: "Retour événement",
  promotional_return: "Retour promotion",
  other_return: "Autre retour (à préciser)",
  loss: "Perte",
  damage: "Casse (→ déclassé)",
  destruction: "Destruction",
  pulping: "Mise au pilon",
  inventory_adjustment: "Régularisation d'inventaire",
};

// Types saisis manuellement par le magasinier, proposés dans le formulaire.
// Pré-remplissage du formulaire de mouvement depuis « Régulariser » (consolidé).
type MovementPrefill = {
  type: StockMovementType;
  isbnId: string;
  toLocationId?: string;
  condition?: "vendable" | "declasse";
  quantity: number;
  reason: string;
  nonce: number; // force la ré-application même si les valeurs sont identiques
};

// Types proposés dans le formulaire générique « Nouveau mouvement de stock ».
// « Retour commercial » n'y figure PAS volontairement : remettre à un commercial
// ET récupérer ses invendus se font tous deux via la carte « Stock commercial »
// (boutons Remettre / Retour), qui impute le compte du commercial concerné.
const MANUAL_FORM_TYPES: StockMovementType[] = [
  "production_in", "supplier_in", "transfer",
  "press_copy", "author_copy", "promotional_out", "institutional_out",
  "event_out", "free_out",
  "event_return", "promotional_return", "other_return",
  "loss", "damage", "destruction", "pulping",
  "inventory_adjustment",
];
// Exigences de lieux par type (miroir du backend) : d'où / vers où.
const MOVEMENT_NEEDS: Record<StockMovementType, { from: boolean; to: boolean }> = {
  production_in: { from: false, to: true },
  supplier_in: { from: false, to: true },
  sale_out: { from: true, to: false },
  consignment_out: { from: true, to: true },
  consignment_return: { from: true, to: true },
  customer_return: { from: false, to: true },
  commercial_return: { from: false, to: true },
  transfer: { from: true, to: true },
  press_copy: { from: true, to: false },
  author_copy: { from: true, to: false },
  promotional_out: { from: true, to: false },
  institutional_out: { from: true, to: false },
  event_out: { from: true, to: false },
  free_out: { from: true, to: false },
  event_return: { from: false, to: true },
  promotional_return: { from: false, to: true },
  other_return: { from: false, to: true },
  loss: { from: true, to: false },
  damage: { from: true, to: false },
  destruction: { from: true, to: false },
  pulping: { from: true, to: false },
  inventory_adjustment: { from: false, to: false },
};
// Types de reclassement (au même lieu) : le compartiment source diminue, un
// compartiment cible augmente (perte → perdu, casse → déclassé, destruction → détruit).
const RECLASS_TYPES: StockMovementType[] = ["loss", "damage", "destruction"];

const LOCATION_TYPE_LABELS: Record<StockLocationType, string> = {
  entrepot: "Entrepôt",
  depot: "Dépôt",
  depot_vente: "Dépôt-vente",
  emplacement: "Emplacement",
  stock_commercial: "Stock commercial",
};

interface StockPageProps {
  canManage: boolean;
  canAdminister: boolean;
  canValidate?: boolean;
}

// Stock et magasin (Ch. 16) : lieux, mouvements typés, alertes. Écran
// transverse (un article de stock ne se rattache pas à un seul manuscrit).
import { useI18n } from "../i18n";

export function StockPage({ canManage, canAdminister, canValidate }: StockPageProps) {
  const { t } = useI18n();
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [items, setItems] = useState<StockItem[]>([]);
  const [alerts, setAlerts] = useState<(StockItem & { severity: string })[]>([]);
  const [isbns, setIsbns] = useState<IsbnRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newLocation, setNewLocation] = useState<{ label: string; type: StockLocationType } | null>(null);
  // Rechargé à chaque saisie / correction / annulation de mouvement.
  const [movVersion, setMovVersion] = useState(0);
  const bumpMovements = () => setMovVersion((v) => v + 1);
  // Filtre « Corriger » depuis le consolidé : concentre l'historique sur un ouvrage.
  const [focusIsbn, setFocusIsbn] = useState<{ id: string; title: string | null } | null>(null);
  function focusOnIsbn(id: string, title: string | null) {
    setFocusIsbn({ id, title });
    setTimeout(() => document.getElementById("historique-mouvements")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
  // « Régulariser » depuis le consolidé : pré-remplit le formulaire avec une
  // entrée de régularisation d'inventaire qui ramène le compartiment négatif à 0.
  const [prefill, setPrefill] = useState<MovementPrefill | null>(null);
  function regularizeRow(row: StockConsolidatedRow) {
    // Cherche le compartiment (lieu + état) négatif à rétablir. Le formulaire ne
    // sait créditer que « vendable » ou « déclassé » — les seuls régularisables ici.
    let target: { locationId: string; condition: "vendable" | "declasse"; deficit: number } | null = null;
    for (const loc of row.by_location) {
      for (const c of ["vendable", "declasse"] as const) {
        if (loc[c] < 0 && (!target || loc[c] < -target.deficit)) target = { locationId: loc.location_id, condition: c, deficit: -loc[c] };
      }
    }
    if (!target) return;
    setPrefill({
      type: "inventory_adjustment",
      isbnId: row.isbn_id,
      toLocationId: target.locationId,
      condition: target.condition,
      quantity: target.deficit,
      reason: `Régularisation stock négatif — ${row.title ?? row.isbn13}`,
      nonce: Date.now(),
    });
    setTimeout(() => document.getElementById("nouveau-mouvement")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

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

      {/* Mode d'emploi du magasinier — guide pas à pas (page servie par l'app). */}
      <a
        href="/guides/mode-emploi-stock.html"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex", alignItems: "center", gap: 10, textDecoration: "none",
          background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 10,
          padding: "10px 14px", margin: "12px 0", color: "var(--eclosion)", fontWeight: 600, fontSize: 13.5,
        }}
      >
        <span style={{ fontSize: 20 }}>📘</span>
        <span style={{ flex: 1 }}>
          Mode d'emploi du magasinier
          <span style={{ display: "block", fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>
            Comment introduire et suivre le stock, pas à pas — s'ouvre dans un nouvel onglet.
          </span>
        </span>
        <span aria-hidden="true">↗</span>
      </a>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      <StockConsolidatedSection collapsible defaultOpen canCorrect={canManage} onCorrect={focusOnIsbn} onRegularize={regularizeRow} />

      <StockInitialImportSection canManage={canManage} collapsible defaultOpen={false} />

      <StockInventorySection locations={locations} canManage={canManage} canValidate={!!canValidate} collapsible defaultOpen />

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
        <div id="nouveau-mouvement">
          <MovementForm
            isbns={isbns}
            locations={locations}
            prefill={prefill}
            onRecorded={() => { setMessage(t("stock.movement_recorded", "Mouvement enregistré.")); setPrefill(null); refresh(); bumpMovements(); }}
            onError={setError}
          />
        </div>
      )}

      <div id="historique-mouvements">
        <MovementHistory
          canManage={canManage}
          version={movVersion}
          filterIsbnId={focusIsbn?.id ?? null}
          filterLabel={focusIsbn?.title ?? null}
          onClearFilter={() => setFocusIsbn(null)}
          onChanged={() => { refresh(); bumpMovements(); }}
          onMessage={setMessage}
          onError={setError}
        />
      </div>

      <CommercialStockSection
        isbns={isbns}
        locations={locations}
        canManage={canManage}
        onMessage={(m) => { setMessage(m); refresh(); bumpMovements(); }}
        onError={setError}
      />

      {/* Pièces officielles imprimables (documents, sans impact stock). */}
      <BookReceiptSection isbns={isbns} canManage={canManage} onError={setError} />
      <AuthorWithdrawalSection isbns={isbns} canManage={canManage} onError={setError} />

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
  prefill,
  onRecorded,
  onError,
}: {
  isbns: IsbnRef[];
  locations: StockLocation[];
  prefill?: MovementPrefill | null;
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
  const [condition, setCondition] = useState<"vendable" | "declasse">("vendable");

  useEffect(() => {
    // On ne présélectionne plus d'ouvrage : le champ de recherche invite à taper
    // l'ISBN ou le titre. Le lieu par défaut reste pré-rempli (confort).
    if (!toLocationId && locations[0]) setToLocationId(locations[0].id);
  }, [isbns, locations]);

  // Applique un pré-remplissage « Régulariser » (entrée qui rétablit un négatif).
  useEffect(() => {
    if (!prefill) return;
    setType(prefill.type);
    setIsbnId(prefill.isbnId);
    if (prefill.toLocationId) setToLocationId(prefill.toLocationId);
    if (prefill.condition) setCondition(prefill.condition);
    setQuantity(prefill.quantity);
    setReason(prefill.reason);
  }, [prefill?.nonce]);

  const needs = MOVEMENT_NEEDS[type];
  const showFrom = needs.from || type === "inventory_adjustment";
  const showTo = needs.to || type === "inventory_adjustment";
  const isReclass = RECLASS_TYPES.includes(type);
  const RECLASS_OUTCOME: Record<string, string> = { loss: "perdu", damage: "déclassé", destruction: "détruit" };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isbnId) {
      onError("Choisissez un ouvrage : tapez son ISBN ou le début de son titre.");
      return;
    }
    // « Autre retour » : le magasinier DOIT préciser la nature dans le motif.
    if (type === "other_return" && !reason.trim()) {
      onError("Précisez la nature de ce retour dans le champ « Motif ».");
      return;
    }
    try {
      await createStockMovement({
        type,
        isbn_id: isbnId,
        from_location_id: showFrom ? fromLocationId || undefined : undefined,
        to_location_id: showTo ? toLocationId || undefined : undefined,
        quantity,
        reason,
        condition,
      });
      setReason("");
      onRecorded();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("stock.err_movement", "Échec de l'enregistrement du mouvement."));
    }
  }

  return (
    <Card title={t("stock.movement_title", "Nouveau mouvement de stock")} icon={<IconCommercial />} subtitle={t("stock.movement_sub", "Entrée, sortie, transfert, perte, casse, destruction…")}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label={t("common.type", "Type")}>
            <select value={type} onChange={(e) => setType(e.target.value as StockMovementType)}>
              {MANUAL_FORM_TYPES.map((value) => <option key={value} value={value}>{t(`stock.mv.${value}`, MOVEMENT_LABELS[value])}</option>)}
            </select>
          </Field>
          <Field label={t("stock.ref_isbn", "Référence (ISBN)")}>
            <IsbnCombobox isbns={isbns} value={isbnId} onChange={setIsbnId} />
          </Field>
          <Field label={t("stock.quantity", "Quantité")}>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          {showFrom && (
            <Field label={isReclass ? t("stock.from_reclass", "Lieu des exemplaires") : t("stock.from", "Lieu d'origine")}>
              <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
                <option value="">—</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
              </select>
            </Field>
          )}
          {showTo && (
            <Field label={t("stock.to", "Lieu de destination")}>
              <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                <option value="">—</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
              </select>
            </Field>
          )}
          {(isReclass || showFrom) && (
            <Field label={isReclass ? t("stock.source_compartment", "Compartiment concerné") : t("stock.condition", "État")}>
              <select value={condition} onChange={(e) => setCondition(e.target.value as "vendable" | "declasse")}>
                <option value="vendable">{t("stock.vendable", "Vendable")}</option>
                <option value="declasse">{t("stock.declasse", "Déclassé")}</option>
              </select>
            </Field>
          )}
          <Field label={type === "other_return" ? "Motif — précisez la nature du retour" : t("stock.reason", "Motif")}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder={type === "other_return" ? "Ex. retour d'un salon, invendus d'un point de vente…" : undefined} />
          </Field>
        </div>
        {isReclass && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
            {quantity} exemplaire(s) passeront du compartiment « {condition === "declasse" ? "déclassé" : "vendable"} » au compartiment « {RECLASS_OUTCOME[type]} » au même lieu. Le stock total reste inchangé (rien ne disparaît, tout reste traçable).
          </p>
        )}
        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">{t("stock.record_movement", "Enregistrer le mouvement")}</Button>
        </div>
      </form>
    </Card>
  );
}

// Historique des mouvements de stock avec correction (Modifier / Annuler). Le
// magasinier peut rectifier une saisie erronée : le stock est recalculé
// automatiquement, l'écriture n'est jamais figée. Seules ses saisies manuelles
// (hors ventes/retours) sont modifiables.
function MovementHistory({
  canManage,
  version,
  filterIsbnId,
  filterLabel,
  onClearFilter,
  onChanged,
  onMessage,
  onError,
}: {
  canManage: boolean;
  version: number;
  filterIsbnId?: string | null;
  filterLabel?: string | null;
  onClearFilter?: () => void;
  onChanged: () => void;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [editing, setEditing] = useState<StockMovement | null>(null);

  useEffect(() => {
    listStockMovements(filterIsbnId ?? undefined).then(setMovements).catch((e) => onError(e instanceof Error ? e.message : "Chargement des mouvements impossible."));
  }, [version, filterIsbnId]);

  async function cancel(m: StockMovement) {
    const reason = window.prompt("Annuler ce mouvement saisi par erreur ?\nMotif (facultatif) :", "");
    if (reason === null) return; // annulation de la boîte de dialogue
    try {
      await cancelStockMovement(m.id, reason.trim() || undefined);
      onMessage("Mouvement annulé — le stock a été recalculé.");
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Annulation impossible.");
    }
  }

  const IN_TYPES: StockMovementType[] = ["production_in", "supplier_in", "customer_return", "commercial_return", "consignment_return", "event_return", "promotional_return", "other_return"];
  const RECLASS: StockMovementType[] = ["loss", "damage", "destruction"];
  const sign = (m: StockMovement) => {
    if (RECLASS.includes(m.type)) return "→"; // reclassement de compartiment, pas de perte de total
    if (IN_TYPES.includes(m.type) || (m.type === "inventory_adjustment" && m.to_location_label)) return "+";
    return "−";
  };

  return (
    <Card title={t("stock.history_title", "Historique des mouvements")} icon={<IconCommercial />} subtitle={t("stock.history_sub", "Corrigez ou annulez une saisie erronée — le stock est recalculé automatiquement.")} collapsible defaultOpen>
      {filterIsbnId && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "var(--eclosion-soft)", borderRadius: 8, padding: "6px 12px", marginBottom: 10, fontSize: 12.5 }}>
          <span>Filtré sur <b>{filterLabel || "cet ouvrage"}</b>. Les mouvements saisis à la main portent <b>Modifier</b>/<b>Annuler</b> ; ceux issus d'un autre document (vente, dépôt-vente…) se corrigent à la source. Pour rétablir un stock négatif, utilisez <b>« Régulariser »</b> dans le tableau consolidé.</span>
          <button onClick={() => onClearFilter?.()} style={{ fontSize: 12, cursor: "pointer", border: "1px solid var(--line)", background: "#fff", borderRadius: 6, padding: "3px 10px", fontWeight: 600 }}>Tout afficher</button>
        </div>
      )}
      {movements.length === 0 ? (
        <Empty>{t("stock.no_movement", "Aucun mouvement enregistré.")}</Empty>
      ) : (
        <div className="ecl-list">
          {movements.map((m) => {
            const cancelled = m.status === "cancelled";
            return (
              <div key={m.id} className="ecl-row" style={{ alignItems: "flex-start", opacity: cancelled ? 0.55 : 1 }}>
                <div className="ecl-row__main" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="ecl-row__title" style={{ textDecoration: cancelled ? "line-through" : "none" }}>{MOVEMENT_LABELS[m.type] ?? m.type}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{sign(m)}{m.quantity}</span>
                    {m.isbn13 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted)" }}>{m.isbn13}</span>}
                    {m.condition === "declasse" && <span style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 999, padding: "1px 8px", fontSize: 11 }}>{t("stock.declasse", "Déclassé")}</span>}
                    {cancelled && <span style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>Annulé</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {[m.from_location_label, m.to_location_label].filter(Boolean).join(" → ")}
                    {m.reason ? ` · ${m.reason}` : ""}
                    {" · "}{new Date(m.movedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    {m.moved_by_name ? ` · ${m.moved_by_name}` : ""}
                    {cancelled && m.cancelReason ? ` · motif d'annulation : ${m.cancelReason}` : ""}
                  </div>
                </div>
                {canManage && m.editable && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Button variant="edit" size="sm" onClick={() => setEditing(m)}>{t("common.edit", "Modifier")}</Button>
                    <Button variant="view" size="sm" onClick={() => cancel(m)}>{t("common.cancel_entry", "Annuler")}</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EditMovementModal
          movement={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onMessage("Mouvement corrigé — le stock a été recalculé."); onChanged(); }}
          onError={onError}
        />
      )}
    </Card>
  );
}

function EditMovementModal({
  movement,
  onClose,
  onSaved,
  onError,
}: {
  movement: StockMovement;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [quantity, setQuantity] = useState(movement.quantity);
  const [reason, setReason] = useState(movement.reason ?? "");
  const [condition, setCondition] = useState<"vendable" | "declasse">(movement.condition);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (quantity <= 0) { onError("La quantité doit être supérieure à zéro."); return; }
    setBusy(true);
    try {
      await updateStockMovement(movement.id, { quantity, reason: reason.trim() || undefined, condition });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Correction impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("stock.edit_movement", "Corriger le mouvement")}
      onClose={onClose}
      footer={
        <>
          <Button variant="view" size="sm" onClick={onClose}>{t("common.cancel", "Annuler")}</Button>
          <Button variant="add" size="sm" onClick={save} disabled={busy}>{busy ? t("common.saving", "Enregistrement…") : t("common.save", "Enregistrer")}</Button>
        </>
      }
    >
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
        {MOVEMENT_LABELS[movement.type] ?? movement.type}{movement.isbn13 ? ` · ${movement.isbn13}` : ""}. Le stock sera recalculé automatiquement.
      </p>
      <Field label={t("stock.quantity", "Quantité")}>
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} autoFocus />
      </Field>
      <Field label={t("stock.reason", "Motif")}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t("stock.condition", "État")}>
        <select value={condition} onChange={(e) => setCondition(e.target.value as "vendable" | "declasse")}>
          <option value="vendable">{t("stock.vendable", "Vendable")}</option>
          <option value="declasse">{t("stock.declasse", "Déclassé")}</option>
        </select>
      </Field>
    </Modal>
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
