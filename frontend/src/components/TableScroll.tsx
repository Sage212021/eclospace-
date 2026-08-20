import { useEffect, useRef, useState, type ReactNode } from "react";

// Conteneur de tableau défilable horizontalement, pensé pour le TÉLÉPHONE :
// le tableau reste dans les limites de l'écran (max-width 100 %) et défile à
// l'intérieur de sa propre zone (le corps de page ne défile jamais en largeur).
// Un dégradé + une flèche « → » apparaissent sur le bord quand il reste du
// contenu masqué, pour signaler qu'on peut faire défiler jusqu'à l'extrémité.
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
    // Recalcule après le rendu du contenu (largeurs connues).
    const t = setTimeout(update, 50);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  return (
    <div style={{ position: "relative", maxWidth: "100%", ...style }}>
      <div
        ref={ref}
        style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"] }}
      >
        {children}
      </div>
      {/* Dégradé gauche (contenu masqué à gauche). */}
      {edges.left && (
        <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 24, pointerEvents: "none", background: "linear-gradient(to right, var(--card, #fff), transparent)" }} />
      )}
      {/* Dégradé + flèche à droite : « il y a plus, faites défiler ». */}
      {edges.right && (
        <>
          <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 32, pointerEvents: "none", background: "linear-gradient(to left, var(--card, #fff), transparent)" }} />
          <div aria-hidden style={{ position: "absolute", top: "50%", right: 4, transform: "translateY(-50%)", pointerEvents: "none", fontSize: 16, color: "var(--muted)", fontWeight: 700 }}>›</div>
        </>
      )}
    </div>
  );
}
