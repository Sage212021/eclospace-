import { useEffect, useState } from "react";
import { getDuplicateEmployees, deleteEmployee, type DuplicateGroup } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { IconAdmin } from "./icons";
import { useConfirm } from "./ConfirmProvider";

// Doublons détectés : fiches désignant probablement la même personne. Le RH
// choisit PRÉCISÉMENT laquelle garder et supprime l'autre (jamais automatique).

const dateFr = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

export function HrDuplicatesSection({ canDelete, collapsible, defaultOpen }: { canDelete: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const confirm = useConfirm();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => getDuplicateEmployees().then((r) => setGroups(r.groups)).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); }, []);

  async function remove(employeeId: string, name: string, linkedTotal: number) {
    const warn = linkedTotal > 0
      ? `\n\n⚠️ Cette fiche possède ${linkedTotal} donnée(s) liée(s) (bulletins, absences, contrats…). La suppression est LOGIQUE : la fiche disparaît des listes mais les données liées sont conservées (réversible).`
      : "";
    const ok = await confirm({
      title: "Supprimer cette fiche en doublon ?",
      message: `« ${name} » sera retirée des listes.${warn}\n\nVérifiez bien que vous supprimez le DOUBLON et non la fiche principale.`,
      confirmLabel: "Supprimer le doublon",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteEmployee(employeeId);
      setMessage(`Fiche « ${name} » supprimée (doublon).`);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  return (
    <Card title="Doublons détectés" icon={<IconAdmin />} subtitle="Fiches désignant probablement la même personne — à fusionner/nettoyer." collapsible={collapsible} defaultOpen={defaultOpen}>
      {error && <div style={{ fontSize: 13, color: "var(--alert, #C4661F)", marginBottom: 8 }}>{error}</div>}
      {message && <div style={{ fontSize: 13, color: "var(--eclosion-dark, #8A6A12)", marginBottom: 8 }}>{message}</div>}
      {!groups && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Analyse en cours…</div>}
      {groups && groups.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucun doublon détecté. ✅</div>}
      {groups && groups.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{groups.length} groupe(s) de doublons. Choisissez la fiche à conserver (généralement la plus ancienne ou celle avec le plus de données liées) et supprimez l'autre.</div>
          {groups.map((g) => (
            <div key={g.key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{g.key} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {g.records.length} fiches</span></div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 640 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
                      <th style={{ padding: "4px 8px" }}>Matricule</th>
                      <th style={{ padding: "4px 8px" }}>Téléphone</th>
                      <th style={{ padding: "4px 8px" }}>Embauche</th>
                      <th style={{ padding: "4px 8px" }}>Créée le</th>
                      <th style={{ padding: "4px 8px" }}>Données liées</th>
                      <th style={{ padding: "4px 8px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.records.map((r, i) => (
                      <tr key={r.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{r.matricule ?? "—"}</td>
                        <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{r.phone ?? "—"}</td>
                        <td style={{ padding: "5px 8px" }}>{dateFr(r.hire_date)}</td>
                        <td style={{ padding: "5px 8px" }}>{dateFr(r.created_at)}</td>
                        <td style={{ padding: "5px 8px" }}>
                          {r.linked_total === 0 ? <span style={{ color: "var(--muted)" }}>aucune</span> : (
                            <span title={`contrats ${r.linked.contrats} · absences ${r.linked.absences} · bulletins ${r.linked.bulletins} · variables ${r.linked.variables_paie} · évaluations ${r.linked.evaluations} · formations ${r.linked.formations}`}>
                              <strong>{r.linked_total}</strong> {i === 0 ? "" : ""}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>
                          {canDelete && (
                            <Button variant="danger" size="sm" type="button" onClick={() => remove(r.employee_id, `${g.key} (${r.matricule ?? "sans matricule"})`, r.linked_total)}>
                              Supprimer
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
