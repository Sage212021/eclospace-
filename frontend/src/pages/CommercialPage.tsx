import { useEffect, useState } from "react";
import { TableScroll } from "../components/TableScroll";
import {
  approveSalesOrder,
  createCustomer,
  createPosSale,
  deleteCustomer,
  listProvisionalPosSales,
  listMyPosSales,
  getSalesAnnual,
  reconcilePosSale,
  cancelPosSale,
  type PosSaleRow,
  type SalesAnnual,
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
import { TeamPerformanceSection } from "../components/TeamPerformanceSection";
import { MyCommercialStockCard } from "../components/CommercialStockSection";
import { useConfirm } from "../components/ConfirmProvider";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconCommercial } from "../components/icons";
import { IsbnCombobox } from "../components/IsbnCombobox";
import { PeriodFilter, currentPeriod, inPeriod, type Period } from "../components/PeriodFilter";

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
  // Responsable commercial / DG : voit la performance de chaque commercial + total.
  canSeeTeam: boolean;
}

// Commercial, distribution et ventes (Ch. 17) : clients, commandes, vente
// directe. Écran transverse, non rattaché à un seul manuscrit.
import { useI18n } from "../i18n";

export function CommercialPage({ canManage, canValidate, canInitiateOrder, canSeeTeam }: CommercialPageProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [isbns, setIsbns] = useState<IsbnRef[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState<{ name: string; category: CustomerCategory; zone: string } | null>(null);
  // Rafraîchit le registre « Mes ventes » et le récap annuel après chaque vente.
  const [salesKey, setSalesKey] = useState(0);

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

      {/* Mon stock commercial : exemplaires qui me sont confiés, à justifier (§10). */}
      <MyCommercialStockCard />

      {/* Responsable commercial / DG : performance de CHAQUE commercial + total équipe. */}
      {canSeeTeam && <TeamPerformanceSection />}

      <Card
        title={t("com.customers", "Clients")}
        icon={<IconCommercial />}
        subtitle={t("com.customers_sub", "Librairies, distributeurs, institutions…")}
        action={canManage ? <Button variant="add" size="sm" onClick={() => setNewCustomer({ name: "", category: "librairie", zone: "" })}>+ Client</Button> : undefined}
      >
        {customers.length > 0 && (
          <input
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            placeholder={t("com.search_customer", "Rechercher un client (nom, catégorie, contact, tél, e-mail)…")}
            style={{ width: "100%", maxWidth: 460, padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, marginBottom: 12 }}
          />
        )}
        {customers.length === 0 ? (
          <Empty>{t("com.no_customer", "Aucun client.")}</Empty>
        ) : (
          <div className="ecl-list">
            {customers
              .filter((c) => {
                const q = customerQuery.trim().toLowerCase();
                if (!q) return true;
                return [c.name, CATEGORY_LABELS[c.category], c.contactName, c.phone, c.email]
                  .some((v) => (v ?? "").toLowerCase().includes(q));
              })
              .map((customer) => (
              <div key={customer.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title">{customer.name}</span>
                  <StatusChip label={t(`com.cat.${customer.category}`, CATEGORY_LABELS[customer.category])} />
                </div>
                {customer.creditLimit && <span className="ecl-row__desc" style={{ margin: 0 }}>{t("com.limit", "plafond")} <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{customer.creditLimit}</strong></span>}
                {/* Barre d'actions standard (refonte, Étape 1) : impression de la fiche client. */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <StandardActionBar onPrint={() => getCustomer(customer.id).then((c) => printCustomerFiche(c)).catch((e) => setError(e instanceof Error ? e.message : "Impression impossible."))} />
                  {canManage && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={async () => {
                        const ok = await confirm({
                          title: t("com.del_customer_title", "Supprimer ce client ?"),
                          message: t("com.del_customer_msg", `« ${customer.name} » sera retiré de la liste. Les clients ayant un historique (commandes, ventes, factures) ne peuvent pas être supprimés.`),
                          confirmLabel: t("com.del_customer_ok", "Supprimer"),
                          tone: "danger",
                        });
                        if (!ok) return;
                        try {
                          await deleteCustomer(customer.id);
                          setMessage(t("com.del_customer_done", `Client « ${customer.name} » supprimé.`));
                          await refresh();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : t("com.del_customer_err", "Suppression impossible."));
                        }
                      }}
                    >
                      {t("com.delete", "Supprimer")}
                    </Button>
                  )}
                </div>
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
          <PosSaleForm customers={customers} isbns={isbns} locations={locations} onCreated={() => { setSalesKey((k) => k + 1); }} onError={setError} />
          <MySalesRegister refreshKey={salesKey} />
          <AnnualSalesRecap refreshKey={salesKey} />
          {canValidate && <ProvisionalSalesSection isbns={isbns} onDone={(msg) => { setMessage(msg); refresh(); }} onError={setError} />}
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
  const NEW = "__new__";
  const [customerId, setCustomerId] = useState("");
  const [isbnId, setIsbnId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(10000);
  // Nouveau client saisi à la volée (auto-créé au catalogue à la validation).
  const [newCust, setNewCust] = useState({ name: "", category: "particulier" as CustomerCategory, phone: "", email: "", address: "" });

  useEffect(() => {
    if (!customerId && customers[0]) setCustomerId(customers[0].id);
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [customers, isbns, locations]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isbnId) {
      onError("Choisissez un ouvrage : tapez son ISBN ou le début de son titre.");
      return;
    }
    try {
      // Client non catalogué : on crée d'abord sa fiche (identifiant unique,
      // réutilisable partout ensuite), puis la commande — jamais bloquant.
      let resolvedCustomerId = customerId;
      if (customerId === NEW) {
        if (!newCust.name.trim()) {
          onError(t("com.err_new_customer_name", "Nom ou raison sociale du nouveau client requis."));
          return;
        }
        const created = await createCustomer({
          category: newCust.category,
          name: newCust.name.trim(),
          phone: newCust.phone.trim() || undefined,
          email: newCust.email.trim() || undefined,
          address: newCust.address.trim() || undefined,
        });
        resolvedCustomerId = created.id;
      }
      const order = await createSalesOrder({
        customer_id: resolvedCustomerId,
        channel: "telephone",
        location_id: locationId,
        lines: [{ isbn_id: isbnId, quantity, unit_price: unitPrice }],
      });
      onCreated(
        order.status === "blocked_credit"
          ? `Commande ${order.orderNumber} créée mais bloquée (encours dépassé).`
          : `Commande ${order.orderNumber} confirmée.`,
      );
      if (customerId === NEW) {
        setNewCust({ name: "", category: "particulier", phone: "", email: "", address: "" });
        setCustomerId("");
      }
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
              <option value={NEW}>➕ {t("com.new_customer_opt", "Nouveau client (saisie manuelle)")}</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </Field>
          <Field label={t("com.ref_isbn", "Référence (ISBN)")}>
            <IsbnCombobox isbns={isbns} value={isbnId} onChange={setIsbnId} />
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

        {/* Saisie manuelle d'un nouveau client (auto-créé au catalogue). */}
        {customerId === NEW && (
          <div style={{ marginTop: 12, padding: 12, border: "1px dashed var(--eclosion)", borderRadius: 8, background: "var(--eclosion-soft)" }}>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
              {t("com.new_customer_hint", "Ce client sera enregistré au catalogue à la validation, avec un identifiant unique — réutilisable ensuite partout.")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <Field label={t("com.nc_name", "Nom / raison sociale *")}>
                <input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
              </Field>
              <Field label={t("com.nc_category", "Catégorie")}>
                <select value={newCust.category} onChange={(e) => setNewCust({ ...newCust, category: e.target.value as CustomerCategory })}>
                  {(Object.keys(CATEGORY_LABELS) as CustomerCategory[]).map((c) => <option key={c} value={c}>{t(`com.cat.${c}`, CATEGORY_LABELS[c])}</option>)}
                </select>
              </Field>
              <Field label={t("com.nc_phone", "Téléphone")}>
                <input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
              </Field>
              <Field label={t("com.nc_email", "E-mail (facultatif)")}>
                <input type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} />
              </Field>
              <Field label={t("com.nc_address", "Adresse (facultatif)")}>
                <input value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} />
              </Field>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Button variant="add" size="md" type="submit">{t("com.create_order", "Créer la commande")}</Button>
        </div>
      </form>
    </Card>
  );
}

function PosSaleForm({
  customers,
  isbns,
  locations,
  onCreated,
  onError,
}: {
  customers: Customer[];
  isbns: IsbnRef[];
  locations: StockLocation[];
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const NEW = "__new__";
  const [isbnId, setIsbnId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(10000);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "mobile_money">("cash");
  const [points, setPoints] = useState<PointOfSale[]>([]);
  const [pointId, setPointId] = useState("");
  // Livre : catalogue (ISBN) ou hors catalogue (provisoire, saisie libre).
  const [bookMode, setBookMode] = useState<"catalogue" | "off">("catalogue");
  const [offTitle, setOffTitle] = useState("");
  const [offAuthor, setOffAuthor] = useState("");
  const [offIsbn, setOffIsbn] = useState("");
  // Client optionnel (au choix du commercial) : "" = aucun, NEW = saisie manuelle.
  const [customerId, setCustomerId] = useState("");
  const [newCust, setNewCust] = useState({ name: "", category: "particulier" as CustomerCategory, phone: "", email: "", address: "" });
  // Ajout rapide d'un point de vente (nom + type).
  const [addingPoint, setAddingPoint] = useState(false);
  const [newPointName, setNewPointName] = useState("");
  const [newPointType, setNewPointType] = useState<PointOfSaleType>("librairie");
  // Confirmation INLINE (à côté du bouton) : le commercial voit tout de suite
  // que sa vente est bien enregistrée, sans devoir remonter en haut de page.
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
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
    setSavedMsg(null);
    try {
      // Client optionnel : nouveau client auto-créé si saisie manuelle.
      let customer_id: string | undefined;
      if (customerId === NEW) {
        if (!newCust.name.trim()) {
          onError(t("com.err_new_customer_name", "Nom ou raison sociale du nouveau client requis."));
          return;
        }
        const created = await createCustomer({ category: newCust.category, name: newCust.name.trim(), phone: newCust.phone.trim() || undefined, email: newCust.email.trim() || undefined, address: newCust.address.trim() || undefined });
        customer_id = created.id;
      } else if (customerId) {
        customer_id = customerId;
      }

      if (bookMode === "off") {
        if (!offTitle.trim()) {
          onError(t("com.err_off_title", "Titre du livre non catalogué requis."));
          return;
        }
        await createPosSale({ off_catalogue_title: offTitle.trim(), off_catalogue_author: offAuthor.trim() || undefined, off_catalogue_isbn: offIsbn.trim() || undefined, quantity, unit_price: unitPrice, payment_method: paymentMethod, customer_id, point_of_sale_id: pointId || undefined });
      } else {
        if (!isbnId) {
          onError(t("com.err_isbn", "Sélectionnez un ouvrage du catalogue (ISBN)."));
          return;
        }
        await createPosSale({ isbn_id: isbnId, location_id: locationId || undefined, quantity, unit_price: unitPrice, payment_method: paymentMethod, customer_id, point_of_sale_id: pointId || undefined });
      }
      onCreated();
      const total = (quantity * unitPrice).toLocaleString("fr-FR");
      setSavedMsg(t("com.pos_saved_inline", `Vente enregistrée : ${quantity} × ${unitPrice.toLocaleString("fr-FR")} = ${total} FCFA. Elle apparaît dans « Mes ventes » ci-dessous.`));
      setOffTitle(""); setOffAuthor(""); setOffIsbn("");
      if (customerId === NEW) { setNewCust({ name: "", category: "particulier", phone: "", email: "", address: "" }); setCustomerId(""); }
    } catch (err) {
      setSavedMsg(null);
      onError(err instanceof Error ? err.message : t("com.err_pos", "Échec de la vente au comptoir."));
    }
  }

  return (
    <Card title={t("com.pos_title", "Vente au comptoir / salon")} icon={<IconCommercial />} subtitle={t("com.pos_sub", "Vente directe payée sur place (espèces, carte, mobile money).")}>
      <GuidanceNote title="Vente au comptoir : un seul geste">
        Ici, <b>enregistrer</b> une vente au comptoir vaut <b>encaissement immédiat</b> : le paiement est reçu sur place, la
        facture et les droits d'auteur sont générés aussitôt. (Le circuit « Commandes » ci-dessus est différent : on
        <b> enregistre d'abord</b> la commande, puis la Finance <b>facture et encaisse</b> plus tard.) Cette vente n'a
        aucun effet sur le stock pour le moment.
      </GuidanceNote>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label={t("com.book_mode", "Livre")}>
            <select value={bookMode} onChange={(e) => setBookMode(e.target.value as "catalogue" | "off")}>
              <option value="catalogue">{t("com.book_catalogue", "Du catalogue (ISBN)")}</option>
              <option value="off">{t("com.book_off", "Non encore catalogué")}</option>
            </select>
          </Field>
          {bookMode === "catalogue" ? (
            <>
              <Field label={t("com.ref_isbn", "Référence (ISBN)")}>
                <IsbnCombobox isbns={isbns} value={isbnId} onChange={setIsbnId} />
              </Field>
              <Field label={t("com.location", "Lieu")}>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label={t("com.off_title", "Titre du livre *")}>
                <input value={offTitle} onChange={(e) => setOffTitle(e.target.value)} />
              </Field>
              <Field label={t("com.off_author", "Auteur (facultatif)")}>
                <input value={offAuthor} onChange={(e) => setOffAuthor(e.target.value)} />
              </Field>
              <Field label={t("com.off_isbn", "ISBN (facultatif)")}>
                <input value={offIsbn} onChange={(e) => setOffIsbn(e.target.value)} />
              </Field>
            </>
          )}
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
          <Field label={t("com.pos_customer", "Client (facultatif)")}>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t("com.pos_customer_none", "— Aucun (vente anonyme) —")}</option>
              <option value={NEW}>➕ {t("com.new_customer_opt", "Nouveau client (saisie manuelle)")}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>

        {bookMode === "off" && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
            {t("com.off_hint", "Vente « hors catalogue » : enregistrée comme provisoire (sans mouvement de stock), à rattacher à l'ouvrage une fois créé au catalogue.")}
          </div>
        )}

        {/* Nouveau client (saisie manuelle, auto-créé au catalogue). */}
        {customerId === NEW && (
          <div style={{ marginTop: 12, padding: 12, border: "1px dashed var(--eclosion)", borderRadius: 8, background: "var(--eclosion-soft)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <Field label={t("com.nc_name", "Nom / raison sociale *")}>
                <input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
              </Field>
              <Field label={t("com.nc_category", "Catégorie")}>
                <select value={newCust.category} onChange={(e) => setNewCust({ ...newCust, category: e.target.value as CustomerCategory })}>
                  {(Object.keys(CATEGORY_LABELS) as CustomerCategory[]).map((c) => <option key={c} value={c}>{t(`com.cat.${c}`, CATEGORY_LABELS[c])}</option>)}
                </select>
              </Field>
              <Field label={t("com.nc_phone", "Téléphone")}>
                <input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
              </Field>
              <Field label={t("com.nc_email", "E-mail (facultatif)")}>
                <input type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} />
              </Field>
              <Field label={t("com.nc_address", "Adresse (facultatif)")}>
                <input value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} />
              </Field>
            </div>
          </div>
        )}
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
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button variant="add" size="md" type="submit">{t("com.checkout", "Enregistrer la vente")}</Button>
          {savedMsg && <span style={{ color: "var(--eclosion, #d9b21a)", fontSize: 13, fontWeight: 600 }}>✓ {savedMsg}</span>}
        </div>
      </form>
    </Card>
  );
}

// Réconciliation : rattacher les ventes « hors catalogue » (provisoires) à un
// ouvrage désormais référencé. À ce moment, la facture et les droits d'auteur
// sont générés. Réservé à la validation commerciale.
function ProvisionalSalesSection({
  isbns,
  onDone,
  onError,
}: {
  isbns: IsbnRef[];
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [sales, setSales] = useState<PosSaleRow[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => listProvisionalPosSales().then(setSales).catch(() => setSales([]));
  useEffect(() => { load(); }, []);

  async function reconcile(id: string) {
    const isbnId = picks[id] || isbns[0]?.id;
    if (!isbnId) { onError(t("com.recon_no_isbn", "Aucun ouvrage disponible pour le rattachement.")); return; }
    setBusy(id);
    try {
      await reconcilePosSale(id, isbnId);
      onDone(t("com.recon_done", "Vente rattachée : facture et droits d'auteur générés."));
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("com.recon_err", "Rattachement impossible."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={t("com.recon_title", "Ventes à rattacher (hors catalogue)")} icon={<IconCommercial />} subtitle={t("com.recon_sub", "Ventes provisoires : rattachez-les à l'ouvrage une fois créé au catalogue.")}>
      {sales.length === 0 ? (
        <Empty>{t("com.recon_none", "Aucune vente provisoire à rattacher.")}</Empty>
      ) : (
        <div className="ecl-list">
          {sales.map((s) => (
            <div key={s.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
              <div className="ecl-row__main">
                <div className="ecl-row__title">{s.title ?? "—"}</div>
                <div className="ecl-row__desc">
                  {[s.author, s.isbn13].filter(Boolean).join(" · ")}
                  {s.author || s.isbn13 ? " · " : ""}
                  {t("com.recon_qty", "qté")} <span style={{ fontFamily: "var(--font-mono)" }}>{s.quantity}</span> · <span style={{ fontFamily: "var(--font-mono)" }}>{s.unit_price.toLocaleString("fr-FR")}</span> FCFA
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select value={picks[s.id] ?? ""} onChange={(e) => setPicks({ ...picks, [s.id]: e.target.value })}>
                  <option value="">{t("com.recon_choose", "— Ouvrage cible —")}</option>
                  {isbns.map((i) => <option key={i.id} value={i.id}>{i.isbn13} — {i.manuscript?.title}</option>)}
                </select>
                <Button variant="add" size="sm" type="button" disabled={busy === s.id} onClick={() => reconcile(s.id)}>
                  {busy === s.id ? t("com.recon_busy", "…") : t("com.recon_btn", "Rattacher")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const PAY_LABEL: Record<string, string> = { cash: "Espèces", card: "Carte", mobile_money: "Mobile money" };
function fcfa(n: number): string { return `${Math.round(n).toLocaleString("fr-FR")} FCFA`; }

// Registre des ventes au comptoir du commercial : visible dès l'enregistrement.
function MySalesRegister({ refreshKey }: { refreshKey: number }) {
  const [sales, setSales] = useState<PosSaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Annulation : vente ciblée, motif saisi, état d'envoi et message d'erreur.
  const [target, setTarget] = useState<PosSaleRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Filtre par période (D-023) : ouvert par défaut sur le mois en cours.
  const [period, setPeriod] = useState<Period>(currentPeriod());

  const load = () => { setLoading(true); listMyPosSales().then(setSales).catch(() => setSales([])).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, [refreshKey]);

  const filtered = sales.filter((s) => inPeriod(s.sold_at, period));
  // Le total ne compte QUE les ventes actives de la période (une vente annulée ne pèse plus).
  const total = filtered.reduce((s, r) => s + (r.cancelled ? 0 : r.total), 0);
  const activeCount = filtered.filter((s) => !s.cancelled).length;

  function openCancel(s: PosSaleRow) { setTarget(s); setReason(""); setErr(null); }

  async function confirmCancel() {
    if (!target) return;
    const r = reason.trim();
    if (!r) { setErr("Le motif de l'annulation est obligatoire."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await cancelPosSale(target.id, r);
      setTarget(null);
      setFlash(res.credit_note_id
        ? "Vente annulée : un avoir a été émis, les droits d'auteur contre-passés et la Direction financière notifiée."
        : "Vente annulée.");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Annulation impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Mes ventes au comptoir" icon={<IconCommercial />} subtitle="Vos ventes directes, les plus récentes en premier — visibles dès l'enregistrement. Une vente saisie par erreur peut être annulée (avec motif) ; elle reste au journal, barrée." collapsible defaultOpen>
      {flash && <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(200,154,27,0.12)", color: "var(--ink)", fontSize: 13 }}>{flash}</div>}
      {loading ? (
        <Empty>Chargement…</Empty>
      ) : sales.length === 0 ? (
        <Empty>Aucune vente enregistrée pour l'instant. Enregistrez une vente ci-dessus, elle apparaîtra ici.</Empty>
      ) : (
        <>
        <PeriodFilter dates={sales.map((s) => s.sold_at)} value={period} onChange={setPeriod} resultCount={filtered.length} />
        {filtered.length === 0 ? (
          <Empty>Aucune vente pour cette période.</Empty>
        ) : (
        <TableScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "6px 8px" }}>Date</th>
                <th style={{ padding: "6px 8px" }}>Ouvrage</th>
                <th style={{ padding: "6px 8px" }}>Auteur</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Qté</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>P.U.</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Total</th>
                <th style={{ padding: "6px 8px" }}>Paiement</th>
                <th style={{ padding: "6px 8px" }} />
              </tr>
            </thead>
            <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {filtered.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--line)", opacity: s.cancelled ? 0.55 : 1, textDecoration: s.cancelled ? "line-through" : "none" }}>
                  <td style={{ padding: "6px 8px" }}>{s.sold_at.slice(0, 10)}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "inherit" }}>
                    {s.title ?? "—"}
                    {!s.is_catalogue && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--retard, #C4661F)", textDecoration: "none" }}>hors catalogue</span>}
                  </td>
                  <td style={{ padding: "6px 8px", fontFamily: "inherit", color: "var(--muted)" }}>{s.author ?? "—"}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.quantity}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.unit_price.toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{s.total.toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "inherit" }}>{PAY_LABEL[s.payment_method] ?? s.payment_method}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "inherit", textDecoration: "none", whiteSpace: "nowrap" }}>
                    {s.cancelled ? (
                      <span title={s.cancellation_reason ?? undefined} style={{ fontSize: 11, color: "var(--critique, #C24B3A)" }}>
                        Annulée{s.cancellation_reason ? ` · ${s.cancellation_reason}` : ""}
                      </span>
                    ) : (
                      <Button variant="danger" size="sm" type="button" onClick={() => openCancel(s)}>Annuler</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700, fontFamily: "var(--font-mono, monospace)" }}>
                <td style={{ padding: "6px 8px" }} colSpan={5}>Total ({activeCount} vente{activeCount > 1 ? "s" : ""} active{activeCount > 1 ? "s" : ""})</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{total.toLocaleString("fr-FR")}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </TableScroll>
        )}
        </>
      )}

      {target && (
        <Modal
          title="Annuler cette vente"
          onClose={() => (busy ? undefined : setTarget(null))}
          footer={
            <>
              <Button variant="subtle" type="button" disabled={busy} onClick={() => setTarget(null)}>Fermer</Button>
              <Button variant="danger" type="button" disabled={busy} onClick={confirmCancel}>
                {busy ? "Annulation…" : "Confirmer l'annulation"}
              </Button>
            </>
          }
        >
          <div style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
            Vente du <b>{target.sold_at.slice(0, 10)}</b> : <b>{target.quantity} × {target.title ?? "—"}</b> à{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{target.unit_price.toLocaleString("fr-FR")}</span> FCFA
            (total <span style={{ fontFamily: "var(--font-mono)" }}>{target.total.toLocaleString("fr-FR")}</span> FCFA).
            {target.is_catalogue
              ? " Un avoir sera émis, les droits d'auteur contre-passés et la Direction financière notifiée."
              : " Vente provisoire (hors catalogue) : simple annulation, sans effet comptable."}
            {" "}Le stock n'est pas modifié (il est piloté par le magasin).
          </div>
          <Field label="Motif de l'annulation (obligatoire)">
            <input
              autoFocus
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (err) setErr(null); }}
              placeholder="Ex. erreur de saisie, vente de test, montant erroné"
              maxLength={300}
            />
          </Field>
          {err && <div style={{ marginTop: 8, color: "var(--critique, #C24B3A)", fontSize: 13 }}>{err}</div>}
        </Modal>
      )}
    </Card>
  );
}

// Récapitulatif annuel des ventes au comptoir, par ouvrage et par auteur.
function AnnualSalesRecap({ refreshKey }: { refreshKey: number }) {
  const nowYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(nowYear);
  const [data, setData] = useState<SalesAnnual | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    getSalesAnnual(year).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [year, refreshKey]);
  const years = [nowYear, nowYear - 1, nowYear - 2, nowYear - 3];
  const recapTable = (title: string, rows: SalesAnnual["by_book"]) => (
    <div style={{ flex: "1 1 320px", minWidth: 300 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {rows.length === 0 ? <Empty>Aucune vente.</Empty> : (
        <TableScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
              <th style={{ padding: "5px 8px" }}>Libellé</th>
              <th style={{ padding: "5px 8px", textAlign: "right" }}>Qté</th>
              <th style={{ padding: "5px 8px", textAlign: "right" }}>CA</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 8px" }}>{r.label}{r.sublabel && <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}> · {r.sublabel}</span>}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.quantity}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fcfa(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
  return (
    <Card title="Récapitulatif annuel des ventes" icon={<IconCommercial />} subtitle="Ventes au comptoir agrégées par ouvrage et par auteur." collapsible>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 12 }}>
        <Field label="Année">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        {data && <div style={{ fontSize: 13, color: "var(--muted)" }}>{data.totals.sales_count} vente(s) · {data.totals.quantity} ex. · <b style={{ color: "var(--ink)" }}>{fcfa(data.totals.revenue)}</b></div>}
      </div>
      {loading ? <Empty>Chargement…</Empty> : data && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          {recapTable("Par ouvrage", data.by_book)}
          {recapTable("Par auteur", data.by_author)}
        </div>
      )}
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
