import { useEffect, useState } from "react";
import {
  approveSalesOrder,
  createCustomer,
  createPosSale,
  createSalesOrder,
  listCustomers,
  listIsbnRefs,
  listSalesOrders,
  listStockLocations,
  type Customer,
  type CustomerCategory,
  type IsbnRef,
  type SalesOrder,
  type StockLocation,
} from "../api/client";
import { Card } from "../components/Card";
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
}

// Commercial, distribution et ventes (Ch. 17) : clients, commandes, vente
// directe. Écran transverse, non rattaché à un seul manuscrit.
export function CommercialPage({ canManage, canValidate }: CommercialPageProps) {
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
      setError(err instanceof Error ? err.message : "Échec de la création du client.");
    }
  }

  async function handleApprove(order: SalesOrder) {
    try {
      await approveSalesOrder(order.id);
      setMessage(`Commande ${order.orderNumber} débloquée.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'approbation.");
    }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 960 }}>
      <h1 className="ecl-page__title">Commercial, distribution et ventes</h1>
      <p className="ecl-page__lead">Clients, commandes et ventes directes.</p>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      <Card
        title="Clients"
        icon={<IconCommercial />}
        subtitle="Librairies, distributeurs, institutions…"
        action={canManage ? <Button variant="add" size="sm" onClick={() => setNewCustomer({ name: "", category: "librairie", zone: "" })}>+ Client</Button> : undefined}
      >
        {customers.length === 0 ? (
          <Empty>Aucun client.</Empty>
        ) : (
          <div className="ecl-list">
            {customers.map((customer) => (
              <div key={customer.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title">{customer.name}</span>
                  <StatusChip label={CATEGORY_LABELS[customer.category]} />
                </div>
                {customer.creditLimit && <span className="ecl-row__desc" style={{ margin: 0 }}>plafond <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{customer.creditLimit}</strong></span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Commandes" icon={<IconCommercial />} subtitle="Suivi et déblocage des commandes.">
        {orders.length === 0 ? (
          <Empty>Aucune commande.</Empty>
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
                  <Button variant="add" size="sm" onClick={() => handleApprove(order)}>Débloquer</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canManage && (
        <>
          <NewOrderForm customers={customers} isbns={isbns} locations={locations} onCreated={(msg) => { setMessage(msg); refresh(); }} onError={setError} />
          <PosSaleForm isbns={isbns} locations={locations} onCreated={() => { setMessage("Vente au comptoir enregistrée."); refresh(); }} onError={setError} />
        </>
      )}

      {newCustomer && (
        <Modal
          title="Nouveau client"
          onClose={() => setNewCustomer(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setNewCustomer(null)}>Annuler</Button>
              <Button variant="add" size="sm" onClick={submitCustomer}>Créer</Button>
            </>
          }
        >
          <Field label="Nom du client"><input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} autoFocus /></Field>
          <Field label="Catégorie">
            <select value={newCustomer.category} onChange={(e) => setNewCustomer({ ...newCustomer, category: e.target.value as CustomerCategory })}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Zone de livraison">
            <select value={newCustomer.zone} onChange={(e) => setNewCustomer({ ...newCustomer, zone: e.target.value })}>
              {ZONE_OPTIONS.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
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
      onError(err instanceof Error ? err.message : "Échec de la création de la commande.");
    }
  }

  return (
    <Card title="Nouvelle commande" icon={<IconCommercial />} subtitle="Créer une commande client.">
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label="Client">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </Field>
          <Field label="Référence (ISBN)">
            <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)}>
              {isbns.map((isbn) => <option key={isbn.id} value={isbn.id}>{isbn.isbn13} — {isbn.manuscript?.title}</option>)}
            </select>
          </Field>
          <Field label="Lieu d'expédition">
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label="Quantité">
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <Field label="Prix unitaire">
            <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">Créer la commande</Button>
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
  const [isbnId, setIsbnId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(10000);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "mobile_money">("cash");

  useEffect(() => {
    if (!isbnId && isbns[0]) setIsbnId(isbns[0].id);
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [isbns, locations]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createPosSale({ isbn_id: isbnId, location_id: locationId, quantity, unit_price: unitPrice, payment_method: paymentMethod });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la vente au comptoir.");
    }
  }

  return (
    <Card title="Vente au comptoir / salon" icon={<IconCommercial />} subtitle="Encaisser une vente directe.">
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label="Référence (ISBN)">
            <select value={isbnId} onChange={(e) => setIsbnId(e.target.value)}>
              {isbns.map((isbn) => <option key={isbn.id} value={isbn.id}>{isbn.isbn13} — {isbn.manuscript?.title}</option>)}
            </select>
          </Field>
          <Field label="Lieu">
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </Field>
          <Field label="Quantité">
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <Field label="Prix unitaire">
            <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
          </Field>
          <Field label="Encaissement">
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>
              <option value="cash">Espèces</option>
              <option value="card">Carte</option>
              <option value="mobile_money">Mobile money</option>
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">Encaisser</Button>
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
