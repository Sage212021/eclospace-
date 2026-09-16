import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { confirmIdentifierChange, fetchMe, getChatUnread, getNotificationPreferences, logout, stopImpersonation, type EffectiveUser, type NotificationPreferences } from "./api/client";
import { useI18n } from "./i18n";
import { Login } from "./pages/Login";
import { lazyWithRetry as lazy } from "./lib/lazyWithRetry";

// Chargement à la demande (« code-splitting ») : chaque écran ne se télécharge
// qu'au moment où l'utilisateur l'ouvre, au lieu de tout charger d'un bloc au
// premier accès. Sur une connexion modeste, la première ouverture est bien plus
// rapide. Seule la page de connexion reste chargée d'emblée (c'est la porte
// d'entrée). Les modules React exportent des composants nommés : on les
// convertit en export « par défaut » attendu par lazy().
const QuoteSignPage = lazy(() => import("./pages/QuoteSignPage").then((m) => ({ default: m.QuoteSignPage })));
const DecisionLetterConfirmPage = lazy(() => import("./pages/DecisionLetterConfirmPage").then((m) => ({ default: m.DecisionLetterConfirmPage })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Manuscripts = lazy(() => import("./pages/Manuscripts").then((m) => ({ default: m.Manuscripts })));
const ReadingCommittee = lazy(() => import("./pages/ReadingCommittee").then((m) => ({ default: m.ReadingCommittee })));
const EditorialDecision = lazy(() => import("./pages/EditorialDecision").then((m) => ({ default: m.EditorialDecision })));
const CorrectionEditorial = lazy(() => import("./pages/CorrectionEditorial").then((m) => ({ default: m.CorrectionEditorial })));
const MyCorrections = lazy(() => import("./pages/MyCorrections").then((m) => ({ default: m.MyCorrections })));
const CatalogueReferencePage = lazy(() => import("./pages/CatalogueReferencePage").then((m) => ({ default: m.CatalogueReferencePage })));
const EditorialQuotesInbox = lazy(() => import("./components/EditorialQuotesInbox").then((m) => ({ default: m.EditorialQuotesInbox })));
const ArchivesPage = lazy(() => import("./pages/ArchivesPage").then((m) => ({ default: m.ArchivesPage })));
const RightsMatrixPage = lazy(() => import("./pages/RightsMatrixPage").then((m) => ({ default: m.RightsMatrixPage })));
const ManuscriptDetail = lazy(() => import("./pages/ManuscriptDetail").then((m) => ({ default: m.ManuscriptDetail })));
const MyReadings = lazy(() => import("./pages/MyReadings").then((m) => ({ default: m.MyReadings })));
const MyDossiers = lazy(() => import("./pages/MyDossiers").then((m) => ({ default: m.MyDossiers })));
const StockPage = lazy(() => import("./pages/StockPage").then((m) => ({ default: m.StockPage })));
const CommercialPage = lazy(() => import("./pages/CommercialPage").then((m) => ({ default: m.CommercialPage })));
const CataloguePage = lazy(() => import("./pages/CataloguePage").then((m) => ({ default: m.CataloguePage })));
const MarketingPlansPage = lazy(() => import("./pages/MarketingPlansPage").then((m) => ({ default: m.MarketingPlansPage })));
const MarketingPartnersPage = lazy(() => import("./pages/MarketingPartnersPage").then((m) => ({ default: m.MarketingPartnersPage })));
const MarketingCampaignsPage = lazy(() => import("./pages/MarketingCampaignsPage").then((m) => ({ default: m.MarketingCampaignsPage })));
const MarketingDashboardPage = lazy(() => import("./pages/MarketingDashboardPage").then((m) => ({ default: m.MarketingDashboardPage })));
const FinancePage = lazy(() => import("./pages/FinancePage").then((m) => ({ default: m.FinancePage })));
const HrPage = lazy(() => import("./pages/HrPage").then((m) => ({ default: m.HrPage })));
const DirectionPage = lazy(() => import("./pages/DirectionPage").then((m) => ({ default: m.DirectionPage })));
const PayrollSuiviPage = lazy(() => import("./pages/PayrollSuiviPage").then((m) => ({ default: m.PayrollSuiviPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const WeeklyReportsPage = lazy(() => import("./pages/WeeklyReportsPage").then((m) => ({ default: m.WeeklyReportsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage").then((m) => ({ default: m.AuditLogPage })));
const UsersRolesPage = lazy(() => import("./pages/UsersRolesPage").then((m) => ({ default: m.UsersRolesPage })));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage").then((m) => ({ default: m.DiagnosticsPage })));
const AnnouncementsPage = lazy(() => import("./pages/AnnouncementsPage").then((m) => ({ default: m.AnnouncementsPage })));
const AnnualEventsPlanning = lazy(() => import("./components/AnnualEventsPlanning").then((m) => ({ default: m.AnnualEventsPlanning })));
const CalendarPage = lazy(() => import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const NewsFeedPage = lazy(() => import("./pages/NewsFeedPage").then((m) => ({ default: m.NewsFeedPage })));
const NewslettersPage = lazy(() => import("./pages/NewslettersPage").then((m) => ({ default: m.NewslettersPage })));
const ProductionTrackingPage = lazy(() => import("./pages/ProductionTrackingPage").then((m) => ({ default: m.ProductionTrackingPage })));
const SalesByBookPage = lazy(() => import("./pages/SalesByBookPage").then((m) => ({ default: m.SalesByBookPage })));
const CommercialPerformancePage = lazy(() => import("./pages/CommercialPerformancePage").then((m) => ({ default: m.CommercialPerformancePage })));
const CommissionsPage = lazy(() => import("./pages/CommissionsPage").then((m) => ({ default: m.CommissionsPage })));
const AuthorRoyaltiesPage = lazy(() => import("./pages/AuthorRoyaltiesPage").then((m) => ({ default: m.AuthorRoyaltiesPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const AuthorPortal = lazy(() => import("./pages/author/AuthorPortal").then((m) => ({ default: m.AuthorPortal })));
const ReviewerPortal = lazy(() => import("./pages/reviewer/ReviewerPortal").then((m) => ({ default: m.ReviewerPortal })));
const ServiceDeskPage = lazy(() => import("./pages/ServiceDeskPage").then((m) => ({ default: m.ServiceDeskPage })));

// Court message affiché le temps qu'un écran se télécharge (en général une
// fraction de seconde).
function PageLoading() {
  const { t } = useI18n();
  return <div style={{ padding: "40px 24px", color: "var(--muted)", fontSize: 13 }}>{t("common.loading", "Chargement…")}</div>;
}
import { RubricHelp } from "./components/RubricHelp";
import { ContractsDashboard } from "./components/ContractsDashboard";
import { GuidanceNote } from "./components/GuidanceNote";
import { Sidebar, type NavPole } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { AgendaBanner } from "./components/AgendaBanner";
import { PresenceToasts } from "./components/PresenceToasts";
import { MessageBubble } from "./components/MessageBubble";
import { AnnouncementToasts, type ToastItem } from "./components/AnnouncementToasts";
import { usePresence, type AnnouncementPush } from "./hooks/usePresence";
import { playNotificationSound } from "./lib/notificationSound";

// Cible d'un élément de menu : soit une page dédiée, soit une liste de
// manuscrits filtrée sur une étape du workflow (option « liste filtrée »).
type PageId =
  | "dashboard"
  | "payroll-suivi"
  | "annual-events"
  | "weekly-reports"
  | "manuscripts"
  | "reading-committee"
  | "editorial-decision"
  | "correction-editorial"
  | "my-corrections"
  | "my-readings"
  | "my-dossiers"
  | "editorial-quotes-inbox"
  | "catalogue-ref"
  | "archives"
  | "rights-matrix"
  | "stock"
  | "commercial"
  | "catalogue"
  | "marketing-plans"
  | "marketing-partners"
  | "marketing-campaigns"
  | "marketing-dashboard"
  | "finance"
  | "hr"
  | "direction"
  | "reports"
  | "audit"
  | "settings"
  | "users-roles"
  | "communication"
  | "calendar"
  | "newsfeed"
  | "newsletters"
  | "diagnostics"
  | "production-tracking"
  | "sales-by-book"
  | "commercial-performance"
  | "commissions"
  | "author-royalties"
  | "chat"
  | "service-desk";

type LeafView = { page: PageId } | { stage: string; heading: string };

// Menu organisé en 6 pôles (+ accueil à plat). Chaque sous-module est filtré
// par sa permission ; un pôle sans sous-module visible est masqué (Sidebar).
// Les sous-modules « par étape » ouvrent la liste des manuscrits filtrée sur
// le statut de workflow correspondant, d'où la permission manuscripts:consultation.
// Rôles autorisés à ouvrir « Suivi des ouvrages » : direction générale, tout le
// pôle éditorial et tout le pôle production — et eux seuls. Miroir exact de
// Pilotage éditorial confidentiel : sous-modules de coordination du pôle
// (comité de lecture…). Doit correspondre à EDITORIAL_ROLES côté serveur
// (backend/src/routes/editorialDashboards.ts) — `manuscripts:consultation`
// est trop large (catalogue, partagé avec juridique/qualité/production).
const EDITORIAL_PILOTAGE_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL", "DIR_EDITORIAL", "ASSISTANT_EDITORIAL"];

// TRACKING_ROLES côté serveur (backend/src/routes/reference.ts).
const TRACKING_ROLES = [
  "ADMIN_GENERAL",
  "DIR_GENERAL",
  "DIR_EDITORIAL",
  "ASSISTANT_EDITORIAL",
  "MEMBRE_COMITE_LECTURE",
  "CORRECTEUR",
  "MAQUETTISTE",
  "RESP_INFOGRAPHIE",
  "RESP_QUALITE",
  "RESP_IMPRESSION",
];

const NAV_POLES: NavPole[] = [
  {
    label: null,
    items: [
      { key: "dashboard", label: "Tableau de bord" },
      // Suivi des ouvrages : réservé aux pôles éditorial et production et à la
      // direction. Les autres pôles voient l'entrée verrouillée (comme un module
      // hors périmètre) — contrôle confirmé aussi côté serveur (TRACKING_ROLES).
      { key: "suivi", label: "Suivi des ouvrages", anyRole: TRACKING_ROLES },
      { key: "mes-dossiers", label: "Mes dossiers à traiter" },
      { key: "mes-rapports", label: "Mes rapports hebdo" },
    ],
  },
  {
    label: "Éditorial",
    items: [
      { key: "ed-manuscrits", label: "Manuscrits", permission: "manuscripts:consultation" },
      { key: "ed-comite", label: "Comité de lecture", anyRole: EDITORIAL_PILOTAGE_ROLES },
      { key: "ed-mes-lectures", label: "Mes lectures", permission: "comite_lecture:saisie" },
      { key: "ed-mes-corrections", label: "Mes corrections", permission: "tasks:saisie" },
      { key: "ed-direction", label: "Direction éditoriale", anyRole: EDITORIAL_PILOTAGE_ROLES },
      { key: "ed-correction", label: "Correction éditoriale", anyRole: EDITORIAL_PILOTAGE_ROLES },
      { key: "ed-expertise", label: "Expertise scientifique", permission: "tasks:consultation" },
      { key: "ed-reecriture", label: "Réécriture", permission: "tasks:consultation" },
      // Devis (compte d'auteur) transmis par la Finance : l'éditorial les envoie
      // au client et remonte la validation (circuit devis→éditorial→facture).
      { key: "ed-devis-editorial", label: "Devis (compte d'auteur)", anyPermission: ["manuscripts:saisie", "manuscripts:validation"] },
      // Contrats & droits d'auteur : rattachés au pôle Éditorial (décision
      // opérateur du 06/08/2026) — la contractualisation prolonge la relation
      // éditoriale avec l'auteur. Clé interne inchangée (« jf-contrats ») pour
      // préserver le rattachement au stade CONTRACTUALISATION et les droits.
      { key: "jf-contrats", label: "Contrats & droits d'auteur", permission: "manuscripts:consultation" },
      // Messagerie des auteurs : rattachée au pôle Éditorial (décision opérateur) —
      // la relation avec les auteurs est un travail éditorial. La clé reste
      // « cm-messages-auteurs » (identifiant interne inchangé, vue service-desk).
      { key: "cm-messages-auteurs", label: "Messagerie des auteurs", permission: "service_auteurs:consultation" },
      { key: "ed-catalogue-ref", label: "Domaines & collections", permission: "manuscripts:consultation" },
      { key: "ed-archives", label: "Archives", permission: "manuscripts:consultation" },
    ],
  },
  {
    // Chaque module Production dépend du droit du MÉTIER correspondant (et non
    // du droit « manuscrits » générique) : ainsi un rôle qui a besoin de voir les
    // manuscrits pour une autre raison (ex. le juridique, pour les contrats)
    // n'accède pas à la Production. La Direction (générale/éditoriale) reçoit ces
    // droits de supervision dans le seed pour garder la vue complète.
    label: "Production",
    items: [
      { key: "pr-maquette", label: "Maquette", permission: "production:consultation" },
      { key: "pr-infographie", label: "Infographie & couvertures", permission: "production:consultation" },
      { key: "pr-isbn", label: "ISBN & dépôt légal", permission: "isbn:consultation" },
      { key: "pr-bat", label: "BAT Final & contrôle qualité", permission: "bat:consultation" },
      { key: "pr-impression", label: "Impression", permission: "printing:consultation" },
    ],
  },
  {
    // Pôle Marketing, Communication & Distribution (D-031) : distinct du
    // Commercial — il crée la demande (marketing), fait connaître (communication)
    // et diffuse (distribution). Premier module : le Catalogue des ouvrages,
    // alimenté automatiquement par les ouvrages publiés/archivés.
    label: "Marketing, Communication & Distribution",
    items: [
      { key: "md-tableau", label: "Tableau de bord", permission: "marketing:consultation" },
      { key: "md-catalogue", label: "Catalogue des ouvrages", permission: "communication:consultation" },
      { key: "md-fiches", label: "Fiches marketing", permission: "marketing:consultation" },
      { key: "md-campagnes", label: "Campagnes", permission: "marketing:consultation" },
      { key: "md-partenaires", label: "Réseau de partenaires", permission: "marketing:consultation" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { key: "co-ventes", label: "Commercial & ventes", permission: "commercial:consultation" },
      { key: "co-mes-performances", label: "Mes performances", permission: "commercial:consultation" },
      { key: "co-suivi-ventes", label: "Suivi des ventes par ouvrage", permission: "commercial:consultation" },
    ],
  },
  {
    label: "Juridique & Finance",
    items: [
      // « Contrats & droits d'auteur » apparaît AUSSI ici (accès du pôle
      // juridique, décision opérateur du 07/08/2026) tout en restant au pôle
      // Éditorial. Même clé interne (« jf-contrats ») : c'est la même rubrique,
      // affichée à deux endroits — le juridique la retrouve comme auparavant.
      { key: "jf-contrats", label: "Contrats & droits d'auteur", permission: "manuscripts:consultation" },
      { key: "jf-finance", label: "Finance & comptabilité", permission: "finance:consultation" },
      { key: "jf-paie-suivi", label: "Paie — validation (DG) & suivi (DAF)", anyPermission: ["finance:validation", "paie:consultation"] },
      // Stock & magasin rattaché au pôle Finance (décision opérateur 13/08/2026) :
      // la gestion des stocks quitte le Commercial pour la Finance.
      { key: "co-stock", label: "Stock & magasin", permission: "stock:consultation" },
      { key: "co-commissions", label: "Commissions commerciales", anyPermission: ["finance:consultation", "commercial:consultation"] },
      { key: "jf-droits-annuels", label: "États annuels de droits d'auteur", permission: "royalties:consultation" },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "ad-rh", label: "Ressources humaines", permission: "rh:consultation" },
      { key: "ad-users", label: "Utilisateurs & rôles", permission: "users:administration" },
      { key: "ad-rights", label: "Droits & pôles", permission: "users:administration" },
      { key: "ad-parametres", label: "Paramètres", permission: "settings:consultation" },
      { key: "ad-diagnostics", label: "Diagnostics système", role: "ADMIN_GENERAL" },
    ],
  },
  {
    label: "Communication interne",
    items: [
      { key: "cm-messagerie", label: "Messagerie" },
      { key: "cm-actualites", label: "Fil d'actualités", permission: "communication:consultation" },
      { key: "cm-babillard", label: "Babillard d'annonces", permission: "communication:consultation" },
      { key: "cm-evenements", label: "Planning des événements", permission: "communication:consultation" },
      { key: "cm-calendrier", label: "Calendrier partagé", permission: "communication:consultation" },
      { key: "cm-bulletin", label: "Bulletin d'actualités", permission: "communication:consultation" },
    ],
  },
  {
    label: "Pilotage",
    items: [
      { key: "pi-direction", label: "Direction générale", permission: "direction:consultation" },
      { key: "pi-rapports", label: "Rapports & statistiques", permission: "rapports:consultation" },
      { key: "pi-journal", label: "Journal d'activité", permission: "direction:consultation" },
    ],
  },
];

const LEAF_VIEWS: Record<string, LeafView> = {
  dashboard: { page: "dashboard" },
  suivi: { page: "production-tracking" },
  "mes-dossiers": { page: "my-dossiers" },
  "mes-rapports": { page: "weekly-reports" },
  "ed-manuscrits": { page: "manuscripts" },
  "ed-comite": { page: "reading-committee" },
  "ed-mes-lectures": { page: "my-readings" },
  "ed-mes-corrections": { page: "my-corrections" },
  "ed-direction": { page: "editorial-decision" },
  "ed-correction": { page: "correction-editorial" },
  "ed-expertise": { stage: "EXPERTISE", heading: "Expertise scientifique (si nécessaire)" },
  "ed-reecriture": { stage: "REECRITURE", heading: "Réécriture éditoriale (si nécessaire)" },
  "ed-devis-editorial": { page: "editorial-quotes-inbox" },
  "ed-catalogue-ref": { page: "catalogue-ref" },
  "ed-archives": { page: "archives" },
  "pr-maquette": { stage: "MISE_EN_PAGE", heading: "Maquette & mise en page" },
  "pr-infographie": { stage: "INFOGRAPHIE", heading: "Infographie & couvertures" },
  "pr-isbn": { stage: "ATTRIBUTION_REFERENCES", heading: "ISBN & dépôt légal" },
  "pr-bat": { stage: "VALIDATION_BAT", heading: "BAT Final & contrôle qualité" },
  "pr-impression": { stage: "IMPRESSION", heading: "Impression" },
  "md-tableau": { page: "marketing-dashboard" },
  "md-catalogue": { page: "catalogue" },
  "md-fiches": { page: "marketing-plans" },
  "md-campagnes": { page: "marketing-campaigns" },
  "md-partenaires": { page: "marketing-partners" },
  "co-stock": { page: "stock" },
  "co-ventes": { page: "commercial" },
  "co-mes-performances": { page: "commercial-performance" },
  "co-suivi-ventes": { page: "sales-by-book" },
  "co-commissions": { page: "commissions" },
  "jf-contrats": { stage: "CONTRACTUALISATION", heading: "Contrats & droits d'auteur" },
  "jf-finance": { page: "finance" },
  "jf-droits-annuels": { page: "author-royalties" },
  "ad-rh": { page: "hr" },
  "ad-users": { page: "users-roles" },
  "ad-rights": { page: "rights-matrix" },
  "ad-parametres": { page: "settings" },
  "ad-diagnostics": { page: "diagnostics" },
  "cm-messagerie": { page: "chat" },
  "cm-messages-auteurs": { page: "service-desk" },
  "cm-actualites": { page: "newsfeed" },
  "cm-babillard": { page: "communication" },
  "cm-evenements": { page: "annual-events" },
  "cm-calendrier": { page: "calendar" },
  "cm-bulletin": { page: "newsletters" },
  "pi-direction": { page: "direction" },
  "jf-paie-suivi": { page: "payroll-suivi" },
  "pi-rapports": { page: "reports" },
  "pi-journal": { page: "audit" },
};

// Association sous-module (clé de feuille) → pôle (libellé), pour signaler la
// présence au bon endroit. Les éléments à plat (accueil) n'ont pas de pôle.
const LEAF_TO_POLE: Record<string, string> = {};
for (const pole of NAV_POLES) {
  if (pole.label) for (const item of pole.items) LEAF_TO_POLE[item.key] = pole.label;
}

// Libellés des pôles dans l'ordre du menu — base des tuiles de la fenêtre
// « Hall / Présence » (chaque pôle affiché actif/inactif avec son effectif).
const POLE_LABELS: string[] = NAV_POLES.filter((p): p is typeof p & { label: string } => Boolean(p.label)).map((p) => p.label);

// Règle d'accès (permission et/ou rôle) par sous-module. Tous les pôles sont
// visibles dans le menu (structure de la maison), mais ouvrir un module hors de
// son périmètre affiche « Accès non autorisé » — cette table pilote ce contrôle.
const LEAF_ACCESS: Record<string, { permission?: string; anyRole?: string[]; anyPermission?: string[]; role?: string }> = {};
const LEAF_LABEL: Record<string, string> = {};
for (const pole of NAV_POLES) {
  for (const item of pole.items) {
    LEAF_ACCESS[item.key] = { permission: item.permission, anyRole: item.anyRole, anyPermission: item.anyPermission, role: item.role };
    LEAF_LABEL[item.key] = item.label;
  }
}
function isLeafAuthorized(key: string, permissions: Set<string>, roles: Set<string>): boolean {
  const rule = LEAF_ACCESS[key];
  if (!rule) return true;
  if (rule.permission && !permissions.has(rule.permission)) return false;
  if (rule.anyRole && !rule.anyRole.some((r) => roles.has(r))) return false;
  if (rule.anyPermission && !rule.anyPermission.some((p) => permissions.has(p))) return false;
  if (rule.role && !roles.has(rule.role)) return false;
  return true;
}

type View = { kind: "leaf"; key: string } | { kind: "manuscript-detail"; id: string; originKey: string };

// Mémorisation de l'écran courant (localStorage). Sur mobile, minimiser
// l'application puis y revenir recharge souvent la page (le système récupère
// la mémoire) : sans cela, on repartirait toujours du tableau de bord. On
// restitue donc le dernier écran ouvert. Sécurisé : toute valeur invalide ou
// clé de feuille inconnue retombe sur le tableau de bord.
const VIEW_STORAGE_KEY = "eclospace.view";
const DEFAULT_VIEW: View = { kind: "leaf", key: "dashboard" };

function loadStoredView(): View {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const v = JSON.parse(raw) as View;
    if (v && v.kind === "leaf" && typeof v.key === "string" && v.key in LEAF_VIEWS) return v;
    if (v && v.kind === "manuscript-detail" && typeof v.id === "string" && typeof v.originKey === "string") return v;
  } catch {
    /* stockage indisponible ou valeur corrompue : on ignore */
  }
  return DEFAULT_VIEW;
}

export function App() {
  const [user, setUser] = useState<EffectiveUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(loadStoredView);
  const [announcementToOpen, setAnnouncementToOpen] = useState<string | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  // Voyant de non-lus de la messagerie interne (rafraîchi régulièrement et au
  // changement de vue) pour signaler au destinataire un nouveau message.
  const [chatUnread, setChatUnread] = useState(0);
  // Bulle de messagerie flottante « rabattue » par l'utilisateur : masquée
  // jusqu'à l'arrivée d'un nouveau message (le compteur repart à la hausse).
  const [bubbleHidden, setBubbleHidden] = useState(false);
  const prevUnreadRef = useRef(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Compteur incrémenté à chaque nouvelle annonce temps réel : sert de signal
  // à la cloche (TopBar) pour recharger son badge de non-lus.
  const [notifTick, setNotifTick] = useState(0);
  const toastId = useRef(1);
  const [confirmBanner, setConfirmBanner] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  // Barre latérale : en tiroir escamotable sur mobile (piloté par CSS ; l'état
  // ne sert qu'à ouvrir/fermer le tiroir, fermé par défaut).
  const [navOpen, setNavOpen] = useState(false);

  // Préférences de notification (son/visuel/e-mail/catégories) : lues à jour
  // dans une ref pour le gestionnaire temps réel sans le recréer.
  const notifPrefsRef = useRef<NotificationPreferences | null>(null);
  notifPrefsRef.current = notifPrefs;

  // Réception temps réel d'une nouvelle annonce : cloche + sonnerie + pop-up,
  // selon les préférences de l'utilisateur.
  const handleAnnouncementPush = useCallback((a: AnnouncementPush) => {
    const prefs = notifPrefsRef.current;
    // La notification persistée existe toujours : on rafraîchit la cloche.
    setNotifTick((n) => n + 1);
    // Filtrage par catégories choisies (null = toutes).
    const allowed = !prefs?.categories || (a.category != null && prefs.categories.includes(a.category));
    if (!allowed) return;
    if (prefs?.sound_enabled !== false) playNotificationSound(prefs?.sound_volume ?? 70);
    if (prefs?.visual_enabled !== false) {
      const id = toastId.current++;
      setToasts((list) => [...list, { ...a, toastId: id }]);
      window.setTimeout(() => setToasts((list) => list.filter((x) => x.toastId !== id)), 7000);
    }
  }, []);

  // Alerte temps réel générale : une info renvoyée par un autre pôle déclenche
  // son + pop-up + rafraîchissement de la cloche — jamais en sourdine (décision
  // opérateur). Contrairement aux annonces, pas de filtrage par catégories.
  const handleNotificationPush = useCallback((n: AnnouncementPush) => {
    const prefs = notifPrefsRef.current;
    setNotifTick((v) => v + 1);
    if (prefs?.sound_enabled !== false) playNotificationSound(prefs?.sound_volume ?? 70);
    if (prefs?.visual_enabled !== false) {
      const id = toastId.current++;
      setToasts((list) => [...list, { ...n, toastId: id }]);
      window.setTimeout(() => setToasts((list) => list.filter((x) => x.toastId !== id)), 7000);
    }
  }, []);

  const { presence, join, disconnect } = usePresence(Boolean(user), handleAnnouncementPush, handleNotificationPush);
  const { applyLang } = useI18n();

  const refreshUser = () =>
    fetchMe()
      .then((u) => {
        setUser(u);
        // Applique la langue enregistrée sur le profil (sans réécriture serveur).
        if (u.language === "fr" || u.language === "en") applyLang(u.language);
      })
      .catch(() => setUser(null));

  // Déconnexion robuste (Paramètres/en-tête) : on ferme d'abord la socket de
  // présence, on demande au serveur de clore la session (best effort), puis on
  // repasse toujours à l'écran de connexion — même si l'appel échoue (session
  // déjà expirée, réseau, 401/500). Un échec serveur est signalé sans bloquer.
  const handleLogout = async () => {
    disconnect();
    try {
      await logout();
    } catch {
      setConfirmBanner({
        tone: "alert",
        text: "La déconnexion côté serveur n'a pas abouti (session peut-être déjà expirée). Vous avez tout de même été déconnecté de cet appareil.",
      });
    } finally {
      try {
        localStorage.removeItem(VIEW_STORAGE_KEY);
      } catch {
        /* sans effet */
      }
      setView({ kind: "leaf", key: "dashboard" });
      setUser(null);
    }
  };

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  // Charge les préférences de notification à la connexion (et au changement de
  // compte, ex. imitation d'utilisateur).
  useEffect(() => {
    if (!user) {
      setNotifPrefs(null);
      return;
    }
    getNotificationPreferences().then(setNotifPrefs).catch(() => {});
  }, [user?.id]);

  // Voyant de non-lus de la messagerie : rafraîchi à la connexion, à chaque
  // changement de vue (ex. en quittant la messagerie), et toutes les 20 s.
  useEffect(() => {
    if (!user) {
      setChatUnread(0);
      return;
    }
    // On ne sollicite pas le serveur quand l'onglet est en arrière-plan (économie
    // de CPU/batterie sur les machines modestes et les mobiles).
    const refresh = () => { if (document.hidden) return; getChatUnread().then((r) => setChatUnread(r.unread)).catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 20000);
    return () => clearInterval(timer);
  }, [user?.id, view]);

  // Bulle de messagerie : si le nombre de non-lus augmente (nouveau message),
  // on « déplie » la bulle même si l'utilisateur l'avait rabattue.
  useEffect(() => {
    if (chatUnread > prevUnreadRef.current) setBubbleHidden(false);
    prevUnreadRef.current = chatUnread;
  }, [chatUnread]);

  // Bouton « retour » du téléphone / navigateur : navigue vers l'écran
  // PRÉCÉDENT au lieu de fermer l'application. La navigation se fait par état
  // (`view`) et non par URL ; on la synchronise donc avec l'historique du
  // navigateur — chaque ouverture d'écran empile une entrée, « retour » la
  // dépile. `isPopRef` évite de réempiler une entrée lors d'un retour.
  const isPopRef = useRef(false);
  const historySeededRef = useRef(false);
  const lastHistoryViewRef = useRef<View | null>(null);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      isPopRef.current = true;
      const v = (e.state as { eclView?: View } | null)?.eclView;
      const valid =
        v &&
        ((v.kind === "leaf" && typeof v.key === "string" && v.key in LEAF_VIEWS) ||
          (v.kind === "manuscript-detail" && typeof v.id === "string"));
      // Toujours produire un objet NEUF (même pour le repli par défaut) : ainsi le
      // changement d'état déclenche bien l'effet qui consomme le drapeau « retour ».
      setView(valid ? ({ ...(v as View) } as View) : { ...DEFAULT_VIEW });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!user) return;
    // On CONSOMME le drapeau « retour » en tout premier, avant toute sortie
    // anticipée : sinon, si un « retour » aboutit à une vue de même référence
    // (ex. repli sur la vue par défaut), le drapeau resterait coincé à `true` et
    // bloquerait tous les empilements suivants — le bouton « retour » finirait
    // par fermer l'appli après un ou deux écrans seulement.
    const cameFromPop = isPopRef.current;
    isPopRef.current = false;
    // Un simple rafraîchissement du profil (même `view`) ne doit rien empiler :
    // on ne réagit qu'à un VRAI changement d'écran (nouvelle référence `view`).
    if (lastHistoryViewRef.current === view) return;
    lastHistoryViewRef.current = view;
    // Première vue de la session : on remplace l'entrée courante (pas d'empilement).
    if (!historySeededRef.current) {
      historySeededRef.current = true;
      window.history.replaceState({ eclView: view }, "");
      return;
    }
    // Vue issue d'un « retour » : ne pas réempiler (l'entrée existe déjà).
    if (cameFromPop) return;
    // Navigation vers un nouvel écran : on empile une entrée d'historique.
    window.history.pushState({ eclView: view }, "");
  }, [view, user]);

  // Signale le pôle/module courant à chaque changement de vue (présence).
  useEffect(() => {
    if (!user) return;
    const active = view.kind === "manuscript-detail" ? view.originKey : view.key;
    join(LEAF_TO_POLE[active] ?? null, active);
  }, [view, user, join]);

  // Mémorise l'écran courant tant qu'on est connecté, pour y revenir après un
  // rechargement (ex. retour d'arrière-plan sur mobile). Rien n'est mémorisé
  // hors session.
  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
    } catch {
      /* stockage indisponible : sans effet */
    }
  }, [view, user]);

  // Confirmation d'un changement d'identifiant/e-mail via le lien reçu par
  // e-mail (?identifier_token=...). Public : le jeton fait foi.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("identifier_token");
    if (!token) return;
    confirmIdentifierChange(token)
      .then(() => {
        setConfirmBanner({ tone: "ok", text: "Vos identifiants de connexion ont été mis à jour. Utilisez-les à la prochaine connexion." });
        refreshUser();
      })
      .catch((e) => setConfirmBanner({ tone: "alert", text: e instanceof Error ? e.message : "Lien de confirmation invalide ou expiré." }))
      .finally(() => {
        params.delete("identifier_token");
        const q = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : ""));
      });
  }, []);

  // Page publique de signature d'un devis (③), accessible sans compte via le
  // lien reçu par e-mail : /signer-devis/:token. Court-circuite l'application.
  const signMatch = window.location.pathname.match(/^\/signer-devis\/([A-Za-z0-9]+)\/?$/);
  if (signMatch) return <Suspense fallback={<PageLoading />}><QuoteSignPage token={signMatch[1]} /></Suspense>;

  // Page publique d'accusé de réception d'une décision éditoriale (auteur, lien
  // par jeton reçu par e-mail) : /decision-lettre/:token. Court-circuite l'app.
  const decisionLetterMatch = window.location.pathname.match(/^\/decision-lettre\/([A-Za-z0-9]+)\/?$/);
  if (decisionLetterMatch) return <Suspense fallback={<PageLoading />}><DecisionLetterConfirmPage token={decisionLetterMatch[1]} /></Suspense>;

  if (loading) return null;

  const confirmBannerNode = confirmBanner && (
    <div
      style={{
        background: confirmBanner.tone === "alert" ? "var(--alert-soft)" : "var(--eclosion-soft)",
        color: confirmBanner.tone === "alert" ? "var(--alert)" : "var(--eclosion)",
        borderRadius: 6,
        padding: "10px 14px",
        fontSize: 13,
        margin: "12px 24px 0",
      }}
    >
      {confirmBanner.text}
    </div>
  );

  if (!user) {
    return (
      <>
        {confirmBannerNode}
        <Login onAuthenticated={() => refreshUser()} />
      </>
    );
  }

  // Aiguillage : un compte externe reçoit un portail entièrement distinct de
  // l'ERP employé — aucune barre latérale, aucun accès aux modules internes.
  // Un relecteur externe (rôle « membre du comité de lecture ») va dans l'espace
  // relecteur ; sinon c'est un auteur → espace auteur.
  if (user.account_type === "external") {
    const isReviewer = user.roles.includes("MEMBRE_COMITE_LECTURE");
    return (
      <Suspense fallback={<PageLoading />}>
        {isReviewer ? (
          <ReviewerPortal userName={user.username} onLogout={handleLogout} />
        ) : (
          <AuthorPortal userName={user.username} onLogout={handleLogout} />
        )}
      </Suspense>
    );
  }

  const permissions = new Set(user.permissions);
  const roles = new Set(user.roles);
  // Initiation d'une commande à facturer / proforma : ouverte au commercial
  // (saisie/validation) et à la Finance (saisie) — le DG, qui détient
  // commercial:validation, peut donc initier depuis sa propre rubrique.
  const canInitiateOrder =
    permissions.has("commercial:saisie") ||
    permissions.has("commercial:validation") ||
    permissions.has("finance:saisie");
  const activeKey = view.kind === "manuscript-detail" ? view.originKey : view.key;
  const leaf = view.kind === "leaf" ? LEAF_VIEWS[view.key] : undefined;
  // Modèle « tout visible, gardé à l'ouverture » : un module hors périmètre
  // reste dans le menu mais son ouverture affiche « Accès non autorisé ».
  const leafAuthorized = view.kind !== "leaf" || isLeafAuthorized(activeKey, permissions, roles);
  const openManuscript = (id: string) => setView({ kind: "manuscript-detail", id, originKey: activeKey });
  // Ouverture d'une annonce depuis la cloche : bascule sur le Babillard et
  // transmet l'identifiant à ouvrir (si l'utilisateur y a accès).
  const openAnnouncement = (id: string) => {
    if (!permissions.has("communication:consultation")) return;
    setAnnouncementToOpen(id);
    setView({ kind: "leaf", key: "cm-babillard" });
  };

  const selectLeaf = (key: string) => {
    setView({ kind: "leaf", key });
    setNavOpen(false); // referme le tiroir après navigation (mobile)
  };

  const sidebar = (
    <Sidebar
      poles={NAV_POLES}
      permissions={permissions}
      roles={roles}
      activeKey={activeKey}
      onSelect={selectLeaf}
      username={user.username}
      presenceByPole={presence.byPole}
      presenceByModule={presence.byModule}
      chatUnread={chatUnread}
    />
  );

  return (
    <div className="app-shell">
      {/* Notifications discrètes de connexion/déconnexion (sans identités). */}
      <PresenceToasts total={presence.total} />
      {/* Pop-up d'aperçu des nouvelles annonces (temps réel). */}
      <AnnouncementToasts
        toasts={toasts}
        onOpen={(id) => {
          setToasts([]);
          openAnnouncement(id);
        }}
        onDismiss={(tid) => setToasts((list) => list.filter((x) => x.toastId !== tid))}
      />
      {/* Bulle de messagerie flottante (or) : signale les messages internes non
          lus, en plus du point rouge de la barre latérale. Masquée sur la
          messagerie elle-même et une fois rabattue par l'utilisateur. */}
      {chatUnread > 0 && !bubbleHidden && !(view.kind === "leaf" && view.key === "cm-messagerie") && (
        <MessageBubble
          count={chatUnread}
          onOpen={() => {
            setBubbleHidden(true);
            setView({ kind: "leaf", key: "cm-messagerie" });
          }}
          onDismiss={() => setBubbleHidden(true)}
        />
      )}
      {/* Layout responsive piloté par CSS (média-requêtes) : fiable sur un vrai
          téléphone, indépendant du JavaScript. La classe --open ne fait glisser
          le tiroir que sous 900px ; au-dessus, la barre reste fixe en flux. */}
      <div className={"app-sidebar" + (navOpen ? " app-sidebar--open" : "")}>{sidebar}</div>
      <div
        className={"app-backdrop" + (navOpen ? " app-backdrop--show" : "")}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <div className="app-main">
        <TopBar
          connectedTotal={presence.total}
          poles={POLE_LABELS.map((label) => ({ label, count: presence.byPole[label] ?? 0, status: presence.poleStatus[label] ?? null }))}
          canSeePresenceNames={permissions.has("direction:consultation") || roles.has("CHEF_DEPARTEMENT")}
          chatUnread={chatUnread}
          onMenu={() => setNavOpen(true)}
          user={{ username: user.username, email: user.email }}
          onLogout={handleLogout}
          onOpenSettings={() => selectLeaf("ad-parametres")}
          onOpenManuscript={openManuscript}
          onOpenAnnouncement={openAnnouncement}
          onOpenCalendar={() => permissions.has("communication:consultation") && setView({ kind: "leaf", key: "cm-calendrier" })}
          refreshSignal={notifTick}
        />

        <AgendaBanner
          enabled={permissions.has("communication:consultation")}
          onOpenCalendar={() => permissions.has("communication:consultation") && setView({ kind: "leaf", key: "cm-calendrier" })}
        />

        {user.impersonating && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              background: "var(--amber)",
              color: "#fff",
              padding: "8px 24px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span>
              Vous agissez en tant que <strong>{user.username}</strong>
              {user.impersonator ? ` (session ouverte par ${user.impersonator.username})` : ""}.
            </span>
            <button
              onClick={() => stopImpersonation().then(() => window.location.reload())}
              style={{ background: "#fff", color: "var(--amber)", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Revenir à mon compte
            </button>
          </div>
        )}

        {confirmBannerNode}

        {!leafAuthorized && <UnauthorizedView poleLabel={LEAF_TO_POLE[activeKey]} moduleLabel={LEAF_LABEL[activeKey] ?? activeKey} />}

        {leafAuthorized && (
        <Suspense fallback={<PageLoading />}>
        <RubricHelp helpKey={activeKey} />
        {view.kind === "manuscript-detail" && (
          <ManuscriptDetail
            manuscriptId={view.id}
            permissions={permissions}
            originKey={view.originKey}
            onBack={() => setView({ kind: "leaf", key: activeKey })}
          />
        )}

        {leaf && "stage" in leaf && (
          <>
            {leaf.stage === "CONTRACTUALISATION" && permissions.has("contracts:consultation") && (
              <div className="ecl-page" style={{ paddingBottom: 0 }}>
                <ContractsDashboard canRestore={permissions.has("contracts:validation")} />
              </div>
            )}
            <Manuscripts
              key={leaf.stage}
              statusFilter={leaf.stage}
              heading={leaf.heading}
              canCreate={permissions.has("manuscripts:saisie")}
              onOpenManuscript={openManuscript}
              onGoToManuscripts={() => setView({ kind: "leaf", key: "ed-manuscrits" })}
            />
          </>
        )}

        {leaf && "page" in leaf && leaf.page === "dashboard" && (
          <Dashboard
            user={user}
            onOpenAnnouncement={openAnnouncement}
            onOpenCalendar={permissions.has("communication:consultation") ? () => setView({ kind: "leaf", key: "cm-calendrier" }) : undefined}
            onNavigate={(key) => setView({ kind: "leaf", key })}
          />
        )}
        {leaf && "page" in leaf && leaf.page === "manuscripts" && (
          <Manuscripts canCreate={permissions.has("manuscripts:saisie")} canAdminister={permissions.has("manuscripts:administration")} onOpenManuscript={openManuscript} />
        )}
        {leaf && "page" in leaf && leaf.page === "reading-committee" && (
          <ReadingCommittee onOpenManuscript={openManuscript} />
        )}
        {leaf && "page" in leaf && leaf.page === "editorial-decision" && (
          <EditorialDecision onOpenManuscript={openManuscript} />
        )}
        {leaf && "page" in leaf && leaf.page === "correction-editorial" && (
          <CorrectionEditorial onOpenManuscript={openManuscript} />
        )}
        {leaf && "page" in leaf && leaf.page === "my-readings" && <MyReadings />}
        {leaf && "page" in leaf && leaf.page === "my-dossiers" && (
          <MyDossiers onOpenManuscript={openManuscript} canOpen={permissions.has("manuscripts:consultation")} />
        )}
        {leaf && "page" in leaf && leaf.page === "my-corrections" && <MyCorrections />}
        {leaf && "page" in leaf && leaf.page === "editorial-quotes-inbox" && <EditorialQuotesInbox />}
        {leaf && "page" in leaf && leaf.page === "catalogue-ref" && (
          <CatalogueReferencePage canManage={permissions.has("manuscripts:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "archives" && <ArchivesPage onOpenManuscript={openManuscript} />}
        {leaf && "page" in leaf && leaf.page === "rights-matrix" && (
          <RightsMatrixPage canManage={permissions.has("users:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "stock" && (
          <StockPage canManage={permissions.has("stock:saisie")} canAdminister={permissions.has("stock:administration")} canValidate={permissions.has("stock:validation")} />
        )}
        {leaf && "page" in leaf && leaf.page === "commercial" && (
          <CommercialPage canManage={permissions.has("commercial:saisie")} canValidate={permissions.has("commercial:administration")} canInitiateOrder={canInitiateOrder} canSeeTeam={permissions.has("commercial:validation")} />
        )}
        {leaf && "page" in leaf && leaf.page === "catalogue" && (
          <CataloguePage onOpenManuscript={openManuscript} canAdmin={permissions.has("communication:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "marketing-plans" && (
          <MarketingPlansPage canManage={permissions.has("marketing:saisie")} />
        )}
        {leaf && "page" in leaf && leaf.page === "marketing-partners" && (
          <MarketingPartnersPage canManage={permissions.has("marketing:saisie")} />
        )}
        {leaf && "page" in leaf && leaf.page === "marketing-campaigns" && (
          <MarketingCampaignsPage canManage={permissions.has("marketing:saisie")} />
        )}
        {leaf && "page" in leaf && leaf.page === "marketing-dashboard" && <MarketingDashboardPage />}
        {leaf && "page" in leaf && leaf.page === "finance" && (
          <FinancePage canManage={permissions.has("finance:saisie")} canAdminister={permissions.has("finance:administration")} canInitiateOrder={canInitiateOrder} canValidateCancellation={permissions.has("pilotage:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "hr" && (
          <HrPage
            canManage={permissions.has("rh:saisie")}
            canAdminister={permissions.has("rh:administration")}
            canValidateAbsence={permissions.has("rh:validation")}
            canManageUsers={permissions.has("users:administration")}
            canReadConfidential={permissions.has("rh_confidentiel:consultation")}
            canWriteConfidential={permissions.has("rh_confidentiel:saisie")}
            canAdministerPresence={permissions.has("presences:administration")}
            canValidatePresence={permissions.has("presences:validation")}
            canOverseePresence={permissions.has("presences:validation") || permissions.has("direction:consultation") || roles.has("CHEF_DEPARTEMENT")}
            canViewPayroll={permissions.has("paie:consultation")}
            canManagePayroll={permissions.has("paie:administration")}
            canEditPayroll={permissions.has("paie:saisie")}
            canClosePayroll={permissions.has("paie:validation")}
            canValidatePayrollDg={roles.has("DIR_GENERAL") || roles.has("ADMIN_GENERAL")}
            canHandoffDaf={permissions.has("finance:validation")}
          />
        )}
        {leaf && "page" in leaf && leaf.page === "users-roles" && (
          <UsersRolesPage canAdminister={permissions.has("users:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "direction" && <DirectionPage canTreatRecommendations={permissions.has("pilotage:saisie")} canInitiateOrder={canInitiateOrder} canValidateCancellation={permissions.has("pilotage:administration")} canValidatePayrollDg={roles.has("DIR_GENERAL") || roles.has("ADMIN_GENERAL")} onNavigate={(key) => setView({ kind: "leaf", key })} />}
        {leaf && "page" in leaf && leaf.page === "payroll-suivi" && <PayrollSuiviPage canValidatePayrollDg={roles.has("DIR_GENERAL") || roles.has("ADMIN_GENERAL")} canHandoffDaf={permissions.has("finance:validation")} />}
        {leaf && "page" in leaf && leaf.page === "reports" && (
          <ReportsPage canCreateAnalysis={permissions.has("rapports:saisie")} canPromoteAnalysis={permissions.has("rapports:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "weekly-reports" && <WeeklyReportsPage user={user} />}
        {leaf && "page" in leaf && leaf.page === "audit" && <AuditLogPage />}
        {leaf && "page" in leaf && leaf.page === "settings" && (
          <SettingsPage canAdminister={permissions.has("settings:administration")} user={user} />
        )}
        {leaf && "page" in leaf && leaf.page === "communication" && (
          <AnnouncementsPage
            canPublish={permissions.has("communication:saisie")}
            canAdminister={permissions.has("communication:administration")}
            openAnnouncementId={announcementToOpen}
            onOpened={() => setAnnouncementToOpen(null)}
            prefs={notifPrefs}
            onPrefsChange={setNotifPrefs}
          />
        )}
        {leaf && "page" in leaf && leaf.page === "annual-events" && (
          <div className="ecl-page">
            <GuidanceNote title="Planning des événements">
              Le calendrier des temps forts de l'année (salons, sorties, échéances…). Les profils habilités y ajoutent et
              organisent les événements ; chacun les retrouve aussi dans le calendrier partagé.
            </GuidanceNote>
            <AnnualEventsPlanning canManage={permissions.has("rh:administration")} />
          </div>
        )}
        {leaf && "page" in leaf && leaf.page === "calendar" && (
          <CalendarPage canPublish={permissions.has("communication:saisie")} />
        )}
        {leaf && "page" in leaf && leaf.page === "chat" && <ChatPage />}
        {leaf && "page" in leaf && leaf.page === "service-desk" && <ServiceDeskPage canReply={permissions.has("service_auteurs:saisie")} canBrowseWorks={permissions.has("manuscripts:consultation")} onOpenManuscript={openManuscript} />}
        {leaf && "page" in leaf && leaf.page === "newsfeed" && (
          <NewsFeedPage
            onOpenAnnouncement={openAnnouncement}
            onOpenCalendar={permissions.has("communication:consultation") ? () => setView({ kind: "leaf", key: "cm-calendrier" }) : undefined}
          />
        )}
        {leaf && "page" in leaf && leaf.page === "newsletters" && (
          <NewslettersPage canManage={permissions.has("communication:saisie")} />
        )}
        {leaf && "page" in leaf && leaf.page === "diagnostics" && <DiagnosticsPage user={user} />}
        {leaf && "page" in leaf && leaf.page === "production-tracking" && <ProductionTrackingPage />}
        {leaf && "page" in leaf && leaf.page === "sales-by-book" && <SalesByBookPage />}
        {leaf && "page" in leaf && leaf.page === "commercial-performance" && <CommercialPerformancePage canManage={permissions.has("commercial:validation") || permissions.has("commercial:administration")} />}
        {leaf && "page" in leaf && leaf.page === "commissions" && <CommissionsPage canSetRate={permissions.has("finance:administration")} />}
        {leaf && "page" in leaf && leaf.page === "author-royalties" && <AuthorRoyaltiesPage canConfigure={permissions.has("finance:administration")} canGenerate={permissions.has("royalties:validation")} />}
        </Suspense>
        )}
      </div>
    </div>
  );
}

// Écran « Accès non autorisé » : le module est visible dans le menu (structure
// de la maison), mais son ouverture est refusée hors du périmètre de l'employé.
function UnauthorizedView({ poleLabel, moduleLabel }: { poleLabel?: string; moduleLabel: string }) {
  const { t } = useI18n();
  const target = poleLabel ? `${t(`pole.${poleLabel}`, poleLabel)} · ${moduleLabel}` : moduleLabel;
  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)", maxWidth: 620 }}>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderLeft: "4px solid var(--amber)",
          borderRadius: 14,
          padding: "22px 24px",
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <div
          aria-hidden="true"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: "var(--amber-soft)", color: "var(--amber)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <div>
          <h1 style={{ fontFamily: "var(--font-title)", fontSize: 19, margin: "2px 0 6px" }}>
            {t("unauth.title", "Accès non autorisé")}
          </h1>
          <p style={{ margin: "0 0 6px", fontSize: 14, color: "var(--ink)" }}>
            {t("unauth.body", "Ce module ne fait pas partie de votre périmètre :")} <strong>{target}</strong>.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {t("unauth.hint", "Il apparaît dans le menu pour vous montrer l'organisation de la maison. Si vous pensez qu'il devrait vous être accessible, rapprochez-vous de votre administrateur.")}
          </p>
        </div>
      </div>
    </div>
  );
}
