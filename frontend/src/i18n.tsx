import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setMyLanguage } from "./api/client";

// Internationalisation FR/EN — approche légère (pas de dépendance) et
// incrémentale : le français reste le texte par défaut fourni à `t(key, fr)` ;
// seul l'anglais vit dans le dictionnaire ci-dessous. Une clé sans traduction
// anglaise retombe proprement sur le français — on peut donc traduire écran par
// écran sans rien casser.

export type Lang = "fr" | "en";

const EN: Record<string, string> = {
  // Connexion
  "login.username": "Username",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.2fa_hint": "Enter the 6-digit code from your authenticator app.",
  "login.code": "Verification code",
  "login.validate": "Verify code",
  // Tableau de bord
  "dash.welcome": "Welcome",
  "dash.subtitle": "Overview of your publishing house.",
  "dash.kpi.ouvrages": "Books",
  "dash.kpi.utilisateurs": "Users",
  "dash.kpi.ventes": "Sales",
  "dash.kpi.stock": "Stock",
  "dash.session": "My session",
  "dash.username": "Username",
  "dash.role": "Role",
  "dash.no_role": "No role assigned",
  "dash.status": "Status",
  "dash.online": "Online",
  // Libellés de rôles
  "role.ADMIN_GENERAL": "General administrator",
  "role.DIR_GENERAL": "General manager",
  "role.DIR_EDITORIALE": "Editorial management",
  "role.RESP_FINANCE": "Administrative & financial manager",
  "role.RESP_RH": "HR manager",
  "role.RESP_COMMERCIAL": "Sales manager",
  "role.RESP_IMPRESSION": "Production/printing manager",
  "role.RESP_INFOGRAPHIE": "Graphics manager",
  "role.MAGASINIER": "Warehouse keeper",
  "role.CORRECTEUR": "Proofreader",
  "role.MEMBRE_COMITE_LECTURE": "Reading committee member",
  "role.ASSISTANT_EDITORIAL": "Editorial assistant",
  // En-têtes de pages
  "page.hr.title": "Human resources",
  "page.hr.lead": "Employee records, absences and access reviews.",
  "page.finance.title": "Finance & accounting",
  "page.finance.lead": "Invoices, payments, expenses, royalties and treasury.",
  "page.stock.title": "Stock & warehouse",
  "page.stock.lead": "Storage locations, movements and replenishment alerts.",
  "page.commercial.title": "Sales, distribution & orders",
  "page.commercial.lead": "Customers, orders and direct sales.",
  "page.reports.title": "Reports & indicators",
  "page.reports.lead": "Standard reports, management indicators, personal analyses and simulations.",
  "page.users.title": "Users & roles",
  "page.users.lead": "Accounts and permissions. Every change is justified and logged.",
  "page.direction.title": "General management",
  "page.direction.lead": "Consolidated view, global search, alerts and management recommendations.",
  "page.myreadings.title": "My reviews",
  "page.myreadings.lead": "Your reading assignments and the submission of your evaluations.",
  "page.catalogue.title": "Domains & collections",
  "page.rights.title": "Rights & poles",
  // Mes lectures
  "myr.empty": "No current assignment — new ones will appear here.",
  "myr.deadline": "Deadline",
  "myr.close": "Close",
  "myr.evaluate": "Evaluate",
  "myr.submitted_ok": "Evaluation submitted successfully.",
  "myr.global_score": "Indicative overall score (recomputed and validated by the server on submission):",
  "myr.coef": "coef.",
  "myr.recommendation": "Recommendation",
  "myr.reco.accept": "Accept without changes",
  "myr.reco.accept_minor": "Accept subject to minor corrections",
  "myr.reco.accept_major": "Accept subject to major corrections",
  "myr.reco.rewrite": "Request rewrite",
  "myr.reco.new_expertise": "New expert review",
  "myr.reco.reject": "Reasoned rejection",
  "myr.general_comment": "General assessment",
  "myr.submit_report": "Submit my report",
  "myr.status.pending": "To evaluate",
  "myr.status.submitted": "Submitted",
  "myr.status.cancelled": "Cancelled",
  // Commun
  "common.type": "Type",
  "common.cancel": "Cancel",
  "common.create": "Create",
  // Stock
  "stock.alerts_title": "Stock alerts",
  "stock.alerts_sub": "Out-of-stock and reached alert thresholds.",
  "stock.rupture": "Out of stock",
  "stock.alert": "Low",
  "stock.available_short": "avail.",
  "stock.locations_title": "Storage locations",
  "stock.locations_sub": "Warehouses, depots and locations.",
  "stock.add_location": "+ Location",
  "stock.no_location": "No location.",
  "stock.items_title": "Stock by reference and location",
  "stock.items_sub": "Physical, reserved and available quantities.",
  "stock.no_item": "No item in stock.",
  "stock.print_run": "print run",
  "stock.declasse": "Downgraded",
  "stock.pra_note": "Physical / reserved / available.",
  "stock.movement_recorded": "Movement recorded.",
  "stock.new_location_title": "New storage location",
  "stock.location_name": "Location name",
  "stock.location_placeholder": "E.g. Main warehouse",
  "stock.movement_title": "New stock movement",
  "stock.movement_sub": "Record an inbound, outbound or transfer.",
  "stock.ref_isbn": "Reference (ISBN)",
  "stock.quantity": "Quantity",
  "stock.from": "Origin location",
  "stock.to": "Destination location",
  "stock.reason": "Reason",
  "stock.record_movement": "Record movement",
  "stock.mv.production_in": "Production receipt",
  "stock.mv.sale_out": "Sale out",
  "stock.mv.consignment_out": "Consignment out",
  "stock.mv.consignment_return": "Consignment return",
  "stock.mv.customer_return": "Customer return",
  "stock.mv.transfer": "Transfer",
  "stock.mv.press_copy": "Press copy",
  "stock.mv.author_copy": "Author copy",
  "stock.mv.pulping": "Pulping",
  "stock.mv.inventory_adjustment": "Inventory adjustment",
  "stock.loc.entrepot": "Warehouse",
  "stock.loc.depot": "Depot",
  "stock.loc.depot_vente": "Consignment",
  "stock.loc.emplacement": "Location",
  // Commercial
  "com.customers": "Customers",
  "com.customers_sub": "Bookstores, distributors, institutions…",
  "com.no_customer": "No customer.",
  "com.limit": "limit",
  "com.orders": "Orders",
  "com.orders_sub": "Tracking and unblocking of orders.",
  "com.no_order": "No order.",
  "com.unblock": "Unblock",
  "com.new_customer": "New customer",
  "com.customer_name": "Customer name",
  "com.category": "Category",
  "com.delivery_zone": "Delivery zone",
  "com.new_order": "New order",
  "com.new_order_sub": "Create a customer order.",
  "com.customer": "Customer",
  "com.ref_isbn": "Reference (ISBN)",
  "com.ship_location": "Shipping location",
  "com.quantity": "Quantity",
  "com.unit_price": "Unit price",
  "com.create_order": "Create order",
  "com.pos_title": "Counter / fair sale",
  "com.pos_sub": "Record a direct sale.",
  "com.location": "Location",
  "com.payment": "Payment",
  "com.cash": "Cash",
  "com.card": "Card",
  "com.mobile": "Mobile money",
  "com.pos_point": "Point of sale",
  "com.pos_none": "— None —",
  "com.new_point": "+ new point of sale",
  "com.point_name": "Point of sale name",
  "com.point_placeholder": "e.g. Downtown Bookstore",
  "com.save": "Save",
  "com.checkout": "Check out",
  "com.pos_recorded": "Counter sale recorded.",
  "com.cat.librairie": "Bookstore",
  "com.cat.distributeur": "Distributor",
  "com.cat.institution": "Institution",
  "com.cat.particulier": "Individual",
  "com.cat.plateforme": "Online platform",
  "com.cat.auteur": "Author",
  "com.zone.": "— not applicable —",
  "com.zone.yaounde": "Yaoundé",
  "com.zone.douala": "Douala",
  "com.zone.autres_villes_cameroun": "Other cities (Cameroon)",
  "com.zone.international": "International",
  "com.pt.librairie": "Bookstore",
  "com.pt.salon": "Fair / show",
  "com.pt.en_ligne": "Online",
  "com.pt.autre": "Other",
  // Barre latérale
  "sidebar.connected": "Signed in",
  // Barre supérieure
  "topbar.search": "Search a book, an author, an ISBN…",
  "topbar.online": "online",
  "topbar.account_settings": "Account settings",
  "topbar.logout": "Sign out",
  // Poles (grands menus)
  "pole.Éditorial": "Editorial",
  "pole.Production": "Production",
  "pole.Commercial": "Sales",
  "pole.Juridique & Finance": "Legal & Finance",
  "pole.Administration": "Administration",
  "pole.Pilotage": "Management",
  // Entrées de menu
  "nav.dashboard": "Dashboard",
  "nav.mes-rapports": "My weekly reports",
  "nav.ed-manuscrits": "Manuscripts",
  "nav.ed-comite": "Reading committee",
  "nav.ed-mes-lectures": "My reviews",
  "nav.ed-direction": "Editorial direction",
  "nav.ed-correction": "Editorial correction",
  "nav.ed-catalogue-ref": "Domains & collections",
  "nav.ed-archives": "Archives",
  "nav.pr-maquette": "Layout",
  "nav.pr-infographie": "Graphics & covers",
  "nav.pr-isbn": "ISBN & legal deposit",
  "nav.pr-bat": "Proof & quality control",
  "nav.pr-impression": "Printing",
  "nav.co-stock": "Stock & warehouse",
  "nav.co-ventes": "Sales & orders",
  "nav.jf-contrats": "Contracts & royalties",
  "nav.jf-finance": "Finance & accounting",
  "nav.ad-rh": "Human resources",
  "nav.ad-users": "Users & roles",
  "nav.ad-rights": "Rights & poles",
  "nav.ad-parametres": "Settings",
  "nav.ad-diagnostics": "System diagnostics",
  "nav.pi-direction": "General management",
  "nav.pi-rapports": "Reports & statistics",
  "nav.pi-journal": "Activity log",
};

interface I18nCtx {
  lang: Lang;
  /** Changement par l'utilisateur : mémorisé localement ET sur le profil. */
  setLang: (l: Lang) => void;
  /** Application depuis le serveur (à la connexion) : sans réécriture serveur. */
  applyLang: (l: Lang) => void;
  /** Traduit une clé ; `fr` est le texte français par défaut (fallback). */
  t: (key: string, fr: string) => string;
}

const Ctx = createContext<I18nCtx>({ lang: "fr", setLang: () => {}, applyLang: () => {}, t: (_k, fr) => fr });

function readInitial(): Lang {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem("ecl_lang") : null;
  return v === "en" ? "en" : "fr";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  function applyLang(l: Lang) {
    setLangState(l);
    if (typeof localStorage !== "undefined") localStorage.setItem("ecl_lang", l);
  }

  function setLang(l: Lang) {
    applyLang(l);
    void setMyLanguage(l).catch(() => {}); // au mieux : ne bloque jamais l'UI
  }

  const t = (key: string, fr: string) => (lang === "fr" ? fr : EN[key] ?? fr);

  return <Ctx.Provider value={{ lang, setLang, applyLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  return useContext(Ctx);
}
