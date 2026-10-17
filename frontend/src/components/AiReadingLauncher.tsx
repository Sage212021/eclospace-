import { useEffect, useState } from "react";
import { runAiEditorial, listAiJobs, cancelAiJob, aiJobReportDownloadUrl, aiJobComparison, aiJobDocuments, aiJobDocumentDownloadUrl, listGenres, type AiJob, type AiJobDocument, type AiWorkType, type Genre } from "../api/client";

// Lot IA-1 : lancer une relecture assistée à l'étape courante. Le rapport produit
// (au nom du relecteur d'Éclosion) est classé dans les Documents de l'ouvrage.

const STATUS_LABELS: Record<AiJob["status"], string> = {
  en_attente: "En attente",
  en_cours: "En cours…",
  termine: "Terminé",
  erreur: "Erreur",
  annule: "Arrêté",
};
const STATUS_COLORS: Record<AiJob["status"], string> = {
  en_attente: "var(--muted)",
  en_cours: "#B87400",
  termine: "#2F7D4A",
  erreur: "var(--alert, #B23A2E)",
  annule: "var(--muted)",
};

// Groupes de « chips » d'objectifs (facultatifs) : cliquer une puce insère la
// consigne correspondante dans la zone de recommandation, sans ressaisie. Sert à
// la sélection claire des objectifs (types d'expertise, niveaux de réécriture,
// degré de préservation de la voix) — cf. cahier des charges IA §5/§12/§13.
export interface PresetGroup {
  title: string;
  options: string[];
}

export function AiReadingLauncher({ manuscriptId, workType, stepCode, title, hint, askCoverPass, askGrid, presetGroups, bookTypeCode, support }: { manuscriptId: string; workType: AiWorkType; stepCode: string; title: string; hint?: string; askCoverPass?: boolean; askGrid?: boolean; presetGroups?: PresetGroup[]; bookTypeCode?: string | null; support?: string | null }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [reco, setReco] = useState("");
  const [coverPass, setCoverPass] = useState<"BAT1" | "BAT2">("BAT1");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Évaluation : type de manuscrit choisi par le relecteur pour adapter la
  // GRILLE transmise à l'IA. "" = automatique (selon le domaine de l'ouvrage).
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState("");
  // Comparaison avant/après (réécriture) : texte original vs texte réécrit.
  const [compare, setCompare] = useState<{ jobId: string; original: string; rewritten: string } | null>(null);
  const [cmpBusy, setCmpBusy] = useState(false);

  // Livrables produits (« Générer les livrables ») : sélection + téléchargement.
  const [livrables, setLivrables] = useState<{ jobId: string; docs: AiJobDocument[]; selected: Set<string> } | null>(null);
  const [livBusy, setLivBusy] = useState(false);

  async function openLivrables(jobId: string) {
    if (livrables?.jobId === jobId) { setLivrables(null); return; }
    setLivBusy(true); setErr(null);
    try {
      const r = await aiJobDocuments(jobId);
      setLivrables({ jobId, docs: r.documents, selected: new Set(r.documents.map((d) => d.id)) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Livrables indisponibles.");
    } finally {
      setLivBusy(false);
    }
  }
  function toggleLivrable(id: string) {
    setLivrables((cur) => {
      if (!cur) return cur;
      const selected = new Set(cur.selected);
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      return { ...cur, selected };
    });
  }
  function downloadSelected() {
    if (!livrables) return;
    livrables.docs.filter((d) => livrables.selected.has(d.id)).forEach((d, i) => {
      // Déclenche chaque téléchargement via un lien temporaire (léger décalage
      // pour ne pas que le navigateur en ignore certains).
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = aiJobDocumentDownloadUrl(livrables.jobId, d.id);
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
  }

  async function openComparison(jobId: string) {
    if (compare?.jobId === jobId) { setCompare(null); return; }
    setCmpBusy(true); setErr(null);
    try {
      const c = await aiJobComparison(jobId);
      setCompare({ jobId, original: c.original, rewritten: c.rewritten });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Comparaison indisponible.");
    } finally {
      setCmpBusy(false);
    }
  }

  const load = () => listAiJobs(manuscriptId).then((r) => r.jobs.filter((j) => j.workType === workType));
  const refresh = () => load().then(setJobs).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [manuscriptId, workType]);
  useEffect(() => { if (askGrid) listGenres().then(setGenres).catch(() => setGenres([])); }, [askGrid]);

  // Rafraîchissement LÉGER tant qu'un lancement est actif — indépendant du suivi
  // de 5 min du bouton : garde le pourcentage d'avancement à jour dans
  // l'historique, même pour une longue correction et même si l'opérateur revient
  // sur l'écran plus tard. S'arrête dès qu'aucun lancement n'est en cours.
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "en_cours" || j.status === "en_attente");
    if (!hasRunning) return;
    const t = setTimeout(() => { refresh(); }, 8000);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [jobs]);

  // L'analyse tourne EN ARRIÈRE-PLAN (fin des erreurs 504) : après le lancement,
  // on suit l'avancement du job en rafraîchissant régulièrement, jusqu'à
  // « Terminé » ou « Erreur ». Le bouton reste en « analyse en cours » pendant ce
  // temps ; l'utilisateur peut quitter l'écran, le job se poursuit côté serveur.
  async function launch() {
    setBusy(true); setErr(null); setNote(null);
    try {
      await runAiEditorial({ manuscript_id: manuscriptId, work_type: workType, step_code: stepCode, editor_recommendation: reco.trim() || undefined, cover_pass: askCoverPass ? coverPass : undefined, grid_genre_id: askGrid && selectedGenre ? selectedGenre : undefined, book_type_code: bookTypeCode ?? undefined, support: support ?? undefined });
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
          if (latest && latest.status === "annule") {
            setNote("Lancement arrêté.");
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

  // Arrêt d'un lancement qui traîne ou ne convient plus : le job passe « Arrêté »
  // et on cesse le suivi actif (plus de consommation de crédit inutile).
  async function stop(jobId: string) {
    try {
      await cancelAiJob(jobId);
      setErr(null);
      setNote("Lancement arrêté.");
    } catch (e) {
      // 409 = le lancement s'est déjà terminé/arrêté entre-temps : ce n'est pas
      // une vraie erreur. On ne laisse donc PAS le bouton bloqué sur « en cours » —
      // on rafraîchit l'état dans tous les cas (sinon : « je clique Stopper mais
      // ça reste en cours », retour opérateur 17/10).
      if ((e as { status?: number }).status === 409) {
        setErr(null);
        setNote("Lancement déjà terminé ou arrêté.");
      } else {
        setErr(e instanceof Error ? e.message : "Arrêt impossible.");
      }
    } finally {
      setBusy(false);
      // Rafraîchissement systématique : l'historique reflète le vrai statut
      // (arrêté / terminé / interrompu) et le bouton se débloque.
      const list = await load().catch(() => null);
      if (list) setJobs(list);
    }
  }

  // Un lancement est « en cours » pour TOUT LE MONDE s'il existe un job actif —
  // pas seulement pour la personne qui l'a démarré (busy, local à sa session).
  // Ainsi le correcteur voit aussi l'avancement d'une analyse lancée par l'éditeur.
  const running = jobs.find((j) => j.status === "en_cours" || j.status === "en_attente");
  const inProgress = busy || !!running;
  const runningPct = running?.progressTotal ? Math.round(((running.progressDone ?? 0) / running.progressTotal) * 100) : null;

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
      {askGrid && (
        // Fenêtre en accordéon : le relecteur choisit le TYPE de manuscrit pour
        // que la GRILLE d'évaluation transmise à l'IA corresponde. Repliée par
        // défaut (« Automatique — selon l'ouvrage ») pour ne pas occuper d'espace.
        <details style={{ marginBottom: 10, border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg, #fff)" }}>
          <summary style={{ cursor: "pointer", padding: "8px 11px", fontSize: 12.5, fontWeight: 600, userSelect: "none" }}>
            Type de manuscrit (grille appliquée) : {selectedGenre ? (genres.find((g) => g.id === selectedGenre)?.label ?? "—") : "Automatique — selon l'ouvrage"}
          </summary>
          <div style={{ padding: "0 11px 11px" }}>
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
            >
              <option value="">Automatique — selon l'ouvrage</option>
              {genres.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.5 }}>
              La grille d'évaluation envoyée à l'IA s'adapte au type choisi ; « Automatique » utilise le type de l'ouvrage.
            </p>
          </div>
        </details>
      )}
      {presetGroups && presetGroups.length > 0 && (
        // Sélection claire des objectifs : chaque puce insère sa consigne dans la
        // zone ci-dessous (cumulables). L'opérateur peut ensuite préciser à la main.
        <div style={{ marginBottom: 10 }}>
          {presetGroups.map((g) => (
            <div key={g.title} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>{g.title}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {g.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setReco((cur) => (cur.trim() ? `${cur.trim()}\n${opt}` : opt))}
                    style={{ background: "var(--bg, #fff)", border: "1px solid var(--line)", borderRadius: 999, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "var(--ink)" }}
                    title="Ajouter cette consigne"
                  >
                    + {opt}
                  </button>
                ))}
              </div>
            </div>
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
        disabled={inProgress}
        style={{ marginTop: 8, background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: inProgress ? "default" : "pointer" }}
      >
        {inProgress
          ? (runningPct !== null ? `Analyse en cours… ${runningPct} %` : "Analyse en cours… (patientez)")
          : "Lancer avec Claude"}
      </button>

      {jobs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Historique</div>
          <div style={{ display: "grid", gap: 4 }}>
            {jobs.map((j) => (
              <div key={j.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{new Date(j.launchedAt).toLocaleString("fr-FR")}</span>
                <span style={{ fontWeight: 700, color: STATUS_COLORS[j.status] }}>{STATUS_LABELS[j.status]}</span>
                {j.status === "en_cours" && (j.progressLabel || j.progressTotal) ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--eclosion-dark, #9A7A12)", fontWeight: 600 }}>
                    {j.progressLabel && <span>{j.progressLabel}</span>}
                    {j.progressTotal ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 90, height: 8, background: "var(--line)", borderRadius: 999, overflow: "hidden", display: "inline-block" }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.round(((j.progressDone ?? 0) / j.progressTotal) * 100)}%`, background: "var(--eclosion, #D9B21A)" }} />
                        </span>
                        <strong style={{ fontFamily: "var(--font-mono)" }}>{Math.round(((j.progressDone ?? 0) / j.progressTotal) * 100)} %</strong>
                        <span style={{ color: "var(--muted)" }}>({j.progressDone ?? 0}/{j.progressTotal})</span>
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {(j.status === "en_cours" || j.status === "en_attente") && (
                  <button
                    type="button"
                    onClick={() => stop(j.id)}
                    style={{ background: "none", border: "1px solid var(--alert, #B23A2E)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "1px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                    title="Arrêter ce lancement"
                  >
                    ⏹ Stopper
                  </button>
                )}
                {j.status === "termine" && (
                  // Production IA : jamais présentée comme une décision. Reste « à
                  // valider » jusqu'à intervention d'un responsable habilité.
                  <span style={{ background: "#F4E9BE", color: "#8A6D00", border: "1px solid #D9B21A", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>IA — à valider</span>
                )}
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
                    {workType === "reecriture" && (
                      <button
                        type="button"
                        onClick={() => openComparison(j.id)}
                        disabled={cmpBusy}
                        style={{ background: "none", border: "none", color: "var(--eclosion-dark, #9A7A12)", fontWeight: 700, cursor: cmpBusy ? "default" : "pointer", padding: 0, fontSize: 12 }}
                        title="Afficher la version originale et la version réécrite côte à côte"
                      >
                        🔀 {compare?.jobId === j.id ? "Masquer la comparaison" : "Comparer avant/après"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openLivrables(j.id)}
                      disabled={livBusy}
                      style={{ background: "none", border: "none", color: "var(--eclosion-dark, #9A7A12)", fontWeight: 700, cursor: livBusy ? "default" : "pointer", padding: 0, fontSize: 12 }}
                      title="Choisir les documents produits à télécharger"
                    >
                      📦 {livrables?.jobId === j.id ? "Masquer les livrables" : "Générer les livrables"}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {livrables && (
            // Sélection des livrables produits par la relecture (rapport, version
            // réécrite…) puis téléchargement de la sélection. Réutilise les fichiers
            // déjà classés dans les Documents de l'ouvrage.
            <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: 10, background: "var(--paper, #FAF8F2)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Générer les livrables</div>
              {livrables.docs.length === 0 && <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Aucun livrable produit.</p>}
              <div style={{ display: "grid", gap: 4 }}>
                {livrables.docs.map((d) => (
                  <label key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, cursor: "pointer" }}>
                    <input type="checkbox" checked={livrables.selected.has(d.id)} onChange={() => toggleLivrable(d.id)} />
                    <span style={{ fontWeight: 600 }}>{d.title}</span>
                    <a href={aiJobDocumentDownloadUrl(livrables.jobId, d.id)} style={{ color: "var(--eclosion-dark, #9A7A12)", fontWeight: 700, textDecoration: "none" }}>📄 télécharger</a>
                  </label>
                ))}
              </div>
              {livrables.docs.length > 0 && (
                <button
                  type="button"
                  onClick={downloadSelected}
                  disabled={livrables.selected.size === 0}
                  style={{ marginTop: 8, background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: livrables.selected.size === 0 ? "default" : "pointer" }}
                >
                  Télécharger la sélection ({livrables.selected.size})
                </button>
              )}
            </div>
          )}
          {compare && (
            // Version originale / version proposée par l'IA, côte à côte. La
            // version originale n'est jamais modifiée : ceci est une proposition.
            <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                <div style={{ borderRight: "1px solid var(--line)" }}>
                  <div style={{ background: "var(--paper, #FAF8F2)", padding: "6px 10px", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>Version originale</div>
                  <div style={{ padding: 10, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>{compare.original}</div>
                </div>
                <div>
                  <div style={{ background: "#F4E9BE", padding: "6px 10px", fontSize: 11.5, fontWeight: 700, color: "#8A6D00", borderBottom: "1px solid var(--line)" }}>Version proposée par l'IA — à valider</div>
                  <div style={{ padding: 10, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>{compare.rewritten}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
