import { useEffect, useState } from "react";
import {
  approveSalesOrder,
  createCustomer,
  createPosSale,
  createSalesOrder,
  listCustomers,
  getCustomer,
  listIsbnRefs,
  listSalesOrders,
  listStockLocations,
  listPointsOfSale,
  createPointOfSale,
  type Customer,
  type CustomerCategory,
  type IsbnRef,
  type PointOfSale,
  type PointOfSaleType,
  type SalesOrder,
  type StockLocation,
} from "../api/client";
import { Card } from "../components/Card";
import { StandardActionBar } from "../components/StandardActionBar";
import { printCustomerFiche } from "../lib/print";
import { GuidanceNote } from "../components/GuidanceNote";
import { BillingOrdersSection } from "../components/BillingOrdersSection";
import { useConfirm } from "../components/ConfirmProvider";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconCommercial } from "../components/icons";

const CATEGORY_LABELS: Record<CustomerCategory, string> = {
  librairie: "Librairie",
  distributeur: "Distributeur",
  institution: "Institution",
  particulier: "Particulier",
  plateforme: "Plateforme en ligne",
  auteur: "Auteur",
};

const ZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— non applicable —" },
  { value: "yaounde", label: "Yaoundé" },
  { value: "douala", label: "Douala" },
  { value: "autres_villes_cameroun", label: "Autres villes (Cameroun)" },
  { value: "international", label: "International" },
];

interface CommercialPageProps {
  canManage: boolean;
  canValidate: boolean;
  // Initiation d'une commande à facturer / proforma (commercial ou DG).
  canInitiateOrder: boolean;
}

// Commercial, distribution et ventes (Ch. 17) : clients, commandes, vente
// directe. Écran transverse, non rattaché à un seul manuscrit.
import { useI18n } from "../i18n";

export function CommercialPage({ canManage, canValidate, canInitiateOrder }: CommercialPageProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [isbns, setIsbns] = useState<IsbnRef[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState<{ name: string; category: CustomerCategory; zone: string } | null>(null);

  const refresh = async () => {
    const [customerList, orderList, isbnList, locationList] = await Promise.all([
      listCustomers(),
      listSalesOrders(),
      listIsbnRefs("print"),
      listStockLocations(),
    ]);
    setCustomers(customerList);
    setOrders(orderList);
    setIsbns(isbnList);
    setLocations(locationList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function submitCustomer() {
    if (!newCustomer || !newCustomer.name.trim()) return;
    try {
      await createCustomer({ category: newCustomer.category, name: newCustomer.name.trim(), shipping_zone: newCustomer.zone || undefined });
      setNewCustomer(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("com.err_customer", "Échec de la création du client."));
    }
  }

  async function handleApprove(order: SalesOrder) {
    const ok = await confirm({
      title: t("com.unblock", "Débloquer"),
      message: t("com.confirm.approve", "Débloquer cette commande (validation direction commerciale) ?"),
      detail: order.orderNumber,
      confirmLabel: t("com.unblock", "Débloquer"),
    });
    if (!ok) return;
    try {
      await approveSalesOrder(order.id);
      setMessage(`Commande ${order.orderNumber} débloquée.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("com.err_approve", "Échec de l'approbation."));
    }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 960 }}>
      <h1 className="ecl-page__title">{t("page.commercial.title", "Commercial, distribution et ventes")}</h1>
      <p className="ecl-page__lead">{t("page.commercial.lead", "Clients, commandes et ventes directes.")}</p>

      <GuidanceNote title="Commercial & ventes">
        Gérez les clients, les commandes et les ventes directes (comptoir/salon). Les commandes à facturer (livre scolaire…)
        se saisissent ici et sont ensuite facturées par la Finance.
      </GuidanceNote>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {/* Commandes à facturer (ex. livre scolaire) : le commercial les initie ; la
          Finance établit la facture. */}
      <BillingOrdersSection canCreate={canInitiateOrder} canInvoice={false} canValidateThreshold={false} />

      <Card
        title={t("com.customers", "Clients")}
        icon={<IconCommercial />}
        subtitle={t("com.customers_sub", "Librairies, distributeurs, institutions…")}
        action={canManage ? <Button variant="add" size="sm" onClick={() => setNewCustomer({ name: "", category: "librairie", zone: "" })}>+ Client</Button> : undefined}
      >
        {customers.length === 0 ? (
          <Empty>{t("com.no_customer", "Aucun client.")}</Empty>
        ) : (
          <div className="ecl-list">
            {customers.map((customer) => (
              <div key={customer.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title">{customer.name}</span>
                  <StatusChip label={t(`com.cat.${customer.category}`, CATEGORY_LABELS[customer.category])} />
                </div>
                {customer.creditLimit && <span className="ecl-row__desc" style={{ margin: 0 }}>{t("com.limit", "plafond")} <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{customer.creditLimit}</strong></span>}
                {/* Barre d'actions standard (refonte, Étape 1) : impression de la fiche client. */}
                <StandardActionBar onPrint={() => getCustomer(customer.id).then((c) => printCustomerFiche(c)).catch((e) => setError(e instanceof Error ? e.message : "Impression impossible."))} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t("com.orders", "Commandes")} icon={<IconCommercial />} subtitle={t("com.orders_sub", "Suivi et déblocage des commandes.")}>
        {orders.length === 0 ? (
          <Empty>{t("com.no_order", "Aucune commande.")}</Empty>
        ) : (
          <div className="ecl-list">
            {orders.map((order) => (
              <div key={order.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{order.orderNumber}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{order.customer.name}</span>
                  <StatusChip label={order.status} />
                  {order.blockReason && <span style={{ color: "var(--alert)", fontSize: 12 }}>{order.blockReason}</span>}
                </div>
                {canValidate && order.status === "blocked_credit" && (
                  <Button variant="add" size="sm" onClick={() => handleApprove(order)}>{t("com.unblock", "Débloquer")}</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canManage && (
        <>
          <NewOrderForm customers={customers} isbns={isbns} locations={locations} onCreated={(msg) => { setMessage(msg); refresh(); }} onError={setError} />
          <PosSaleForm isbns={isbns} locations={locations} onCreated={() => { setMessage(t("com.pos_recorded", "Vente au comptoir enregistrée.")); refresh(); }} onError={setError} />
        </>
      )}

      {newCustomer && (
        <Modal
          title={t("com.new_customer", "Nouveau client")}
          onClose={() => setNewCustomer(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setNewCustomer(null)}>{t("common.cancel", "Annuler")}</Button>
              <Button variant="add" size="sm" onClick={submitCustomer}>{t("common.create", "Créer")}</Button>
            </>
          }
        >
          <Field label={t("com.customer_name", "Nom du client")}><input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} autoFocus /></Field>
          <Field label={t("com.category", "Catégorie")}>
            <select value={newCustomer.category} onChange={(e) => setNewCustomer({ ...newCustomer, category: e.target.value as CustomerCategory })}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{t(`com.cat.${value}`, label)}</option>)}
            </select>
          </Field>
          <Field label={t("com.delivery_zone", "Zone de livraison")}>
            <select value={newCustomer.zone} onChange={(e) => setNewCustomer({ ...newCustomer, zone: e.target.value })}>
              {ZONE_OPTIONS.map((z) => <option key={z.value} value={z.value}>{t(`com.zone.${z.value}`, z.label)}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

function NewOrderForm({
  customers,
  isbns,
  locations,
  onCreated,
  onError,
}: {
  customers: Customer[];
  isbns: IsbnRef[];
  locations: StockLocation[];
  onCreated: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [customerId, setCustomerId] = useState("");
  const [isbnId, setIsbnId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(10000);

  useEffect(() => {
    if (!customerId && customers[0]) setCustomerId(customers[0].id);
    if (!isbnId && isbns[0]) setIsbnId(isbns[0].id);
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [customers, isbns, locations]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const order = await createSalesOrder({
        customer_id: customerId,
        channel: "telephone",
        location_id: locationId,
        lines: [{ isbn_id: isbnId, quantity, unit_price: unitPrice }],
      });
      onCreated(
        order.status === "blocked_credit"
          ? `Commande ${order.orderNumber} créée mais bloquée (encours dépassé).`
          : `Commande ${order.orderNumber} confirmée.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : t("com.err_order", "Échec de la création de la commande."));
    }
  }

  return (
    <Card title={t("com.new_order", "Nouvelle commande")} icon={<IconCommercial />} subtitle={t("com.new_order_sub", "Créer une commande client.")}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label={t("com.customer", "Client")}>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </Field>
          <Field label={t("com.ref_isbn", "Référence (ISBN)")}>
            <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)}>
              {isbns.map((isbn) => <option key={isbn.id} value={isbn.id}>{isbn.isbn13} — {isbn.manuscript?.title}</option>)}
            </select>
          </Field>
          <Field label={t("com.ship_location", "Lieu d'expédition")}>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label={t("com.quantity", "Quantité")}>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <Field label={t("com.unit_price", "Prix unitaire")}>
            <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">{t("com.create_order", "Créer la commande")}</Button>
        </div>
      </form>
    </Card>
  );
}

function PosSaleForm({
  isbns,
  locations,
  onCreated,
  onError,
}: {
  isbns: IsbnRef[];
  locations: StockLocation[];
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [isbnId, setIsbnId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(10000);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "mobile_money">("cash");
  const [points, setPoints] = useState<PointOfSale[]>([]);
  const [pointId, setPointId] = useState("");
  // Ajout rapide d'un point de vente (nom + type).
  const [addingPoint, setAddingPoint] = useState(false);
  const [newPointName, setNewPointName] = useState("");
  const [newPointType, setNewPointType] = useState<PointOfSaleType>("librairie");

  useEffect(() => {
    if (!isbnId && isbns[0]) setIsbnId(isbns[0].id);
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [isbns, locations]);

  useEffect(() => {
    listPointsOfSale().then(setPoints).catch(() => setPoints([]));
  }, []);

  async function handleAddPoint() {
    if (!newPointName.trim()) return;
    try {
      const p = await createPointOfSale({ name: newPointName.trim(), type: newPointType });
      const list = await listPointsOfSale();
      setPoints(list);
      setPointId(p.id);
      setNewPointName("");
      setAddingPoint(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("com.err_point", "Impossible d'ajouter le point de vente."));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createPosSale({ isbn_id: isbnId, location_id: locationId, quantity, unit_price: unitPrice, payment_method: paymentMethod, point_of_sale_id: pointId || undefined });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("com.err_pos", "Échec de la vente au comptoir."));
    }
  }

  return (
    <Card title={t("com.pos_title", "Vente au comptoir / salon")} icon={<IconCommercial />} subtitle={t("com.pos_sub", "Encaisser une vente directe.")}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label={t("com.ref_isbn", "Référence (ISBN)")}>
            <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)}>
              {isbns.map((isbn) => <option key={isbn.id} value={isbn.id}>{isbn.isbn13} — {isbn.manuscript?.title}</option>)}
            </select>
          </Field>
          <Field label={t("com.location", "Lieu")}>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label={t("com.quantity", "Quantité")}>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <Field label={t("com.unit_price", "Prix unitaire")}>
            <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
          </Field>
          <Field label={t("com.payment", "Encaissement")}>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>
              <option value="cash">{t("com.cash", "Espèces")}</option>
              <option value="card">{t("com.card", "Carte")}</option>
              <option value="mobile_money">{t("com.mobile", "Mobile money")}</option>
            </select>
          </Field>
          <Field label={t("com.pos_point", "Point de vente")}>
            <select value={pointId} onChange={(e) => setPointId(e.target.value)}>
              <option value="">{t("com.pos_none", "— Aucun —")}</option>
              {points.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        {addingPoint ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, marginTop: 12 }}>
            <Field label={t("com.point_name", "Nom du point de vente")}>
              <input value={newPointName} onChange={(e) => setNewPointName(e.target.value)} placeholder={t("com.point_placeholder", "Ex : Librairie du Centre")} />
            </Field>
            <Field label={t("common.type", "Type")}>
              <select value={newPointType} onChange={(e) => setNewPointType(e.target.value as PointOfSaleType)}>
                <option value="librairie">{t("com.pt.librairie", "Librairie")}</option>
                <option value="salon">{t("com.pt.salon", "Salon / foire")}</option>
                <option value="en_ligne">{t("com.pt.en_ligne", "En ligne")}</option>
                <option value="autre">{t("com.pt.autre", "Autre")}</option>
              </select>
            </Field>
            <Button variant="add" size="sm" type="button" onClick={handleAddPoint}>{t("com.save", "Enregistrer")}</Button>
            <Button variant="subtle" size="sm" type="button" onClick={() => { setAddingPoint(false); setNewPointName(""); }}>{t("common.cancel", "Annuler")}</Button>
          </div>
        ) : (
          <button type="button" onClick={() => setAddingPoint(true)} style={{ marginTop: 10, background: "none", border: "none", color: "var(--gold)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            {t("com.new_point", "+ nouveau point de vente")}
          </button>
        )}
        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">{t("com.checkout", "Encaisser")}</Button>
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
