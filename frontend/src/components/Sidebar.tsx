import { useState } from "react";

export interface NavLeaf {
  key: string;
  label: string;
  permission?: string;
}

export interface NavPole {
  // label null => éléments rendus à plat, sans en-tête dépliable (ex. accueil).
  label: string | null;
  items: NavLeaf[];
}

interface SidebarProps {
  poles: NavPole[];
  permissions: Set<string>;
  activeKey: string;
  onSelect: (key: string) => void;
  username: string;
}

// Barre latérale sombre (guide de style §6) : menu en 6 pôles dépliables
// (accordéon). Ne montre que les modules autorisés par les permissions
// effectives (§1.3 du guide) ; un pôle sans aucun sous-module visible est masqué.
export function Sidebar({ poles, permissions, activeKey, onSelect, username }: SidebarProps) {
  const visiblePoles = poles
    .map((pole) => ({ ...pole, items: pole.items.filter((i) => !i.permission || permissions.has(i.permission)) }))
    .filter((pole) => pole.items.length > 0);

  // Pôles ouverts par défaut (découvrabilité de tous les modules) ; chacun
  // reste repliable pour désencombrer.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const pole of visiblePoles) {
      if (pole.label) initial[pole.label] = true;
    }
    return initial;
  });

  return (
    <nav
      style={{
        background: "var(--chrome)",
        color: "#fff",
        width: 240,
        minHeight: "100vh",
        padding: "20px 0 64px",
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "0 20px 20px", fontFamily: "var(--font-title)", fontSize: 18 }}>Eclospace</div>

      {visiblePoles.map((pole, idx) => {
        if (!pole.label) {
          return (
            <ul key={`flat-${idx}`} style={listStyle}>
              {pole.items.map((item) => (
                <LeafButton key={item.key} item={item} active={item.key === activeKey} onSelect={onSelect} />
              ))}
            </ul>
          );
        }
        const isOpen = open[pole.label];
        return (
          <div key={pole.label}>
            <button
              onClick={() => setOpen((o) => ({ ...o, [pole.label as string]: !o[pole.label as string] }))}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                padding: "10px 20px",
                background: "transparent",
                border: "none",
                color: "#a9b0c2",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              <span>{pole.label}</span>
              <span style={{ fontSize: 10 }}>{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <ul style={listStyle}>
                {pole.items.map((item) => (
                  <LeafButton key={item.key} item={item} active={item.key === activeKey} onSelect={onSelect} indented />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <div style={{ position: "absolute", bottom: 20, padding: "0 20px", fontSize: 11, color: "#a9b0c2" }}>
        Connecté : {username}
      </div>
    </nav>
  );
}

function LeafButton({
  item,
  active,
  onSelect,
  indented,
}: {
  item: NavLeaf;
  active: boolean;
  onSelect: (key: string) => void;
  indented?: boolean;
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(item.key)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: indented ? "8px 20px 8px 32px" : "10px 20px",
          background: active ? "var(--chrome-2)" : "transparent",
          borderLeft: active ? "3px solid var(--eclosion)" : "3px solid transparent",
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
}

const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
