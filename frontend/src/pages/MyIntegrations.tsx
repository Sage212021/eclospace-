import { useEffect, useRef, useState } from "react";
import { listMyCorrectionIntegrations, getCoverCorrectionCycle, uploadCorrectionPhase, stepAttachmentDownloadUrl, type MyIntegrationItem, type CorrectionPhaseState } from "../api/client";
import { GuidanceNote } from "../components/GuidanceNote";
import { CorrectionAnomaliesPanel } from "../components/CorrectionAnomaliesPanel";
import { CorrectionCyclePanel } from "../components/CorrectionCyclePanel";

// Phases de couverture DÉPOSÉES PAR L'INFOGRAPHE (retour vers le correcteur) —
// doit rester aligné sur COVER_INTEGRATION_KEYS (backend correctionCycle.ts).
const COVER_DEPOT_KEYS = new Set(["couverture_integration_1", "couverture_finale"]);

// Espace COUVERTURE de l'infographe : il télécharge ici les rapports de correction
// déposés par le correcteur (1ʳᵉ · dos · 4ᵉ, puis 2ᵉ relecture) ET dépose en retour
// sa couverture intégrée (BAT2) puis la couverture corrigée finale — que le
// correcteur récupère aussitôt dans « Mes corrections ». Circuit aller-retour
// complet (D-069), symétrique de la branche texte.
function CoverReports({ manuscriptId }: { manuscriptId: string }) {
  const [phases, setPhases] = useState<CorrectionPhaseState[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = () => getCoverCorrectionCycle(manuscriptId).then(setPhases).catch(() => setPhases([]));
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

  const reports = (phases ?? []).filter((p) => !COVER_DEPOT_KEYS.has(p.key));
  const depots = (phases ?? []).filter((p) => COVER_DEPOT_KEYS.has(p.key));
  const withReport = reports.filter((p) => p.has_file);

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper, #FAF8F2)", padding: 14, marginTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Rapports de correction reçus du correcteur</div>
      {withReport.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>Aucun rapport de couverture déposé pour l'instant par le correcteur.</p>
      ) : (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {withReport.map((p) => (
            <div key={p.key} style={{ fontSize: 12.5 }}>
              <a href={stepAttachmentDownloadUrl(manuscriptId, p.version_id!)} download style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>⬇️ {p.label}</a>
              <span style={{ color: "var(--muted)" }}> — {p.filename ?? "fichier"}{p.created_at ? ` · ${new Date(p.created_at).toLocaleDateString("fr-FR")}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Retours de l'infographe → renvoyés au correcteur (couverture intégrée BAT2,
          puis couverture corrigée finale). */}
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 14 }}>Vos retours à déposer (renvoyés au correcteur)</div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 8px" }}>
        Après avoir appliqué les corrections sur les fichiers (1ʳᵉ · dos · 4ᵉ), déposez ici votre <strong>couverture intégrée</strong> :
        le correcteur la voit aussitôt dans « Mes corrections » et lance la 2ᵉ relecture dessus. Déposez ensuite la <strong>couverture corrigée finale</strong>.
      </p>
      {error && <div style={{ background: "var(--alert-soft, #F6E0DC)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "grid", gap: 8 }}>
        {depots.map((p) => (
          <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, background: "#fff", padding: "9px 12px" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
              {p.has_file ? (
                <div>
                  <a href={stepAttachmentDownloadUrl(manuscriptId, p.version_id!)} download style={{ fontSize: 12, color: "var(--eclosion-dark)", fontWeight: 600 }}>⬇️ {p.filename ?? "Télécharger le fichier"}</a>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {[
                      p.created_at ? `Renvoyé le ${new Date(p.created_at).toLocaleDateString("fr-FR")}` : null,
                      p.uploaded_by_name ? `par ${p.uploaded_by_name}` : null,
                      p.version_number ? `v${p.version_number}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>À déposer quand vous êtes prêt</span>
              )}
            </div>
            <span aria-hidden style={{ fontSize: 16 }}>{p.has_file ? "✅" : "—"}</span>
            <label style={{ cursor: busyKey === p.key ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
              {busyKey === p.key ? "Envoi…" : p.has_file ? "Remplacer" : "Déposer"}
              <input ref={(el) => { inputs.current[p.key] = el; }} type="file" style={{ display: "none" }} disabled={busyKey === p.key} onChange={(e) => { const f = e.target.files?.[0]; if (f) deposit(p.key, f); e.target.value = ""; }} />
            </label>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>Une fois la couverture corrigée finale déposée et validée par le correcteur, le dossier de <strong>BAT</strong> pourra s'ouvrir.</p>
    </section>
  );
}

// Espace personnel de l'INTÉGRATEUR (parallèle de « Mes lectures » / « Mes
// corrections »). Il voit uniquement les ouvrages qu'on lui a confiés, avec les
// corrections retenues (acceptées/modifiées) à appliquer dans le fichier — qu'il
// coche une par une — puis dépose la version intégrée (BAT2) et la version
// finale (VCF). Branche TEXTE (la couverture, gérée par l'infographe, arrive en
// 2ᵉ temps).

export function MyIntegrations() {
  const [items, setItems] = useState<MyIntegrationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = () =>
    listMyCorrectionIntegrations()
      .then((r) => { setItems(r.manuscripts); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { refresh(); }, []);

  return (
    <section>
      <h2 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: "0 0 8px" }}>Mes intégrations de correction</h2>
      <GuidanceNote title="Votre rôle d'intégrateur">
        Vous recevez ici les ouvrages dont on vous a confié l'intégration des corrections. Pour chacun : appliquez dans le fichier
        les corrections <strong>acceptées / modifiées</strong> par le correcteur, puis <strong>cochez</strong> chaque correction
        (Intégrée · À revoir · Non applicable). Déposez ensuite la version intégrée (BAT2) puis la version finale (VCF) — la version
        finale ne se dépose qu'une fois <strong>tout intégré</strong>.
      </GuidanceNote>

      {error && <div style={{ fontSize: 13, color: "var(--alert, #B23A2E)", margin: "8px 0" }}>{error}</div>}
      {items.length === 0 && !error && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>Aucun ouvrage à intégrer pour l'instant. Dès qu'un correcteur vous confie un manuscrit et accepte des corrections, il apparaîtra ici.</div>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {items.map((m) => {
          const rowKey = `${m.branch}:${m.id}`;
          const restant = m.counts.a_integrer + m.counts.a_revoir;
          const open = openId === rowKey;
          const isCover = m.branch === "couverture";
          return (
            <div key={rowKey} style={{ border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : rowKey)}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
              >
                <span aria-hidden style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
                <span style={{ fontWeight: 700 }}>{m.title}</span>
                <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "1px 9px", background: isCover ? "var(--eclosion-soft)" : "#E7EAF0", color: isCover ? "var(--eclosion-dark, #9A7A12)" : "#5B6472" }}>
                  {isCover ? "Couverture" : "Texte"}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{m.manuscript_number}</span>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· {m.status_label}</span>
                <span
                  style={{
                    marginLeft: "auto", fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "2px 10px",
                    background: restant > 0 ? "var(--amber-soft, #F6E7D2)" : "var(--eclosion-soft)",
                    color: restant > 0 ? "#B87400" : "#2F7D4A",
                  }}
                >
                  {m.counts.total === 0 ? "aucune correction retenue" : restant > 0 ? `${restant} à intégrer` : "tout intégré ✅"}
                </span>
              </button>
              {open && (
                <div style={{ padding: "0 14px 14px" }}>
                  <CorrectionAnomaliesPanel manuscriptId={m.id} canDecide={false} integrationMode canIntegrate branchFilter={m.branch} />
                  {isCover ? (
                    <CoverReports manuscriptId={m.id} />
                  ) : (
                    /* Intégrateur TEXTE : on masque la section couverture
                       (pilotée par le correcteur, reçue par l'infographe). */
                    <CorrectionCyclePanel manuscriptId={m.id} canManage showCover={false} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
