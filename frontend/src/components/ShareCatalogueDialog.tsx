import { useEffect, useRef, useState } from "react";
import { catalogueCoverUrl, type CatalogueItem } from "../api/client";
import {
  type ShareLang,
  catalogueLegendText,
  catalogueCoverFile,
  catalogueCardPdfFile,
  printCatalogueCard,
  shareCatalogueNative,
  copyLegendText,
  downloadFile,
} from "../lib/catalogueShareCard";

// Fenêtre « Partager l'ouvrage » : la COUVERTURE part en image, la LÉGENDE reste
// du TEXTE LIBRE (sélectionnable / copiable), jamais figé dans une image. Le
// partage natif envoie couverture + texte ; on propose aussi « copier le texte »,
// le téléchargement de la couverture, WhatsApp, un PDF (texte sélectionnable) et
// l'impression. La langue (FR/EN) est au choix.
export function ShareCatalogueDialog({ item, lang: initialLang, onClose }: { item: CatalogueItem; lang: ShareLang; onClose: () => void }) {
  const [lang, setLang] = useState<ShareLang>(initialLang);
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [canNativeShare] = useState<boolean>(() => typeof navigator !== "undefined" && typeof (navigator as Navigator).share === "function");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const text = catalogueLegendText(item, lang);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function doNativeShare() {
    await run("share", async () => {
      const ok = await shareCatalogueNative(item, lang);
      if (ok) { onClose(); return; }
      setErr("Le partage direct n'est pas disponible sur cet appareil. Utilisez « Copier le texte » et « Télécharger la couverture ».");
    });
  }

  async function doWhatsApp() {
    await run("wa", async () => {
      // Le TEXTE part dans le message WhatsApp (sélectionnable) ; la couverture
      // est téléchargée pour être jointe à la main (WhatsApp Web n'attache pas
      // d'image via un lien). Sur mobile, préférez « Partager ».
      const cover = await catalogueCoverFile(item);
      if (cover) downloadFile(cover);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      if (cover) setInfo("Couverture téléchargée : joignez-la à votre message WhatsApp (le texte est déjà pré-rempli).");
    });
  }

  async function doCopy() {
    await run("copy", async () => {
      const ok = await copyLegendText(item, lang);
      setInfo(ok ? "Texte de la légende copié — vous pouvez le coller où vous voulez." : "Copie impossible : sélectionnez le texte ci-dessous et copiez-le à la main.");
    });
  }

  async function doDownloadCover() {
    await run("cover", async () => {
      const cover = await catalogueCoverFile(item);
      if (!cover) { setErr("Cet ouvrage n'a pas de couverture image."); return; }
      downloadFile(cover);
    });
  }

  const btn: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "9px 13px", fontSize: 13, cursor: "pointer", fontWeight: 600 };
  const btnGold: React.CSSProperties = { ...btn, background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 560, width: "100%", maxHeight: "92vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: "var(--font-title, Georgia, serif)", fontSize: 17 }}>Partager l'ouvrage</div>
          <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}>
            {(["fr", "en"] as ShareLang[]).map((l) => (
              <button key={l} onClick={() => setLang(l)} style={{ border: "none", padding: "5px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: lang === l ? "var(--eclosion, #D9B21A)" : "#fff", color: lang === l ? "#0B0B0C" : "var(--muted)" }}>
                {l === "fr" ? "Français" : "English"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 12px" }}>
          La <strong>couverture</strong> part en image ; la <strong>légende</strong> suit en <strong>texte libre</strong>, sélectionnable et copiable.
        </div>

        {/* Aperçu : couverture (image) + texte de la légende (sélectionnable). */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 120, flexShrink: 0 }}>
            {item.hasCover ? (
              <img src={catalogueCoverUrl(item.id)} alt={`Couverture — ${item.title}`} style={{ width: "100%", borderRadius: 6, border: "1px solid var(--line)", background: "var(--paper, #FAF8F2)" }} />
            ) : (
              <div style={{ aspectRatio: "3 / 4", borderRadius: 6, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--muted)", textAlign: "center", padding: 6 }}>Pas de couverture</div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>Légende (texte)</label>
            <textarea readOnly value={text} onFocus={(e) => e.currentTarget.select()} rows={9}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 4, padding: 10, border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical", background: "var(--paper, #FAF8F2)" }} />
          </div>
        </div>

        {info && <div style={{ background: "#E7F1EA", color: "#2F7D4A", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, marginTop: 10 }}>{info}</div>}
        {err && <div style={{ background: "#F6E2DE", color: "#B23A2E", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, marginTop: 10 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {canNativeShare && (
            <button onClick={doNativeShare} disabled={!!busy} style={btnGold}>{busy === "share" ? "Partage…" : "📤 Partager (couverture + texte)"}</button>
          )}
          <button onClick={doCopy} disabled={!!busy} style={btn}>{busy === "copy" ? "…" : "📋 Copier le texte"}</button>
          <button onClick={doDownloadCover} disabled={!!busy} style={btn}>{busy === "cover" ? "…" : "🖼️ Télécharger la couverture"}</button>
          <button onClick={doWhatsApp} disabled={!!busy} style={{ ...btn, borderColor: "#25D366", color: "#128C3E" }}>{busy === "wa" ? "…" : "💬 WhatsApp"}</button>
          <button onClick={() => run("pdf", async () => downloadFile(await catalogueCardPdfFile(item, lang)))} disabled={!!busy} style={btn}>{busy === "pdf" ? "…" : "📄 PDF"}</button>
          <button onClick={() => run("print", async () => printCatalogueCard(item, lang))} disabled={!!busy} style={btn}>{busy === "print" ? "…" : "🖨️ Imprimer"}</button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btn}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
