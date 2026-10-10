import { useEffect, useMemo, useState } from "react";
import { getCorrectionAnomalies, decideCorrectionAnomaly, integrateCorrectionAnomaly, backfillCorrectionAnomalies, type CorrectionAnomaly, type AnomalySummary } from "../api/client";

// Lot 3 en DEUX temps.
//  • Mode DÉCISION (correcteur) : Accepter / Modifier / Rejeter / À vérifier.
//  • Mode INTÉGRATION (intégrateur) : sur les anomalies acceptées/modifiées, il
//    applique la correction dans le fichier puis coche Intégrée / À revoir /
//    Non applicable. Rien n'est écrasé (l'historique est tracé).
const SEV_COLOR: Record<string, { bg: string; fg: string }> = {
  C1: { bg: "#F6D9D3", fg: "#B23A2E" },
  C2: { bg: "var(--amber-soft, #F6E7D2)", fg: "#B87400" },
  C3: { bg: "var(--eclosion-soft)", fg: "var(--eclosion-dark, #9A7A12)" },
  S: { bg: "#E7EAF0", fg: "#5B6472" },
};
const STATUS_LABEL: Record<string, string> = { a_traiter: "À traiter", acceptee: "Acceptée", modifiee: "Modifiée", rejetee: "Rejetée", a_verifier: "À vérifier" };
const STATUS_COLOR: Record<string, string> = { a_traiter: "var(--muted)", acceptee: "#2F7D4A", modifiee: "#B87400", rejetee: "#B23A2E", a_verifier: "#5B6472" };
const INTEG_LABEL: Record<string, string> = { a_integrer: "À intégrer", integree: "Intégrée", a_revoir: "À revoir", non_applicable: "Non applicable" };
const INTEG_COLOR: Record<string, string> = { a_integrer: "#B87400", integree: "#2F7D4A", a_revoir: "#B23A2E", non_applicable: "#5B6472" };
const WORKTYPE_LABEL: Record<string, string> = { correction_1: "Relecture 1 (BAT1)", correction_2: "Relecture 2 (BAT2)", couverture: "Couverture" };
const FACE_LABEL: Record<string, string> = { "1ere": "1ʳᵉ de couverture", dos: "Dos", "4eme": "4ᵉ de couverture" };

// Source d'une anomalie — pour l'accordéon de sélection (demande opérateur
// 10/10) : Texte BAT1/BAT2 (1re/2e correction) et Couverture BAT1/BAT2.
function anomalySource(a: CorrectionAnomaly): { key: string; label: string; sort: number } {
  if (a.work_type === "correction_1") return { key: "texte_bat1", label: "Texte — BAT1", sort: 1 };
  if (a.work_type === "correction_2") return { key: "texte_bat2", label: "Texte — BAT2", sort: 2 };
  if (a.work_type === "couverture") {
    const pass = a.cover_pass === "BAT2" ? "BAT2" : "BAT1";
    return { key: `couverture_${pass}`, label: `Couverture — ${pass}`, sort: pass === "BAT2" ? 12 : 11 };
  }
  return { key: a.work_type, label: WORKTYPE_LABEL[a.work_type] ?? a.work_type, sort: 99 };
}

export function CorrectionAnomaliesPanel({
  manuscriptId,
  canDecide,
  integrationMode = false,
  canIntegrate = false,
  branchFilter,
}: {
  manuscriptId: string;
  canDecide: boolean;
  integrationMode?: boolean;
  canIntegrate?: boolean;
  // En mode intégration : restreint aux anomalies « texte » (jobs correction)
  // ou « couverture », selon le rôle de l'intégrateur qui regarde l'écran.
  branchFilter?: "texte" | "couverture";
}) {
  const [anomalies, setAnomalies] = useState<CorrectionAnomaly[]>([]);
  const [summary, setSummary] = useState<AnomalySummary | null>(null);
  const [filter, setFilter] = useState<string>(integrationMode ? "a_integrer" : "all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; status: string; text: string; kind: "decision" | "integration" } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const load = () =>
    getCorrectionAnomalies(manuscriptId)
      .then((r) => { setAnomalies(r.anomalies); setSummary(r.summary); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId]);

  // Rattrapage des anomalies manquantes : utile pour les corrections de TEXTE
  // livrées avant le correctif (où l'extraction, placée après la génération du
  // manuscrit corrigé, pouvait être sautée). Idempotent côté serveur.
  async function backfill() {
    setBackfilling(true); setErr(null); setBackfillMsg(null);
    try {
      const r = await backfillCorrectionAnomalies(manuscriptId);
      await load();
      setBackfillMsg(
        r.created > 0
          ? `${r.created} anomalie(s) récupérée(s) sur ${r.repaired} relecture(s).`
          : "Aucune anomalie à récupérer : les relectures terminées ont déjà leurs fiches (ou leur rapport n'en contenait aucune).",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Récupération impossible.");
    } finally { setBackfilling(false); }
  }

  // En mode intégration, on ne travaille que sur les anomalies RETENUES
  // (acceptées/modifiées) — ce sont les seules à appliquer dans le fichier.
  const base = useMemo(() => {
    if (!integrationMode) return anomalies;
    return anomalies.filter((a) => {
      if (a.status !== "acceptee" && a.status !== "modifiee") return false;
      if (branchFilter === "couverture") return a.work_type === "couverture";
      if (branchFilter === "texte") return a.work_type !== "couverture";
      return true;
    });
  }, [anomalies, integrationMode, branchFilter]);
  // Compteurs d'intégration calculés sur la branche affichée (et non globaux).
  const integCounts = useMemo(() => {
    const c = { a_integrer: 0, integree: 0, a_revoir: 0, non_applicable: 0 } as Record<string, number>;
    for (const a of base) if (a.integration_status in c) c[a.integration_status] += 1;
    return c;
  }, [base]);
  const shown = useMemo(() => {
    if (filter === "all") return base;
    return integrationMode ? base.filter((a) => a.integration_status === filter) : base.filter((a) => a.status === filter);
  }, [base, filter, integrationMode]);
  // Regroupement par SOURCE (Texte BAT1/BAT2, Couverture BAT1/BAT2) — chaque
  // groupe est un accordéon que l'on déplie pour traiter ses anomalies.
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; sort: number; list: CorrectionAnomaly[] }>();
    for (const a of shown) {
      const s = anomalySource(a);
      if (!m.has(s.key)) m.set(s.key, { label: s.label, sort: s.sort, list: [] });
      m.get(s.key)!.list.push(a);
    }
    return [...m.entries()].sort((x, y) => x[1].sort - y[1].sort);
  }, [shown]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  async function decide(a: CorrectionAnomaly, status: string, note?: string) {
    setBusyId(a.id); setErr(null);
    try {
      await decideCorrectionAnomaly(a.id, { status, resolution_note: note ?? null });
      setNoteFor(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Décision impossible.");
    } finally { setBusyId(null); }
  }

  async function integrate(a: CorrectionAnomaly, integration_status: string, note?: string) {
    setBusyId(a.id); setErr(null);
    try {
      await integrateCorrectionAnomaly(a.id, { integration_status, note: note ?? null });
      setNoteFor(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Intégration impossible.");
    } finally { setBusyId(null); }
  }

  if (!summary) return null;

  if (integrationMode) {
    if (base.length === 0) {
      return (
        <section style={box}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Corrections à intégrer</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>Aucune correction retenue à intégrer pour l'instant (le correcteur n'a pas encore accepté/modifié d'anomalie{branchFilter === "couverture" ? " de couverture" : ""}).</p>
        </section>
      );
    }
    const restant = integCounts.a_integrer + integCounts.a_revoir;
    const chips: { key: string; label: string; n: number }[] = [
      { key: "a_integrer", label: "À intégrer", n: integCounts.a_integrer },
      { key: "integree", label: "Intégrées", n: integCounts.integree },
      { key: "a_revoir", label: "À revoir", n: integCounts.a_revoir },
      { key: "non_applicable", label: "Non applicable", n: integCounts.non_applicable },
      { key: "all", label: "Toutes", n: base.length },
    ];
    return (
      <section style={box}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Corrections à intégrer — {integCounts.integree}/{base.length} faites{restant > 0 ? ` · ${restant} restante(s)` : " ✅"}</div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
          Appliquez chaque correction retenue dans le fichier, puis cochez-la. « À revoir » la renvoie au correcteur ; « Non applicable » l'écarte (motif requis). La version finale ne peut être déposée qu'une fois tout intégré.
        </p>
        {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => setFilter(c.key)}
              style={{ background: filter === c.key ? "var(--eclosion)" : "#fff", color: filter === c.key ? "#0B0B0C" : "var(--ink)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {c.label} · {c.n}
            </button>
          ))}
        </div>
        {groups.map(([key, g]) => {
          const list = g.list;
          const open = !collapsed[key];
          return (
          <div key={key} style={{ marginBottom: 12, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <button type="button" onClick={() => toggleGroup(key)} aria-expanded={open}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "var(--ivory, #FAF8F2)", border: "none", borderBottom: open ? "1px solid var(--line)" : "none", padding: "8px 12px", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--ink)" }}>
              <span aria-hidden>{open ? "▾" : "▸"}</span>
              <span>{g.label}</span>
              <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--muted)" }}>{list.length} · {new Date(list[0].job_launched_at).toLocaleDateString("fr-FR")}</span>
            </button>
            {open && (
            <div style={{ display: "grid", gap: 8, padding: 10 }}>
              {list.map((a) => {
                const sev = SEV_COLOR[a.severity] ?? SEV_COLOR.C3;
                const retenue = a.status === "modifiee" && a.resolution_note ? a.resolution_note : a.proposal;
                return (
                  <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ background: sev.bg, color: sev.fg, borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 700 }}>{a.severity}</span>
                      {a.face && <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9A7A12)", borderRadius: 999, padding: "1px 9px", fontSize: 11 }}>{FACE_LABEL[a.face] ?? a.face}</span>}
                      {a.location && <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{a.location}</span>}
                      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: INTEG_COLOR[a.integration_status] }}>{INTEG_LABEL[a.integration_status] ?? a.integration_status}</span>
                    </div>
                    {a.element && <div style={{ fontSize: 12.5, margin: "2px 0" }}><span style={{ color: "var(--muted)" }}>Texte : </span>« {a.element} »</div>}
                    <div style={{ fontSize: 12.5, margin: "2px 0" }}><span style={{ color: "var(--muted)" }}>Correction à appliquer : </span><strong>{retenue ?? "—"}</strong></div>
                    {a.integration_note && <div style={{ fontSize: 11.5, color: "var(--ink)", margin: "4px 0 0", fontStyle: "italic" }}>Note : {a.integration_note}{a.integrated_by_name ? ` — ${a.integrated_by_name}` : ""}</div>}
                    {canIntegrate && (
                      noteFor?.id === a.id && noteFor.kind === "integration" ? (
                        <div style={{ marginTop: 8 }}>
                          <textarea value={noteFor.text} onChange={(e) => setNoteFor({ ...noteFor, text: e.target.value })}
                            placeholder={noteFor.status === "non_applicable" ? "Motif : pourquoi cette correction n'est pas applicable…" : "Précision pour le correcteur…"}
                            style={{ width: "100%", minHeight: 48, fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, boxSizing: "border-box" }} />
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button type="button" disabled={busyId === a.id} onClick={() => integrate(a, noteFor.status, noteFor.text.trim() || undefined)} style={btnPrimary}>Enregistrer</button>
                            <button type="button" onClick={() => setNoteFor(null)} style={btnGhost}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                          <button type="button" disabled={busyId === a.id} onClick={() => integrate(a, "integree")} style={btn("#2F7D4A")}>✔️ Intégrée</button>
                          <button type="button" disabled={busyId === a.id} onClick={() => setNoteFor({ id: a.id, status: "a_revoir", text: a.integration_note ?? "", kind: "integration" })} style={btn("#B23A2E")}>↩️ À revoir</button>
                          <button type="button" disabled={busyId === a.id} onClick={() => setNoteFor({ id: a.id, status: "non_applicable", text: a.integration_note ?? "", kind: "integration" })} style={btn("#5B6472")}>🚫 Non applicable</button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
          );
        })}
      </section>
    );
  }

  // — Mode DÉCISION (correcteur) —
  if (summary.total === 0) {
    return (
      <section style={box}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Anomalies à traiter</div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 10px" }}>Aucune anomalie enregistrée pour l'instant. Lancez une relecture IA ci-dessus : ses anomalies s'afficheront ici, à valider une par une.</p>
        {canDecide && (
          <>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px" }}>
              Une correction de texte déjà terminée n'affiche aucune anomalie ? Récupérez-les depuis son rapport :
            </p>
            <button type="button" onClick={backfill} disabled={backfilling} style={{ ...btnGhost, color: "var(--eclosion-dark, #9A7A12)", borderColor: "var(--eclosion, #D9B21A)", fontWeight: 700 }}>
              {backfilling ? "Récupération en cours…" : "🔧 Récupérer les anomalies du rapport"}
            </button>
            {backfillMsg && <div style={{ fontSize: 12, color: "var(--ink)", marginTop: 6 }}>{backfillMsg}</div>}
            {err && <div style={{ fontSize: 12.5, color: "var(--alert, #B23A2E)", marginTop: 6 }}>{err}</div>}
          </>
        )}
      </section>
    );
  }
  const chips: { key: string; label: string; n: number }[] = [
    { key: "all", label: "Toutes", n: summary.total },
    { key: "a_traiter", label: "À traiter", n: summary.a_traiter },
    { key: "acceptee", label: "Acceptées", n: summary.acceptee },
    { key: "modifiee", label: "Modifiées", n: summary.modifiee },
    { key: "rejetee", label: "Rejetées", n: summary.rejetee },
    { key: "a_verifier", label: "À vérifier", n: summary.a_verifier },
  ];

  return (
    <section style={box}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Anomalies à traiter ({summary.total})</div>
        {canDecide && (
          <button type="button" onClick={backfill} disabled={backfilling} title="Récupère les anomalies manquantes des relectures terminées (corrections livrées sans anomalies)"
            style={{ ...btnGhost, marginLeft: "auto", color: "var(--eclosion-dark, #9A7A12)", borderColor: "var(--eclosion, #D9B21A)", fontWeight: 700 }}>
            {backfilling ? "Récupération…" : "🔧 Récupérer les anomalies manquantes"}
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
        Chaque anomalie relevée par l'assistance IA se valide une par une. « Accepter » enregistre la décision ; l'intégrateur
        applique ensuite la correction dans le fichier. Sévérité : C1 bloquant · C2 important · C3 mineur · S suggestion.
        Les anomalies sont regroupées par source — <strong>Texte BAT1/BAT2</strong> et <strong>Couverture BAT1/BAT2</strong> : cliquez un bandeau pour déplier/replier et traiter ce groupe.
      </p>
      {backfillMsg && <div style={{ fontSize: 12, color: "var(--ink)", marginBottom: 8 }}>{backfillMsg}</div>}
      {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => setFilter(c.key)}
            style={{ background: filter === c.key ? "var(--eclosion)" : "#fff", color: filter === c.key ? "#0B0B0C" : "var(--ink)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {c.label} · {c.n}
          </button>
        ))}
      </div>

      {groups.map(([key, g]) => {
        const list = g.list;
        const open = !collapsed[key];
        return (
        <div key={key} style={{ marginBottom: 12, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          <button type="button" onClick={() => toggleGroup(key)} aria-expanded={open}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "var(--ivory, #FAF8F2)", border: "none", borderBottom: open ? "1px solid var(--line)" : "none", padding: "8px 12px", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--ink)" }}>
            <span aria-hidden>{open ? "▾" : "▸"}</span>
            <span>{g.label}</span>
            <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--muted)" }}>{list.length} · {new Date(list[0].job_launched_at).toLocaleDateString("fr-FR")}</span>
          </button>
          {open && (
          <div style={{ display: "grid", gap: 8, padding: 10 }}>
            {list.map((a) => {
              const sev = SEV_COLOR[a.severity] ?? SEV_COLOR.C3;
              return (
                <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ background: sev.bg, color: sev.fg, borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 700 }}>{a.severity}</span>
                    {a.face && <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9A7A12)", borderRadius: 999, padding: "1px 9px", fontSize: 11 }}>{FACE_LABEL[a.face] ?? a.face}</span>}
                    {a.location && <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{a.location}</span>}
                    <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status] ?? a.status}</span>
                  </div>
                  {a.element && <div style={{ fontSize: 12.5, margin: "2px 0" }}><span style={{ color: "var(--muted)" }}>Texte : </span>« {a.element} »</div>}
                  {a.observation && <div style={{ fontSize: 12.5, margin: "2px 0" }}><span style={{ color: "var(--muted)" }}>Constat : </span>{a.observation}</div>}
                  {a.proposal && <div style={{ fontSize: 12.5, margin: "2px 0" }}><span style={{ color: "var(--muted)" }}>Correction : </span><strong>{a.proposal}</strong></div>}
                  {a.justification && <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "2px 0" }}>{a.justification}</div>}
                  {a.resolution_note && <div style={{ fontSize: 11.5, color: "var(--ink)", margin: "4px 0 0", fontStyle: "italic" }}>Note : {a.resolution_note}{a.decided_by_name ? ` — ${a.decided_by_name}` : ""}</div>}

                  {canDecide && (
                    noteFor?.id === a.id && noteFor.kind === "decision" ? (
                      <div style={{ marginTop: 8 }}>
                        <textarea value={noteFor.text} onChange={(e) => setNoteFor({ ...noteFor, text: e.target.value })}
                          placeholder={noteFor.status === "modifiee" ? "Correction retenue (à la place de la proposition)…" : "Motif du rejet / précision…"}
                          style={{ width: "100%", minHeight: 48, fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, boxSizing: "border-box" }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button type="button" disabled={busyId === a.id} onClick={() => decide(a, noteFor.status, noteFor.text.trim() || undefined)} style={btnPrimary}>Enregistrer</button>
                          <button type="button" onClick={() => setNoteFor(null)} style={btnGhost}>Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        <button type="button" disabled={busyId === a.id} onClick={() => decide(a, "acceptee")} style={btn("#2F7D4A")}>✅ Accepter</button>
                        <button type="button" disabled={busyId === a.id} onClick={() => setNoteFor({ id: a.id, status: "modifiee", text: a.resolution_note ?? "", kind: "decision" })} style={btn("#B87400")}>✏️ Modifier</button>
                        <button type="button" disabled={busyId === a.id} onClick={() => setNoteFor({ id: a.id, status: "rejetee", text: a.resolution_note ?? "", kind: "decision" })} style={btn("#B23A2E")}>❌ Rejeter</button>
                        <button type="button" disabled={busyId === a.id} onClick={() => decide(a, "a_verifier")} style={btn("#5B6472")}>🔎 À vérifier</button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
          )}
        </div>
        );
      })}
    </section>
  );
}

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper, #FAF8F2)", padding: 14, marginTop: 12 };
const btnPrimary: React.CSSProperties = { background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" };
function btn(color: string): React.CSSProperties {
  return { background: "#fff", color, border: `1px solid ${color}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" };
}
