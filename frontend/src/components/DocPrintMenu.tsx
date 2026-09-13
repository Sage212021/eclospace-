import { useRef } from "react";
import type { PrintOpts } from "../lib/print";

// Menu compact d'impression d'un document officiel, avec les trois
// présentations : numérique (logo + mentions), avec le papier à en-tête
// numérique intégré (fond A4 officiel), ou version neutre pour le papier à
// en-tête physique. `<details>` natif : léger, accessible, sans dépendance.
// `extras` : actions supplémentaires propres au document (ex. contrat d'édition :
// « Transférer », « Modifier / enregistrer »), affichées sous les présentations
// d'impression, après un séparateur.
export function DocPrintMenu({ onPrint, label = "Imprimer / PDF", extras, onDownloadPdf }: { onPrint: (opts: PrintOpts) => void; label?: string; extras?: { label: string; onSelect: () => void }[]; onDownloadPdf?: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  const choose = (opts: PrintOpts) => { onPrint(opts); close(); };
  return (
    <details ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <summary style={summaryStyle}>{label} ▾</summary>
      <div style={menuStyle}>
        {/* PDF vectoriel (net sur tout appareil, téléphone compris) : action mise
            en avant, à privilégier — les autres passent par l'impression du
            navigateur (rasterisée sur mobile). */}
        {onDownloadPdf && (
          <button style={{ ...itemStyle, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", background: "var(--paper, #faf8f2)" }} onClick={() => { onDownloadPdf(); close(); }}>
            📄 Télécharger le PDF (net)
          </button>
        )}
        {/* Aperçu plein écran (défilable), sans lancer l'impression — pratique
            sur téléphone pour VOIR le document avant de l'imprimer / l'enregistrer. */}
        <button style={{ ...itemStyle, fontWeight: 600 }} onClick={() => choose({ preview: true })}>👁 Aperçu à l'écran</button>
        <button style={itemStyle} onClick={() => choose({})}>Numérique / PDF (en-tête officiel)</button>
        <button style={itemStyle} onClick={() => choose({ letterhead: true })}>Sur papier à en-tête vierge</button>
        {extras && extras.length > 0 && (
          <div style={{ borderTop: "2px solid var(--line)" }}>
            {extras.map((e) => (
              <button key={e.label} style={{ ...itemStyle, fontWeight: 600, color: "var(--eclosion-dark, #9a7a12)" }} onClick={() => { e.onSelect(); close(); }}>{e.label}</button>
            ))}
          </div>
        )}
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
  boxShadow: "0 8px 24px rgba(11,11,12,.14)",
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
