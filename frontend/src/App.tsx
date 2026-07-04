import { useEffect, useState } from "react";
import { fetchMe, logout, type EffectiveUser } from "./api/client";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

const NAV_ITEMS: NavItem[] = [{ key: "dashboard", label: "Tableau de bord" }];

export function App() {
  const [user, setUser] = useState<EffectiveUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState("dashboard");

  const refreshUser = () => fetchMe().then(setUser).catch(() => setUser(null));

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  if (!user) {
    return <Login onAuthenticated={() => refreshUser()} />;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar
        items={NAV_ITEMS}
        permissions={new Set(user.permissions)}
        activeKey={activeKey}
        onSelect={setActiveKey}
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
        {activeKey === "dashboard" && <Dashboard user={user} />}
      </div>
    </div>
  );
}
