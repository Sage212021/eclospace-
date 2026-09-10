import { useEffect, useState } from "react";
import { listManuscriptTrash, restoreStepDocument, type TrashItem } from "../api/client";

// Corbeille du dossier (cahier des charges IA §45) : les productions IA et
// pièces de travail RETIRÉES du dossier actif (suppression logique) restent
// consultables ici et peuvent être RESTAURÉES. Discret par défaut : masqué quand
// la corbeille est vide ; sinon un simple indicateur dépliable. Le manuscrit
// source original et les pièces protégées n'y arrivent jamais (règle serveur).
export function AiTrashSection({ manuscriptId }: { manuscriptId: string }) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => listManuscriptTrash(manuscriptId).then(setItems).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [manuscriptId]);

  async function restore(id: string) {
    setBusy(id); setErr(null);
    try {
      await restoreStepDocument(manuscriptId, id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Restauration impossible.");
    } finally {
      setBusy(null);
    }
  }

  // Rien à afficher tant que la corbeille est vide : on n'encombre pas le dossier.
  if (items.length === 0) return null;

  return (
    <details style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 0, marginTop: 12, background: "var(--bg, #fff)" }}>
      <summary style={{ cursor: "pointer", padding: "10px 14px", fontSize: 13, fontWeight: 600, userSelect: "none" }}>
        🗑️ Corbeille du dossier : {items.length} élément{items.length > 1 ? "s" : ""}
      </summary>
      <div style={{ padding: "0 14px 12px" }}>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 8px", lineHeight: 1.6 }}>
          Pièces de travail retirées du dossier actif (rapports IA, versions réécrites non retenues…). Rien n'est
          détruit : le manuscrit original et les versions validées ne sont jamais ici. Vous pouvez restaurer une pièce
          dans le dossier.
        </p>
        {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "grid", gap: 6 }}>
          {items.map((it) => (
            <div key={it.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>{it.title}</span>
              <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>retiré le {new Date(it.deleted_at).toLocaleDateString("fr-FR")}</span>
              {it.can_restore ? (
                <button
                  type="button"
                  onClick={() => restore(it.id)}
                  disabled={busy === it.id}
                  style={{ background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "3px 12px", fontSize: 12, fontWeight: 700, cursor: busy === it.id ? "default" : "pointer" }}
                >
                  {busy === it.id ? "Restauration…" : "Restaurer"}
                </button>
              ) : (
                <span style={{ color: "var(--muted)", fontStyle: "italic" }}>restauration réservée à l'auteur du retrait ou à la direction</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
