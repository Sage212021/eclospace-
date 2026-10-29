import { useEffect, useState } from "react";
import { getAuthorImprovementGuide, setAuthorObservationStatus, type AuthorGuideObservation } from "../../api/client";

// Accompagnement de l'auteur (Phase 3) : une fois le guide validé par le comité,
// l'auteur consulte ses recommandations (et les propositions retenues) et suit
// sa propre progression de révision. Rien ne s'affiche tant que le comité n'a
// pas transmis le guide.

const STATUS_LABELS: Record<string, string> = { a_traiter: "À traiter", en_cours: "En cours", traite: "Traité" };
const AUTHOR_STATUSES = ["a_traiter", "en_cours", "traite"];
const PRIORITY_LABELS: Record<string, string> = { majeure: "Majeure", importante: "Importante", secondaire: "Secondaire" };
const PRIORITY_COLOR: Record<string, string> = { majeure: "#B23A2E", importante: "#B87400", secondaire: "#667085" };

export function AuthorImprovementGuideSection({ workId }: { workId: string }) {
  const [obs, setObs] = useState<AuthorGuideObservation[] | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { const r = await getAuthorImprovementGuide(workId); setAvailable(r.available); setObs(r.observations); }
    catch { setAvailable(false); setObs([]); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workId]);

  if (!available || !obs || obs.length === 0) return null;

  async function setStatus(obsId: string, status: "a_traiter" | "en_cours" | "traite") {
    setBusy(true); setErr(null);
    try { await setAuthorObservationStatus(workId, obsId, status); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Mise à jour impossible."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "var(--marine, #0b0b0c)", marginTop: 22 }}>Recommandations d'amélioration</h4>
      <p style={{ fontSize: 12.5, color: "var(--muted, #667085)", margin: "0 0 10px" }}>
        Le comité éditorial vous transmet ces recommandations pour améliorer votre manuscrit. Suivez votre avancement sur chaque point.
      </p>
      {err && <p style={{ fontSize: 12.5, color: "#B23A2E" }}>{err}</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {obs.map((o) => (
          <div key={o.id} style={{ border: "1px solid var(--line, #E3E8EF)", borderRadius: 8, padding: "9px 12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 700 }}>{o.code}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_COLOR[o.priority] ?? "#667085" }}>{PRIORITY_LABELS[o.priority] ?? o.priority}</span>
              {o.title && <span style={{ fontSize: 13.5, fontWeight: 600 }}>{o.title}</span>}
              <span style={{ marginLeft: "auto", fontSize: 12 }}>
                <select value={o.status} disabled={busy} onChange={(e) => setStatus(o.id, e.target.value as "a_traiter" | "en_cours" | "traite")} style={{ padding: "4px 7px", border: "1px solid var(--line, #E3E8EF)", borderRadius: 6, fontSize: 12 }}>
                  {AUTHOR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </span>
            </div>
            {o.location && <div style={{ fontSize: 12, color: "var(--muted, #667085)", marginTop: 3 }}>Localisation : {o.location}</div>}
            {o.recommendation && <div style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{o.recommendation}</div>}
            {o.proposal && (
              <div style={{ fontSize: 12.5, marginTop: 5, borderLeft: "3px solid #2F7D4A", padding: "2px 8px", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                <b>Proposition retenue :</b> {o.proposal}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
