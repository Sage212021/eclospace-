import { useEffect, useState } from "react";
import { listMyCorrectionIntegrations, type MyIntegrationItem } from "../api/client";
import { GuidanceNote } from "../components/GuidanceNote";
import { CorrectionAnomaliesPanel } from "../components/CorrectionAnomaliesPanel";
import { CorrectionCyclePanel } from "../components/CorrectionCyclePanel";

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
          const restant = m.counts.a_integrer + m.counts.a_revoir;
          const open = openId === m.id;
          return (
            <div key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : m.id)}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
              >
                <span aria-hidden style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
                <span style={{ fontWeight: 700 }}>{m.title}</span>
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
                  <CorrectionAnomaliesPanel manuscriptId={m.id} canDecide={false} integrationMode canIntegrate />
                  <CorrectionCyclePanel manuscriptId={m.id} canManage />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
