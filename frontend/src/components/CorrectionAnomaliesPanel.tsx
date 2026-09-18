import { useEffect, useMemo, useState } from "react";
import { getCorrectionAnomalies, decideCorrectionAnomaly, type CorrectionAnomaly, type AnomalySummary } from "../api/client";

// Validation humaine des anomalies de correction (Lot 3, option A). Chaque
// anomalie produite par l'assistance IA devient une fiche : Accepter / Modifier
// / Rejeter / À vérifier. « Accepter » enregistre la décision ; l'intégrateur
// applique ensuite la correction. Rien n'est écrasé (l'historique est tracé).
const SEV_COLOR: Record<string, { bg: string; fg: string }> = {
  C1: { bg: "#F6D9D3", fg: "#B23A2E" },
  C2: { bg: "var(--amber-soft, #F6E7D2)", fg: "#B87400" },
  C3: { bg: "var(--eclosion-soft)", fg: "var(--eclosion-dark, #9A7A12)" },
  S: { bg: "#E7EAF0", fg: "#5B6472" },
};
const STATUS_LABEL: Record<string, string> = { a_traiter: "À traiter", acceptee: "Acceptée", modifiee: "Modifiée", rejetee: "Rejetée", a_verifier: "À vérifier" };
const STATUS_COLOR: Record<string, string> = { a_traiter: "var(--muted)", acceptee: "#2F7D4A", modifiee: "#B87400", rejetee: "#B23A2E", a_verifier: "#5B6472" };
const WORKTYPE_LABEL: Record<string, string> = { correction_1: "Relecture 1 (BAT1)", correction_2: "Relecture 2 (BAT2)", couverture: "Couverture" };
const FACE_LABEL: Record<string, string> = { "1ere": "1ʳᵉ de couverture", dos: "Dos", "4eme": "4ᵉ de couverture" };

export function CorrectionAnomaliesPanel({ manuscriptId, canDecide }: { manuscriptId: string; canDecide: boolean }) {
  const [anomalies, setAnomalies] = useState<CorrectionAnomaly[]>([]);
  const [summary, setSummary] = useState<AnomalySummary | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; status: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    getCorrectionAnomalies(manuscriptId)
      .then((r) => { setAnomalies(r.anomalies); setSummary(r.summary); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId]);

  const shown = useMemo(() => (filter === "all" ? anomalies : anomalies.filter((a) => a.status === filter)), [anomalies, filter]);
  // Regroupe par relecture (job), la plus récente d'abord (déjà trié côté serveur).
  const groups = useMemo(() => {
    const m = new Map<string, CorrectionAnomaly[]>();
    for (const a of shown) { const k = a.job_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(a); }
    return [...m.entries()];
  }, [shown]);

  async function decide(a: CorrectionAnomaly, status: string, note?: string) {
    setBusyId(a.id); setErr(null);
    try {
      await decideCorrectionAnomaly(a.id, { status, resolution_note: note ?? null });
      setNoteFor(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Décision impossible.");
    } finally {
      setBusyId(null);
    }
  }

  if (!summary) return null;
  if (summary.total === 0) {
    return (
      <section style={box}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Anomalies à traiter</div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>Aucune anomalie enregistrée pour l'instant. Lancez une relecture IA ci-dessus : ses anomalies s'afficheront ici, à valider une par une.</p>
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
      <div style={{ fontWeight: 600, fontSize: 14 }}>Anomalies à traiter ({summary.total})</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
        Chaque anomalie relevée par l'assistance IA se valide une par une. « Accepter » enregistre la décision ; l'intégrateur
        applique ensuite la correction dans le fichier. Sévérité : C1 bloquant · C2 important · C3 mineur · S suggestion.
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

      {groups.map(([jobId, list]) => (
        <div key={jobId} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", margin: "0 0 6px" }}>
            {WORKTYPE_LABEL[list[0].work_type] ?? list[0].work_type} · {new Date(list[0].job_launched_at).toLocaleDateString("fr-FR")}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
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
                    noteFor?.id === a.id ? (
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
                        <button type="button" disabled={busyId === a.id} onClick={() => setNoteFor({ id: a.id, status: "modifiee", text: a.resolution_note ?? "" })} style={btn("#B87400")}>✏️ Modifier</button>
                        <button type="button" disabled={busyId === a.id} onClick={() => setNoteFor({ id: a.id, status: "rejetee", text: a.resolution_note ?? "" })} style={btn("#B23A2E")}>❌ Rejeter</button>
                        <button type="button" disabled={busyId === a.id} onClick={() => decide(a, "a_verifier")} style={btn("#5B6472")}>🔎 À vérifier</button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper, #FAF8F2)", padding: 14, marginTop: 12 };
const btnPrimary: React.CSSProperties = { background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" };
function btn(color: string): React.CSSProperties {
  return { background: "#fff", color, border: `1px solid ${color}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" };
}
