import { useEffect, useMemo, useRef, useState } from "react";
import { getCatalogue, uploadImageAssetFile, type CatalogueItem } from "../api/client";

// Téléversement GROUPÉ des couvertures (demande opérateur 14/10). L'import en
// masse du catalogue n'apporte que le TEXTE (titre, auteur, genre…) : les images
// de couverture doivent être ajoutées à part. Plutôt que d'ouvrir chaque fiche
// une par une (32 fois), ce panneau permet de choisir TOUTES les images d'un
// coup : chaque fichier est rapproché automatiquement d'un ouvrage par son NOM
// (comparé au titre), le rapprochement restant corrigeable à la main avant envoi.
// Chaque image est déposée comme « 1ère de couverture » via l'endpoint existant.

// Normalisation pour le rapprochement fichier ↔ titre : minuscules, sans
// accents, sans extension, sans ponctuation, espaces compactés.
function norm(s: string, stripExt = false): string {
  let x = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (stripExt) x = x.replace(/\.[a-z0-9]+$/i, "");
  return x.replace(/[^a-z0-9]+/g, " ").trim();
}

type RowStatus = "pending" | "uploading" | "done" | "error" | "skipped";
interface Row {
  file: File;
  previewUrl: string;
  bookId: string; // "" = non attribué
  auto: boolean; // rapproché automatiquement
  status: RowStatus;
  message?: string;
}

export function BulkCoverUpload({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<CatalogueItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // À l'ouverture, on charge la liste COMPLÈTE du catalogue (indépendante des
  // filtres de la page), pour pouvoir rattacher une couverture à n'importe quel
  // ouvrage.
  useEffect(() => {
    if (!open) return;
    setLoadingList(true);
    getCatalogue({})
      .then((r) => setAll(r.items))
      .catch(() => setAll([]))
      .finally(() => setLoadingList(false));
  }, [open]);

  // Nettoyage des URLs d'aperçu pour ne pas fuir de mémoire.
  useEffect(() => () => rows.forEach((r) => URL.revokeObjectURL(r.previewUrl)), [rows]);

  const byNormTitle = useMemo(() => {
    const m = new Map<string, CatalogueItem>();
    for (const it of all) {
      const k = norm(it.title);
      if (k && !m.has(k)) m.set(k, it);
    }
    return m;
  }, [all]);

  const missingCount = useMemo(() => all.filter((i) => !i.hasCover).length, [all]);

  function matchBook(filename: string): CatalogueItem | null {
    const nf = norm(filename, true);
    if (!nf) return null;
    const exact = byNormTitle.get(nf);
    if (exact) return exact;
    // Rapprochement souple : le titre est contenu dans le nom de fichier (ou
    // l'inverse). On retient le titre le PLUS LONG (le plus spécifique).
    let best: CatalogueItem | null = null;
    let bestLen = 0;
    for (const it of all) {
      const nt = norm(it.title);
      if (nt.length < 4) continue; // évite les rapprochements hasardeux sur titres très courts
      if (nf.includes(nt) || nt.includes(nf)) {
        if (nt.length > bestLen) {
          best = it;
          bestLen = nt.length;
        }
      }
    }
    return best;
  }

  function onPick(files: FileList | null) {
    if (!files) return;
    const next: Row[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const m = matchBook(file.name);
      next.push({ file, previewUrl: URL.createObjectURL(file), bookId: m?.id ?? "", auto: !!m, status: "pending" });
    }
    setRows(next);
    setSummary(null);
  }

  function setRowBook(i: number, bookId: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, bookId, auto: false } : r)));
  }

  async function uploadAll() {
    if (busy) return;
    setBusy(true);
    setSummary(null);
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    const updated = rows.map((r) => ({ ...r }));
    for (let i = 0; i < updated.length; i++) {
      const r = updated[i];
      if (r.status === "done") {
        ok++;
        continue;
      }
      if (!r.bookId) {
        r.status = "skipped";
        r.message = "Aucun ouvrage sélectionné";
        skipped++;
        setRows([...updated]);
        continue;
      }
      r.status = "uploading";
      r.message = undefined;
      setRows([...updated]);
      try {
        await uploadImageAssetFile(r.bookId, "couverture_1", r.file);
        r.status = "done";
        ok++;
      } catch (e) {
        r.status = "error";
        r.message = e instanceof Error ? e.message : "Échec du téléversement";
        failed++;
      }
      setRows([...updated]);
    }
    setBusy(false);
    setSummary(`${ok} couverture(s) ajoutée(s)${skipped ? ` · ${skipped} sans ouvrage` : ""}${failed ? ` · ${failed} en échec` : ""}.`);
    if (ok > 0) onDone();
  }

  const matchedCount = rows.filter((r) => r.bookId).length;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={btnPrimary} title="Ajouter plusieurs couvertures d'un coup">
        🖼️ Ajouter les couvertures (en masse)
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "4px 0 14px", background: "var(--ivory, #FAF8F2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 15 }}>Ajouter les couvertures en masse</div>
        <button type="button" onClick={() => { setOpen(false); setRows([]); setSummary(null); }} style={btnGhost}>Fermer</button>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px", lineHeight: 1.6 }}>
        Choisissez <strong>toutes les images</strong> de couverture d'un coup. Chaque fichier est rapproché automatiquement
        d'un ouvrage par son <strong>nom</strong> (comparé au titre) ; vérifiez le rapprochement et corrigez-le au besoin,
        puis téléversez. {loadingList ? "Chargement du catalogue…" : `${all.length} ouvrage(s) au catalogue, dont ${missingCount} sans couverture.`}
        <br />
        <span style={{ fontSize: 11.5 }}>Astuce : pour un rapprochement automatique fiable, nommez chaque image comme le titre de l'ouvrage (ex. « Bozayeur.jpg »).</span>
      </p>

      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onPick(e.target.files)} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" onClick={() => inputRef.current?.click()} style={btnGhost} disabled={busy}>📂 Choisir des images…</button>
        {rows.length > 0 && (
          <button type="button" onClick={uploadAll} style={btnPrimary} disabled={busy || matchedCount === 0}>
            {busy ? "Téléversement…" : `Téléverser ${matchedCount} couverture(s)`}
          </button>
        )}
      </div>

      {summary && (
        <div style={{ background: "var(--eclosion-soft, #f6efd8)", color: "var(--eclosion-dark, #9A7A12)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{summary}</div>
      )}

      {rows.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r, i) => {
            const chosen = all.find((a) => a.id === r.bookId) ?? null;
            const border = r.status === "error" ? "var(--alert, #B23A2E)" : r.status === "done" ? "var(--ok, #2F7D4A)" : !r.bookId ? "var(--warn, #B87400)" : "var(--line)";
            return (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", border: `1px solid ${border}`, borderRadius: 8, padding: 8, background: "#fff" }}>
                <img src={r.previewUrl} alt="" style={{ width: 44, height: 58, objectFit: "cover", borderRadius: 4, border: "1px solid var(--line)", flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.file.name}>{r.file.name}</div>
                  <select value={r.bookId} onChange={(e) => setRowBook(i, e.target.value)} disabled={busy} style={{ ...inp, marginTop: 4 }}>
                    <option value="">— Aucun ouvrage (ignoré) —</option>
                    {all.map((a) => (
                      <option key={a.id} value={a.id}>{a.title}{a.hasCover ? " — (a déjà une couverture)" : ""}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11.5, marginTop: 3 }}>
                    {r.status === "done" && <span style={{ color: "var(--ok, #2F7D4A)" }}>✓ Couverture ajoutée{chosen ? ` à « ${chosen.title} »` : ""}</span>}
                    {r.status === "uploading" && <span style={{ color: "var(--muted)" }}>Téléversement…</span>}
                    {r.status === "error" && <span style={{ color: "var(--alert, #B23A2E)" }}>✕ {r.message}</span>}
                    {r.status === "skipped" && <span style={{ color: "var(--warn, #B87400)" }}>Ignoré — {r.message}</span>}
                    {r.status === "pending" && (r.bookId ? (
                      <span style={{ color: r.auto ? "var(--eclosion-dark, #9A7A12)" : "var(--muted)" }}>{r.auto ? "Rapproché automatiquement" : "Rapproché à la main"}{chosen?.hasCover ? " · remplacera la couverture existante" : ""}</span>
                    ) : (
                      <span style={{ color: "var(--warn, #B87400)" }}>Non rapproché — choisissez l'ouvrage ci-dessus</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", width: "100%" };
const btnPrimary: React.CSSProperties = { border: "none", background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", color: "var(--ink)", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer" };
