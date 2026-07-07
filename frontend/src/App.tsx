import { useEffect, useState } from "react";
import { confirmIdentifierChange, fetchMe, logout, type EffectiveUser } from "./api/client";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Manuscripts } from "./pages/Manuscripts";
import { ManuscriptDetail } from "./pages/ManuscriptDetail";
import { MyReadings } from "./pages/MyReadings";
import { StockPage } from "./pages/StockPage";
import { CommercialPage } from "./pages/CommercialPage";
import { FinancePage } from "./pages/FinancePage";
import { HrPage } from "./pages/HrPage";
import { DirectionPage } from "./pages/DirectionPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { UsersRolesPage } from "./pages/UsersRolesPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { Sidebar, type NavPole } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

// Cible d'un élément de menu : soit une page dédiée, soit une liste de
// manuscrits filtrée sur une étape du workflow (option « liste filtrée »).
type PageId =
  | "dashboard"
  | "manuscripts"
  | "my-readings"
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
  { label: null, items: [{ key: "dashboard", label: "Tableau de bord" }] },
  {
    label: "Éditorial",
    items: [
      { key: "ed-manuscrits", label: "Manuscrits", permission: "manuscripts:consultation" },
      { key: "ed-comite", label: "Comité de lecture", permission: "manuscripts:consultation" },
      { key: "ed-mes-lectures", label: "Mes lectures", permission: "comite_lecture:saisie" },
      { key: "ed-direction", label: "Direction éditoriale", permission: "manuscripts:consultation" },
      { key: "ed-correction", label: "Correction éditoriale", permission: "manuscripts:consultation" },
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
  "ed-manuscrits": { page: "manuscripts" },
  "ed-comite": { stage: "COMITE_LECTURE", heading: "Comité de lecture" },
  "ed-mes-lectures": { page: "my-readings" },
  "ed-direction": { stage: "DECISION_EDITORIALE", heading: "Direction éditoriale" },
  "ed-correction": { stage: "CORRECTION", heading: "Correction éditoriale" },
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
  "ad-parametres": { page: "settings" },
  "ad-diagnostics": { page: "diagnostics" },
  "pi-direction": { page: "direction" },
  "pi-rapports": { page: "reports" },
  "pi-journal": { page: "audit" },
};

type View = { kind: "leaf"; key: string } | { kind: "manuscript-detail"; id: string; originKey: string };

export function App() {
  const [user, setUser] = useState<EffectiveUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "leaf", key: "dashboard" });
  const [confirmBanner, setConfirmBanner] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);

  const refreshUser = () => fetchMe().then(setUser).catch(() => setUser(null));

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

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

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar
        poles={NAV_POLES}
        permissions={permissions}
        roles={roles}
        activeKey={activeKey}
        onSelect={(key) => setView({ kind: "leaf", key })}
        username={user.username}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <TopBar />
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 24px" }}>
          <button
            onClick={() => logout().then(() => setUser(null))}
            style={{
              background: "none",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Se déconnecter
          </button>
        </div>

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
          />
        )}
        {leaf && "page" in leaf && leaf.page === "users-roles" && (
          <UsersRolesPage canAdminister={permissions.has("users:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "direction" && <DirectionPage canTreatRecommendations={permissions.has("pilotage:saisie")} />}
        {leaf && "page" in leaf && leaf.page === "reports" && (
          <ReportsPage canCreateAnalysis={permissions.has("rapports:saisie")} canPromoteAnalysis={permissions.has("rapports:administration")} />
        )}
        {leaf && "page" in leaf && leaf.page === "audit" && <AuditLogPage />}
        {leaf && "page" in leaf && leaf.page === "settings" && (
          <SettingsPage canAdminister={permissions.has("settings:administration")} user={user} />
        )}
        {leaf && "page" in leaf && leaf.page === "diagnostics" && <DiagnosticsPage user={user} />}
      </div>
    </div>
  );
}
