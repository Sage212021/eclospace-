import { Fragment, useEffect, useState } from "react";
import { TableScroll } from "./TableScroll";
import { getStockConsolidated, type StockConsolidated, type StockConsolidatedRow } from "../api/client";
import { Card } from "./Card";
import { IconCommercial } from "./icons";

// Stock consolidé « toutes zones » (rapport d'inventaire) : stock réel total par
// ouvrage, par compartiment, avec détail par lieu au clic. Les valeurs négatives
// (anomalies de saisie antérieures) sont signalées en rouge et corrigeables via
// « Corriger » (renvoie à l'historique des mouvements de l'ouvrage).
export function StockConsolidatedSection({ collapsible, defaultOpen, canCorrect, onCorrect, onRegularize }: {
  collapsible?: boolean;
  defaultOpen?: boolean;
  canCorrect?: boolean;
  onCorrect?: (isbnId: string, title: string | null) => void;
  onRegularize?: (row: StockConsolidatedRow) => void;
}) {
  const [data, setData] = useState<StockConsolidated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getStockConsolidated()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const num = (n: number) => n.toLocaleString("fr-FR");
  // Couleur d'une valeur : rouge si négative (anomalie), sinon la couleur passée.
  const col = (n: number, normal?: string) => (n < 0 ? "var(--danger, #C24B3A)" : normal);
  const cell = (n: number, normal?: string, weight?: number): React.CSSProperties => ({
    padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: col(n, normal), fontWeight: n < 0 ? 700 : weight,
  });

  const hasNegative = !!data && data.rows.some((r) => r.vendable < 0 || r.declasse < 0 || r.perdu < 0 || r.detruit < 0 || r.total < 0);

  return (
    <Card
      title="Stock réel consolidé (toutes zones)"
      icon={<IconCommercial />}
      subtitle="Total par ouvrage tous lieux confondus, par compartiment (vendable / déclassé / perdu / détruit). Cliquez une ligne pour le détail par zone."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>{error}</div>}
      {hasNegative && (
        <div style={{ background: "var(--alert-soft, #f8e3df)", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>
          ⚠️ Une ou plusieurs lignes sont <b>négatives</b> : plus de sorties que d'entrées ont été enregistrées (saisie antérieure au contrôle). Cliquez <b>« Régulariser »</b> pour ramener le stock à 0 en un mouvement de régularisation d'inventaire. <b>« Corriger »</b> ouvre l'historique de l'ouvrage pour examiner le mouvement en cause.
        </div>
      )}
      {data && data.rows.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun stock enregistré pour le moment.</p>}
      {data && data.rows.length > 0 && (
        <TableScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "5px 8px" }}>Ouvrage</th>
                <th style={{ padding: "5px 8px" }}>Auteur</th>
                <th style={{ padding: "5px 8px" }}>ISBN</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Vendable</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Déclassé</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Perdu</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Détruit</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Total</th>
                {canCorrect && <th style={{ padding: "5px 8px" }}></th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const rowNeg = r.vendable < 0 || r.declasse < 0 || r.perdu < 0 || r.detruit < 0 || r.total < 0;
                return (
                <Fragment key={r.isbn_id}>
                  <tr
                    onClick={() => setOpen(open === r.isbn_id ? null : r.isbn_id)}
                    style={{ borderTop: "1px solid var(--line)", cursor: "pointer", background: open === r.isbn_id ? "var(--eclosion-soft)" : rowNeg ? "var(--alert-soft, #fbeeeb)" : undefined }}
                  >
                    <td style={{ padding: "5px 8px" }}>
                      <span style={{ color: "var(--muted)", marginRight: 6, display: "inline-block", transform: open === r.isbn_id ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
                      {r.title ?? "—"}
                    </td>
                    <td style={{ padding: "5px 8px", color: r.author ? undefined : "var(--muted)" }}>{r.author ?? "—"}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{r.isbn13}</td>
                    <td style={cell(r.vendable)}>{num(r.vendable)}</td>
                    <td style={cell(r.declasse, r.declasse ? "var(--alert, #C4661F)" : undefined)}>{num(r.declasse)}</td>
                    <td style={cell(r.perdu, r.perdu ? "var(--alert, #C4661F)" : "var(--muted)")}>{num(r.perdu)}</td>
                    <td style={cell(r.detruit, r.detruit ? "var(--danger, #C24B3A)" : "var(--muted)")}>{num(r.detruit)}</td>
                    <td style={cell(r.total, undefined, 700)}>{num(r.total)}</td>
                    {canCorrect && (
                      <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                        {rowNeg && onRegularize && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRegularize(r); }}
                            style={{ fontSize: 11.5, cursor: "pointer", border: "1px solid var(--danger, #C24B3A)", color: "#fff", background: "var(--danger, #C24B3A)", borderRadius: 6, padding: "3px 9px", fontWeight: 600, marginRight: 6 }}
                          >
                            Régulariser
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onCorrect?.(r.isbn_id, r.title); }}
                          style={{ fontSize: 11.5, cursor: "pointer", border: `1px solid ${rowNeg ? "var(--danger, #C24B3A)" : "var(--line)"}`, color: rowNeg ? "var(--danger, #C24B3A)" : "var(--eclosion)", background: "transparent", borderRadius: 6, padding: "3px 9px", fontWeight: 600 }}
                        >
                          Corriger
                        </button>
                      </td>
                    )}
                  </tr>
                  {open === r.isbn_id && (
                    <tr style={{ background: "var(--paper, #F8F9FB)", fontSize: 12 }}>
                      <td colSpan={canCorrect ? 9 : 8} style={{ padding: "3px 8px 3px 26px", color: "var(--muted)" }}>
                        Chargé à l'inventaire initial : <b style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{num(r.initial_loaded)}</b>
                        {" · "}stock à date : <b style={{ fontFamily: "var(--font-mono)", color: col(r.total, "var(--text)") }}>{num(r.total)}</b>
                        {r.initial_loaded > 0 && r.total !== r.initial_loaded && (
                          <> {" · "}écart depuis le chargement : <b style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{r.total - r.initial_loaded > 0 ? "+" : ""}{num(r.total - r.initial_loaded)}</b></>
                        )}
                      </td>
                    </tr>
                  )}
                  {open === r.isbn_id &&
                    r.by_location.map((loc) => {
                      const locTotal = loc.vendable + loc.declasse + loc.perdu + loc.detruit;
                      return (
                      <tr key={`${r.isbn_id}-${loc.location_label}`} style={{ background: "var(--paper, #F8F9FB)", fontSize: 12.5 }}>
                        <td style={{ padding: "3px 8px 3px 26px", color: "var(--muted)" }} colSpan={3}>{loc.location_label}</td>
                        <td style={cell(loc.vendable)}>{num(loc.vendable)}</td>
                        <td style={cell(loc.declasse, loc.declasse ? "var(--alert, #C4661F)" : undefined)}>{num(loc.declasse)}</td>
                        <td style={cell(loc.perdu, "var(--muted)")}>{num(loc.perdu)}</td>
                        <td style={cell(loc.detruit, "var(--muted)")}>{num(loc.detruit)}</td>
                        <td style={cell(locTotal)}>{num(locTotal)}</td>
                        {canCorrect && <td></td>}
                      </tr>
                      );
                    })}
                </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                <td style={{ padding: "6px 8px" }} colSpan={3}>Total général</td>
                <td style={cell(data.totals.vendable, undefined, 700)}>{num(data.totals.vendable)}</td>
                <td style={cell(data.totals.declasse, data.totals.declasse ? "var(--alert, #C4661F)" : undefined, 700)}>{num(data.totals.declasse)}</td>
                <td style={cell(data.totals.perdu, data.totals.perdu ? "var(--alert, #C4661F)" : "var(--muted)", 700)}>{num(data.totals.perdu)}</td>
                <td style={cell(data.totals.detruit, data.totals.detruit ? "var(--danger, #C24B3A)" : "var(--muted)", 700)}>{num(data.totals.detruit)}</td>
                <td style={cell(data.totals.total, "var(--eclosion, #d9b21a)", 700)}>{num(data.totals.total)}</td>
                {canCorrect && <td></td>}
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}
