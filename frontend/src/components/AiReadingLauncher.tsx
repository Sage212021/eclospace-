import { useEffect, useState } from "react";
import { runAiEditorial, listAiJobs, aiJobReportDownloadUrl, type AiJob, type AiWorkType } from "../api/client";

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

export function AiReadingLauncher({ manuscriptId, workType, stepCode, title, hint, askCoverPass }: { manuscriptId: string; workType: AiWorkType; stepCode: string; title: string; hint?: string; askCoverPass?: boolean }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [reco, setReco] = useState("");
  const [coverPass, setCoverPass] = useState<"BAT1" | "BAT2">("BAT1");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => listAiJobs(manuscriptId).then((r) => r.jobs.filter((j) => j.workType === workType));
  const refresh = () => load().then(setJobs).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [manuscriptId, workType]);

  // L'analyse tourne EN ARRIÈRE-PLAN (fin des erreurs 504) : après le lancement,
  // on suit l'avancement du job en rafraîchissant régulièrement, jusqu'à
  // « Terminé » ou « Erreur ». Le bouton reste en « analyse en cours » pendant ce
  // temps ; l'utilisateur peut quitter l'écran, le job se poursuit côté serveur.
  async function launch() {
    setBusy(true); setErr(null); setNote(null);
    try {
      await runAiEditorial({ manuscript_id: manuscriptId, work_type: workType, step_code: stepCode, editor_recommendation: reco.trim() || undefined, cover_pass: askCoverPass ? coverPass : undefined });
      setReco("");
      setNote("Analyse lancée. Le relecteur d'Éclosion travaille en arrière-plan — vous pouvez patienter ou quitter cet écran, le rapport sera classé dans les Documents de l'ouvrage.");
      // Suivi de progression (jusqu'à ~5 min).
      const started = Date.now();
      const poll = async (): Promise<void> => {
        const list = await load().catch(() => null);
        if (list) {
          setJobs(list);
          const latest = list[0];
          if (latest && latest.status === "termine") {
            setNote(`Rapport généré : téléchargez-le ci-dessous (« 📄 Télécharger le rapport ») ; il est aussi classé dans les Documents de l'ouvrage${latest.costEstimate ? ` (coût estimé ≈ ${Number(latest.costEstimate).toLocaleString("fr-FR")} FCFA)` : ""}.`);
            setBusy(false);
            return;
          }
          if (latest && latest.status === "erreur") {
            setErr(latest.errorMessage || "L'analyse a échoué.");
            setNote(null);
            setBusy(false);
            return;
          }
        }
        if (Date.now() - started > 5 * 60_000) {
          setBusy(false); // on arrête le suivi actif ; le job continue côté serveur
          setNote("L'analyse est plus longue que prévu ; elle se poursuit en arrière-plan. Actualisez la page dans quelques instants pour voir le résultat.");
          return;
        }
        setTimeout(() => { void poll(); }, 4000);
      };
      void poll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lancement impossible.");
      setBusy(false);
    }
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
      {askCoverPass && (
        <div style={{ marginBottom: 8, fontSize: 12.5 }}>
          <span style={{ fontWeight: 600, marginRight: 10 }}>Passage :</span>
          {(["BAT1", "BAT2"] as const).map((p) => (
            <label key={p} style={{ marginRight: 14, cursor: "pointer" }}>
              <input type="radio" name={`coverpass-${manuscriptId}`} checked={coverPass === p} onChange={() => setCoverPass(p)} style={{ marginRight: 4 }} />
              {p === "BAT1" ? "BAT1 (1ᵉʳ passage)" : "BAT2 (2ᵉ passage — suivi du BAT précédent)"}
            </label>
          ))}
        </div>
      )}
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
                {j.status === "termine" && j.reportAvailable !== false && (
                  <>
                    <a
                      href={aiJobReportDownloadUrl(j.id, false)}
                      style={{ color: "var(--eclosion-dark, #9A7A12)", fontWeight: 700, textDecoration: "none" }}
                      title="Rapport tel quel, sans en-tête maison"
                    >
                      📄 Télécharger — sans en-tête
                    </a>
                    <a
                      href={aiJobReportDownloadUrl(j.id, true)}
                      style={{ color: "var(--muted)", fontWeight: 700, textDecoration: "none" }}
                      title="Rapport avec l'en-tête Éclosion"
                    >
                      📄 avec en-tête Éclosion
                    </a>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
