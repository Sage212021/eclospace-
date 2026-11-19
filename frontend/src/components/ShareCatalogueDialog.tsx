import { useEffect, useRef, useState } from "react";
import type { CatalogueItem } from "../api/client";
import {
  type ShareLang,
  renderCatalogueCard,
  catalogueCardPngFile,
  catalogueCardPdfFile,
  printCatalogueCard,
  shareCatalogueCardNative,
  downloadFile,
} from "../lib/catalogueShareCard";

// Fenêtre « Partager l'ouvrage » : aperçu fidèle de la fiche (couverture +
// légende) dans la langue choisie, puis actions — partage natif (tablette →
// WhatsApp…), image PNG, PDF, impression, et repli WhatsApp (image + message).
export function ShareCatalogueDialog({ item, lang: initialLang, onClose }: { item: CatalogueItem; lang: ShareLang; onClose: () => void }) {
  const [lang, setLang] = useState<ShareLang>(initialLang);
  const [preview, setPreview] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [canNativeShare] = useState<boolean>(() => typeof navigator !== "undefined" && typeof (navigator as Navigator).share === "function");
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    setBuilding(true);
    setErr(null);
    renderCatalogueCard(item, lang)
      .then(({ canvas }) => {
        if (!alive.current) return;
        setPreview(canvas.toDataURL("image/png"));
      })
      .catch((e) => { if (alive.current) setErr(e instanceof Error ? e.message : "Aperçu impossible."); })
      .finally(() => { if (alive.current) setBuilding(false); });
  }, [item, lang]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const shareText = `${item.title}${item.authors.length ? " — " + item.authors.join(", ") : ""} · Éditions Éclosion`;

  async function doNativeShare() {
    await run("share", async () => {
      const ok = await shareCatalogueCardNative(item, lang, shareText);
      if (ok) { onClose(); return; }
      // Repli : on télécharge l'image et on prévient.
      downloadFile(await catalogueCardPngFile(item, lang));
      setErr("Le partage direct n'est pas disponible sur cet appareil : l'image a été téléchargée, vous pouvez la joindre à votre message.");
    });
  }

  async function doWhatsApp() {
    await run("wa", async () => {
      downloadFile(await catalogueCardPngFile(item, lang));
      const url = `https://wa.me/?text=${encodeURIComponent(shareText + " (image jointe téléchargée à envoyer).")}`;
      window.open(url, "_blank", "noopener");
    });
  }

  const btn: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "9px 13px", fontSize: 13, cursor: "pointer", fontWeight: 600 };
  const btnGold: React.CSSProperties = { ...btn, background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 560, width: "100%", maxHeight: "92vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: "var(--font-title, Georgia, serif)", fontSize: 17 }}>Partager l'ouvrage</div>
          {/* Sélecteur de langue de la légende. */}
          <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}>
            {(["fr", "en"] as ShareLang[]).map((l) => (
              <button key={l} onClick={() => setLang(l)} style={{ border: "none", padding: "5px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: lang === l ? "var(--eclosion, #D9B21A)" : "#fff", color: lang === l ? "#0B0B0C" : "var(--muted)" }}>
                {l === "fr" ? "Français" : "English"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 12px" }}>
          La fiche (couverture + légende) part en une seule image, dans la langue choisie.
        </div>

        {/* Aperçu. */}
        <div style={{ background: "var(--paper, #FAF8F2)", borderRadius: 10, padding: 10, minHeight: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {building ? (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Préparation de l'aperçu…</span>
          ) : preview ? (
            <img src={preview} alt="Aperçu de la fiche" style={{ maxWidth: "100%", maxHeight: "52vh", borderRadius: 6, boxShadow: "0 2px 10px rgba(11,11,12,.15)" }} />
          ) : (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Aperçu indisponible.</span>
          )}
        </div>

        {err && <div style={{ background: "#F6E2DE", color: "#B23A2E", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, marginTop: 10 }}>{err}</div>}

        {/* Actions. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {canNativeShare && (
            <button onClick={doNativeShare} disabled={!!busy || building} style={btnGold}>{busy === "share" ? "Partage…" : "📤 Partager"}</button>
          )}
          <button onClick={() => run("png", async () => downloadFile(await catalogueCardPngFile(item, lang)))} disabled={!!busy || building} style={btn}>{busy === "png" ? "…" : "🖼️ Image (PNG)"}</button>
          <button onClick={() => run("pdf", async () => downloadFile(await catalogueCardPdfFile(item, lang)))} disabled={!!busy || building} style={btn}>{busy === "pdf" ? "…" : "📄 PDF"}</button>
          <button onClick={() => run("print", async () => printCatalogueCard(item, lang))} disabled={!!busy || building} style={btn}>{busy === "print" ? "…" : "🖨️ Imprimer"}</button>
          <button onClick={doWhatsApp} disabled={!!busy || building} style={{ ...btn, borderColor: "#25D366", color: "#128C3E" }}>{busy === "wa" ? "…" : "💬 WhatsApp"}</button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btn}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
