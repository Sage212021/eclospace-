export interface NavItem {
  key: string;
  label: string;
  permission?: string;
}

interface SidebarProps {
  items: NavItem[];
  permissions: Set<string>;
  activeKey: string;
  onSelect: (key: string) => void;
  username: string;
}

// Barre latérale sombre (guide de style §6) : ne montre que les modules
// autorisés par les permissions effectives de l'utilisateur (§1.3 du guide).
export function Sidebar({ items, permissions, activeKey, onSelect, username }: SidebarProps) {
  const visibleItems = items.filter((item) => !item.permission || permissions.has(item.permission));

  return (
    <nav
      style={{
        background: "var(--chrome)",
        color: "#fff",
        width: 220,
        minHeight: "100vh",
        padding: "20px 0",
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "0 20px 20px", fontFamily: "var(--font-title)", fontSize: 18 }}>Eclospace</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {visibleItems.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <li key={item.key}>
              <button
                onClick={() => onSelect(item.key)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 20px",
                  background: isActive ? "var(--chrome-2)" : "transparent",
                  borderLeft: isActive ? "3px solid var(--eclosion)" : "3px solid transparent",
                  border: "none",
                  color: "#fff",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div
        style={{
          position: "absolute",
          bottom: 20,
          padding: "0 20px",
          fontSize: 11,
          color: "#a9b0c2",
        }}
      >
        Connecté : {username}
      </div>
    </nav>
  );
}
