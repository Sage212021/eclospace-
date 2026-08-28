import { useEffect, useState } from "react";
import { getDeletedEmployees, restoreEmployee, type DeletedEmployee } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Corbeille RH : fiches collaborateurs supprimées (logiquement). Permet de vérifier
// ce qui a été retiré et de RESTAURER une fiche supprimée par erreur.
const dateFr = (s: string) => new Date(s).toLocaleString("fr-FR");

export function HrTrashSection({ canRestore, collapsible }: { canRestore: boolean; collapsible?: boolean }) {
  const [rows, setRows] = useState<DeletedEmployee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => getDeletedEmployees().then((r) => setRows(r.deleted)).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); }, []);

  async function restore(id: string, name: string) {
    try {
      await restoreEmployee(id);
      setMessage(`Fiche « ${name} » restaurée.`);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restauration impossible.");
    }
  }

  return (
    <Card title="Corbeille RH — fiches supprimées" icon={<IconAdmin />} subtitle="Restaurez une fiche supprimée par erreur (rien n'est perdu)." collapsible={collapsible} defaultOpen={(rows?.length ?? 0) > 0}>
      {error && <div style={{ fontSize: 13, color: "var(--alert, #C4661F)", marginBottom: 8 }}>{error}</div>}
      {message && <div style={{ fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", marginBottom: 8 }}>{message}</div>}
      {!rows && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</div>}
      {rows && rows.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucune fiche supprimée.</div>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
                <th style={{ padding: "4px 8px" }}>Nom</th>
                <th style={{ padding: "4px 8px" }}>Matricule</th>
                <th style={{ padding: "4px 8px" }}>Département</th>
                <th style={{ padding: "4px 8px" }}>Bulletins</th>
                <th style={{ padding: "4px 8px" }}>Supprimée le</th>
                <th style={{ padding: "4px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 8px", fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{r.matricule ?? "—"}</td>
                  <td style={{ padding: "5px 8px" }}>{r.department ?? "—"}</td>
                  <td style={{ padding: "5px 8px" }}>{r.has_payslips ? "oui" : "—"}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{dateFr(r.deleted_at)}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right" }}>
                    {canRestore && <Button variant="add" size="sm" type="button" onClick={() => restore(r.employee_id, r.name)}>Restaurer</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
