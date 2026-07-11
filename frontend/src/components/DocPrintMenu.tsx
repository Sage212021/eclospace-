import { useRef } from "react";
import type { PrintOpts } from "../lib/print";

// Menu compact d'impression d'un document officiel, avec les trois
// présentations : numérique (logo + mentions), avec le papier à en-tête
// numérique intégré (fond A4 officiel), ou version neutre pour le papier à
// en-tête physique. `<details>` natif : léger, accessible, sans dépendance.
export function DocPrintMenu({ onPrint, label = "Imprimer / PDF" }: { onPrint: (opts: PrintOpts) => void; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const choose = (opts: PrintOpts) => {
    onPrint(opts);
    if (ref.current) ref.current.open = false;
  };
  return (
    <details ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <summary style={summaryStyle}>{label} ▾</summary>
      <div style={menuStyle}>
        <button style={itemStyle} onClick={() => choose({ embed: true })}>Numérique / PDF (avec en-tête)</button>
        <button style={itemStyle} onClick={() => choose({ letterhead: true })}>Sur papier à en-tête vierge</button>
        <button style={itemStyle} onClick={() => choose({})}>Version sobre (logo seul)</button>
      </div>
    </details>
  );
}

const summaryStyle: React.CSSProperties = {
  listStyle: "none",
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
  userSelect: "none",
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  marginTop: 4,
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(22,35,61,.14)",
  minWidth: 230,
  overflow: "hidden",
};

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "#fff",
  border: "none",
  borderBottom: "1px solid var(--line)",
  padding: "9px 12px",
  fontSize: 12.5,
  cursor: "pointer",
};
