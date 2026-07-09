import { useState } from "react";

export interface NavLeaf {
  key: string;
  label: string;
  permission?: string;
  // Restriction par rôle exact (ex. "ADMIN_GENERAL" pour Diagnostics système).
  role?: string;
}

export interface NavPole {
  // label null => éléments rendus à plat, sans en-tête dépliable (ex. accueil).
  label: string | null;
  items: NavLeaf[];
}

interface SidebarProps {
  poles: NavPole[];
  permissions: Set<string>;
  roles: Set<string>;
  activeKey: string;
  onSelect: (key: string) => void;
  username: string;
  // Présence temps réel : noms d'utilisateurs actifs par pôle et par module.
  presenceByPole: Record<string, string[]>;
  presenceByModule: Record<string, string[]>;
}

// Barre latérale sombre (guide de style §6). Menu en 6 pôles dépliables
// (accordéon) : au chargement tous les pôles sont fermés ; cliquer un pôle
// déroule ses sous-modules et referme les autres (un seul ouvert à la fois),
// avec une transition légère. Ne montre que les modules autorisés (permission
// et, le cas échéant, rôle) ; un pôle sans sous-module visible est masqué.
export function Sidebar({
  poles,
  permissions,
  roles,
  activeKey,
  onSelect,
  username,
  presenceByPole,
  presenceByModule,
}: SidebarProps) {
  const visiblePoles = poles
    .map((pole) => ({
      ...pole,
      items: pole.items.filter(
        (i) => (!i.permission || permissions.has(i.permission)) && (!i.role || roles.has(i.role)),
      ),
    }))
    .filter((pole) => pole.items.length > 0);

  // Un seul pôle ouvert à la fois ; null = tous fermés (état par défaut).
  const [openPole, setOpenPole] = useState<string | null>(null);

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
                <LeafButton
                  key={item.key}
                  item={item}
                  active={item.key === activeKey}
                  onSelect={onSelect}
                  presentUsers={presenceByModule[item.key] ?? []}
                />
              ))}
            </ul>
          );
        }
        const isOpen = openPole === pole.label;
        return (
          <div key={pole.label}>
            <button
              onClick={() => setOpenPole((cur) => (cur === pole.label ? null : (pole.label as string)))}
              aria-expanded={isOpen}
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
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {pole.label}
                <PresenceDot names={presenceByPole[pole.label] ?? []} />
              </span>
              <span
                style={{
                  fontSize: 10,
                  display: "inline-block",
                  transition: "transform 200ms ease",
                  transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                ▸
              </span>
            </button>
            <div
              style={{
                overflow: "hidden",
                maxHeight: isOpen ? pole.items.length * 40 + 8 : 0,
                opacity: isOpen ? 1 : 0,
                transition: "max-height 200ms ease, opacity 200ms ease",
              }}
            >
              <ul style={listStyle}>
                {pole.items.map((item) => (
                  <LeafButton
                    key={item.key}
                    item={item}
                    active={item.key === activeKey}
                    onSelect={onSelect}
                    indented
                    presentUsers={presenceByModule[item.key] ?? []}
                  />
                ))}
              </ul>
            </div>
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
  presentUsers,
}: {
  item: NavLeaf;
  active: boolean;
  onSelect: (key: string) => void;
  indented?: boolean;
  presentUsers: string[];
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(item.key)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          width: "100%",
          textAlign: "left",
          padding: indented ? "8px 20px 8px 30px" : "10px 20px",
          // Sélection : fond or très léger + barre dorée de 4 px + texte blanc
          // renforcé, pour attirer l'œil sans surcharger (identité premium).
          background: active ? "rgba(200, 154, 27, 0.16)" : "transparent",
          borderLeft: active ? "4px solid var(--eclosion)" : "4px solid transparent",
          borderTop: "none",
          borderRight: "none",
          borderBottom: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          cursor: "pointer",
        }}
      >
        <span>{item.label}</span>
        <PresenceDot names={presentUsers} />
      </button>
    </li>
  );
}

// Voyant de présence : point vert si au moins un utilisateur est actif ici,
// badge numérique si plusieurs, info-bulle au survol listant les noms.
function PresenceDot({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span
      title={`Actif : ${names.join(", ")}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "#3fb950", display: "inline-block" }} />
      {names.length > 1 && (
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#3fb950" }}>{names.length}</span>
      )}
    </span>
  );
}

const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
