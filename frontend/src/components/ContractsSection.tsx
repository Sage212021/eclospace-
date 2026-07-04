import { useEffect, useState } from "react";
import { createContract, listContracts, updateContractStatus, type Contract, type ContractStatus } from "../api/client";

const STATUS_CHAIN: ContractStatus[] = ["preparation", "legal_review", "direction_approval", "awaiting_signature", "active"];
const STATUS_LABELS: Record<ContractStatus, string> = {
  preparation: "En préparation",
  legal_review: "Relecture juridique",
  direction_approval: "Validation direction",
  awaiting_signature: "En attente de signature",
  active: "Actif",
  expired: "Expiré",
  terminated: "Résilié",
};

interface ContractsSectionProps {
  manuscriptId: string;
  authorId: string;
  canCreate: boolean;
  canValidate: boolean;
}

// Juridique et contrats (Ch. 9) — circuit de validation affiché comme une
// suite d'étapes, cohérent avec la frise du manuscrit (guide de style §5.1).
export function ContractsSection({ manuscriptId, authorId, canCreate, canValidate }: ContractsSectionProps) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listContracts(manuscriptId).then(setContracts).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, [manuscriptId]);

  async function advance(contract: Contract) {
    const currentIndex = STATUS_CHAIN.indexOf(contract.status);
    const next = STATUS_CHAIN[currentIndex + 1];
    if (!next) return;
    try {
      await updateContractStatus(contract.id, next);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la transition.");
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Contrats</div>
        {canCreate && (
          <button onClick={() => setShowForm((v) => !v)} style={secondaryButtonStyle}>
            {showForm ? "Annuler" : "+ Nouveau contrat"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {showForm && (
        <NewContractForm
          manuscriptId={manuscriptId}
          authorId={authorId}
          onCreated={() => {
            setShowForm(false);
            refresh();
          }}
          onError={setError}
        />
      )}

      {contracts.length === 0 && !showForm && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun contrat pour ce manuscrit.</p>}

      {contracts.map((contract) => (
        <div key={contract.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10, fontSize: 13 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{contract.contractNumber}</div>
          <div>
            {contract.type} — {contract.author.firstName} {contract.author.lastName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "2px 10px", fontSize: 11 }}>
              {STATUS_LABELS[contract.status]}
            </span>
            {canValidate && STATUS_CHAIN.indexOf(contract.status) >= 0 && STATUS_CHAIN.indexOf(contract.status) < STATUS_CHAIN.length - 1 && (
              <button onClick={() => advance(contract)} style={secondaryButtonStyle}>
                Faire avancer →
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewContractForm({
  manuscriptId,
  authorId,
  onCreated,
  onError,
}: {
  manuscriptId: string;
  authorId: string;
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [type, setType] = useState("edition");
  const [rate, setRate] = useState(10);
  const [advance, setAdvance] = useState(0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createContract({
        type,
        manuscript_id: manuscriptId,
        author_id: authorId,
        financial_terms: {
          base: "prix_public_ht",
          tiers: [{ up_to: null, rate: rate / 100 }],
          advance_amount: advance,
          payment_schedule: "semestriel",
        },
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la création.");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
            <option value="edition">Édition</option>
            <option value="coedition">Coédition</option>
            <option value="cession">Cession de droits</option>
            <option value="traduction">Traduction</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Taux de droits (%)
          <input type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>
          Avance (FCFA)
          <input type="number" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={inputStyle} />
        </label>
      </div>
      <button type="submit" style={{ ...secondaryButtonStyle, marginTop: 10, background: "var(--eclosion)", color: "#fff", border: "none" }}>
        Créer le contrat
      </button>
    </form>
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
