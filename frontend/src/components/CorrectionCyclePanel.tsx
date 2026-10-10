import { useEffect, useRef, useState } from "react";
import { getCorrectionCycle, getCoverCorrectionCycle, uploadCorrectionPhase, deleteStepDocument, stepAttachmentDownloadUrl, getCorrectionIntegrator, getCorrectionIntegrators, setCorrectionIntegrator, getCoverIntegrator, getCoverIntegrators, setCoverIntegrator, type CorrectionPhaseState, type CorrectionIntegratorState } from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";
import { confirmFileBelongs } from "../lib/filenameMatch";

const ACTOR_LABEL: Record<string, string> = { correcteur: "au correcteur", integrateur: "à l'intégrateur (éditeur)", termine: "— cycle terminé" };

// Correction éditoriale EN DEUX TEMPS (demande opérateur 20/08/2026) :
//   1. Rapport de correction (vu par l'étape suivante pour l'intégration)
//   2. Version intégrée (1er passage)
//   3. Rapport de 2e relecture
//   4. Version finale intégrée
// Les phases marquées « obligatoire » bloquent la validation de l'étape tant
// qu'aucun fichier n'est déposé.
// `showCover` (défaut : true) affiche la section « Correction de la couverture
// (pour l'infographe) ». On la masque sur l'écran de l'INTÉGRATEUR TEXTE
// (assistant / directeur éditorial), qui ne gère que le texte : la couverture est
// pilotée par le correcteur et reçue par l'infographe dans sa propre branche.
export function CorrectionCyclePanel({ manuscriptId, canManage, showCover = true, manuscriptTitle }: { manuscriptId: string; canManage: boolean; showCover?: boolean; manuscriptTitle?: string }) {
  const [phases, setPhases] = useState<CorrectionPhaseState[]>([]);
  const [coverPhases, setCoverPhases] = useState<CorrectionPhaseState[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [integ, setInteg] = useState<CorrectionIntegratorState | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([]);
  const [coverInteg, setCoverInteg] = useState<{ id: string; name: string } | null>(null);
  const [coverCandidates, setCoverCandidates] = useState<{ id: string; name: string }[]>([]);

  const load = () => Promise.all([
    getCorrectionCycle(manuscriptId).then(setPhases).catch(() => setPhases([])),
    getCoverCorrectionCycle(manuscriptId).then(setCoverPhases).catch(() => setCoverPhases([])),
    getCorrectionIntegrator(manuscriptId).then(setInteg).catch(() => setInteg(null)),
    getCoverIntegrator(manuscriptId).then((r) => setCoverInteg(r.integrator)).catch(() => setCoverInteg(null)),
  ]);
  useEffect(() => {
    load();
    getCorrectionIntegrators().then(setCandidates).catch(() => setCandidates([]));
    getCoverIntegrators().then(setCoverCandidates).catch(() => setCoverCandidates([]));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [manuscriptId]);

  async function chooseInteg(userId: string) {
    setError(null);
    try {
      await setCorrectionIntegrator(manuscriptId, userId || null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Désignation impossible.");
    }
  }

  async function chooseCoverInteg(userId: string) {
    setError(null);
    try {
      await setCoverIntegrator(manuscriptId, userId || null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Désignation impossible.");
    }
  }

  async function deposit(key: string, file: File) {
    // Garde-fou « mauvais fichier » : si le nom ne correspond pas à l'ouvrage,
    // on demande confirmation avant d'envoyer.
    if (!confirmFileBelongs(manuscriptTitle, file.name)) return;
    setBusyKey(key);
    setError(null);
    try {
      await uploadCorrectionPhase(manuscriptId, key, file);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt impossible.");
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(key: string, docId: string) {
    if (!window.confirm("Retirer ce fichier déposé par erreur ? Vous pourrez en redéposer un.")) return;
    setBusyKey(key);
    setError(null);
    try {
      await deleteStepDocument(manuscriptId, docId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrait impossible.");
    } finally {
      setBusyKey(null);
    }
  }

  const requiredMissing = phases.filter((p) => p.required && !p.has_file);

  return (
    <CollapsibleSection
      title="Correction en deux temps"
      subtitle="Relais correcteur ↔ intégrateur jusqu'à la version corrigée finale (VCF)."
      storageKey="fiche:correction-cycle"
    >
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
        Relais correcteur ↔ intégrateur : <strong>1re correction</strong> → <strong>version intégrée</strong> →
        <strong> 2e correction (relecture)</strong> → <strong>Version corrigée finale (VCF)</strong>, transmise à la mise en page.
        Les étapes se déposent <strong>dans l'ordre</strong> : impossible de déposer la version corrigée finale tant que les étapes précédentes ne le sont pas.
        Un fichier déjà déposé reste toujours remplaçable (pour corriger un mauvais fichier).
        Le passage à la mise en page est bloqué tant que la 1re correction et la version corrigée finale ne sont pas déposées.
      </p>

      {/* Intégrateur des corrections + « à qui la main » */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", margin: "6px 0 10px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Intégrateur (éditeur) :</span>
        {canManage ? (
          <select value={integ?.integrator?.id ?? ""} onChange={(e) => chooseInteg(e.target.value)} style={{ fontSize: 12.5 }}>
            <option value="">— À désigner —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 12.5 }}>{integ?.integrator?.name ?? "— non désigné —"}</span>
        )}
        {integ && (
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, background: integ.current_actor === "termine" ? "var(--eclosion-soft)" : "rgba(196,102,31,0.12)", color: integ.current_actor === "termine" ? "var(--eclosion)" : "#C4661F", borderRadius: 999, padding: "3px 10px" }}>
            Balle {ACTOR_LABEL[integ.current_actor] ?? ""}
          </span>
        )}
      </div>
      {!integ?.integrator && (
        <p style={{ fontSize: 12, color: "var(--eclosion-retard, #C4661F)", marginTop: 0 }}>Désignez l'intégrateur pour que les corrections lui parviennent automatiquement.</p>
      )}
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {phases.map((p, i) => {
          // ORDRE DU CYCLE : un NOUVEAU dépôt n'est possible que si toutes les
          // étapes précédentes ont un fichier. Le remplacement d'une pièce déjà
          // déposée reste toujours possible (corriger un mauvais fichier).
          const prevMissing = phases.slice(0, i).filter((x) => !x.has_file);
          const locked = !p.has_file && prevMissing.length > 0;
          return (
          <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px", opacity: locked ? 0.7 : 1 }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 12 }}>{i + 1}.</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {p.label}
                {p.required && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-retard, #C4661F)" }}>OBLIGATOIRE</span>}
              </div>
              {p.has_file ? (
                <div>
                  <a href={stepAttachmentDownloadUrl(manuscriptId, p.version_id!)} download style={{ fontSize: 12, color: "var(--eclosion-dark)", fontWeight: 600 }}>
                    ⬇️ {p.filename ?? "Télécharger le fichier"}
                  </a>
                  {/* Retour transmis : date, auteur, version — consultable depuis
                      la fiche globale de l'ouvrage. */}
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {[
                      p.created_at ? `Transmis le ${new Date(p.created_at).toLocaleDateString("fr-FR")}` : null,
                      p.uploaded_by_name ? `par ${p.uploaded_by_name}` : null,
                      p.version_number ? `v${p.version_number}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : locked ? (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  🔒 Déposez d'abord : {prevMissing.map((x) => x.label).join(", ")}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: p.required ? "var(--eclosion-retard, #C4661F)" : "var(--muted)" }}>
                  {p.required ? "À déposer (bloque la suite)" : "À déposer (dans l'ordre du cycle)"}
                </span>
              )}
            </div>
            <span aria-hidden style={{ fontSize: 16 }}>{p.has_file ? "✅" : locked ? "🔒" : p.required ? "⛔" : "—"}</span>
            {canManage && !locked && (
              <label style={{ cursor: busyKey === p.key ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
                {busyKey === p.key ? "Envoi…" : p.has_file ? "Remplacer" : "Déposer"}
                <input
                  ref={(el) => { inputs.current[p.key] = el; }}
                  type="file"
                  style={{ display: "none" }}
                  disabled={busyKey === p.key}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f && (!p.has_file || window.confirm("Remplacer le fichier déjà déposé ? L'ancien reste dans l'historique."))) deposit(p.key, f); e.target.value = ""; }}
                />
              </label>
            )}
            {canManage && locked && (
              <span title="Déposez d'abord les étapes précédentes du cycle." style={{ fontWeight: 600, color: "var(--muted)", border: "1px dashed var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: "not-allowed" }}>
                🔒 Déposer
              </span>
            )}
            {canManage && p.has_file && p.can_correct && p.doc_id && (
              <button onClick={() => remove(p.key, p.doc_id!)} disabled={busyKey === p.key} style={{ fontWeight: 600, color: "var(--alert)", background: "#fff", border: "1px solid var(--alert)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: busyKey === p.key ? "default" : "pointer" }}>
                Retirer
              </button>
            )}
          </div>
          );
        })}
      </div>

      {requiredMissing.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--eclosion-retard, #C4661F)", marginTop: 10, marginBottom: 0 }}>
          Manque avant de poursuivre : {requiredMissing.map((p) => p.label).join(" ; ")}.
        </p>
      )}

      {/* Rapports de correction de la COUVERTURE — déposés ici par le correcteur,
          exploités par l'INFOGRAPHE (branche parallèle du texte). Masqués pour
          l'intégrateur texte, qui ne gère que le texte. */}
      {showCover && (<>
      <h3 style={{ fontSize: 15, margin: "18px 0 4px", color: "var(--ink)" }}>Correction de la couverture (pour l'infographe)</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
        Déposez ici, <strong>dans l'ordre</strong>, les pièces de correction de la couverture : 1re correction → retour intégration (BAT2) → 2e correction → couverture corrigée finale.
        Toutes sont <strong>obligatoires</strong> pour clôturer la correction. L'infographe désigné les reçoit dans « Mes intégrations de correction » et les exploite.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", margin: "6px 0 10px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Infographe (couverture) :</span>
        {canManage ? (
          <select value={coverInteg?.id ?? ""} onChange={(e) => chooseCoverInteg(e.target.value)} style={{ fontSize: 12.5 }}>
            <option value="">— À désigner —</option>
            {coverCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 12.5 }}>{coverInteg?.name ?? "— non désigné —"}</span>
        )}
      </div>
      {!coverInteg && (
        <p style={{ fontSize: 12, color: "var(--eclosion-retard, #C4661F)", marginTop: 0 }}>Désignez l'infographe pour que le rapport de correction de couverture lui parvienne.</p>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {coverPhases.map((p, i) => {
          // Cycle couverture obligatoire et ORDONNÉ (10/10) : un nouveau dépôt
          // n'est possible que si les étapes couverture précédentes ont un fichier.
          const prevMissing = coverPhases.slice(0, i).filter((x) => !x.has_file);
          const locked = !p.has_file && prevMissing.length > 0;
          return (
          <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px", opacity: locked ? 0.7 : 1 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {p.label}
                {p.required && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-retard, #C4661F)" }}>OBLIGATOIRE</span>}
              </div>
              {p.has_file ? (
                <div>
                  <a href={stepAttachmentDownloadUrl(manuscriptId, p.version_id!)} download style={{ fontSize: 12, color: "var(--eclosion-dark)", fontWeight: 600 }}>
                    ⬇️ {p.filename ?? "Télécharger le fichier"}
                  </a>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {[
                      p.created_at ? `Transmis le ${new Date(p.created_at).toLocaleDateString("fr-FR")}` : null,
                      p.uploaded_by_name ? `par ${p.uploaded_by_name}` : null,
                      p.version_number ? `v${p.version_number}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : locked ? (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>🔒 Déposez d'abord : {prevMissing.map((x) => x.label).join(", ")}</span>
              ) : (
                <span style={{ fontSize: 12, color: p.required ? "var(--eclosion-retard, #C4661F)" : "var(--muted)" }}>{p.required ? "À déposer (bloque la suite)" : "À déposer (dans l'ordre du cycle)"}</span>
              )}
            </div>
            <span aria-hidden style={{ fontSize: 16 }}>{p.has_file ? "✅" : locked ? "🔒" : p.required ? "⛔" : "—"}</span>
            {canManage && !locked && (
              <label style={{ cursor: busyKey === p.key ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
                {busyKey === p.key ? "Envoi…" : p.has_file ? "Remplacer" : "Déposer"}
                <input type="file" style={{ display: "none" }} disabled={busyKey === p.key} onChange={(e) => { const f = e.target.files?.[0]; if (f && (!p.has_file || window.confirm("Remplacer le fichier déjà déposé ? L'ancien reste dans l'historique."))) deposit(p.key, f); e.target.value = ""; }} />
              </label>
            )}
            {canManage && locked && (
              <span title="Déposez d'abord les étapes couverture précédentes." style={{ fontWeight: 600, color: "var(--muted)", border: "1px dashed var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: "not-allowed" }}>🔒 Déposer</span>
            )}
            {canManage && p.has_file && p.can_correct && p.doc_id && (
              <button onClick={() => remove(p.key, p.doc_id!)} disabled={busyKey === p.key} style={{ fontWeight: 600, color: "var(--alert)", background: "#fff", border: "1px solid var(--alert)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: busyKey === p.key ? "default" : "pointer" }}>
                Retirer
              </button>
            )}
          </div>
          );
        })}
      </div>
      </>)}
    </CollapsibleSection>
  );
}
