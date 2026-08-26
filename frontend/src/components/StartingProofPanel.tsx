import { useEffect, useRef, useState } from "react";
import { getVc1, uploadVc1, deleteStepDocument, stepAttachmentDownloadUrl, type Vc1SlotState } from "../api/client";

// « Version à corriger » (VC1) — dossier de départ déposé à la Planification du
// projet, en deux points : le manuscrit à corriger et les couvertures à corriger
// (1ère + dos + 4ème réunies en un seul fichier). C'est la matière que le
// correcteur travaillera aux étapes suivantes.
export function StartingProofPanel({ manuscriptId, canManage }: { manuscriptId: string; canManage: boolean }) {
  const [slots, setSlots] = useState<Vc1SlotState[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = () => getVc1(manuscriptId).then(setSlots).catch(() => setSlots([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId]);

  async function deposit(key: string, file: File) {
    setBusyKey(key);
    setError(null);
    try {
      await uploadVc1(manuscriptId, key, file);
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

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 12 }}>
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>Version à corriger (VC1)</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
        Dossier de départ transmis à la correction, en deux points : le <strong>manuscrit à corriger</strong> et les
        <strong> couvertures à corriger</strong> — 1ère, dos et 4ème réunies en <strong>un seul fichier</strong>. Facultatif ;
        se dépose et se remplace librement.
      </p>
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {slots.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
              {s.has_file ? (
                <a href={stepAttachmentDownloadUrl(manuscriptId, s.version_id!)} download style={{ fontSize: 12, color: "var(--eclosion-dark)", fontWeight: 600 }}>
                  ⬇️ {s.filename ?? "Télécharger le fichier"}
                </a>
              ) : (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Non déposé</span>
              )}
            </div>
            <span aria-hidden style={{ fontSize: 16 }}>{s.has_file ? "✅" : "—"}</span>
            {canManage && (
              <label style={{ cursor: busyKey === s.key ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
                {busyKey === s.key ? "Envoi…" : s.has_file ? "Remplacer" : "Déposer"}
                <input
                  ref={(el) => { inputs.current[s.key] = el; }}
                  type="file"
                  style={{ display: "none" }}
                  disabled={busyKey === s.key}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) deposit(s.key, f); e.target.value = ""; }}
                />
              </label>
            )}
            {canManage && s.has_file && s.can_correct && s.doc_id && (
              <button onClick={() => remove(s.key, s.doc_id!)} disabled={busyKey === s.key} style={{ fontWeight: 600, color: "var(--alert)", background: "#fff", border: "1px solid var(--alert)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: busyKey === s.key ? "default" : "pointer" }}>
                Retirer
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
