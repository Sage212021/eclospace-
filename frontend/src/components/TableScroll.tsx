import { useEffect, useRef, useState, type ReactNode } from "react";

// Conteneur de tableau défilable horizontalement au DOIGT sur téléphone.
// Robuste quelle que soit la largeur des parents :
//   • le tableau défile DANS sa propre zone (le corps de page ne bouge pas) ;
//   • largeur bornée à l'écran (width:100% + overflow caché sur l'enveloppe) ;
//   • touch-action:pan-x → le navigateur autorise le glissé horizontal ;
//   • dégradés + chevrons sur les bords, et un rappel « glissez » tant qu'il
//     reste des colonnes masquées.
export function TableScroll({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  function update() {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Recalcule après le rendu / l'arrivée des données (largeurs connues).
    const t1 = setTimeout(update, 60);
    const t2 = setTimeout(update, 400);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  const scrollable = edges.left || edges.right;

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: "100%", overflow: "hidden", ...style }}>
      <div
        ref={ref}
        style={{
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          touchAction: "pan-x",
          WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
        }}
      >
        {children}
      </div>

      {edges.left && (
        <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 22, pointerEvents: "none", background: "linear-gradient(to right, var(--card, #fff), transparent)" }} />
      )}
      {edges.right && (
        <>
          <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 30, pointerEvents: "none", background: "linear-gradient(to left, var(--card, #fff), transparent)" }} />
          <div aria-hidden style={{ position: "absolute", top: "50%", right: 5, transform: "translateY(-50%)", pointerEvents: "none", fontSize: 18, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 800 }}>›</div>
        </>
      )}

      {scrollable && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden>↔</span> Faites glisser le tableau du doigt pour voir toutes les colonnes.
        </div>
      )}
    </div>
  );
}
