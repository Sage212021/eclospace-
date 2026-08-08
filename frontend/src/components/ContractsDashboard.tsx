import { useEffect, useState } from "react";
import { getContractsDashboard, restoreContract, type ContractsDashboard as Dash, type ContractStatus } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Tableau de bord des contrats (refonte CLM, phase 1) : répartition par statut,
// avenants, avances contractuelles, échéances à venir + retards, restauration.
const STATUS_LABELS: Record<ContractStatus, string> = {
  preparation: "En préparation",
  legal_review: "Relecture juridique",
  direction_approval: "Validation direction",
  awaiting_signature: "En attente de signature",
  active: "Actif",
  expired: "Expiré",
  terminated: "Résilié",
};
const STATUS_ORDER: ContractStatus[] = ["preparation", "legal_review", "direction_approval", "awaiting_signature", "active", "expired", "terminated"];
const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;

export function ContractsDashboard({ canRestore }: { canRestore: boolean }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      setData(await getContractsDashboard());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function restore(id: string) {
    if (!window.confirm("Restaurer ce contrat supprimé ?")) return;
    try {
      await restoreContract(id);
      setMessage("Contrat restauré.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restauration impossible.");
    }
  }

  return (
    <Card title="Tableau de bord des contrats" icon={<IconAdmin />} subtitle="Répartition par statut, avances, échéances à venir et alertes." collapsible defaultOpen>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}
      {!data ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Chargement…</p>
      ) : (
        <>
          {/* Compteurs par statut */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
            {STATUS_ORDER.map((s) => {
              const n = data.by_status[s] ?? 0;
              const accent = s === "active" ? "var(--eclosion, #C89A1B)" : s === "expired" ? "var(--alert, #C4661F)" : s === "terminated" ? "var(--danger, #C24B3A)" : "var(--ink)";
              return (
                <div key={s} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--card, #fff)" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 700, color: accent, lineHeight: 1 }}>{n}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{STATUS_LABELS[s]}</div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, fontSize: 13 }}>
            <span>Total : <strong style={{ fontFamily: "var(--font-mono)" }}>{data.total}</strong></span>
            <span>Avec avenant(s) : <strong style={{ fontFamily: "var(--font-mono)" }}>{data.with_amendments}</strong></span>
            <span>Avances contractuelles : <strong style={{ fontFamily: "var(--font-mono)" }}>{fcfa(data.advances_total)}</strong></span>
          </div>

          {/* Échéances à venir + retards */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Échéances (90 jours) &amp; retards</div>
            {data.expiring.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>Aucun contrat actif n'arrive à échéance dans les 90 jours.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                      <th style={{ padding: "4px 8px" }}>Contrat</th>
                      <th style={{ padding: "4px 8px" }}>Ouvrage / Partie</th>
                      <th style={{ padding: "4px 8px" }}>Échéance</th>
                      <th style={{ padding: "4px 8px" }}>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expiring.map((e) => (
                      <tr key={e.id} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)" }}>{e.contract_number}</td>
                        <td style={{ padding: "4px 8px" }}>{e.title ?? "—"} · <span style={{ color: "var(--muted)" }}>{e.partner_name}</span></td>
                        <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)" }}>{e.expiry}</td>
                        <td style={{ padding: "4px 8px" }}>
                          {e.overdue ? (
                            <span style={{ color: "#fff", background: "var(--danger, #C24B3A)", borderRadius: 999, padding: "1px 9px", fontSize: 11.5, fontWeight: 700 }}>Échu depuis {Math.abs(e.days_left)} j</span>
                          ) : (
                            <span style={{ color: "var(--alert, #C4661F)", fontWeight: 600 }}>dans {e.days_left} j</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Contrats supprimés — restaurables */}
          {data.deleted.length > 0 && (
            <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Contrats supprimés ({data.deleted.length})</div>
              {data.deleted.map((d) => (
                <div key={d.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12.5, padding: "3px 0" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{d.contract_number}</span>
                  <span>{d.title ?? "—"}</span>
                  <span style={{ color: "var(--muted)" }}>{d.partner_name}</span>
                  <span style={{ color: "var(--muted)" }}>{d.deleted_at ? new Date(d.deleted_at).toLocaleDateString("fr-FR") : ""}</span>
                  {canRestore && <Button variant="edit" size="sm" type="button" onClick={() => restore(d.id)} style={{ marginLeft: "auto" }}>↩ Restaurer</Button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
