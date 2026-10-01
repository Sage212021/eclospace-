import { useEffect, useState } from "react";
import { getCorrectionCycles, type CorrectionCycleHistory, type CorrectionCycleMovement } from "../api/client";

// HISTORIQUE DES CYCLES DE CORRECTION ÉDITORIALE (Phase 2 — demande opérateur
// 01/10/2026). Un panneau repliable qui montre, pour chaque cycle de l'ouvrage :
//   • sa référence (COR-AAAA-NNN) et son numéro (Correction #N) ;
//   • son statut (En cours / Terminée) ;
//   • la frise de tous ses mouvements (date/heure, utilisateur, rôle,
//     destinataire, motif, observations, version concernée, statut de l'étape) ;
//   • pour un cycle clos : la fiche de clôture (qui, quand, version finale).
// Objectif : tracer « qui a fait quoi » sans jamais confondre les allers-retours
// d'un même cycle avec de nouvelles corrections.

const KIND_LABEL: Record<CorrectionCycleMovement["kind"], string> = {
  opened: "Ouverture du cycle",
  deposit: "Dépôt",
  reassign: "Réaffectation",
  closed: "Clôture",
  note: "Note",
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function CorrectionCycleHistoryPanel({ manuscriptId }: { manuscriptId: string }) {
  const [open, setOpen] = useState(false);
  const [cycles, setCycles] = useState<CorrectionCycleHistory[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || cycles) return;
    setLoading(true);
    getCorrectionCycles(manuscriptId)
      .then(setCycles)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  }, [open, cycles, manuscriptId]);

  return (
    <div style={{ marginTop: 10, border: "1px solid #e4ddc7", borderRadius: 10, background: "var(--ivory, #FAF8F2)", overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: "11px 14px", fontSize: 13.5, fontWeight: 700, color: "#0B0B0C", display: "flex", alignItems: "center", gap: 8 }}
      >
        <span>🗂️ Historique du cycle de correction</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-soft, #6b6b6b)" }}>{open ? "▾ masquer" : "▸ afficher"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          {loading && <p style={{ fontSize: 12.5, color: "var(--ink-soft, #6b6b6b)" }}>Chargement…</p>}
          {error && <p style={{ fontSize: 12.5, color: "#B23A2E" }}>{error}</p>}
          {!loading && !error && cycles && cycles.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--ink-soft, #6b6b6b)" }}>Aucun cycle de correction ouvert pour cet ouvrage pour l'instant.</p>
          )}
          {!loading && !error && cycles && cycles.map((c) => (
            <div key={c.id} style={{ marginTop: 10, border: "1px solid #e4ddc7", borderRadius: 8, background: "#fff", padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: "#0B0B0C" }}>Correction #{c.cycleNumber}</span>
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, fontWeight: 700, color: "#0B0B0C", background: "var(--ivory, #FAF8F2)", border: "1px solid #e4ddc7", borderRadius: 6, padding: "1px 7px" }}>{c.reference}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: c.status === "terminee" ? "#2F7D4A" : "#B87400", background: c.status === "terminee" ? "#e9f3ec" : "#fbf1dd", border: `1px solid ${c.status === "terminee" ? "#2F7D4A" : "#B87400"}`, borderRadius: 6, padding: "1px 7px" }}>
                  {c.status === "terminee" ? "Terminée" : "En cours"}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft, #6b6b6b)", marginTop: 3 }}>
                Ouverte le {fmt(c.openedAt)}{c.openedByName ? ` par ${c.openedByName}` : ""}.
              </div>

              {/* Fiche de clôture (cycle terminé). */}
              {c.status === "terminee" && (
                <div style={{ marginTop: 8, background: "#e9f3ec", border: "1px solid #2F7D4A", borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: "#2F7D4A" }}>Clôture</div>
                  <div style={{ color: "var(--ink)", marginTop: 2 }}>
                    Le {fmt(c.closedAt)}{c.closedByName ? ` par ${c.closedByName}` : ""}.
                    {c.finalVersionId ? " Version corrigée finale enregistrée." : ""}
                  </div>
                  {c.closureNote && <div style={{ color: "var(--ink)", marginTop: 2, fontStyle: "italic" }}>« {c.closureNote} »</div>}
                </div>
              )}

              {/* Frise des mouvements. */}
              <div style={{ marginTop: 8 }}>
                {c.movements.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-soft, #6b6b6b)" }}>Aucun mouvement enregistré.</p>}
                {c.movements.map((m) => (
                  <div key={m.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px dashed #ece6d4" }}>
                    <div style={{ minWidth: 118, fontSize: 11.5, color: "var(--ink-soft, #6b6b6b)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{fmt(m.at)}</div>
                    <div style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.5 }}>
                      <strong>{KIND_LABEL[m.kind] ?? m.kind}</strong>
                      {m.userName ? ` — ${m.userName}` : ""}
                      {m.userRole ? ` (${m.userRole})` : ""}
                      {m.recipientName ? ` → ${m.recipientName}` : ""}
                      {m.stepStatus ? <span style={{ color: "var(--ink-soft, #6b6b6b)" }}>{` · étape ${m.stepStatus}`}</span> : ""}
                      {m.documentVersionId ? <span style={{ color: "var(--ink-soft, #6b6b6b)" }}> · fichier joint</span> : ""}
                      {m.motive ? <div style={{ color: "var(--ink)" }}>Motif : {m.motive}</div> : null}
                      {m.observations ? <div style={{ color: "var(--ink)", fontStyle: "italic" }}>« {m.observations} »</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
