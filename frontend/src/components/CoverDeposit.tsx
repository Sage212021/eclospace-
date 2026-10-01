import { useEffect, useRef, useState } from "react";
import {
  listImageAssets,
  uploadImageAssetFile,
  deleteImageAsset,
  imageAssetFileUrl,
  type ImageAsset,
  type ImageAssetType,
} from "../api/client";

// Dépôt de la COUVERTURE par l'infographe (demande opérateur 01/10/2026).
// Deux modes AU CHOIX (panneau dépliable) :
//  • « Un seul fichier » : la couverture complète en une image (sert aussi
//    d'aperçu pour le site).
//  • « Pièces séparées » : 1ère de couverture, 4e, dos — chacune téléversée.
// Dans tous les cas, la 1ère de couverture (couverture_1) est l'image qui
// ALIMENTE LE SITE (catalogue). Les fichiers sont de vraies images téléversées
// (pas seulement des métadonnées) pour pouvoir s'afficher.
const LABELS: Record<ImageAssetType, string> = {
  couverture_1: "1ère de couverture",
  couverture_4: "4e de couverture",
  dos: "Dos",
  rabat: "Rabat",
  illustration_interieure: "Illustration intérieure",
  visuel_marketing: "Visuel marketing",
};

export function CoverDeposit({ manuscriptId, canManage }: { manuscriptId: string; canManage: boolean }) {
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "pieces">("single");
  const [busy, setBusy] = useState<ImageAssetType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => listImageAssets(manuscriptId).then(setAssets).catch(() => setAssets([]));
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId]);

  const byType = (t: ImageAssetType) => assets.find((a) => a.type === t && a.has_file);
  const cover1 = byType("couverture_1");

  async function upload(type: ImageAssetType, file: File) {
    setBusy(type); setError(null); setMsg(null);
    try {
      await uploadImageAssetFile(manuscriptId, type, file);
      setMsg(`${LABELS[type]} déposée.${type === "couverture_1" ? " Elle alimentera le catalogue du site." : ""}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(asset: ImageAsset) {
    if (!window.confirm(`Retirer « ${LABELS[asset.type]} » ? Vous pourrez en déposer une autre.`)) return;
    setError(null);
    try { await deleteImageAsset(manuscriptId, asset.id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Retrait impossible."); }
  }

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Couverture (impression + site)</div>
        {cover1
          ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--valid, #2F7D4A)" }}>✓ 1ère de couverture déposée</span>
          : <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--eclosion-retard, #C4661F)" }}>1ère de couverture manquante (pour le site)</span>}
        {canManage && (
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...btn, background: open ? "var(--eclosion, #D9B21A)" : "#fff", color: open ? "#0B0B0C" : "var(--eclosion-dark, #9a7a12)" }}>
            {open ? "Masquer ▴" : "Déposer / gérer la couverture ▾"}
          </button>
        )}
      </div>

      {/* Aperçu des pièces déjà déposées (vignettes). */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        {(["couverture_1", "couverture_4", "dos"] as ImageAssetType[]).map((t) => {
          const a = byType(t);
          if (!a) return null;
          return (
            <figure key={t} style={{ margin: 0, textAlign: "center" }}>
              <img src={imageAssetFileUrl(manuscriptId, a.id)} alt={LABELS[t]} style={{ width: 82, height: 116, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", background: "#fff" }} />
              <figcaption style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                {LABELS[t]}{t === "couverture_1" ? " · site" : ""}
                {canManage && a.can_correct && (
                  <><br /><button type="button" onClick={() => remove(a)} style={{ color: "var(--alert)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 11 }}>Retirer</button></>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>

      {open && canManage && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {/* D — choix du mode de livraison de la couverture. */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 10 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="covermode" checked={mode === "single"} onChange={() => setMode("single")} /> Un seul fichier (couverture complète)
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="covermode" checked={mode === "pieces"} onChange={() => setMode("pieces")} /> Pièces séparées (1ère, 4e, dos)
            </label>
          </div>

          {mode === "single" ? (
            <UploadRow label="Couverture complète (image — sert aussi d'aperçu pour le site)" type="couverture_1" busy={busy === "couverture_1"} onPick={upload} />
          ) : (
            <>
              <UploadRow label="1ère de couverture (image pour le site)" type="couverture_1" busy={busy === "couverture_1"} onPick={upload} />
              <UploadRow label="4e de couverture" type="couverture_4" busy={busy === "couverture_4"} onPick={upload} />
              <UploadRow label="Dos" type="dos" busy={busy === "dos"} onPick={upload} />
            </>
          )}
          <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
            Formats image (JPEG, PNG…). La 1ère de couverture est celle qui s'affichera sur le catalogue du site.
          </p>
        </div>
      )}

      {msg && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, marginTop: 10 }}>{msg}</div>}
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
    </section>
  );
}

function UploadRow({ label, type, busy, onPick }: { label: string; type: ImageAssetType; busy: boolean; onPick: (t: ImageAssetType, f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
      <span style={{ fontSize: 13, flex: 1, minWidth: 180 }}>{label}</span>
      <label style={{ cursor: busy ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 11px", fontSize: 12.5 }}>
        {busy ? "Envoi…" : "Choisir une image"}
        <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(type, f); e.target.value = ""; }} />
      </label>
    </div>
  );
}

const btn: React.CSSProperties = {
  border: "1px solid var(--eclosion, #D9B21A)",
  borderRadius: 6,
  padding: "5px 11px",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};
