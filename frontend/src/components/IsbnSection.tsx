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
}

// ISBN, dépôt légal et métadonnées (Ch. 13) : identité officielle de
// l'ouvrage, point de passage obligé avant le BAT (Ch. 13 §13.9).
export function IsbnSection({ manuscriptId, canManage, startOpen = false, onOpenManuscript }: IsbnSectionProps) {
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
  const [pricePro, setPricePro] = useState("");
  const [priceEditeur, setPriceEditeur] = useState("");
  const [pricePromo, setPricePromo] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [commStatus, setCommStatus] = useState("");
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
    setPricePro(meta?.pricePro ?? "");
    setPriceEditeur(meta?.priceEditeur ?? "");
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

  // Prix remisé −25 % : calculé automatiquement depuis le prix public (PPT),
  // affiché à titre indicatif (non stocké).
  const priceDiscount25 = Number(pricePublic) > 0 ? Math.round(Number(pricePublic) * 0.75) : null;

  async function handleSaveMetadata(event: React.FormEvent) {
    event.preventDefault();
    try {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      await updateWorkMetadata(manuscriptId, {
        summary: summary || undefined,
        weight_grams: weight ? Number(weight) : undefined,
        edition_type: (editionType || null) as EditionType | null,
        price_public: num(pricePublic),
        price_pro: num(pricePro),
        price_editeur: num(priceEditeur),
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
        <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
          Poids (grammes)
          <input disabled={!canManage} type="number" value={weight} onChange={(e) => setWeight(e.target.value)} style={inputStyle} />
        </label>

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
            Prix remisé −25 % (auto)
            <input
              readOnly
              value={priceDiscount25 != null ? priceDiscount25.toLocaleString("fr-FR") : ""}
              placeholder="—"
              title="Calculé automatiquement : prix public × 0,75"
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", background: "var(--ivory, #FAF8F2)", color: "var(--muted)" }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Prix promotionnel / autre (FCFA)
            <input disabled={!canManage} type="number" min={0} value={pricePromo} onChange={(e) => setPricePromo(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Prix professionnel (FCFA)
            <input disabled={!canManage} type="number" min={0} value={pricePro} onChange={(e) => setPricePro(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Prix éditeur (FCFA)
            <input disabled={!canManage} type="number" min={0} value={priceEditeur} onChange={(e) => setPriceEditeur(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Coût de production unitaire (FCFA)
            <input disabled={!canManage} type="number" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </label>
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
