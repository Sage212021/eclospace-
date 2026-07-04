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

const CATEGORY_LABELS: Record<CustomerCategory, string> = {
  librairie: "Librairie",
  distributeur: "Distributeur",
  institution: "Institution",
  particulier: "Particulier",
  plateforme: "Plateforme en ligne",
};

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

  async function handleCreateCustomer() {
    const name = window.prompt("Nom du client");
    if (!name) return;
    const category = (window.prompt(`Catégorie (${Object.keys(CATEGORY_LABELS).join(", ")})`, "librairie") ?? "librairie") as CustomerCategory;
    const shippingZoneInput = window.prompt("Zone de livraison (yaounde, douala, autres_villes_cameroun, international) — laisser vide si non applicable", "");
    try {
      await createCustomer({ category, name, shipping_zone: shippingZoneInput || undefined });
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
    <div style={{ padding: 32, maxWidth: 960 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Commercial, distribution et ventes</h1>
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

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Clients</div>
          {canManage && (
            <button onClick={handleCreateCustomer} style={secondaryButtonStyle}>
              + Nouveau client
            </button>
          )}
        </div>
        {customers.map((customer) => (
          <div key={customer.id} style={{ fontSize: 13, padding: "4px 0" }}>
            {customer.name} ({CATEGORY_LABELS[customer.category]})
            {customer.creditLimit && <span style={{ color: "var(--muted)" }}> — plafond {customer.creditLimit}</span>}
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Commandes</div>
        {orders.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune commande.</p>}
        {orders.map((order) => (
          <div key={order.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {order.orderNumber} — {order.customer.name} — {order.status}
              {order.blockReason && <span style={{ color: "var(--alert)" }}> ({order.blockReason})</span>}
            </span>
            {canValidate && order.status === "blocked_credit" && (
              <button onClick={() => handleApprove(order)} style={secondaryButtonStyle}>
                Débloquer
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <>
          <NewOrderForm
            customers={customers}
            isbns={isbns}
            locations={locations}
            onCreated={(msg) => {
              setMessage(msg);
              refresh();
            }}
            onError={setError}
          />
          <PosSaleForm
            isbns={isbns}
            locations={locations}
            onCreated={() => {
              setMessage("Vente au comptoir enregistrée.");
              refresh();
            }}
            onError={setError}
          />
        </>
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
    <form onSubmit={handleSubmit} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Nouvelle commande</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          Client
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={inputStyle}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
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
          Lieu d'expédition
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={inputStyle}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Quantité
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>
          Prix unitaire
          <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} style={inputStyle} />
        </label>
      </div>
      <button type="submit" style={{ ...secondaryButtonStyle, marginTop: 10, background: "var(--eclosion)", color: "#fff", border: "none" }}>
        Créer la commande
      </button>
    </form>
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
    <form onSubmit={handleSubmit} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Vente au comptoir / salon</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
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
          Lieu
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={inputStyle}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Quantité
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>
          Prix unitaire
          <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>
          Encaissement
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} style={inputStyle}>
            <option value="cash">Espèces</option>
            <option value="card">Carte</option>
            <option value="mobile_money">Mobile money</option>
          </select>
        </label>
      </div>
      <button type="submit" style={{ ...secondaryButtonStyle, marginTop: 10, background: "var(--eclosion)", color: "#fff", border: "none" }}>
        Encaisser
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
