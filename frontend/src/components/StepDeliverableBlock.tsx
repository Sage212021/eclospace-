import { useEffect, useState } from "react";
import { getStepDeliverable, uploadStepDeliverable, deleteStepDocument, stepAttachmentDownloadUrl, type StepDeliverableMeta } from "../api/client";

// Livrable de sortie de l'étape courante (verrou « pas d'avancement sans le
// fichier attendu par l'étape suivante »). Ne s'affiche que si l'étape est
// soumise au verrou. Tant que le fichier n'est pas déposé, la validation de
// l'étape est refusée côté serveur.
export function StepDeliverableBlock({ manuscriptId, stepCode, canManage }: { manuscriptId: string; stepCode: string; canManage: boolean }) {
  const [meta, setMeta] = useState<StepDeliverableMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => getStepDeliverable(manuscriptId, stepCode).then(setMeta).catch(() => setMeta(null));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId, stepCode]);

  if (!meta || !meta.required) return null;

  async function deposit(file: File) {
    setBusy(true);
    setError(null);
    try {
      await uploadStepDeliverable(manuscriptId, stepCode, file);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!meta?.doc_id) return;
    if (!window.confirm("Retirer ce fichier déposé par erreur ? Vous pourrez en déposer un autre ensuite.")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteStepDocument(manuscriptId, meta.doc_id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrait impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span aria-hidden style={{ fontSize: 16 }}>{meta.has_file ? "✅" : "⛔"}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Livrable de l'étape — {meta.label}</div>
          {meta.has_file ? (
            <a href={stepAttachmentDownloadUrl(manuscriptId, meta.version_id!)} download style={{ fontSize: 12.5, color: "var(--eclosion-dark)", fontWeight: 600 }}>
              ⬇️ {meta.filename ?? "Télécharger le fichier"}
            </a>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--eclosion-retard, #C4661F)" }}>
              À déposer avant de valider l'étape — sans ce fichier, le passage à l'étape suivante est bloqué.
            </span>
          )}
        </div>
        {canManage && (
          <label style={{ cursor: busy ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 11px", fontSize: 12.5 }}>
            {busy ? "Envoi…" : meta.has_file ? "Remplacer" : "Déposer le livrable"}
            <input type="file" style={{ display: "none" }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) deposit(f); e.target.value = ""; }} />
          </label>
        )}
        {canManage && meta.can_correct && meta.has_file && (
          <button onClick={remove} disabled={busy} style={{ fontWeight: 600, color: "var(--alert)", background: "#fff", border: "1px solid var(--alert)", borderRadius: 6, padding: "5px 11px", fontSize: 12.5, cursor: busy ? "default" : "pointer" }}>
            Retirer
          </button>
        )}
      </div>
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, marginTop: 8 }}>{error}</div>}
    </section>
  );
}
