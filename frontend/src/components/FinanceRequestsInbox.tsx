import { useEffect, useState } from "react";
import { getFinanceRequests, resolveFinanceRequest, type FinanceRequestQueueRow, type FinanceRequestType } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { IconFinance } from "./icons";

// File Finance : demandes reçues depuis les fiches manuscrit (point 6 du chantier)
// — « Demande de devis » et « Demande de facture — frais de dépôt ». Le financier
// ouvre l'ouvrage pour établir le document, puis marque la demande traitée.

const TYPE_LABEL: Record<FinanceRequestType, { label: string; bg: string; fg: string }> = {
  devis: { label: "Devis", bg: "var(--eclosion-soft)", fg: "var(--eclosion)" },
  frais_depot: { label: "Frais de dépôt", bg: "#F7E7DA", fg: "#C4661F" },
};

export function FinanceRequestsInbox({ canManage, onOpenManuscript }: { canManage: boolean; onOpenManuscript?: (id: string) => void }) {
  const [rows, setRows] = useState<FinanceRequestQueueRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => getFinanceRequests().then(setRows).catch(() => setRows([])).finally(() => setLoaded(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function resolve(id: string, status: "processed" | "rejected") {
    setError(null);
    try { await resolveFinanceRequest(id, status); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Action impossible."); }
  }

  return (
    <Card title="Demandes reçues (devis / frais de dépôt)" icon={<IconFinance />} subtitle="Demandes émises depuis les fiches manuscrit, à établir puis marquer traitées.">
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {loaded && rows.length === 0 && <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>Aucune demande en attente. Une demande apparaît dès que l'éditorial en émet une depuis une fiche manuscrit.</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r) => {
          const t = TYPE_LABEL[r.type];
          return (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "9px 13px", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>
                  {r.title} <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "2px 8px", background: t.bg, color: t.fg }}>{t.label}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{r.manuscript_number}</span>
                  {r.author ? ` · ${r.author}` : ""}
                  {" · demandé le "}<span style={{ fontFamily: "var(--font-mono)" }}>{r.requested_at.slice(0, 10)}</span>
                  {r.funding_mode === "author" ? " · à compte d'auteur" : ""}
                </div>
                {r.note ? <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{r.note}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {onOpenManuscript && <Button variant="view" size="sm" onClick={() => onOpenManuscript(r.manuscript_id)}>Ouvrir l'ouvrage</Button>}
                {canManage && <Button variant="edit" size="sm" onClick={() => resolve(r.id, "processed")}>Marquer traité</Button>}
                {canManage && <Button variant="danger" size="sm" onClick={() => resolve(r.id, "rejected")}>Rejeter</Button>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
