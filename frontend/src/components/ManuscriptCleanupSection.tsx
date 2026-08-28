import { useEffect, useState } from "react";
import { getCatalogueIncomplete, getPurgeCandidates, purgeManuscripts, type CatalogueIncompleteRow, type PurgeCandidateRow } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Deux outils de nettoyage (réservés à l'administration/DG) :
//  1. Fiches du catalogue à compléter (chemin A) — ouvrages déjà parus dont la
//     fiche manque d'informations ; on les complète sur place (rien n'est effacé).
//  2. Épuration des essais — manuscrits sans empreinte catalogue/financière,
//     archivés (suppression logique réversible) après sélection. Les ouvrages
//     protégés (catalogue, finances) sont affichés mais non cochables.
export function ManuscriptCleanupSection({ canAdminister, onOpenManuscript }: { canAdminister: boolean; onOpenManuscript: (id: string) => void }) {
  const [incomplete, setIncomplete] = useState<CatalogueIncompleteRow[] | null>(null);
  const [candidates, setCandidates] = useState<PurgeCandidateRow[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getCatalogueIncomplete().then(setIncomplete).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
    if (canAdminister) getPurgeCandidates().then(setCandidates).catch(() => {});
  }, [canAdminister]);

  const selectedIds = Object.entries(checked).filter(([, v]) => v).map(([id]) => id);
  const safeCandidates = candidates?.filter((c) => c.safe) ?? [];

  async function purge() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Archiver ${selectedIds.length} essai(s) ?\n\nRéversible : ils sont mis de côté (corbeille), pas détruits. Le catalogue et le financier ne sont pas touchés.`)) return;
    setBusy(true);
    try {
      const r = await purgeManuscripts(selectedIds);
      setMessage(`${r.archived_count} essai(s) archivé(s).${r.skipped.length ? ` ${r.skipped.length} protégé(s) et ignoré(s).` : ""}`);
      setChecked({});
      setCandidates(await getPurgeCandidates());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archivage impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {/* 1. Fiches catalogue à compléter */}
      <Card title="Fiches du catalogue à compléter" icon={<IconAdmin />} subtitle="Ouvrages déjà parus dont la fiche est incomplète. À compléter sur place — rien n'est effacé." collapsible defaultOpen={false}>
        {!incomplete ? (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Chargement…</p>
        ) : incomplete.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Toutes les fiches du catalogue sont complètes. 👍</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                  <th style={{ padding: "5px 8px" }}>Ouvrage</th>
                  <th style={{ padding: "5px 8px" }}>À compléter</th>
                  <th style={{ padding: "5px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {incomplete.map((m) => (
                  <tr key={m.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "5px 8px" }}>{m.title} <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{m.manuscript_number}</span></td>
                    <td style={{ padding: "5px 8px" }}>
                      {m.missing.map((x) => (
                        <span key={x} style={{ display: "inline-block", background: "var(--gold-soft, #f6efdc)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 999, padding: "1px 8px", fontSize: 11.5, marginRight: 4, marginBottom: 2 }}>{x}</span>
                      ))}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}><Button variant="edit" size="sm" type="button" onClick={() => onOpenManuscript(m.id)}>Compléter</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Ouvrez chaque fiche puis « ✎ Modifier la fiche » pour compléter (auteur, ISBN, prix…).</p>
          </div>
        )}
      </Card>

      {/* 2. Épuration des essais (administration) */}
      {canAdminister && (
        <Card title="Épuration des essais" icon={<IconAdmin />} subtitle="Manuscrits d'essai sans empreinte catalogue ni financière. Archivage réversible ; les ouvrages protégés ne sont pas cochables." collapsible defaultOpen={false}>
          {!candidates ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Chargement…</p>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 8, fontSize: 13 }}>
                <span><strong>{safeCandidates.length}</strong> essai(s) sûr(s) à archiver</span>
                <span style={{ color: "var(--muted)" }}>· {candidates.length - safeCandidates.length} protégé(s)</span>
                <Button variant="add" size="sm" type="button" disabled={busy || selectedIds.length === 0} onClick={purge} style={{ marginLeft: "auto" }}>
                  {busy ? "…" : `Archiver ${selectedIds.length || ""} essai(s) sélectionné(s)`}
                </Button>
                {safeCandidates.length > 0 && (
                  <Button variant="view" size="sm" type="button" onClick={() => setChecked(Object.fromEntries(safeCandidates.map((c) => [c.id, true])))}>Tout cocher</Button>
                )}
              </div>
              <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead style={{ position: "sticky", top: 0, background: "var(--card, #fff)" }}>
                    <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                      <th style={{ padding: "5px 8px", width: 28 }}></th>
                      <th style={{ padding: "5px 8px" }}>Ouvrage</th>
                      <th style={{ padding: "5px 8px" }}>Étape</th>
                      <th style={{ padding: "5px 8px" }}>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={c.id} style={{ borderTop: "1px solid var(--line)", opacity: c.safe ? 1 : 0.6 }}>
                        <td style={{ padding: "5px 8px" }}>
                          <input type="checkbox" disabled={!c.safe} checked={!!checked[c.id]} onChange={(e) => setChecked((s) => ({ ...s, [c.id]: e.target.checked }))} />
                        </td>
                        <td style={{ padding: "5px 8px" }}>{c.title} <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{c.manuscript_number}</span></td>
                        <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{c.stage ?? "—"}</td>
                        <td style={{ padding: "5px 8px" }}>
                          {c.safe ? (
                            <span style={{ color: "var(--eclosion-dark, #9a7a12)", fontSize: 12 }}>essai — sûr à archiver</span>
                          ) : (
                            <span style={{ color: "var(--alert, #C4661F)", fontSize: 12 }}>🔒 protégé : {c.blockers.join(", ")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
                « Archiver » = mettre de côté (corbeille), réversible. Les ouvrages au catalogue, avec ISBN, contrat ou données financières sont <strong>protégés</strong> et ne peuvent pas être cochés.
              </p>
            </>
          )}
        </Card>
      )}
    </>
  );
}
