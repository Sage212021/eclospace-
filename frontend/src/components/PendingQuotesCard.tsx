import { useEffect, useState } from "react";
import { getPendingQuotes, type PendingQuoteRow } from "../api/client";
import { Card } from "./Card";
import { IconFinance } from "./icons";

// Liste Finance « En attente de devis » (reconfiguration Finance) : ouvrages à
// compte d'auteur dont le devis reste à établir. Le financier ouvre la fiche du
// manuscrit pour l'établir dans la section « Devis de prestation ».

const DECISION_LABEL: Record<string, { text: string; color: string }> = {
  pending: { text: "À traiter", color: "var(--muted)" },
  requested: { text: "Demandé par l'éditorial", color: "var(--eclosion-dark, #8A6A12)" },
  deferred: { text: "Reporté", color: "var(--muted)" },
};

export function PendingQuotesCard() {
  const [rows, setRows] = useState<PendingQuoteRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getPendingQuotes()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (loaded && rows.length === 0) return null;

  return (
    <Card title="En attente de devis" icon={<IconFinance />} subtitle="Ouvrages à compte d'auteur dont le devis reste à établir.">
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r) => {
          const d = DECISION_LABEL[r.decision] ?? DECISION_LABEL.pending;
          return (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "9px 13px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{r.reference}</span> · {r.author_name}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {r.has_draft && <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "2px 9px", fontSize: 11 }}>Brouillon en cours</span>}
                <span style={{ color: d.color, fontSize: 12, fontWeight: 700 }}>{d.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
