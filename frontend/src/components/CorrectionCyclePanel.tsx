import { useEffect, useRef, useState } from "react";
import { getCorrectionCycle, uploadCorrectionPhase, stepAttachmentDownloadUrl, type CorrectionPhaseState } from "../api/client";

// Correction éditoriale EN DEUX TEMPS (demande opérateur 20/08/2026) :
//   1. Rapport de correction (vu par l'étape suivante pour l'intégration)
//   2. Version intégrée (1er passage)
//   3. Rapport de 2e relecture
//   4. Version finale intégrée
// Les phases marquées « obligatoire » bloquent la validation de l'étape tant
// qu'aucun fichier n'est déposé.
export function CorrectionCyclePanel({ manuscriptId, canManage }: { manuscriptId: string; canManage: boolean }) {
  const [phases, setPhases] = useState<CorrectionPhaseState[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = () => getCorrectionCycle(manuscriptId).then(setPhases).catch(() => setPhases([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId]);

  async function deposit(key: string, file: File) {
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

  const requiredMissing = phases.filter((p) => p.required && !p.has_file);

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 12 }}>
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>Correction en deux temps</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
        Le correcteur rend d'abord un <strong>rapport de correction</strong>, puis les corrections sont <strong>intégrées</strong> ;
        une <strong>2e relecture</strong> et une <strong>intégration finale</strong> closent le cycle. Le passage à la mise en page
        est bloqué tant que le rapport et la version finale intégrée ne sont pas déposés.
      </p>
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {phases.map((p, i) => (
          <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px" }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 12 }}>{i + 1}.</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {p.label}
                {p.required && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "var(--eclosion-retard, #C4661F)" }}>OBLIGATOIRE</span>}
              </div>
              {p.has_file ? (
                <a href={stepAttachmentDownloadUrl(manuscriptId, p.version_id!)} download style={{ fontSize: 12, color: "var(--eclosion-dark)", fontWeight: 600 }}>
                  ⬇️ {p.filename ?? "Télécharger le fichier"}
                </a>
              ) : (
                <span style={{ fontSize: 12, color: p.required ? "var(--eclosion-retard, #C4661F)" : "var(--muted)" }}>
                  {p.required ? "À déposer (bloque la suite)" : "Optionnel — non déposé"}
                </span>
              )}
            </div>
            <span aria-hidden style={{ fontSize: 16 }}>{p.has_file ? "✅" : p.required ? "⛔" : "—"}</span>
            {canManage && (
              <label style={{ cursor: busyKey === p.key ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
                {busyKey === p.key ? "Envoi…" : p.has_file ? "Remplacer" : "Déposer"}
                <input
                  ref={(el) => { inputs.current[p.key] = el; }}
                  type="file"
                  style={{ display: "none" }}
                  disabled={busyKey === p.key}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) deposit(p.key, f); e.target.value = ""; }}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      {requiredMissing.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--eclosion-retard, #C4661F)", marginTop: 10, marginBottom: 0 }}>
          Manque avant de poursuivre : {requiredMissing.map((p) => p.label).join(" ; ")}.
        </p>
      )}
    </section>
  );
}
