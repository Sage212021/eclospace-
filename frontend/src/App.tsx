import { useEffect, useState } from "react";
import { confirmIdentifierChange, fetchMe, logout, stopImpersonation, type EffectiveUser } from "./api/client";
import { useI18n } from "./i18n";
import { Login } from "./pages/Login";
import { QuoteSignPage } from "./pages/QuoteSignPage";
import { Dashboard } from "./pages/Dashboard";
import { Manuscripts } from "./pages/Manuscripts";
import { CatalogueReferencePage } from "./pages/CatalogueReferencePage";
import { ArchivesPage } from "./pages/ArchivesPage";
import { RightsMatrixPage } from "./pages/RightsMatrixPage";
import { ManuscriptDetail } from "./pages/ManuscriptDetail";
import { MyReadings } from "./pages/MyReadings";
import { StockPage } from "./pages/StockPage";
import { CommercialPage } from "./pages/CommercialPage";
import { FinancePage } from "./pages/FinancePage";
import { HrPage } from "./pages/HrPage";
import { DirectionPage } from "./pages/DirectionPage";
import { ReportsPage } from "./pages/ReportsPage";
import { WeeklyReportsPage } from "./pages/WeeklyReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { UsersRolesPage } from "./pages/UsersRolesPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { Sidebar, type NavPole } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { PresenceToasts } from "./components/PresenceToasts";
import { usePresence } from "./hooks/usePresence";

// Cible d'un élément de menu : soit une page dédiée, soit une liste de
// manuscrits filtrée sur une étape du workflow (option « liste filtrée »).
type PageId =
  | "dashboard"
  | "weekly-reports"
  | "manuscripts"
  | "my-readings"
  | "catalogue-ref"
  | "archives"
  | "rights-matrix"
  | "stock"
  | "commercial"
  | "finance"
  | "hr"
  | "direction"
  | "reports"
  | "audit"
  | "settings"
  | "users-roles"
  | "diagnostics";

type LeafView = { page: PageId } | { stage: string; heading: string };

// Menu organisé en 6 pôles (+ accueil à plat). Chaque sous-module est filtré
// par sa permission ; un pôle sans sous-module visible est masqué (Sidebar).
// Les sous-modules « par étape » ouvrent la liste des manuscrits filtrée sur
// le statut de workflow correspondant, d'où la permission manuscripts:consultation.
const NAV_POLES: NavPole[] = [
  { label: null, items: [{ key: "dashboard", label: "Tableau de bord" }, { key: "mes-rapports", label: "Mes rapports hebdo" }] },
  {
    label: "Éditorial",
    items: [
      { key: "ed-manuscrits", label: "Manuscrits", permission: "manuscripts:consultation" },
      { key: "ed-comite", label: "Comité de lecture", permission: "manuscripts:consultation" },
      { key: "ed-mes-lectures", label: "Mes lectures", permission: "comite_lecture:saisie" },
      { key: "ed-direction", label: "Direction éditoriale", permission: "manuscripts:consultation" },
      { key: "ed-correction", label: "Correction éditoriale", permission: "manuscripts:consultation" },
      { key: "ed-catalogue-ref", label: "Domaines & collections", permission: "manuscripts:consultation" },
      { key: "ed-archives", label: "Archives", permission: "manuscripts:consultation" },
    ],
  },
  {
    label: "Production",
    items: [
      { key: "pr-maquette", label: "Maquette", permission: "manuscripts:consultation" },
      { key: "pr-infographie", label: "Infographie & couvertures", permission: "manuscripts:consultation" },
      { key: "pr-isbn", label: "ISBN & dépôt légal", permission: "manuscripts:consultation" },
      { key: "pr-bat", label: "BAT & contrôle qualité", permission: "manuscripts:consultation" },
      { key: "pr-impression", label: "Impression", permission: "manuscripts:consultation" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { key: "co-stock", label: "Stock & magasin", permission: "stock:consultation" },
      { key: "co-ventes", label: "Commercial & ventes", permission: "commercial:consultation" },
    ],
  },
  {
    label: "Juridique & Finance",
    items: [
      { key: "jf-contrats", label: "Contrats & droits d'auteur", permission: "manuscripts:consultation" },
      { key: "jf-finance", label: "Finance & comptabilité", permission: "finance:consultation" },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "ad-rh", label: "Ressources humaines", permission: "rh:consultation" },
      { key: "ad-users", label: "Utilisateurs & rôles", permission: "users:consultation" },
      { key: "ad-rights", label: "Droits & pôles", permission: "users:administration" },
      { key: "ad-parametres", label: "Paramètres", permission: "settings:consultation" },
      { key: "ad-diagnostics", label: "Diagnostics système", role: "ADMIN_GENERAL" },
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
  "mes-rapports": { page: "weekly-reports" },
  "ed-manuscrits": { page: "manuscripts" },
  "ed-comite": { stage: "COMITE_LECTURE", heading: "Comité de lecture" },
  "ed-mes-lectures": { page: "my-readings" },
  "ed-direction": { stage: "DECISION_EDITORIALE", heading: "Direction éditoriale" },
  "ed-correction": { stage: "CORRECTION", heading: "Correction éditoriale" },
  "ed-catalogue-ref": { page: "catalogue-ref" },
  "ed-archives": { page: "archives" },
  "pr-maquette": { stage: "MISE_EN_PAGE", heading: "Maquette & mise en page" },
  "pr-infographie": { stage: "INFOGRAPHIE", heading: "Infographie & couvertures" },
  "pr-isbn": { stage: "ATTRIBUTION_REFERENCES", heading: "ISBN & dépôt légal" },
  "pr-bat": { stage: "VALIDATION_BAT", heading: "BAT & contrôle qualité" },
  "pr-impression": { stage: "IMPRESSION", heading: "Impression" },
  "co-stock": { page: "stock" },
  "co-ventes": { page: "commercial" },
  "jf-contrats": { stage: "CONTRACTUALISATION", heading: "Contrats & droits d'auteur" },
  "jf-finance": { page: "finance" },
  "ad-rh": { page: "hr" },
  "ad-users": { page: "users-roles" },
  "ad-rights": { page: "rights-matrix" },
  "ad-parametres": { page: "settings" },
  "ad-diagnostics": { page: "diagnostics" },
  "pi-direction": { page: "direction" },
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

type View = { kind: "leaf"; key: string } | { kind: "manuscript-detail"; id: string; originKey: string };

export function App() {
  const [user, setUser] = useState<EffectiveUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "leaf", key: "dashboard" });
  const [confirmBanner, setConfirmBanner] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  // Barre latérale : en tiroir escamotable sur mobile (piloté par CSS ; l'état
  // ne sert qu'à ouvrir/fermer le tiroir, fermé par défaut).
  const [navOpen, setNavOpen] = useState(false);

  const { presence, join, disconnect } = usePresence(Boolean(user));
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
      setView({ kind: "leaf", key: "dashboard" });
      setUser(null);
    }
  };

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  // Signale le pôle/module courant à chaque changement de vue (présence).
  useEffect(() => {
    if (!user) return;
    const active = view.kind === "manuscript-detail" ? view.originKey : view.key;
    join(LEAF_TO_POLE[active] ?? null, active);
  }, [view, user, join]);

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
  if (signMatch) return <QuoteSignPage token={signMatch[1]} />;

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

  const permissions = new Set(user.permissions);
  const roles = new Set(user.roles);
  const activeKey = view.kind === "manuscript-detail" ? view.originKey : view.key;
  const leaf = view.kind === "leaf" ? LEAF_VIEWS[view.key] : undefined;
  const openManuscript = (id: string) => setView({ kind: "manuscript-detail", id, originKey: activeKey });

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
    />
  );

  return (
    <div className="app-shell">
      {/* Notifications discrètes de connexion/déconnexion (sans identités). */}
      <PresenceToasts total={presence.total} />
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
          poles={POLE_LABELS.map((label) => ({ label, count: presence.byPole[label] ?? 0 }))}
          canSeePresenceNames={permissions.has("direction:consultation") || roles.has("CHEF_DEPARTEMENT")}
          onMenu={() => setNavOpen(true)}
          user={{ username: user.username, email: user.email }}
          onLogout={handleLogout}
          onOpenSettings={() => selectLeaf("ad-parametres")}
          onOpenManuscript={openManuscript}
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

        {view.kind === "manuscript-detail" && (
          <ManuscriptDetail
            manuscriptId={view.id}
            permissions={permissions}
            onBack={() => setView({ kind: "leaf", key: activeKey })}
          />
        )}

        {leaf && "stage" in leaf && (
          <Manuscripts
            key={leaf.stage}
            statusFilter={leaf.stage}
            heading={leaf.heading}
            canCreate={permissions.has("manuscripts:saisie")}
            onOpenManuscript={openManuscript}
            onGoToManuscripts={() => setView({ kind: "leaf", key: "ed-manuscrits" })}
          />
        )}

        {leaf && "page" in leaf && leaf.page === "dashboard" && <Dashboard user={user} />}
        {leaf && "page" in leaf && leaf.page === "manuscripts" && (
          <Manuscripts canCreate={permissions.has("manuscripts:saisie")} onOpenManuscript={openManuscript} />
        )}
        {leaf && "page" in leaf && leaf.page === "my-readings" && <MyReadings />}
        {leaf && "page" in leaf && leaf.page === "catalogue-ref" && (
          <CatalogueReferencePage canManage={permissions.has("manuscripts:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "archives" && <ArchivesPage onOpenManuscript={openManuscript} />}
        {leaf && "page" in leaf && leaf.page === "rights-matrix" && (
          <RightsMatrixPage canManage={permissions.has("users:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "stock" && (
          <StockPage canManage={permissions.has("stock:saisie")} canAdminister={permissions.has("stock:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "commercial" && (
          <CommercialPage canManage={permissions.has("commercial:saisie")} canValidate={permissions.has("commercial:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "finance" && (
          <FinancePage canManage={permissions.has("finance:saisie")} canAdminister={permissions.has("finance:administration")} />
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
          />
        )}
        {leaf && "page" in leaf && leaf.page === "users-roles" && (
          <UsersRolesPage canAdminister={permissions.has("users:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "direction" && <DirectionPage canTreatRecommendations={permissions.has("pilotage:saisie")} />}
        {leaf && "page" in leaf && leaf.page === "reports" && (
          <ReportsPage canCreateAnalysis={permissions.has("rapports:saisie")} canPromoteAnalysis={permissions.has("rapports:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "weekly-reports" && <WeeklyReportsPage user={user} />}
        {leaf && "page" in leaf && leaf.page === "audit" && <AuditLogPage />}
        {leaf && "page" in leaf && leaf.page === "settings" && (
          <SettingsPage canAdminister={permissions.has("settings:administration")} user={user} />
        )}
        {leaf && "page" in leaf && leaf.page === "diagnostics" && <DiagnosticsPage user={user} />}
      </div>
    </div>
  );
}
