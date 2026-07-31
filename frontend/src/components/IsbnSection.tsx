import { useEffect, useState } from "react";
import {
  assignIsbn,
  createLegalDeposit,
  getIsbnCompleteness,
  getWorkMetadata,
  isbnBarcodeUrl,
  listIsbnPools,
  listIsbns,
  listLegalDeposits,
  updateWorkMetadata,
  type Isbn,
  type IsbnFormat,
  type IsbnPoolSummary,
  type LegalDeposit,
  type WorkMetadata,
} from "../api/client";

interface IsbnSectionProps {
  manuscriptId: string;
  canManage: boolean;
}

// ISBN, dépôt légal et métadonnées (Ch. 13) : identité officielle de
// l'ouvrage, point de passage obligé avant le BAT (Ch. 13 §13.9).
export function IsbnSection({ manuscriptId, canManage }: IsbnSectionProps) {
  const [isbns, setIsbns] = useState<Isbn[]>([]);
  const [pools, setPools] = useState<IsbnPoolSummary[]>([]);
  const [deposits, setDeposits] = useState<LegalDeposit[]>([]);
  const [metadata, setMetadata] = useState<WorkMetadata | null>(null);
  const [completeness, setCompleteness] = useState<{ complete: boolean; missing: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [weight, setWeight] = useState("");

  const refresh = async () => {
    const [isbnList, poolData, depositList, meta, complete] = await Promise.all([
      listIsbns(manuscriptId),
      listIsbnPools(),
      listLegalDeposits(manuscriptId),
      getWorkMetadata(manuscriptId),
      getIsbnCompleteness(manuscriptId),
    ]);
    setIsbns(isbnList);
    setPools(poolData.pools);
    setDeposits(depositList);
    setMetadata(meta);
    setCompleteness(complete);
    setSummary(meta?.summary ?? "");
    setWeight(meta?.weightGrams?.toString() ?? "");
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  async function handleAssign() {
    const format = window.prompt("Format (print, epub, pdf, audio)", "print") as IsbnFormat | null;
    if (!format) return;
    try {
      await assignIsbn(manuscriptId, format, pools[0]?.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'attribution.");
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

  async function handleSaveMetadata(event: React.FormEvent) {
    event.preventDefault();
    try {
      await updateWorkMetadata(manuscriptId, { summary: summary || undefined, weight_grams: weight ? Number(weight) : undefined });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>ISBN, dépôt légal et métadonnées</div>
      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {completeness && !completeness.complete && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "6px 10px", fontSize: 12, marginBottom: 10 }}>
          Complétude non atteinte : {completeness.missing.join(", ")}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>ISBN attribués</div>
        {canManage && (
          <button onClick={handleAssign} style={secondaryButtonStyle}>
            + Attribuer un ISBN
          </button>
        )}
      </div>
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
          {deposit.country} — {deposit.depository} ({deposit.copiesRequired} ex.) — {deposit.status}
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
        {canManage && (
          <button type="submit" style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>
            Enregistrer la fiche
          </button>
        )}
      </form>
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
