import { useEffect, useState } from "react";
import { fetchMe, logout, type EffectiveUser } from "./api/client";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Manuscripts } from "./pages/Manuscripts";
import { ManuscriptDetail } from "./pages/ManuscriptDetail";
import { MyReadings } from "./pages/MyReadings";
import { StockPage } from "./pages/StockPage";
import { CommercialPage } from "./pages/CommercialPage";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Tableau de bord" },
  { key: "manuscripts", label: "Manuscrits", permission: "manuscripts:consultation" },
  { key: "my-readings", label: "Mes lectures", permission: "comite_lecture:saisie" },
  { key: "stock", label: "Stock", permission: "stock:consultation" },
  { key: "commercial", label: "Commercial", permission: "commercial:consultation" },
];

type View =
  | { key: "dashboard" }
  | { key: "manuscripts" }
  | { key: "my-readings" }
  | { key: "manuscript-detail"; id: string }
  | { key: "stock" }
  | { key: "commercial" };

export function App() {
  const [user, setUser] = useState<EffectiveUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ key: "dashboard" });

  const refreshUser = () => fetchMe().then(setUser).catch(() => setUser(null));

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  if (!user) {
    return <Login onAuthenticated={() => refreshUser()} />;
  }

  const permissions = new Set(user.permissions);
  const activeKey = view.key === "manuscript-detail" ? "manuscripts" : view.key;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar
        items={NAV_ITEMS}
        permissions={permissions}
        activeKey={activeKey}
        onSelect={(key) => setView({ key } as View)}
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

        {view.key === "dashboard" && <Dashboard user={user} />}
        {view.key === "manuscripts" && (
          <Manuscripts
            canCreate={permissions.has("manuscripts:saisie")}
            onOpenManuscript={(id) => setView({ key: "manuscript-detail", id })}
          />
        )}
        {view.key === "manuscript-detail" && (
          <ManuscriptDetail manuscriptId={view.id} permissions={permissions} onBack={() => setView({ key: "manuscripts" })} />
        )}
        {view.key === "my-readings" && <MyReadings />}
        {view.key === "stock" && <StockPage canManage={permissions.has("stock:saisie")} canAdminister={permissions.has("stock:administration")} />}
        {view.key === "commercial" && (
          <CommercialPage canManage={permissions.has("commercial:saisie")} canValidate={permissions.has("commercial:administration")} />
        )}
      </div>
    </div>
  );
}
