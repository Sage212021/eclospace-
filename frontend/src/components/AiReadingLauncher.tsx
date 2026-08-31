import { useEffect, useState } from "react";
import { runAiEditorial, listAiJobs, type AiJob, type AiWorkType } from "../api/client";

// Lot IA-1 : lancer une relecture assistée à l'étape courante. Le rapport produit
// (au nom du relecteur d'Éclosion) est classé dans les Documents de l'ouvrage.

const STATUS_LABELS: Record<AiJob["status"], string> = {
  en_attente: "En attente",
  en_cours: "En cours…",
  termine: "Terminé",
  erreur: "Erreur",
};
const STATUS_COLORS: Record<AiJob["status"], string> = {
  en_attente: "var(--muted)",
  en_cours: "#B87400",
  termine: "#2F7D4A",
  erreur: "var(--alert, #B23A2E)",
};

export function AiReadingLauncher({ manuscriptId, workType, stepCode, title, hint }: { manuscriptId: string; workType: AiWorkType; stepCode: string; title: string; hint?: string }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [reco, setReco] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => listAiJobs(manuscriptId).then((r) => setJobs(r.jobs.filter((j) => j.workType === workType))).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [manuscriptId, workType]);

  async function launch() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await runAiEditorial({ manuscript_id: manuscriptId, work_type: workType, step_code: stepCode, editor_recommendation: reco.trim() || undefined });
      setNote(`Rapport généré et classé dans les Documents de l'ouvrage (coût estimé ≈ ${r.costEstimate.toLocaleString("fr-FR")} FCFA).`);
      setReco("");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lancement impossible.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12, background: "var(--paper, #FAF8F2)" }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>🤖 {title}</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 10px", lineHeight: 1.6 }}>
        Le relecteur d'Éclosion analyse le manuscrit déposé et rédige le rapport, classé automatiquement dans les Documents de
        l'ouvrage. Vous pouvez ajouter une consigne particulière ci-dessous.
      </p>
      {hint && <p style={{ color: "var(--eclosion-dark, #9A7A12)", fontSize: 12, margin: "-4px 0 10px", fontWeight: 600 }}>{hint}</p>}
      {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      <textarea
        value={reco}
        onChange={(e) => setReco(e.target.value)}
        placeholder="Recommandation spéciale à l'IA (facultatif) — ex. « insister sur la cohérence chronologique »"
        style={{ width: "100%", minHeight: 56, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
      />
      <button
        onClick={launch}
        disabled={busy}
        style={{ marginTop: 8, background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
      >
        {busy ? "Analyse en cours… (patientez)" : "Lancer avec Claude"}
      </button>

      {jobs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Historique</div>
          <div style={{ display: "grid", gap: 4 }}>
            {jobs.map((j) => (
              <div key={j.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{new Date(j.launchedAt).toLocaleString("fr-FR")}</span>
                <span style={{ fontWeight: 700, color: STATUS_COLORS[j.status] }}>{STATUS_LABELS[j.status]}</span>
                {j.costEstimate && <span style={{ color: "var(--muted)" }}>≈ {Number(j.costEstimate).toLocaleString("fr-FR")} FCFA</span>}
                {j.errorMessage && <span style={{ color: "var(--alert, #B23A2E)" }}>{j.errorMessage}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
