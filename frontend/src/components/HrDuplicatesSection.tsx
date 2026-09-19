import { useEffect, useState } from "react";
import { getDuplicateEmployees, deleteEmployee, mergeEmployees, type DuplicateGroup } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { IconAdmin } from "./icons";
import { useConfirm } from "./ConfirmProvider";

// Doublons détectés : fiches désignant probablement la même personne. Le RH
// choisit PRÉCISÉMENT la fiche à CONSERVER, puis :
//  • soit FUSIONNE les autres dedans (toutes leurs données — bulletins du mois,
//    absences, contrats… — passent sur la fiche gardée, et le doublon disparaît
//    des états, y compris du livre de paie) ;
//  • soit se contente de SUPPRIMER un doublon vide (aucune donnée liée).
// Rien n'est jamais automatique : l'opérateur décide.

const dateFr = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

export function HrDuplicatesSection({ canDelete, collapsible, defaultOpen }: { canDelete: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const confirm = useConfirm();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Fiche à conserver, choisie par groupe (clé du groupe → employee_id).
  const [keep, setKeep] = useState<Record<string, string>>({});

  const load = () =>
    getDuplicateEmployees()
      .then((r) => {
        setGroups(r.groups);
        // Défaut : conserver la fiche qui porte le PLUS de données liées (à défaut,
        // la plus ancienne, déjà en tête de liste côté serveur).
        setKeep((prev) => {
          const next = { ...prev };
          for (const g of r.groups) {
            if (!next[g.key] || !g.records.some((rec) => rec.employee_id === next[g.key])) {
              const best = [...g.records].sort((a, b) => b.linked_total - a.linked_total)[0];
              next[g.key] = best.employee_id;
            }
          }
          return next;
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); }, []);

  async function merge(group: DuplicateGroup, loserId: string, loserLabel: string) {
    const keeperId = keep[group.key];
    const keeper = group.records.find((r) => r.employee_id === keeperId);
    if (!keeper) return;
    const ok = await confirm({
      title: "Fusionner ce doublon ?",
      message:
        `Toutes les données de « ${loserLabel} » (bulletins du mois, absences, contrats, primes, pointages…) seront rattachées à la fiche conservée :\n\n` +
        `→ ${keeper.name}${keeper.matricule ? ` (${keeper.matricule})` : ""}\n\n` +
        `Le doublon disparaîtra ensuite des listes ET des états (dont le livre de paie du mois). L'opération est réversible via la corbeille RH.`,
      confirmLabel: "Fusionner dans la fiche conservée",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await mergeEmployees(loserId, keeperId);
      const bulletins = r.moved.bulletins ?? 0;
      const ecartes = r.moved.bulletins_ecartes ?? 0;
      setMessage(
        `Fiche « ${r.loser_name} » fusionnée dans « ${r.keeper_name} ». ` +
          (bulletins > 0 ? `${bulletins} bulletin(s) déplacé(s). ` : "") +
          (ecartes > 0 ? `${ecartes} bulletin(s) en double écarté(s). ` : "") +
          `Le livre de paie ne compte plus ce doublon.`,
      );
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fusion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(employeeId: string, name: string, linkedTotal: number) {
    const warn = linkedTotal > 0
      ? `\n\n⚠️ Cette fiche possède ${linkedTotal} donnée(s) liée(s) (absences, contrats…). Pour REGROUPER ces données sur la fiche conservée, préférez la FUSION. La suppression seule ne les transfère pas.`
      : "";
    const ok = await confirm({
      title: "Supprimer cette fiche en doublon ?",
      message: `« ${name} » sera retirée des listes, et sa paie sera automatiquement retirée des mois encore ouverts (les mois validés/clôturés restent figés).${warn}\n\nVérifiez bien que vous supprimez le DOUBLON et non la fiche principale.`,
      confirmLabel: "Supprimer le doublon",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await deleteEmployee(employeeId);
      const cleaned = r.payroll_months_cleaned ?? [];
      setMessage(
        `Fiche « ${name} » supprimée (doublon).` +
          (cleaned.length > 0 ? ` Paie retirée du/des mois ouvert(s) : ${cleaned.join(", ")}.` : ""),
      );
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Doublons détectés" icon={<IconAdmin />} subtitle="Fiches désignant probablement la même personne — à fusionner/nettoyer." collapsible={collapsible} defaultOpen={defaultOpen}>
      {error && <div style={{ fontSize: 13, color: "var(--alert, #C4661F)", marginBottom: 8 }}>{error}</div>}
      {message && <div style={{ fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", marginBottom: 8 }}>{message}</div>}
      {!groups && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Analyse en cours…</div>}
      {groups && groups.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucun doublon détecté. ✅</div>}
      {groups && groups.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            {groups.length} groupe(s) de doublons. <strong>Cochez la fiche à conserver</strong> (généralement la plus ancienne ou celle avec le plus de données liées), puis <strong>fusionnez</strong> les autres dedans. La fusion regroupe toute l'histoire sur une seule fiche et retire le doublon du livre de paie.
          </div>
          {groups.map((g) => {
            const keeperId = keep[g.key];
            return (
              <div key={g.key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{g.key} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {g.records.length} fiches</span></div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 720 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
                        <th style={{ padding: "4px 8px" }}>Conserver</th>
                        <th style={{ padding: "4px 8px" }}>Matricule</th>
                        <th style={{ padding: "4px 8px" }}>Téléphone</th>
                        <th style={{ padding: "4px 8px" }}>Embauche</th>
                        <th style={{ padding: "4px 8px" }}>Créée le</th>
                        <th style={{ padding: "4px 8px" }}>Données liées</th>
                        <th style={{ padding: "4px 8px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.records.map((r) => {
                        const isKeeper = r.employee_id === keeperId;
                        const label = `${g.key} (${r.matricule ?? "sans matricule"})`;
                        return (
                          <tr key={r.employee_id} style={{ borderTop: "1px solid var(--line)", background: isKeeper ? "var(--eclosion-ivoire, #FAF8F2)" : undefined }}>
                            <td style={{ padding: "5px 8px" }}>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                <input
                                  type="radio"
                                  name={`keep-${g.key}`}
                                  checked={isKeeper}
                                  onChange={() => setKeep((prev) => ({ ...prev, [g.key]: r.employee_id }))}
                                />
                                {isKeeper && <span style={{ fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)" }}>à garder</span>}
                              </label>
                            </td>
                            <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{r.matricule ?? "—"}</td>
                            <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{r.phone ?? "—"}</td>
                            <td style={{ padding: "5px 8px" }}>{dateFr(r.hire_date)}</td>
                            <td style={{ padding: "5px 8px" }}>{dateFr(r.created_at)}</td>
                            <td style={{ padding: "5px 8px" }}>
                              {r.linked_total === 0 ? <span style={{ color: "var(--muted)" }}>aucune</span> : (
                                <span title={`contrats ${r.linked.contrats} · absences ${r.linked.absences} · bulletins ${r.linked.bulletins} · variables ${r.linked.variables_paie} · évaluations ${r.linked.evaluations} · formations ${r.linked.formations}`}>
                                  <strong>{r.linked_total}</strong>
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                              {canDelete && !isKeeper && (
                                <>
                                  <Button variant="add" size="sm" type="button" disabled={busy} onClick={() => merge(g, r.employee_id, label)}>
                                    Fusionner
                                  </Button>{" "}
                                  <Button variant="danger" size="sm" type="button" disabled={busy} onClick={() => remove(r.employee_id, label, r.linked_total)}>
                                    Supprimer
                                  </Button>
                                </>
                              )}
                              {isKeeper && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>fiche conservée</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </Card>
  );
}
