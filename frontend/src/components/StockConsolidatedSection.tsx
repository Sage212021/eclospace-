import { Fragment, useEffect, useState } from "react";
import { getStockConsolidated, type StockConsolidated } from "../api/client";
import { Card } from "./Card";
import { IconCommercial } from "./icons";

// Stock consolidé « toutes zones » (rapport d'inventaire) : stock réel total par
// ouvrage, vendable vs déclassé, avec détail par lieu au clic. Répond au « stock
// réel total » visé par le rapport final de l'opérateur.
export function StockConsolidatedSection({ collapsible, defaultOpen }: { collapsible?: boolean; defaultOpen?: boolean }) {
  const [data, setData] = useState<StockConsolidated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getStockConsolidated()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const num = (n: number) => n.toLocaleString("fr-FR");

  return (
    <Card
      title="Stock réel consolidé (toutes zones)"
      icon={<IconCommercial />}
      subtitle="Total par ouvrage tous lieux confondus (vendable / déclassé). Cliquez une ligne pour le détail par zone."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>{error}</div>}
      {data && data.rows.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun stock enregistré pour le moment.</p>}
      {data && data.rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "5px 8px" }}>Ouvrage</th>
                <th style={{ padding: "5px 8px" }}>ISBN</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Vendable</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Déclassé</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <Fragment key={r.isbn_id}>
                  <tr
                    onClick={() => setOpen(open === r.isbn_id ? null : r.isbn_id)}
                    style={{ borderTop: "1px solid var(--line)", cursor: "pointer", background: open === r.isbn_id ? "var(--eclosion-soft)" : undefined }}
                  >
                    <td style={{ padding: "5px 8px" }}>
                      <span style={{ color: "var(--muted)", marginRight: 6, display: "inline-block", transform: open === r.isbn_id ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
                      {r.title ?? "—"}
                    </td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{r.isbn13}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{num(r.vendable)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: r.declasse ? "var(--alert, #C4661F)" : undefined }}>{num(r.declasse)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{num(r.total)}</td>
                  </tr>
                  {open === r.isbn_id &&
                    r.by_location.map((loc) => (
                      <tr key={`${r.isbn_id}-${loc.location_label}`} style={{ background: "var(--paper, #F8F9FB)", fontSize: 12.5 }}>
                        <td style={{ padding: "3px 8px 3px 26px", color: "var(--muted)" }} colSpan={2}>{loc.location_label}</td>
                        <td style={{ padding: "3px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{num(loc.vendable)}</td>
                        <td style={{ padding: "3px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: loc.declasse ? "var(--alert, #C4661F)" : undefined }}>{num(loc.declasse)}</td>
                        <td style={{ padding: "3px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{num(loc.vendable + loc.declasse)}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                <td style={{ padding: "6px 8px" }} colSpan={2}>Total général</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{num(data.totals.vendable)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: data.totals.declasse ? "var(--alert, #C4661F)" : undefined }}>{num(data.totals.declasse)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--eclosion, #C89A1B)" }}>{num(data.totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
