import { useState } from "react";
import { useI18n } from "../i18n";
import {
  IconAdmin,
  IconBook,
  IconCommercial,
  IconFinance,
  IconHome,
  IconPilotage,
  IconPresence,
  IconProduction,
} from "./icons";

// Icône de chaque pôle (par libellé) et des éléments à plat (par clé).
function poleIcon(label: string) {
  switch (label) {
    case "Éditorial":
      return <IconBook />;
    case "Production":
      return <IconProduction />;
    case "Commercial":
      return <IconCommercial />;
    case "Juridique & Finance":
      return <IconFinance />;
    case "Administration":
      return <IconAdmin />;
    case "Pilotage":
      return <IconPilotage />;
    case "Communication interne":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11l18-5v12L3 14v-3z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      );
    default:
      return null;
  }
}
function leafIcon(key: string) {
  if (key === "dashboard") return <IconHome />;
  return null;
}

export interface NavLeaf {
  key: string;
  label: string;
  permission?: string;
  // Restriction « au moins un » de ces rôles (ex. Suivi des ouvrages, réservé
  // aux pôles éditorial et production et à la direction).
  anyRole?: string[];
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
  // Présence temps réel : nombre de personnes actives par pôle et par module
  // (compteurs uniquement — aucune identité, par confidentialité).
  presenceByPole: Record<string, number>;
  presenceByModule: Record<string, number>;
}

// Barre latérale sombre (guide de style §6). Menu en 6 pôles dépliables
// (accordéon) : au chargement tous les pôles sont fermés ; cliquer un pôle
// déroule ses sous-modules et referme les autres (un seul ouvert à la fois),
// avec une transition légère. **Tous les pôles de la maison sont affichés**
// (structure visible par tous) ; les modules hors périmètre portent un cadenas
// et leur ouverture affiche « Accès non autorisé » (contrôle côté App + serveur).
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
  const { t } = useI18n();
  const visiblePoles = poles;
  const isLocked = (item: NavLeaf) =>
    Boolean(
      (item.permission && !permissions.has(item.permission)) ||
        (item.anyRole && !item.anyRole.some((r) => roles.has(r))) ||
        (item.role && !roles.has(item.role)),
    );

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
                  locked={isLocked(item)}
                  presentCount={isLocked(item) ? 0 : presenceByModule[item.key] ?? 0}
                />
              ))}
            </ul>
          );
        }
        const isOpen = openPole === pole.label;
        const containsActive = pole.items.some((i) => i.key === activeKey);
        // Icône dorée quand le pôle est ouvert ou contient la vue active.
        const accent = isOpen || containsActive;
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
                color: accent ? "#fff" : "#a9b0c2",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ color: accent ? "var(--eclosion-light)" : "#8891a8", display: "inline-flex" }}>
                  {poleIcon(pole.label)}
                </span>
                {t(`pole.${pole.label}`, pole.label)}
                <PresenceDot count={presenceByPole[pole.label] ?? 0} />
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
                    locked={isLocked(item)}
                    presentCount={isLocked(item) ? 0 : presenceByModule[item.key] ?? 0}
                  />
                ))}
              </ul>
            </div>
          </div>
        );
      })}

      <div style={{ position: "absolute", bottom: 20, padding: "0 20px", fontSize: 11, color: "#a9b0c2" }}>
        {t("sidebar.connected", "Connecté")} : {username}
      </div>
    </nav>
  );
}

function LeafButton({
  item,
  active,
  onSelect,
  indented,
  locked,
  presentCount,
}: {
  item: NavLeaf;
  active: boolean;
  onSelect: (key: string) => void;
  indented?: boolean;
  locked?: boolean;
  presentCount: number;
}) {
  const { t } = useI18n();
  const icon = leafIcon(item.key);
  return (
    <li>
      <button
        onClick={() => onSelect(item.key)}
        title={locked ? t("nav.locked", "Accès non autorisé — hors de votre périmètre") : undefined}
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
          background: active ? "rgba(216, 178, 76, 0.22)" : "transparent",
          borderLeft: active ? "4px solid var(--eclosion)" : "4px solid transparent",
          borderTop: "none",
          borderRight: "none",
          borderBottom: "none",
          // Module hors périmètre : texte atténué (mais toujours cliquable).
          color: locked ? "#8891a8" : "#fff",
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {icon && (
            <span style={{ color: active ? "var(--eclosion-light)" : "#8891a8", display: "inline-flex" }}>{icon}</span>
          )}
          {t(`nav.${item.key}`, item.label)}
        </span>
        {locked ? <LockIcon /> : <PresenceDot count={presentCount} />}
      </button>
    </li>
  );
}

// Cadenas discret : signale un module visible mais hors du périmètre de l'employé.
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7186" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Voyant de présence : petite silhouette dorée si au moins une personne est
// active ici, avec le nombre s'il y en a plusieurs. Info-bulle volontairement
// générique (nombre seul, jamais de noms) — confidentialité de la présence.
function PresenceDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} personne(s) active(s) ici`}
      style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0, color: "var(--eclosion-light)" }}
    >
      <IconPresence size={13} />
      {count > 1 && (
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--eclosion-light)" }}>{count}</span>
      )}
    </span>
  );
}

const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
