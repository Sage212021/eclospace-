import { useEffect, useState } from "react";
import { getManuscriptFinanceRequests, createFinanceRequest, type ManuscriptFinanceRequest, type FinanceRequestType } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";

// Demandes adressées à la Finance depuis la fiche manuscrit (point 6 du chantier
// « contrat & manuscrit ») : « Demande de devis » et « Demande de facture —
// frais de dépôt ». La Finance les reçoit automatiquement dans sa file.

const TYPE_LABEL: Record<FinanceRequestType, string> = { devis: "Devis", frais_depot: "Facture — frais de dépôt" };
const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  requested: { label: "En attente Finance", bg: "#F7E7DA", fg: "#C4661F" },
  processed: { label: "Traité", bg: "#e6efe4", fg: "#3B7A34" },
  rejected: { label: "Rejeté", bg: "#f8e3df", fg: "var(--danger, #C24B3A)" },
};

export function FinanceRequestCard({ manuscriptId, canRequest }: { manuscriptId: string; canRequest: boolean }) {
  const [rows, setRows] = useState<ManuscriptFinanceRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<FinanceRequestType | null>(null);

  const load = () => getManuscriptFinanceRequests(manuscriptId).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [manuscriptId]);

  async function ask(type: FinanceRequestType) {
    setBusy(type);
    setError(null);
    setMessage(null);
    try {
      await createFinanceRequest(manuscriptId, type);
      setMessage(`Demande de ${type === "devis" ? "devis" : "facture de frais de dépôt"} transmise à la Finance.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demande impossible.");
    } finally {
      setBusy(null);
    }
  }

  const pending = (t: FinanceRequestType) => rows.some((r) => r.type === t && r.status === "requested");

  return (
    <Card title="Demandes à la Finance" subtitle="Devis et facture de frais de dépôt — la Finance les reçoit automatiquement.">
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {canRequest && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: rows.length ? 12 : 0 }}>
          <Button variant="add" size="sm" disabled={busy !== null || pending("devis")} onClick={() => ask("devis")}>
            {pending("devis") ? "Devis déjà demandé" : busy === "devis" ? "Envoi…" : "Demande de devis"}
          </Button>
          <Button variant="add" size="sm" disabled={busy !== null || pending("frais_depot")} onClick={() => ask("frais_depot")}>
            {pending("frais_depot") ? "Frais de dépôt déjà demandés" : busy === "frais_depot" ? "Envoi…" : "Demande facture frais de dépôt"}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune demande émise pour cet ouvrage.</p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {rows.map((r) => {
            const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.requested;
            return (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                <div style={{ fontSize: 13 }}>
                  {TYPE_LABEL[r.type]} · <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{r.requestedAt.slice(0, 10)}</span>
                  {r.resolution ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.resolution}</div> : null}
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "3px 9px", background: s.bg, color: s.fg }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
