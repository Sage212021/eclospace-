import { useEffect, useState } from "react";
import {
  assignIsbn,
  attributeIsbnByNumber,
  rattachExistingIsbn,
  lookupIsbn,
  createLegalDeposit,
  updateLegalDeposit,
  getIsbnBank,
  getIsbnCompleteness,
  getWorkMetadata,
  isbnBarcodeUrl,
  listIsbnPools,
  listIsbns,
  listLegalDeposits,
  updateWorkMetadata,
  type CommercializationStatus,
  type EditionType,
  type Isbn,
  type IsbnBankItem,
  type IsbnBankResponse,
  type IsbnBankStatus,
  type IsbnFormat,
  type IsbnLookupResult,
  type IsbnPoolSummary,
  type LegalDeposit,
  type WorkMetadata,
} from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

const EDITION_TYPE_LABELS: Record<EditionType, string> = {
  compte_editeur: "Compte d'éditeur",
  compte_auteur: "Compte d'auteur",
  coedition: "Coédition",
  coproduction: "Coproduction",
  partenariat: "Partenariat",
  autre: "Autre",
};
// Simulateur de poids — barèmes indicatifs.
// Surface d'une PAGE (une face), en m² (une feuille = 2 pages).
const WEIGHT_FORMATS: { key: string; label: string; area: number }[] = [
  { key: "roman_135_215", label: "Roman 135 × 215 mm", area: 0.135 * 0.215 },
  { key: "a5", label: "A5 (148 × 210 mm)", area: 0.148 * 0.210 },
  { key: "poche_110_180", label: "Poche 110 × 180 mm", area: 0.110 * 0.180 },
  { key: "145_220", label: "145 × 220 mm", area: 0.145 * 0.220 },
  { key: "a4", label: "A4 (210 × 297 mm)", area: 0.210 * 0.297 },
];
// Grammage du papier intérieur (g/m²).
const WEIGHT_PAPERS = [60, 70, 80, 90, 100, 115];
// Couverture : grammage papier (g/m²) + éventuel poids de carton (reliure rigide).
const WEIGHT_COVERS: { key: string; label: string; gsm: number; board: number }[] = [
  { key: "souple_250", label: "Souple 250 g/m²", gsm: 250, board: 0 },
  { key: "souple_300", label: "Souple 300 g/m²", gsm: 300, board: 0 },
  { key: "rigide", label: "Rigide (cartonnée)", gsm: 150, board: 200 },
  { key: "aucune", label: "Sans couverture", gsm: 0, board: 0 },
];

const LEGAL_DEPOSIT_STATUS_LABELS: Record<string, string> = {
  a_preparer: "À préparer",
  depose: "Déposé",
  accuse_reception: "Accusé de réception",
};
const COMM_STATUS_LABELS: Record<CommercializationStatus, string> = {
  a_paraitre: "À paraître",
  disponible: "Disponible",
  epuise: "Épuisé",
  arret_commercialisation: "Arrêt de commercialisation",
};

interface IsbnSectionProps {
  manuscriptId: string;
  canManage: boolean;
  // Ouvre la section d'emblée (affichage « sur place » comme pré-requis). Par
  // défaut repliée (accordéon de la fiche).
  startOpen?: boolean;
  // Ouvrir la fiche d'un AUTRE ouvrage (cas « ISBN déjà attribué à un autre »).
  onOpenManuscript?: (id: string) => void;
  // Titre et numéro de l'ouvrage — pour l'en-tête de la fiche imprimée.
  manuscriptTitle?: string;
  manuscriptNumber?: string;
}

// ISBN, dépôt légal et métadonnées (Ch. 13) : identité officielle de
// l'ouvrage, point de passage obligé avant le BAT (Ch. 13 §13.9).
export function IsbnSection({ manuscriptId, canManage, startOpen = false, onOpenManuscript, manuscriptTitle, manuscriptNumber }: IsbnSectionProps) {
  const [isbns, setIsbns] = useState<Isbn[]>([]);
  const [pools, setPools] = useState<IsbnPoolSummary[]>([]);
  const [bank, setBank] = useState<IsbnBankResponse | null>(null);
  const [deposits, setDeposits] = useState<LegalDeposit[]>([]);
  const [metadata, setMetadata] = useState<WorkMetadata | null>(null);
  const [completeness, setCompleteness] = useState<{ complete: boolean; missing: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [weight, setWeight] = useState("");
  // Volet commercial & financier de la fiche ouvrage (Lot 2).
  const [editionType, setEditionType] = useState("");
  const [pricePublic, setPricePublic] = useState("");
  // Remise professionnelle paramétrable (défaut 25 %) : le prix pro en découle.
  const [proDiscountPct, setProDiscountPct] = useState("25");
  // Part du distributeur/diffuseur (paramétrable, défaut 50 %) : le prix éditeur
  // est ce qui reste à Éclosion une fois cette commission retirée. Même logique
  // de calcul que le prix pro, mais sens différent (circuit de distribution).
  const [editorDiscountPct, setEditorDiscountPct] = useState("50");
  const [pricePromo, setPricePromo] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [commStatus, setCommStatus] = useState("");
  // Simulateur de poids (local, non stocké — sert à remplir le champ Poids).
  const [simOpen, setSimOpen] = useState(false);
  const [simPages, setSimPages] = useState("");
  const [simFormat, setSimFormat] = useState("roman_135_215");
  const [simGsm, setSimGsm] = useState("80");
  const [simCover, setSimCover] = useState("souple_250");
  const [isSchool, setIsSchool] = useState(false);
  const [schoolLevel, setSchoolLevel] = useState("");
  const [schoolSubject, setSchoolSubject] = useState("");
  const [schoolYear, setSchoolYear] = useState("");

  const refresh = async () => {
    const [isbnList, poolData, bankData, depositList, meta, complete] = await Promise.all([
      listIsbns(manuscriptId),
      listIsbnPools(),
      getIsbnBank(),
      listLegalDeposits(manuscriptId),
      getWorkMetadata(manuscriptId),
      getIsbnCompleteness(manuscriptId),
    ]);
    setIsbns(isbnList);
    setPools(poolData.pools);
    setBank(bankData);
    setDeposits(depositList);
    setMetadata(meta);
    setCompleteness(complete);
    setSummary(meta?.summary ?? "");
    setWeight(meta?.weightGrams?.toString() ?? "");
    setEditionType(meta?.editionType ?? "");
    setPricePublic(meta?.pricePublic ?? "");
    setProDiscountPct(meta?.proDiscountPct ?? "25");
    setEditorDiscountPct(meta?.editorDiscountPct ?? "50");
    setPricePromo(meta?.pricePromo ?? "");
    setUnitCost(meta?.unitProductionCost ?? "");
    setCommStatus(meta?.commercializationStatus ?? "");
    setIsSchool(meta?.isSchoolBook ?? false);
    setSchoolLevel(meta?.schoolLevel ?? "");
    setSchoolSubject(meta?.schoolSubject ?? "");
    setSchoolYear(meta?.schoolYear ?? "");
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  // ── Attribution par numéro (parcours §9) : panneau ouvert par « + Attribuer ».
  const [attrOpen, setAttrOpen] = useState(false);
  const [attrInput, setAttrInput] = useState("");
  const [attrFormat, setAttrFormat] = useState<IsbnFormat>("print");
  const [lookup, setLookup] = useState<IsbnLookupResult | null>(null);
  const [attrBusy, setAttrBusy] = useState(false);
  const [attrError, setAttrError] = useState<string | null>(null);
  const [attrInfo, setAttrInfo] = useState<string | null>(null);

  // Édition inline d'une fiche de dépôt légal déjà enregistrée (correction).
  const [editDep, setEditDep] = useState<{ id: string; country: string; depository: string; copies: string; status: string } | null>(null);
  async function saveDeposit() {
    if (!editDep) return;
    const copies = Number(editDep.copies);
    if (!editDep.country.trim() || !editDep.depository.trim() || !Number.isFinite(copies) || copies < 1) {
      setError("Dépôt légal : pays et organisme obligatoires, et au moins 1 exemplaire.");
      return;
    }
    try {
      await updateLegalDeposit(editDep.id, {
        country: editDep.country.trim(),
        depository: editDep.depository.trim(),
        copies_required: copies,
        status: editDep.status,
      });
      setEditDep(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modification impossible.");
    }
  }

  function resetAttr() {
    setAttrInput(""); setLookup(null); setAttrError(null); setAttrInfo(null); setAttrFormat("print");
  }
  async function verifyIsbn(value?: string) {
    const v = (value ?? attrInput).trim();
    if (!v) return;
    setAttrBusy(true); setAttrError(null); setAttrInfo(null); setLookup(null);
    try {
      setLookup(await lookupIsbn(manuscriptId, v));
    } catch (e) {
      setAttrError(e instanceof Error ? e.message : "Vérification impossible.");
    } finally {
      setAttrBusy(false);
    }
  }
  // Rattacher un ISBN EXISTANT (déjà paru) au dossier en cours, par id d'ISBN.
  // C'est le même ouvrage (déjà au catalogue) dont on enregistre le dossier.
  async function rattachExisting(isbnId: string) {
    setAttrBusy(true); setAttrError(null); setAttrInfo(null);
    try {
      await rattachExistingIsbn(manuscriptId, isbnId);
      setAttrInfo("ISBN rattaché à cet ouvrage.");
      await refresh();
      setAttrOpen(false); resetAttr();
    } catch (e) {
      const err = e as { message?: string };
      setAttrError(err?.message ?? "Rattachement impossible.");
    } finally {
      setAttrBusy(false);
    }
  }

  // Attribution DIRECTE depuis une ligne de la banque (clic « Attribuer » /
  // « Rattacher »). Le backend valide le cas (409 si entre-temps pris ailleurs).
  async function attributeDirect(isbn13: string, fmt: IsbnFormat) {
    setAttrBusy(true); setAttrError(null); setAttrInfo(null);
    try {
      const r = await attributeIsbnByNumber(manuscriptId, { isbn13, format: fmt });
      const msg = r.outcome === "attached" ? "ISBN rattaché à l'ouvrage."
        : r.outcome === "already_attached" ? "Cet ISBN est déjà rattaché à l'ouvrage."
        : "ISBN attribué à l'ouvrage.";
      setAttrInfo(msg);
      await refresh();
      setAttrOpen(false); resetAttr();
    } catch (e) {
      const err = e as { message?: string };
      setAttrError(err?.message ?? "Attribution impossible.");
    } finally {
      setAttrBusy(false);
    }
  }
  async function confirmAttr() {
    setAttrBusy(true); setAttrError(null); setAttrInfo(null);
    try {
      const r = await attributeIsbnByNumber(manuscriptId, { isbn13: attrInput.trim(), format: attrFormat });
      const msg = r.outcome === "registered_and_attributed" ? "ISBN enregistré et attribué à l'ouvrage."
        : r.outcome === "attached" ? "ISBN rattaché à l'ouvrage."
        : r.outcome === "already_attached" ? "Cet ISBN est déjà rattaché à l'ouvrage."
        : "ISBN attribué à l'ouvrage.";
      setAttrInfo(msg);
      await refresh();
      setAttrOpen(false); resetAttr();
    } catch (e) {
      const err = e as { message?: string; code?: string };
      setAttrError(err?.message ?? "Attribution impossible.");
    } finally {
      setAttrBusy(false);
    }
  }
  async function generateFromPool() {
    setAttrBusy(true); setAttrError(null);
    try {
      await assignIsbn(manuscriptId, attrFormat, pools[0]?.id);
      await refresh();
      setAttrOpen(false); resetAttr();
    } catch (e) {
      setAttrError(e instanceof Error ? e.message : "Génération impossible.");
    } finally {
      setAttrBusy(false);
    }
  }

  async function handleAddDeposit() {
    const country = window.prompt("Pays", "France");
    const depository = window.prompt("Organisme dépositaire", "BnF");
    const copies = Number(window.prompt("Nombre d'exemplaires", "2") ?? "0");
    if (!country || !depository) return;
    try {
      await createLegalDeposit(manuscriptId, { country, depository, copies_required: copies });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ajout.");
    }
  }

  // Prix professionnel = prix public (PPT) − remise pro (paramétrable, défaut
  // 25 %). Calculé automatiquement ; c'est ce prix qui est enregistré.
  const proDiscountNum = Math.max(0, Math.min(100, Number(proDiscountPct) || 0));
  const pricePro = Number(pricePublic) > 0 ? Math.round(Number(pricePublic) * (1 - proDiscountNum / 100)) : null;
  // Prix éditeur = prix public − part du distributeur/diffuseur (paramétrable,
  // défaut 50 %) = ce que touche réellement l'éditeur par exemplaire. Calculé
  // automatiquement, même mécanique que le prix pro mais sens distinct.
  const editorDiscountNum = Math.max(0, Math.min(100, Number(editorDiscountPct) || 0));
  const priceEditeur = Number(pricePublic) > 0 ? Math.round(Number(pricePublic) * (1 - editorDiscountNum / 100)) : null;

  // Estimation du poids : (pages/2) feuilles × surface × grammage + couverture.
  const simEstimate = (() => {
    const pages = Number(simPages) || 0;
    const area = WEIGHT_FORMATS.find((f) => f.key === simFormat)?.area ?? 0;
    const gsm = Number(simGsm) || 0;
    const cover = WEIGHT_COVERS.find((c) => c.key === simCover);
    if (pages <= 0 || area <= 0) return null;
    const interior = (pages / 2) * area * gsm;
    const coverW = cover ? area * 2 * cover.gsm + cover.board : 0;
    return Math.round(interior + coverW);
  })();

  // Impression de la fiche de renseignements (ex. à la demande du Directeur
  // éditorial). Document « au nom des Éditions Éclosion » — charte Noir souverain,
  // aucune mention d'outil interne. Reflète les valeurs affichées à l'écran.
  function handlePrint() {
    const esc = (v: unknown) =>
      String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const fcfa = (n: number | null | undefined) => (n != null && !Number.isNaN(n) ? `${Number(n).toLocaleString("fr-FR")} FCFA` : "—");
    const editTypeLabel = editionType ? EDITION_TYPE_LABELS[editionType as EditionType] ?? editionType : "—";
    const commLabel = commStatus ? COMM_STATUS_LABELS[commStatus as CommercializationStatus] ?? commStatus : "—";
    const pricePublicNum = pricePublic.trim() === "" ? null : Number(pricePublic);
    const promoNum = pricePromo.trim() === "" ? null : Number(pricePromo);
    const unitCostNum = unitCost.trim() === "" ? null : Number(unitCost);
    const isbnRows = isbns.length
      ? isbns.map((i) => `<tr><td class="mono">${esc(i.isbn13)}</td><td>${esc(FORMAT_LABELS[i.format] ?? i.format)}</td></tr>`).join("")
      : `<tr><td colspan="2" class="muted">Aucun ISBN attribué.</td></tr>`;
    const depositRows = deposits.length
      ? deposits.map((d) => `<tr><td>${esc(d.country)} — ${esc(d.depository)}</td><td>${esc(LEGAL_DEPOSIT_STATUS_LABELS[d.status] ?? d.status)}</td><td>${d.depositedAt ? esc(new Date(d.depositedAt).toLocaleDateString("fr-FR")) : "—"}</td></tr>`).join("")
      : `<tr><td colspan="3" class="muted">Aucun dépôt légal enregistré.</td></tr>`;
    const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;
    const schoolBlock = isSchool
      ? `<h2>Volet scolaire</h2><table class="kv">${row("Niveau", esc(schoolLevel) || "—")}${row("Matière", esc(schoolSubject) || "—")}${row("Année scolaire", esc(schoolYear) || "—")}</table>`
      : "";
    const summaryBlock = summary.trim()
      ? `<h2>Résumé de présentation</h2><p class="summary">${esc(summary)}</p>`
      : "";
    const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>Fiche de renseignements — ${esc(manuscriptTitle ?? manuscriptNumber ?? "ouvrage")}</title>
<style>
  :root { --or: #D9B21A; --noir: #0B0B0C; --ivoire: #FAF8F2; --line: #E6E1D3; --muted: #6b6b6b; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--noir); margin: 0; padding: 32px 36px; background: #fff; }
  .mono { font-family: "Courier New", monospace; }
  header { border-bottom: 3px solid var(--or); padding-bottom: 12px; margin-bottom: 20px; }
  .brand { font-size: 20px; font-weight: bold; letter-spacing: 0.5px; }
  .doc-title { font-size: 13px; color: var(--muted); margin-top: 2px; }
  h1 { font-size: 22px; margin: 18px 0 2px; }
  .subtitle { font-size: 13px; color: var(--muted); margin: 0 0 18px; }
  h2 { font-size: 14px; color: var(--noir); border-left: 4px solid var(--or); padding-left: 8px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.kv th { text-align: left; width: 230px; vertical-align: top; color: var(--muted); font-weight: normal; padding: 5px 10px 5px 0; }
  table.kv td { padding: 5px 0; }
  table.grid th, table.grid td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  table.grid thead th { background: var(--ivoire); font-size: 12px; }
  .summary { font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  .muted { color: var(--muted); }
  .note { font-size: 11px; color: var(--muted); margin-top: 4px; }
  footer { margin-top: 32px; border-top: 1px solid var(--line); padding-top: 10px; font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; }
  @media print { body { padding: 0; } @page { margin: 18mm; } }
</style></head><body>
<header>
  <div class="brand">Éclosion Édition</div>
  <div class="doc-title">Fiche de renseignements de l'ouvrage</div>
</header>
<h1>${esc(manuscriptTitle ?? "—")}</h1>
<p class="subtitle mono">${esc(manuscriptNumber ?? "")}</p>

<h2>Identité &amp; références</h2>
<table class="grid"><thead><tr><th>ISBN</th><th>Format</th></tr></thead><tbody>${isbnRows}</tbody></table>

<h2>Dépôt légal</h2>
<table class="grid"><thead><tr><th>Lieu</th><th>Statut</th><th>Date</th></tr></thead><tbody>${depositRows}</tbody></table>

<h2>Édition, prix &amp; coût</h2>
<table class="kv">
  ${row("Type d'édition", esc(editTypeLabel))}
  ${row("Statut de commercialisation", esc(commLabel))}
  ${row("Prix public / PPT", `<span class="mono">${fcfa(pricePublicNum)}</span>`)}
  ${row(`Prix professionnel (revendeur, −${proDiscountNum || 0} %)`, `<span class="mono">${fcfa(pricePro)}</span>`)}
  ${row(`Prix éditeur (net distributeur, −${editorDiscountNum || 0} %)`, `<span class="mono">${fcfa(priceEditeur)}</span>`)}
  ${row("Prix promotionnel / autre", `<span class="mono">${fcfa(promoNum)}</span>`)}
  ${row("Coût de production unitaire", `<span class="mono">${fcfa(unitCostNum)}</span>`)}
  ${row("Poids", weight.trim() ? `<span class="mono">${esc(Number(weight).toLocaleString("fr-FR"))} g</span>` : "—")}
</table>
<p class="note">Prix professionnel = ce que paie le revendeur. Prix éditeur = ce que touche réellement l'éditeur par exemplaire, une fois retirée la commission du distributeur/diffuseur.</p>

${schoolBlock}
${summaryBlock}

<footer>
  <span>Éditions Éclosion</span>
  <span>Fiche éditée le ${esc(today)}</span>
</footer>
<script>window.onload = function () { window.focus(); window.print(); };<\/script>
</body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
    if (!w) {
      setError("Impression impossible : autorisez les fenêtres pop-up pour ce site, puis réessayez.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function handleSaveMetadata(event: React.FormEvent) {
    event.preventDefault();
    try {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      await updateWorkMetadata(manuscriptId, {
        summary: summary || undefined,
        weight_grams: weight ? Number(weight) : undefined,
        edition_type: (editionType || null) as EditionType | null,
        price_public: num(pricePublic),
        price_pro: pricePro,
        pro_discount_pct: Number(proDiscountPct) ? proDiscountNum : null,
        price_editeur: priceEditeur,
        editor_discount_pct: Number(editorDiscountPct) ? editorDiscountNum : null,
        price_promo: num(pricePromo),
        unit_production_cost: num(unitCost),
        commercialization_status: (commStatus || null) as CommercializationStatus | null,
        is_school_book: isSchool,
        school_level: isSchool ? schoolLevel.trim() || null : null,
        school_subject: isSchool ? schoolSubject.trim() || null : null,
        school_year: isSchool ? schoolYear.trim() || null : null,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    }
  }

  return (
    <CollapsibleSection
      id="isbn-references"
      title="ISBN, dépôt légal et métadonnées"
      defaultOpen={startOpen}
      storageKey={startOpen ? undefined : "fiche:isbn"}
    >
      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {completeness && !completeness.complete && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "6px 10px", fontSize: 12, marginBottom: 10 }}>
          Complétude non atteinte : {completeness.missing.join(", ")}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <button
          type="button"
          onClick={handlePrint}
          style={{ ...secondaryButtonStyle, background: "#fff", border: "1px solid var(--eclosion, #D9B21A)", color: "var(--eclosion-dark, #9a7a12)", fontWeight: 700 }}
          title="Éditer une fiche imprimable de ces références (ISBN, dépôt légal, prix, poids) — au nom des Éditions Éclosion."
        >
          🖨️ Imprimer la fiche de renseignements
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>ISBN attribués</div>
        {canManage && (
          <button onClick={() => { setAttrOpen((v) => !v); resetAttr(); }} style={secondaryButtonStyle}>
            {attrOpen ? "Fermer" : "+ Attribuer un ISBN"}
          </button>
        )}
      </div>

      {canManage && attrOpen && (
        <IsbnAttributePanel
          input={attrInput} setInput={(v) => { setAttrInput(v); setLookup(null); setAttrError(null); }}
          format={attrFormat} setFormat={setAttrFormat}
          lookup={lookup} busy={attrBusy} error={attrError} info={attrInfo}
          onVerify={() => verifyIsbn()} onConfirm={confirmAttr} onGenerate={generateFromPool}
          onOpenOther={onOpenManuscript}
          poolAvailable={pools.reduce((n, p) => n + (p.available ?? 0), 0)}
          bank={bank} onAttribute={attributeDirect}
          currentManuscriptId={manuscriptId} onRattach={rattachExisting}
        />
      )}
      {isbns.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun ISBN attribué.</p>}
      {isbns.map((isbn) => (
        <div key={isbn.id} style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid var(--line)", padding: "8px 0" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{isbn.isbn13}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{isbn.format}</span>
          <img src={isbnBarcodeUrl(isbn.id)} alt={`Code-barres ${isbn.isbn13}`} loading="lazy" decoding="async" style={{ height: 40 }} />
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Dépôt légal</div>
        {canManage && (
          <button onClick={handleAddDeposit} style={secondaryButtonStyle}>
            + Nouvelle fiche
          </button>
        )}
      </div>
      {deposits.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune fiche de dépôt légal.</p>}
      {deposits.map((deposit) => (
        <div key={deposit.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
          {editDep?.id === deposit.id ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 6 }}>
                <label style={{ fontSize: 11, color: "var(--muted)" }}>Pays
                  <input value={editDep.country} onChange={(e) => setEditDep({ ...editDep, country: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ fontSize: 11, color: "var(--muted)" }}>Organisme dépositaire
                  <input value={editDep.depository} onChange={(e) => setEditDep({ ...editDep, depository: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ fontSize: 11, color: "var(--muted)" }}>Exemplaires
                  <input type="number" min={1} value={editDep.copies} onChange={(e) => setEditDep({ ...editDep, copies: e.target.value })} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                </label>
                <label style={{ fontSize: 11, color: "var(--muted)" }}>Statut
                  <select value={editDep.status} onChange={(e) => setEditDep({ ...editDep, status: e.target.value })} style={inputStyle}>
                    <option value="a_preparer">À préparer</option>
                    <option value="depose">Déposé</option>
                    <option value="accuse_reception">Accusé de réception</option>
                  </select>
                </label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={saveDeposit} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#0B0B0C", border: "none", fontWeight: 700 }}>Enregistrer</button>
                <button onClick={() => setEditDep(null)} style={secondaryButtonStyle}>Annuler</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>{deposit.country} — {deposit.depository} ({deposit.copiesRequired} ex.) — {LEGAL_DEPOSIT_STATUS_LABELS[deposit.status] ?? deposit.status}</span>
              {canManage && (
                <button onClick={() => setEditDep({ id: deposit.id, country: deposit.country, depository: deposit.depository, copies: String(deposit.copiesRequired), status: deposit.status })}
                  style={{ ...secondaryButtonStyle, marginLeft: "auto", padding: "3px 10px" }}>
                  Modifier
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 16, marginBottom: 6 }}>Fiche de métadonnées {metadata ? `(v${metadata.version})` : ""}</div>
      <form onSubmit={handleSaveMetadata}>
        <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
          Résumé de présentation
          <textarea disabled={!canManage} value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} style={{ ...inputStyle, fontFamily: "inherit" }} />
        </label>
        <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
          Poids (grammes)
          <input disabled={!canManage} type="number" value={weight} onChange={(e) => setWeight(e.target.value)} style={inputStyle} />
        </label>
        {canManage && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            Deux façons de renseigner le poids : le saisir directement ci-dessus, ou le faire estimer et l'appliquer avec le simulateur ci-dessous.
          </div>
        )}
        {canManage && (
          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => setSimOpen((v) => !v)} style={{ background: "none", border: "none", color: "var(--eclosion-dark, #9a7a12)", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 12 }}>
              {simOpen ? "▾" : "▸"} ⚖️ Estimer le poids (papier · couverture · pages)
            </button>
            {simOpen && (
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginTop: 6, background: "var(--ivory, #FAF8F2)", display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                  <label style={{ fontSize: 12 }}>Nombre de pages
                    <input type="number" min={1} value={simPages} onChange={(e) => setSimPages(e.target.value)} placeholder="ex. 200" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                  </label>
                  <label style={{ fontSize: 12 }}>Format
                    <select value={simFormat} onChange={(e) => setSimFormat(e.target.value)} style={inputStyle}>
                      {WEIGHT_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}>Papier intérieur (g/m²)
                    <select value={simGsm} onChange={(e) => setSimGsm(e.target.value)} style={inputStyle}>
                      {WEIGHT_PAPERS.map((g) => <option key={g} value={g}>{g} g/m²</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}>Couverture
                    <select value={simCover} onChange={(e) => setSimCover(e.target.value)} style={inputStyle}>
                      {WEIGHT_COVERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5 }}>Poids estimé : <strong style={{ fontFamily: "var(--font-mono)" }}>{simEstimate != null ? `${simEstimate.toLocaleString("fr-FR")} g` : "—"}</strong></span>
                  <button type="button" disabled={simEstimate == null} onClick={() => { if (simEstimate != null) setWeight(String(simEstimate)); }}
                    style={{ background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: simEstimate == null ? "default" : "pointer" }}>
                    Appliquer au poids
                  </button>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Estimation indicative (hors emballage).</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Volet commercial & financier de la fiche ouvrage (Lot 2). */}
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 12, marginBottom: 6, color: "var(--eclosion)" }}>Édition, prix &amp; coût</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Type d'édition
            <select disabled={!canManage} value={editionType} onChange={(e) => setEditionType(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {Object.entries(EDITION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Statut de commercialisation
            <select disabled={!canManage} value={commStatus} onChange={(e) => setCommStatus(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {Object.entries(COMM_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Prix public / PPT (FCFA)
            <input disabled={!canManage} type="number" min={0} value={pricePublic} onChange={(e) => setPricePublic(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Remise professionnelle (%)
            <input disabled={!canManage} type="number" min={0} max={100} value={proDiscountPct} onChange={(e) => setProDiscountPct(e.target.value)} title="Remise consentie aux revendeurs. Par défaut 25 %." style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Prix professionnel (auto, −{proDiscountNum || 0} %)
            <input
              readOnly
              value={pricePro != null ? pricePro.toLocaleString("fr-FR") : ""}
              placeholder="—"
              title="Calculé automatiquement : prix public × (1 − remise pro)"
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", background: "var(--ivory, #FAF8F2)", color: "var(--muted)" }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Prix promotionnel / autre (FCFA)
            <input disabled={!canManage} type="number" min={0} value={pricePromo} onChange={(e) => setPricePromo(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Part distributeur/diffuseur (%)
            <input disabled={!canManage} type="number" min={0} max={100} value={editorDiscountPct} onChange={(e) => setEditorDiscountPct(e.target.value)} title="Commission retenue par le distributeur/diffuseur sur le circuit de vente. Ce qui reste est le prix éditeur. Par défaut 50 % (selon le contrat de distribution)." style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Prix éditeur (auto, net −{editorDiscountNum || 0} %)
            <input
              readOnly
              value={priceEditeur != null ? priceEditeur.toLocaleString("fr-FR") : ""}
              placeholder="—"
              title="Ce que touche réellement Éclosion par exemplaire, une fois retirée la commission du distributeur/diffuseur (prix public − part des intermédiaires). À ne pas confondre avec le prix professionnel, qui est ce que paie le revendeur."
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", background: "var(--ivory, #FAF8F2)", color: "var(--muted)" }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Coût de production unitaire (FCFA)
            <input disabled={!canManage} type="number" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
          <strong>Prix professionnel</strong> = ce que paie le revendeur (prix public − remise revendeur).{" "}
          <strong>Prix éditeur</strong> = ce que touche réellement Éclosion par exemplaire, une fois retirée la commission du distributeur/diffuseur.
        </div>

        {/* Volet scolaire (§3). */}
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <input disabled={!canManage} type="checkbox" checked={isSchool} onChange={(e) => setIsSchool(e.target.checked)} style={{ width: "auto", margin: 0 }} />
          Livre scolaire
        </label>
        {isSchool && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 6 }}>
            <label style={{ fontSize: 12 }}>
              Niveau
              <input disabled={!canManage} value={schoolLevel} onChange={(e) => setSchoolLevel(e.target.value)} placeholder="Ex. 6e, CM2…" style={inputStyle} />
            </label>
            <label style={{ fontSize: 12 }}>
              Matière
              <input disabled={!canManage} value={schoolSubject} onChange={(e) => setSchoolSubject(e.target.value)} placeholder="Ex. Français" style={inputStyle} />
            </label>
            <label style={{ fontSize: 12 }}>
              Année scolaire
              <input disabled={!canManage} value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} placeholder="Ex. 2026-2027" style={inputStyle} />
            </label>
          </div>
        )}

        {canManage && (
          <button type="submit" style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>
            Enregistrer la fiche
          </button>
        )}
      </form>
    </CollapsibleSection>
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

// Panneau d'attribution par numéro (parcours §9 de la Banque des ISBN) : saisir
// ou rechercher un ISBN → vérifier dans la banque → action selon le cas.
function IsbnAttributePanel({
  input, setInput, format, setFormat, lookup, busy, error, info,
  onVerify, onConfirm, onGenerate, onOpenOther, poolAvailable, bank, onAttribute, currentManuscriptId, onRattach,
}: {
  input: string; setInput: (v: string) => void;
  format: IsbnFormat; setFormat: (f: IsbnFormat) => void;
  lookup: IsbnLookupResult | null; busy: boolean; error: string | null; info: string | null;
  onVerify: () => void; onConfirm: () => void; onGenerate: () => void;
  onOpenOther?: (id: string) => void; poolAvailable: number;
  bank: IsbnBankResponse | null; onAttribute: (isbn13: string, fmt: IsbnFormat) => void;
  currentManuscriptId: string; onRattach: (isbnId: string) => void;
}) {
  const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: "10px 0", background: "var(--ivory, #FAF8F2)" };
  const primaryBtn: React.CSSProperties = { background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
  const can = lookup?.case;

  // Attribution PAR CAS DE FIGURE : on choisit d'abord LE CAS qui correspond au
  // dossier en cours, puis l'outil adapté s'affiche. Les cas « déjà rattaché »,
  // « attribué à un autre ouvrage » et « annulé » sont DÉTECTÉS automatiquement
  // par la vérification d'un numéro (ils ne sont pas des choix de départ).
  type Scenario = "disponible" | "deja_paru" | "absent" | "verifier";
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [dejaSearch, setDejaSearch] = useState("");
  const items = bank?.items ?? [];
  // Deux familles distinctes :
  //  • « Disponibles » = numéros NEUFS vierges (sans titre), libres, à attribuer.
  //  • « Déjà parus »  = ISBN de livres déjà publiés, conservés comme RÉFÉRENCES
  //    (numéro + titre + auteur) mais PAS encore liés à une fiche Eclospace
  //    (manuscript_id null) → à rechercher puis rattacher au dossier en cours.
  const dispoItems = items.filter((i) => i.bank_status === "disponible" && !i.title && !i.author);
  // « Déjà parus » = TOUS les ISBN déjà attribués/publiés déjà enregistrés dans
  // le système (catalogue Eclospace inclus). Ceux SANS ouvrage lié se rattachent
  // au dossier en cours ; ceux DÉJÀ liés à un ouvrage sont montrés pour
  // information (on ne réutilise jamais un ISBN déjà pris) avec accès au dossier.
  const dejaParusItems = items.filter((i) => i.bank_status === "attribue");
  const dejaQ = dejaSearch.trim().toLowerCase();
  const dejaParusFiltered = dejaQ
    ? dejaParusItems.filter((i) => `${i.isbn13} ${i.title ?? ""} ${i.author ?? ""}`.toLowerCase().includes(dejaQ))
    : dejaParusItems;
  const SCENARIOS: { key: Scenario; label: string; hint: string; count?: number }[] = [
    { key: "disponible", label: "✅ Attribuer un ISBN disponible", hint: "L'ouvrage reçoit un numéro neuf, libre, de la banque.", count: dispoItems.length },
    { key: "deja_paru", label: "📘 Rattacher un ISBN déjà paru", hint: "Rechercher dans les ouvrages déjà parus du catalogue (par titre ou numéro) et rattacher l'ISBN existant.", count: dejaParusItems.length },
    { key: "absent", label: "➕ Enregistrer un nouvel ISBN", hint: "Le numéro n'est pas encore dans la banque : on l'enregistre et on l'attribue en un geste." },
    { key: "verifier", label: "🔎 Vérifier un numéro précis", hint: "Vous avez un numéro et voulez savoir son cas (disponible, déjà attribué, annulé…)." },
  ];
  const numberTool = scenario === "absent" || scenario === "verifier";

  return (
    <div style={box}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Attribuer un ISBN à cet ouvrage</div>

      {/* 1) CHOIX DU CAS qui correspond au dossier en cours. */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Quel est le cas de ce dossier ?</div>
        <div style={{ display: "grid", gap: 6 }}>
          {SCENARIOS.map((sc) => {
            const active = scenario === sc.key;
            return (
              <button key={sc.key} type="button" onClick={() => setScenario(active ? null : sc.key)}
                style={{ textAlign: "left", background: active ? "var(--eclosion-soft, #FBF4D9)" : "#fff", border: `1px solid ${active ? "var(--eclosion, #D9B21A)" : "var(--line)"}`, borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                  {sc.label}{typeof sc.count === "number" ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {sc.count}</span> : null}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{sc.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2) Cas « Disponible » → liste des ISBN disponibles, bouton Attribuer. */}
      {scenario === "disponible" && (
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed var(--line)" }}>
          {dispoItems.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucun ISBN disponible en banque. Utilisez « Enregistrer un nouvel ISBN » ou faites charger une tranche par l'administrateur.</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 6, maxHeight: 260, overflow: "auto" }}>
                {dispoItems.map((it) => <IsbnBankRow key={it.id} it={it} cat="disponible" busy={busy} onAttribute={onAttribute} onOpenOther={onOpenOther} />)}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Cliquez « Attribuer » sur le numéro voulu. Il sera attribué à cet ouvrage au format indiqué sur sa ligne.</div>
            </>
          )}
        </div>
      )}

      {/* 2bis) Cas « Déjà paru » → RECHERCHE dans les ISBN de référence (livres
          déjà publiés, non encore liés à une fiche) par titre ou numéro. */}
      {scenario === "deja_paru" && (
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed var(--line)" }}>
          <input
            value={dejaSearch}
            onChange={(e) => setDejaSearch(e.target.value)}
            placeholder="Rechercher par titre, auteur ou numéro ISBN…"
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, marginBottom: 8 }}
          />
          {dejaParusItems.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucun ouvrage déjà paru / ISBN déjà attribué n'est encore enregistré dans le système.</div>
          ) : dejaParusFiltered.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucun résultat pour « {dejaSearch} ». Essayez un autre titre ou numéro.</div>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>{dejaParusFiltered.length} ouvrage(s) déjà paru. Recherchez le livre, vérifiez le titre/l'auteur, puis « Rattacher ». Un ISBN déjà lié à un autre ouvrage ne peut pas être réutilisé (accès au dossier proposé).</div>
              <div style={{ display: "grid", gap: 6, maxHeight: 300, overflow: "auto" }}>
                {dejaParusFiltered.map((it) => {
                  const onCurrent = it.manuscript_id === currentManuscriptId;
                  return (
                    <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 11px", background: "#fff" }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{it.title || <span style={{ color: "var(--muted)", fontWeight: 400 }}>(sans titre)</span>}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {it.author ? `${it.author} · ` : ""}<span style={{ fontFamily: "var(--font-mono)" }}>{it.isbn13}</span> · {FORMAT_LABELS[it.format] ?? it.format}
                        </div>
                      </div>
                      {onCurrent ? (
                        <span style={{ fontSize: 11.5, color: "#2F7D4A", fontWeight: 700 }}>✓ Déjà rattaché à cet ouvrage</span>
                      ) : (
                        <button type="button" disabled={busy}
                          onClick={() => { if (it.manuscript_id) onRattach(it.id); else onAttribute(it.isbn13, it.format); }}
                          title="Relier ce numéro ISBN à l'ouvrage en cours"
                          style={{ background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
                          Rattacher l'ISBN
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* 3) Cas « Absent » / « Vérifier » → saisie d'un numéro + vérification. */}
      {numberTool && (
        <>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            {scenario === "absent" ? "Saisissez le nouveau numéro ISBN à enregistrer :" : "Saisissez le numéro à vérifier :"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scenario === "absent" ? onConfirm() : onVerify(); } }}
              placeholder="Saisir un numéro ISBN"
              style={{ flex: 1, minWidth: 220, padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "var(--font-mono)" }}
            />
            <button onClick={onVerify} disabled={busy || !input.trim()} style={{ ...primaryBtn, background: "#fff", border: "1px solid var(--eclosion, #D9B21A)", color: "var(--eclosion-dark, #9a7a12)" }}>Vérifier</button>
          </div>
          {scenario === "absent" && (
            // Enregistrement DIRECT du nouveau numéro + attribution à l'ouvrage,
            // sans étape « Vérifier » séparée. Si le numéro existe déjà, le
            // serveur le signale (message d'erreur adapté).
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Format :
                <select value={format} onChange={(e) => setFormat(e.target.value as IsbnFormat)} style={{ marginLeft: 6, padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}>
                  <option value="print">Imprimé</option><option value="epub">ePub</option><option value="pdf">PDF</option><option value="audio">Audio</option>
                </select>
              </label>
              <button onClick={onConfirm} disabled={busy || !input.trim()} style={primaryBtn}>Enregistrer et attribuer l'ISBN</button>
            </div>
          )}
          {scenario === "absent" && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              « Enregistrer et attribuer l'ISBN » crée le numéro dans la banque et le relie à cet ouvrage. L'étape « Attribution des références » peut ensuite être validée.
            </div>
          )}
        </>
      )}

      {error && <div style={{ marginTop: 10, background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>⚠ {error}</div>}
      {info && <div style={{ marginTop: 10, background: "#e9f3ec", color: "#2F7D4A", borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>✓ {info}</div>}

      {lookup && (
        <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.5 }}>
          {can === "absent" && (
            <div>
              <div style={{ color: "var(--ink)" }}>ℹ️ Cet ISBN n'est pas enregistré dans la banque. Vous pouvez l'enregistrer et l'attribuer à cet ouvrage.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Format :
                  <select value={format} onChange={(e) => setFormat(e.target.value as IsbnFormat)} style={{ marginLeft: 6, padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}>
                    <option value="print">Imprimé</option><option value="epub">ePub</option><option value="pdf">PDF</option><option value="audio">Audio</option>
                  </select>
                </label>
                <button onClick={onConfirm} disabled={busy} style={primaryBtn}>Enregistrer et attribuer au manuscrit</button>
              </div>
            </div>
          )}
          {can === "disponible" && (
            <div>
              <div style={{ color: "#2F7D4A", fontWeight: 600 }}>✅ ISBN trouvé dans la banque — Disponible. Aucun ouvrage associé.</div>
              <button onClick={onConfirm} disabled={busy} style={{ ...primaryBtn, marginTop: 8 }}>Attribuer cet ISBN</button>
            </div>
          )}
          {can === "attribue_libre" && (
            <div>
              <div style={{ color: "var(--ink)" }}>Cet ISBN est enregistré (attribué) mais <strong>sans ouvrage lié</strong> — typiquement un ouvrage déjà paru. Vous pouvez le rattacher à cet ouvrage.</div>
              <button onClick={onConfirm} disabled={busy} style={{ ...primaryBtn, marginTop: 8 }}>Rattacher cet ISBN à l'ouvrage</button>
            </div>
          )}
          {can === "attribue_courant" && (
            <div style={{ color: "var(--muted)" }}>ℹ️ Cet ISBN est déjà rattaché à cet ouvrage.</div>
          )}
          {can === "attribue_autre" && (
            <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px" }}>
              ⚠️ Cet ISBN est <strong>déjà attribué</strong> à {lookup.other_manuscript ? `« ${lookup.other_manuscript.title} » (${lookup.other_manuscript.number})` : "un autre ouvrage"}.
              {lookup.isbn?.author && <> — Auteur : {lookup.isbn.author}.</>} Il ne peut pas être attribué à un second ouvrage.
              {lookup.other_manuscript && onOpenOther && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => onOpenOther(lookup.other_manuscript!.id)} style={{ background: "#fff", border: "1px solid var(--alert)", color: "var(--alert)", borderRadius: 6, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Voir le dossier</button>
                </div>
              )}
            </div>
          )}
          {can === "annule" && (
            <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px" }}>⚠️ Cet ISBN est annulé / inutilisable : il ne peut pas être attribué.</div>
          )}
        </div>
      )}

      {/* Option : générer le PROCHAIN ISBN de la tranche (ouvrages neufs) —
          seulement pertinente pour « disponible » / « nouvel ISBN ». */}
      {(scenario === "disponible" || scenario === "absent") && (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--line)", fontSize: 12, color: "var(--muted)" }}>
        <span>Ou attribuer le prochain numéro de la tranche de la maison </span>
        <label style={{ marginLeft: 4 }}>
          <select value={format} onChange={(e) => setFormat(e.target.value as IsbnFormat)} style={{ padding: "4px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }}>
            <option value="print">Imprimé</option><option value="epub">ePub</option><option value="pdf">PDF</option><option value="audio">Audio</option>
          </select>
        </label>
        <button onClick={onGenerate} disabled={busy || poolAvailable <= 0} title={poolAvailable <= 0 ? "Aucun ISBN dans une tranche configurée (utilisez les ISBN disponibles de la banque ci-dessus)" : undefined} style={{ marginLeft: 8, background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 11px", fontSize: 12.5, cursor: poolAvailable <= 0 ? "default" : "pointer" }}>
          Générer le prochain ISBN{poolAvailable > 0 ? ` (${poolAvailable} dispo.)` : ""}
        </button>
      </div>
      )}
    </div>
  );
}

const FORMAT_LABELS: Record<string, string> = { print: "Imprimé", epub: "ePub", pdf: "PDF", audio: "Audio" };

// Une ligne de la liste « ISBN de ce type » : action adaptée à la catégorie.
//  • disponible → « Attribuer » (attribue à l'ouvrage) ;
//  • attribué SANS ouvrage lié → « Rattacher » (ouvrage déjà paru) ;
//  • attribué à un AUTRE ouvrage → lecture seule (+ « Voir le dossier ») ;
//  • annulé → lecture seule.
function IsbnBankRow({ it, cat, busy, onAttribute, onOpenOther }: {
  it: IsbnBankItem; cat: IsbnBankStatus; busy: boolean;
  onAttribute: (isbn13: string, fmt: IsbnFormat) => void; onOpenOther?: (id: string) => void;
}) {
  const actionBtn: React.CSSProperties = { background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", background: "#fff" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{it.isbn13}</span>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{FORMAT_LABELS[it.format] ?? it.format}</span>
      {it.title && <span style={{ fontSize: 11.5, color: "var(--muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {it.title}</span>}
      <span style={{ marginLeft: "auto" }} />
      {cat === "disponible" && (
        <button type="button" disabled={busy} onClick={() => onAttribute(it.isbn13, it.format)} style={actionBtn}>Attribuer</button>
      )}
      {cat === "attribue" && it.manuscript_id === null && (
        <button type="button" disabled={busy} onClick={() => onAttribute(it.isbn13, it.format)} style={{ ...actionBtn, background: "#fff", border: "1px solid var(--eclosion, #D9B21A)", color: "var(--eclosion-dark, #9a7a12)" }} title="ISBN déjà attribué sans ouvrage lié (déjà paru) — le rattacher à cet ouvrage">Rattacher</button>
      )}
      {cat === "attribue" && it.manuscript_id && (
        <span style={{ fontSize: 11.5, color: "var(--muted)", display: "inline-flex", gap: 6, alignItems: "center" }}>
          → {it.manuscript_number ?? "ouvrage"}
          {onOpenOther && <button type="button" onClick={() => onOpenOther(it.manuscript_id!)} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", fontSize: 11.5, cursor: "pointer" }}>Voir</button>}
        </span>
      )}
      {cat === "annule" && <span style={{ fontSize: 11.5, color: "var(--alert, #B23A2E)", fontWeight: 600 }}>Annulé — inutilisable</span>}
    </div>
  );
}
