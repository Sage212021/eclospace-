import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

// Bulle de messagerie flottante, façon « tête de discussion » Messenger : petite
// pastille RONDE dorée, discrète, que le destinataire peut DÉPLACER n'importe où
// à l'écran (glisser-déposer). Décision opérateur :
//   • signale les messages internes non lus, en plus du point rouge de la barre ;
//   • au simple clic → ouvre la messagerie (onOpen) ;
//   • la petite croix la « rabat » (masque) — elle réapparaît au message suivant ;
//   • sa position est mémorisée (localStorage) et bornée à l'écran.
const POS_KEY = "eclospace.msgbubble.pos";
const SIZE = 54; // diamètre de la pastille (px)
const MARGIN = 12; // marge minimale avec les bords

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function defaultPos(): { x: number; y: number } {
  // Bas-droite par défaut (comme une tête de discussion).
  const w = typeof window !== "undefined" ? window.innerWidth : 360;
  const h = typeof window !== "undefined" ? window.innerHeight : 640;
  return { x: w - SIZE - MARGIN, y: h - SIZE - MARGIN - 8 };
}

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { x: number; y: number };
      if (typeof p.x === "number" && typeof p.y === "number") {
        return {
          x: clamp(p.x, MARGIN, window.innerWidth - SIZE - MARGIN),
          y: clamp(p.y, MARGIN, window.innerHeight - SIZE - MARGIN),
        };
      }
    }
  } catch {
    /* stockage indisponible : position par défaut */
  }
  return defaultPos();
}

export function MessageBubble({ count, onOpen, onDismiss }: { count: number; onOpen: () => void; onDismiss: () => void }) {
  const { t } = useI18n();
  const [pos, setPos] = useState(loadPos);
  // Distingue un vrai « glisser » d'un simple clic : on n'ouvre la messagerie
  // que si la pastille n'a pas été déplacée de façon significative.
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* sans effet */
    }
  }, [pos]);

  // Reste dans l'écran si la fenêtre est redimensionnée / tournée.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => ({
        x: clamp(p.x, MARGIN, window.innerWidth - SIZE - MARGIN),
        y: clamp(p.y, MARGIN, window.innerHeight - SIZE - MARGIN),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = clamp(e.clientX - d.dx, MARGIN, window.innerWidth - SIZE - MARGIN);
    const ny = clamp(e.clientY - d.dy, MARGIN, window.innerHeight - SIZE - MARGIN);
    if (Math.abs(e.clientX - d.dx - pos.x) > 5 || Math.abs(e.clientY - d.dy - pos.y) > 5) d.moved = true;
    setPos({ x: nx, y: ny });
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) onOpen(); // simple clic (pas de déplacement) → ouvrir
  };

  return (
    <div style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 60, touchAction: "none" }}>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={bubbleStyle}
        aria-label={`${count} ${count > 1 ? t("chat.bubble.plural", "nouveaux messages") : t("chat.bubble.one", "nouveau message")} — ${t("chat.bubble.open", "ouvrir la messagerie")}`}
        title={t("chat.bubble.open", "Ouvrir la messagerie")}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
            fill="#fff"
          />
        </svg>
      </button>
      {count > 0 && <span style={countStyle} className="num">{count > 99 ? "99+" : count}</span>}
      <button type="button" onClick={onDismiss} style={closeStyle} aria-label={t("chat.bubble.hide", "Masquer la bulle")} title={t("chat.bubble.hide", "Masquer")}>
        ×
      </button>
    </div>
  );
}

const bubbleStyle: React.CSSProperties = {
  width: SIZE,
  height: SIZE,
  borderRadius: "50%",
  background: "var(--eclosion)",
  color: "#fff",
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "grab",
  boxShadow: "0 6px 18px rgba(22,35,61,.30)",
  touchAction: "none",
};

// Badge du nombre de non-lus, en haut à droite de la pastille.
const countStyle: React.CSSProperties = {
  position: "absolute",
  top: -4,
  right: -4,
  background: "var(--alert)",
  color: "#fff",
  borderRadius: 999,
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  boxShadow: "0 0 0 2px #fff",
  pointerEvents: "none",
};

// Petite croix « rabattre », discrète, en haut à gauche.
const closeStyle: React.CSSProperties = {
  position: "absolute",
  top: -6,
  left: -6,
  width: 18,
  height: 18,
  lineHeight: "14px",
  borderRadius: "50%",
  background: "var(--card)",
  color: "var(--muted)",
  border: "1px solid var(--line)",
  fontSize: 13,
  cursor: "pointer",
  padding: 0,
  boxShadow: "0 1px 4px rgba(22,35,61,.2)",
};
