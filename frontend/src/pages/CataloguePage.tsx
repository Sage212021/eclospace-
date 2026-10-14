import { useEffect, useMemo, useState } from "react";
import {
  getCatalogue,
  getCatalogueConfig,
  setCatalogueDefaultSort,
  catalogueCoverUrl,
  type CatalogueItem,
  type CatalogueResponse,
  type CatalogueSort,
} from "../api/client";
import { BulkCoverUpload } from "../components/BulkCoverUpload";

// Pôle Marketing & Distribution — CATALOGUE des ouvrages.
// Grille visuelle des couvertures, alimentée automatiquement par les ouvrages
// publiés/archivés (aucune re-saisie). Recherche, filtres et tri paramétrable ;
// l'administration fixe le tri par défaut de la maison, chacun peut ensuite
// choisir le sien sans le changer pour tous.

const SORT_LABELS: Record<CatalogueSort, string> = {
  recent: "Parution — plus récent d'abord",
  oldest: "Parution — plus ancien d'abord",
  az: "Titre — A → Z",
  za: "Titre — Z → A",
  author: "Par auteur",
  collection: "Par collection",
  genre: "Par genre",
};

const AVAIL_COLOR: Record<string, string> = {
  disponible: "#2F7D4A",
  a_paraitre: "#B87400",
  epuise: "#B23A2E",
  arret_commercialisation: "var(--muted)",
};

function price(n: number | null): string {
  return n == null ? "—" : `${n.toLocaleString("fr-FR")} FCFA`;
}

export function CataloguePage({ onOpenManuscript, canAdmin, canUploadCovers }: { onOpenManuscript?: (id: string) => void; canAdmin?: boolean; canUploadCovers?: boolean }) {
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filtres / tri (état local ; le tri initialise sur le défaut de la maison).
  const [q, setQ] = useState("");
  const [collection, setCollection] = useState("");
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState("");
  const [availability, setAvailability] = useState("");
  const [sort, setSort] = useState<CatalogueSort | "">("");
  const [selected, setSelected] = useState<CatalogueItem | null>(null);
  const [defaultSort, setDefault] = useState<CatalogueSort>("recent");
  const [savingDefault, setSavingDefault] = useState(false);
  // Incrémenté après un ajout groupé de couvertures pour relancer le chargement
  // (les vignettes nouvellement déposées apparaissent alors sans recharger la page).
  const [reloadTick, setReloadTick] = useState(0);

  // Débounce léger de la recherche pour ne pas requêter à chaque frappe.
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    getCatalogueConfig().then((c) => setDefault(c.defaultSort)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getCatalogue({ q: qDebounced || undefined, collection: collection || undefined, genre: genre || undefined, year: year || undefined, availability: availability || undefined, sort: sort || undefined })
      .then((r) => {
        setData(r);
        setErr(null);
        if (!sort) setSort(r.sort);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  }, [qDebounced, collection, genre, year, availability, sort, reloadTick]);

  const items = data?.items ?? [];
  const facets = data?.facets;

  const totalLabel = useMemo(() => {
    const n = items.length;
    return `${n} ouvrage${n > 1 ? "s" : ""}`;
  }, [items.length]);

  async function saveDefault(next: CatalogueSort) {
    setSavingDefault(true);
    try {
      await setCatalogueDefaultSort(next);
      setDefault(next);
    } catch {
      /* ignore : le backend refuse si non-admin */
    } finally {
      setSavingDefault(false);
    }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 1180 }}>
      <h1 className="ecl-page__title">Catalogue des ouvrages</h1>
      <p className="ecl-page__lead">
        Tous les ouvrages <strong>publiés et archivés</strong> de la maison, avec leur couverture. La liste s'alimente
        automatiquement : dès qu'un ouvrage est mis en commercialisation, il paraît ici — aucune ressaisie.
      </p>

      {/* Barre d'outils : recherche + filtres + tri. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", margin: "14px 0 6px" }}>
        <label style={lbl}>
          Rechercher
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, auteur, référence…" style={{ ...inp, minWidth: 220 }} />
        </label>
        <label style={lbl}>
          Collection
          <select value={collection} onChange={(e) => setCollection(e.target.value)} style={inp}>
            <option value="">Toutes</option>
            {facets?.collections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Genre
          <select value={genre} onChange={(e) => setGenre(e.target.value)} style={inp}>
            <option value="">Tous</option>
            {facets?.genres.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Année
          <select value={year} onChange={(e) => setYear(e.target.value)} style={inp}>
            <option value="">Toutes</option>
            {facets?.years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Disponibilité
          <select value={availability} onChange={(e) => setAvailability(e.target.value)} style={inp}>
            <option value="">Toutes</option>
            {facets?.availability.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Trier par
          <select value={sort} onChange={(e) => setSort(e.target.value as CatalogueSort)} style={inp}>
            {(Object.keys(SORT_LABELS) as CatalogueSort[]).map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
          </select>
        </label>
      </div>

      {canUploadCovers && <BulkCoverUpload onDone={() => setReloadTick((t) => t + 1)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{loading ? "Chargement…" : totalLabel}</span>
        {canAdmin && (
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            ⚙️ Tri par défaut de la maison
            <select value={defaultSort} disabled={savingDefault} onChange={(e) => saveDefault(e.target.value as CatalogueSort)} style={{ ...inp, minWidth: 210 }}>
              {(Object.keys(SORT_LABELS) as CatalogueSort[]).map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
          </label>
        )}
      </div>

      {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 8, padding: "9px 13px", fontSize: 13 }}>{err}</div>}

      {!loading && items.length === 0 && !err && (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Aucun ouvrage ne correspond. Le catalogue se remplit à mesure que les ouvrages passent en commercialisation.</p>
      )}

      {/* Grille de couvertures — présentation « vitrine » (couverture en avant,
          titre, auteur en italique, badge de genre), à la manière d'un catalogue. */}
      <style>{`.ecl-cat-card{transition:transform .12s ease, box-shadow .12s ease}.ecl-cat-card:hover{transform:translateY(-3px);box-shadow:0 6px 18px rgba(11,11,12,.14)}`}</style>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))", gap: 20 }}>
        {items.map((it) => (
          <button key={it.id} className="ecl-cat-card" onClick={() => setSelected(it)} style={cardStyle} title={it.title}>
            <Cover item={it} version={reloadTick} />
            <div style={{ padding: "10px 11px 12px", textAlign: "left" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.28, color: "var(--ink)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.title}</div>
              <div style={{ fontFamily: "var(--font-title, Georgia, serif)", fontStyle: "italic", fontSize: 12.5, color: "var(--muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.authors.join(", ") || "—"}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 7, gap: 6 }}>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--eclosion-dark, #9a7a12)" }}>{it.year ?? ""}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: AVAIL_COLOR[it.availabilityCode ?? ""] ?? "var(--muted)" }}>{it.availability}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selected && <DetailModal item={selected} onClose={() => setSelected(null)} onOpenManuscript={onOpenManuscript} />}
    </div>
  );
}

// Couverture (image de la fiche ouvrage) ou vignette de repli élégante (ivoire
// + titre) si l'ouvrage n'a pas encore de fichier de couverture image.
function Cover({ item, badge = true, version = 0 }: { item: CatalogueItem; badge?: boolean; version?: number }) {
  const [failed, setFailed] = useState(false);
  const showImg = item.hasCover && !failed;
  // Badge « genre » (ou collection à défaut) incrusté en coin, à la manière des
  // grands catalogues — en OR Éclospace (seule couleur d'accent, charte §5).
  const badgeLabel = item.genre?.label ?? item.collection?.label ?? null;
  return (
    <div style={{ aspectRatio: "3 / 4", background: "var(--paper, #FAF8F2)", borderTopLeftRadius: 10, borderTopRightRadius: 10, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      {showImg ? (
        <img src={`${catalogueCoverUrl(item.id)}${version ? `?v=${version}` : ""}`} alt={`Couverture — ${item.title}`} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ padding: 12, textAlign: "center" }}>
          <div style={{ fontSize: 22 }}>📖</div>
          <div style={{ fontFamily: "var(--font-title, Georgia, serif)", fontSize: 12.5, color: "var(--ink)", marginTop: 6, lineHeight: 1.3 }}>{item.title}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>{item.authors[0] ?? ""}</div>
        </div>
      )}
      {badge && badgeLabel && (
        <span style={{ position: "absolute", right: 0, bottom: 10, background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", padding: "3px 8px 3px 9px", borderTopLeftRadius: 4, borderBottomLeftRadius: 4, maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(11,11,12,.25)" }}>
          {badgeLabel}
        </span>
      )}
    </div>
  );
}

function DetailModal({ item, onClose, onOpenManuscript }: { item: CatalogueItem; onClose: () => void; onOpenManuscript?: (id: string) => void }) {
  // Résumé masqué par défaut : on le déroule au clic sur l'en-tête (demande 10/10).
  const [showSummary, setShowSummary] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 620, width: "100%", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ width: 180, flexShrink: 0 }}>
            <Cover item={item} badge={false} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: "var(--font-title, Georgia, serif)", fontSize: 20, color: "var(--ink)" }}>{item.title}</div>
            {item.subtitle && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{item.subtitle}</div>}
            <div style={{ fontSize: 13, marginTop: 8 }}>{item.authors.join(", ") || "Auteur non renseigné"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12.5, marginTop: 12 }}>
              <Meta k="Collection" v={item.collection?.label} />
              <Meta k="Genre" v={item.genre?.label} />
              <Meta k="Parution" v={item.year ? String(item.year) : undefined} />
              <Meta k="Prix public" v={price(item.pricePublic)} />
              <Meta k="Disponibilité" v={item.availability} color={AVAIL_COLOR[item.availabilityCode ?? ""]} />
              <Meta k="Référence" v={item.reference} mono />
              {item.isBackCatalogue && <Meta k="Fonds" v="Ouvrage du fonds (antérieur)" />}
            </div>
          </div>
        </div>
        {item.summary && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <button type="button" onClick={() => setShowSummary((v) => !v)} aria-expanded={showSummary}
              style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <span aria-hidden style={{ color: "var(--eclosion-dark, #9a7a12)", fontSize: 12 }}>{showSummary ? "▾" : "▸"}</span>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" }}>Résumé</span>
              {!showSummary && <span style={{ fontSize: 11.5, color: "var(--muted)", fontStyle: "italic", marginLeft: "auto" }}>cliquer pour afficher</span>}
            </button>
            {showSummary && <p style={{ fontSize: 13, lineHeight: 1.6, margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{item.summary}</p>}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          {onOpenManuscript && (
            <button onClick={() => { onOpenManuscript(item.id); onClose(); }} style={{ background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "8px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Ouvrir la fiche complète
            </button>
          )}
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

function Meta({ k, v, mono, color }: { k: string; v?: string; mono?: boolean; color?: string }) {
  if (!v) return null;
  return (
    <>
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : undefined, fontWeight: 600, color: color ?? "var(--ink)" }}>{v}</span>
    </>
  );
}

const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" };
const inp: React.CSSProperties = { padding: "6px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "#fff" };
const cardStyle: React.CSSProperties = { display: "block", textAlign: "left", padding: 0, background: "#fff", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", cursor: "pointer", boxShadow: "0 1px 3px rgba(11,11,12,.06)" };
