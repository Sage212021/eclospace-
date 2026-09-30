import { useEffect, useState } from "react";
import {
  createImageAsset,
  deleteImageAsset,
  getProductionSpecs,
  listImageAssets,
  updateProductionSpecs,
  type ImageAsset,
  type ImageAssetType,
  type ProductionSpecs,
  type RightsOrigin,
} from "../api/client";

interface ProductionSectionProps {
  manuscriptId: string;
  canManage: boolean;
}

const IMAGE_TYPE_LABELS: Record<ImageAssetType, string> = {
  couverture_1: "Couverture 1",
  couverture_4: "Couverture 4",
  dos: "Dos",
  rabat: "Rabat",
  illustration_interieure: "Illustration intérieure",
  visuel_marketing: "Visuel marketing",
};

// Maquette (Ch. 11) et Infographie (Ch. 12) : fiche technique de fabrication
// avec calcul automatique du dos, et visuels avec contrôle technique/droits.
export function ProductionSection({ manuscriptId, canManage }: ProductionSectionProps) {
  const [specs, setSpecs] = useState<ProductionSpecs | null>(null);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Fiche repliée (résumé) une fois enregistrée ; « Modifier » la rouvre.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ trim_format: "", final_pages: "", paper_interior: "", paper_interior_gsm: "", paper_cover: "", binding: "", lamination: "", typeface: "", font_size_pt: "", leading: "", margins: "", layout_name: "" });

  const refresh = async () => {
    const [s, a] = await Promise.all([getProductionSpecs(manuscriptId), listImageAssets(manuscriptId)]);
    setSpecs(s);
    setAssets(a);
    if (s) {
      setForm({
        trim_format: s.trimFormat ?? "",
        final_pages: s.finalPages?.toString() ?? "",
        paper_interior: s.paperInterior ?? "",
        paper_interior_gsm: s.paperInteriorGsm?.toString() ?? "",
        paper_cover: s.paperCover ?? "",
        binding: s.binding ?? "",
        lamination: s.lamination ?? "",
        typeface: s.typeface ?? "",
        font_size_pt: s.fontSizePt ?? "",
        leading: s.leading ?? "",
        margins: s.margins ?? "",
        layout_name: s.layoutName ?? "",
      });
    }
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateProductionSpecs(manuscriptId, {
        trim_format: form.trim_format || undefined,
        final_pages: form.final_pages ? Number(form.final_pages) : undefined,
        paper_interior: form.paper_interior || undefined,
        paper_interior_gsm: form.paper_interior_gsm ? Number(form.paper_interior_gsm) : undefined,
        paper_cover: form.paper_cover || undefined,
        binding: form.binding || undefined,
        lamination: form.lamination || undefined,
        typeface: form.typeface || undefined,
        font_size_pt: form.font_size_pt || undefined,
        leading: form.leading || undefined,
        margins: form.margins || undefined,
        layout_name: form.layout_name || undefined,
      });
      await refresh();
      setEditing(false); // la fiche se replie en résumé après enregistrement
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    }
  }

  async function handleAddAsset() {
    const type = window.prompt(`Type de visuel (${Object.keys(IMAGE_TYPE_LABELS).join(", ")})`, "couverture_1") as ImageAssetType | null;
    if (!type || !(type in IMAGE_TYPE_LABELS)) return;
    const dpi = Number(window.prompt("Résolution (dpi)", "300") ?? "0");
    const colorMode = window.prompt("Mode colorimétrique (CMJN, RVB...)", "CMJN") ?? undefined;
    const rightsOrigin = window.prompt("Origine des droits (creation_interne, banque_images, fourni_par_auteur)", "creation_interne") as RightsOrigin | undefined;
    try {
      await createImageAsset(manuscriptId, { type, resolution_dpi: dpi || undefined, color_mode: colorMode, rights_origin: rightsOrigin });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ajout du visuel.");
    }
  }

  // La fiche est considérée « renseignée » dès que l'essentiel est saisi → on
  // la présente alors repliée (résumé) plutôt qu'en grand formulaire ouvert.
  const hasFilledSpecs = !!(specs && (specs.trimFormat || specs.finalPages || specs.paperInterior || specs.paperCover || specs.binding));

  return (
    <div id="fiche-technique-fabrication" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16, scrollMarginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Fiche technique de fabrication</div>
      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {specs?.spineNeedsRecalc && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "6px 10px", fontSize: 12, marginBottom: 10 }}>
          Le nombre de pages ou le papier a changé : le dos doit être recalculé.
        </div>
      )}

      {hasFilledSpecs && !editing ? (
        // Fiche REPLIÉE : résumé rassurant + « Modifier ». Évite de laisser un
        // grand formulaire ouvert une fois la fiche renseignée (demande opérateur).
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--valid, #2F7D4A)" }}>✓ Fiche technique enregistrée</span>
            {canManage && (
              <button type="button" onClick={() => { setEditing(true); setSaved(false); }} style={{ ...secondaryButtonStyle }}>
                Modifier
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 12.5 }}>
            <SummaryRow label="Format" value={specs?.trimFormat} />
            <SummaryRow label="Pages" value={specs?.finalPages?.toString()} />
            <SummaryRow label="Papier intérieur" value={[specs?.paperInterior, specs?.paperInteriorGsm ? `${specs.paperInteriorGsm} g/m²` : null].filter(Boolean).join(" · ")} />
            <SummaryRow label="Papier couverture" value={specs?.paperCover} />
            <SummaryRow label="Façonnage" value={specs?.binding} />
            <SummaryRow label="Pelliculage" value={specs?.lamination} />
            <SummaryRow label="Gabarit / collection" value={specs?.layoutName} />
            <SummaryRow label="Police" value={specs?.typeface} />
            <SummaryRow label="Corps de texte" value={specs?.fontSizePt} />
            <SummaryRow label="Interlignage" value={specs?.leading} />
            <SummaryRow label="Marges" value={specs?.margins} />
          </div>
        </div>
      ) : (
      <form onSubmit={handleSave}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 12 }}>
            Format
            <input disabled={!canManage} value={form.trim_format} onChange={(e) => setForm({ ...form, trim_format: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Pages
            <input disabled={!canManage} type="number" value={form.final_pages} onChange={(e) => setForm({ ...form, final_pages: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Papier intérieur
            <input disabled={!canManage} value={form.paper_interior} onChange={(e) => setForm({ ...form, paper_interior: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Grammage intérieur (g/m²)
            <input disabled={!canManage} type="number" value={form.paper_interior_gsm} onChange={(e) => setForm({ ...form, paper_interior_gsm: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Papier couverture
            <input disabled={!canManage} value={form.paper_cover} onChange={(e) => setForm({ ...form, paper_cover: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Façonnage
            <input disabled={!canManage} value={form.binding} onChange={(e) => setForm({ ...form, binding: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Pelliculage
            <input disabled={!canManage} value={form.lamination} onChange={(e) => setForm({ ...form, lamination: e.target.value })} style={inputStyle} />
          </label>
        </div>

        {/* Composition / typographie (Ch. 11 §11.4) — caractéristiques d'écriture,
            facultatives et toujours modifiables. */}
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", margin: "14px 0 8px" }}>Composition / typographie</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 12 }}>
            Gabarit / collection
            <input disabled={!canManage} placeholder="ex. Roman — collection Éclats" value={form.layout_name} onChange={(e) => setForm({ ...form, layout_name: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Police
            <input disabled={!canManage} placeholder="ex. Garamond" value={form.typeface} onChange={(e) => setForm({ ...form, typeface: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Corps de texte
            <input disabled={!canManage} placeholder="ex. 11 pt" value={form.font_size_pt} onChange={(e) => setForm({ ...form, font_size_pt: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>
            Interlignage
            <input disabled={!canManage} placeholder="ex. 14 pt" value={form.leading} onChange={(e) => setForm({ ...form, leading: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12, gridColumn: "span 2" }}>
            Marges
            <input disabled={!canManage} placeholder="ex. H 20 / B 20 / int 18 / ext 15 mm" value={form.margins} onChange={(e) => setForm({ ...form, margins: e.target.value })} style={inputStyle} />
          </label>
        </div>
        {canManage && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            <button type="submit" style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>
              Enregistrer
            </button>
            {hasFilledSpecs && (
              <button type="button" onClick={() => { setEditing(false); refresh().catch(() => {}); }} style={secondaryButtonStyle}>
                Annuler
              </button>
            )}
            {saved && (
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--valid, #2F7D4A)" }}>✓ Enregistré</span>
            )}
          </div>
        )}
      </form>
      )}

      {specs?.spineWidthMm && (
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 13, marginTop: 10 }}>Épaisseur du dos calculée : {specs.spineWidthMm} mm</p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Visuels</div>
        {canManage && (
          <button onClick={handleAddAsset} style={secondaryButtonStyle}>
            + Ajouter un visuel
          </button>
        )}
      </div>
      {assets.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun visuel déposé.</p>}
      {assets.map((asset) => (
        <div key={asset.id} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
          <span>{IMAGE_TYPE_LABELS[asset.type]}</span>
          <span style={{ display: "flex", gap: 8, fontSize: 11 }}>
            <span style={{ color: "var(--muted)" }}>{asset.resolutionDpi ?? "—"} dpi · {asset.colorMode ?? "—"}</span>
            <span
              style={{
                background: asset.technicalOk ? "var(--eclosion-soft)" : "var(--alert-soft)",
                color: asset.technicalOk ? "var(--eclosion)" : "var(--alert)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              {asset.technicalOk ? "Conforme" : "Non conforme"}
            </span>
            {!asset.rightsOrigin && (
              <span style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 999, padding: "2px 8px" }}>Sans droits</span>
            )}
            {canManage && asset.can_correct && (
              <button
                onClick={async () => {
                  if (!window.confirm("Retirer ce visuel déposé par erreur ? Vous pourrez en déposer un autre.")) return;
                  try { await deleteImageAsset(manuscriptId, asset.id); await refresh(); }
                  catch (e) { setError(e instanceof Error ? e.message : "Retrait impossible."); }
                }}
                style={{ color: "var(--alert)", background: "none", border: "none", fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 11 }}
              >
                Retirer
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13 };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};

// Ligne de résumé de la fiche repliée (libellé + valeur, ou « — » si vide).
function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
      <span style={{ color: "var(--muted)", flexShrink: 0 }}>{label} :</span>
      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value && value.trim() ? value : "—"}</span>
    </div>
  );
}
