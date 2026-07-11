import { useEffect, useState } from "react";
import {
  createContract,
  createPartner,
  getContract,
  listContracts,
  listPartners,
  signContract,
  updateContractStatus,
  type Contract,
  type ContractSignature,
  type ContractStatus,
  type Partner,
  type PartnerCategory,
  type SignatureParty,
} from "../api/client";
import { printContract } from "../lib/print";
import { Modal, Field } from "./Modal";
import { Button } from "./Button";
import { DocPrintMenu } from "./DocPrintMenu";

const SIGNATURE_PARTY_LABELS: Record<SignatureParty, string> = {
  author: "Partie contractante (auteur / prestataire)",
  publisher: "Maison d'édition (Éclosion Édition)",
};

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

const PARTNER_CATEGORY_LABELS: Record<PartnerCategory, string> = {
  auteur: "Auteur",
  correcteur: "Correcteur",
  traducteur: "Traducteur",
  illustrateur: "Illustrateur",
  maquettiste: "Maquettiste",
  graphiste: "Graphiste",
  imprimeur: "Imprimeur",
  consultant: "Consultant",
  autre: "Autre prestataire",
};

interface ContractsSectionProps {
  manuscriptId: string;
  defaultPartnerId: string;
  canCreate: boolean;
  canValidate: boolean;
}

// Juridique et contrats (Ch. 9) — circuit de validation affiché comme une
// suite d'étapes, cohérent avec la frise du manuscrit (guide de style §5.1).
// La contrepartie du contrat est un Partenaire (fiche unique auteur +
// prestataires externes — décision opérateur du 04/07/2026).
export function ContractsSection({ manuscriptId, defaultPartnerId, canCreate, canValidate }: ContractsSectionProps) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState<Contract | null>(null);

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
          defaultPartnerId={defaultPartnerId}
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
            {contract.type} — {contract.partner.firstName} {contract.partner.lastName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "2px 10px", fontSize: 11 }}>
              {STATUS_LABELS[contract.status]}
            </span>
            <DocPrintMenu onPrint={(o) => getContract(contract.id).then((c) => printContract(c, o)).catch((e) => setError(e.message))} />
            {canValidate && contract.status === "awaiting_signature" && (
              <button onClick={() => setSigning(contract)} style={{ ...secondaryButtonStyle, borderColor: "var(--eclosion)", color: "var(--eclosion)", fontWeight: 600 }}>
                ✍️ Signer
              </button>
            )}
            {canValidate &&
              STATUS_CHAIN.indexOf(contract.status) >= 0 &&
              contract.status !== "awaiting_signature" &&
              STATUS_CHAIN.indexOf(contract.status) < STATUS_CHAIN.length - 1 && (
                <button onClick={() => advance(contract)} style={secondaryButtonStyle}>
                  Faire avancer →
                </button>
              )}
          </div>
        </div>
      ))}

      {signing && (
        <SignatureModal
          contract={signing}
          onClose={() => setSigning(null)}
          onSigned={() => {
            setSigning(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// Signature « simple / interne » (Phase B) : on affiche les signatures déjà
// apposées et, tant que le contrat attend une signature, un formulaire d'accord
// explicite. La signature de la partie contractante (auteur) active le contrat.
function SignatureModal({ contract, onClose, onSigned }: { contract: Contract; onClose: () => void; onSigned: () => void }) {
  const [signatures, setSignatures] = useState<ContractSignature[]>([]);
  const [party, setParty] = useState<SignatureParty>("author");
  const [signerName, setSignerName] = useState(`${contract.partner.firstName} ${contract.partner.lastName}`);
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getContract(contract.id)
      .then((c) => setSignatures(c.signatures ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, [contract.id]);

  // Le nom par défaut suit la partie choisie (auteur = partenaire ; maison = à saisir).
  function onPartyChange(next: SignatureParty) {
    setParty(next);
    setSignerName(next === "author" ? `${contract.partner.firstName} ${contract.partner.lastName}` : "");
  }

  const alreadySigned = new Set(signatures.map((s) => s.party));

  async function handleSign() {
    if (!consent) {
      setError("Cochez la confirmation d'accord pour signer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await signContract(contract.id, { party, signer_name: signerName.trim(), consent, note: note || undefined });
      setSignatures(updated.signatures ?? []);
      onSigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la signature.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Signature — ${contract.contractNumber}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="view" size="sm" onClick={onClose}>Fermer</Button>
          {!alreadySigned.has(party) && (
            <Button variant="add" size="sm" onClick={handleSign} disabled={busy || !signerName.trim() || !consent}>
              {busy ? "Enregistrement…" : "Signer"}
            </Button>
          )}
        </>
      }
    >
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        {contract.type} — {contract.partner.firstName} {contract.partner.lastName}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Signatures enregistrées</div>
        {signatures.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucune signature pour l'instant.</div>
        ) : (
          signatures.map((s) => (
            <div key={s.id} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <strong>{SIGNATURE_PARTY_LABELS[s.party]}</strong> — {s.signerName}
              <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                {new Date(s.signedAt).toLocaleString("fr-FR")} · empreinte {s.termsHash.slice(0, 12)}…
              </div>
            </div>
          ))
        )}
      </div>

      <Field label="Partie qui signe">
        <select value={party} onChange={(e) => onPartyChange(e.target.value as SignatureParty)}>
          <option value="author">{SIGNATURE_PARTY_LABELS.author}</option>
          <option value="publisher">{SIGNATURE_PARTY_LABELS.publisher}</option>
        </select>
      </Field>

      {alreadySigned.has(party) ? (
        <p style={{ fontSize: 13, color: "var(--eclosion)" }}>Cette partie a déjà signé ce contrat.</p>
      ) : (
        <>
          <Field label="Nom du signataire">
            <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Nom et prénom" />
          </Field>
          <Field label="Note (facultatif)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. signé en présence de…" />
          </Field>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 4 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              Je confirme l'accord de cette partie sur les clauses du contrat. La signature sera horodatée et inscrite au journal
              inviolable. La signature de la partie contractante active le contrat.
            </span>
          </label>
        </>
      )}

      {error && <p style={{ color: "var(--alert)", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

function NewContractForm({
  manuscriptId,
  defaultPartnerId,
  onCreated,
  onError,
}: {
  manuscriptId: string;
  defaultPartnerId: string;
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [type, setType] = useState("edition");
  const [rate, setRate] = useState(10);
  const [advance, setAdvance] = useState(0);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState(defaultPartnerId);

  const refreshPartners = () => listPartners().then(setPartners);

  useEffect(() => {
    refreshPartners();
  }, []);

  async function handleAddPartner() {
    const category = window.prompt(
      `Catégorie (${Object.keys(PARTNER_CATEGORY_LABELS).join(", ")})`,
      "correcteur",
    ) as PartnerCategory | null;
    if (!category || !(category in PARTNER_CATEGORY_LABELS)) return;
    const firstName = window.prompt("Prénom");
    const lastName = window.prompt("Nom");
    if (!firstName || !lastName) return;
    const partner = await createPartner({ category, first_name: firstName, last_name: lastName });
    await refreshPartners();
    setPartnerId(partner.id);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createContract({
        type,
        manuscript_id: manuscriptId,
        partner_id: partnerId,
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
            <option value="correction">Correction</option>
            <option value="illustration">Illustration</option>
            <option value="prestation">Prestation de services</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Partenaire
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} style={inputStyle}>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName} ({PARTNER_CATEGORY_LABELS[p.category]})
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="button" onClick={handleAddPartner} style={secondaryButtonStyle}>
            + Nouveau partenaire
          </button>
        </div>
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
