import { useEffect, useRef, useState } from "react";
import {
  createContract,
  createPartner,
  updatePartner,
  getContract,
  listContracts,
  listPartners,
  signContract,
  updateContractStatus,
  listContractDocuments,
  uploadContractDocument,
  contractDocumentDownloadUrl,
  deleteContractDocument,
  type Contract,
  type ContractDocument,
  type ContractDocumentKind,
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

function humanSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
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

          {/* Coordonnées de la contrepartie — e-mail et WhatsApp pour les notifications. */}
          <ContactBlock partner={contract.partner} canEdit={canCreate} onChanged={refresh} onError={setError} />

          {/* Contrat physique signé, numérisé (PDF ou images) + annexes. */}
          <DocumentsBlock contractId={contract.id} canManage={canCreate} onError={setError} />

          {/* Traçabilité : qui a saisi / modifié en dernier. */}
          <TraceabilityLine contract={contract} />
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

// Coordonnées de la contrepartie (auteur / prestataire) : e-mail et numéro
// WhatsApp, utilisés pour lui adresser les notifications de suivi. Modifiables
// en place par une personne habilitée à la saisie des contrats.
function ContactBlock({
  partner,
  canEdit,
  onChanged,
  onError,
}: {
  partner: Contract["partner"];
  canEdit: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(partner.email ?? "");
  const [whatsapp, setWhatsapp] = useState(partner.whatsapp ?? "");
  const [phone, setPhone] = useState(partner.phone ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEmail(partner.email ?? "");
    setWhatsapp(partner.whatsapp ?? "");
    setPhone(partner.phone ?? "");
  }, [partner.email, partner.whatsapp, partner.phone]);

  async function save() {
    setBusy(true);
    try {
      await updatePartner(partner.id, { email: email.trim(), whatsapp: whatsapp.trim(), phone: phone.trim() });
      setEditing(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span>✉️ {partner.email ? <a href={`mailto:${partner.email}`} style={{ color: "var(--eclosion)" }}>{partner.email}</a> : <em style={{ color: "var(--alert)" }}>e-mail manquant</em>}</span>
        <span>💬 WhatsApp : {partner.whatsapp ? <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{partner.whatsapp}</span> : <em style={{ color: "var(--alert)" }}>non renseigné</em>}</span>
        {canEdit && (
          <button onClick={() => setEditing(true)} style={{ ...linkButtonStyle }}>
            {partner.email && partner.whatsapp ? "Modifier les coordonnées" : "Compléter les coordonnées"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, border: "1px dashed var(--line)", borderRadius: 8, padding: 10, background: "var(--bg, #F8F9FB)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
        Coordonnées de {partner.firstName} {partner.lastName} — pour lui envoyer les notifications
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 11.5 }}>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="auteur@exemple.com" style={inputStyle} />
        </label>
        <label style={{ fontSize: 11.5 }}>
          Numéro WhatsApp
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+237 6 XX XX XX XX" style={inputStyle} />
        </label>
        <label style={{ fontSize: 11.5 }}>
          Téléphone (facultatif)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Fixe / autre" style={inputStyle} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={save} disabled={busy} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button onClick={() => setEditing(false)} disabled={busy} style={secondaryButtonStyle}>
          Annuler
        </button>
      </div>
    </div>
  );
}

const DOC_KIND_LABELS: Record<ContractDocumentKind, string> = {
  signed_scan: "Contrat signé (scan)",
  annexe: "Annexe",
};

// Pièces numérisées du contrat : le contrat physique signé de l'auteur, scanné
// en PDF ou en images, et d'éventuelles annexes. Téléversement, téléchargement,
// retrait (suppression logique côté serveur).
function DocumentsBlock({ contractId, canManage, onError }: { contractId: string; canManage: boolean; onError: (m: string) => void }) {
  const [docs, setDocs] = useState<ContractDocument[]>([]);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<ContractDocumentKind>("signed_scan");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => listContractDocuments(contractId).then(setDocs).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  async function upload(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      await uploadContractDocument(contractId, { label: label.trim(), kind, file });
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Téléversement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(docId: string) {
    if (!window.confirm("Retirer cette pièce ? (elle reste conservée au journal, suppression logique)")) return;
    try {
      await deleteContractDocument(contractId, docId);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Retrait impossible.");
    }
  }

  return (
    <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
        Contrat signé & pièces jointes
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {docs.length === 0 && <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Aucune pièce numérisée. Téléversez le contrat scanné signé (PDF ou images).</p>}
        {docs.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13 }}>
                {d.kind === "signed_scan" ? "📄" : "📎"} {d.label || d.name}{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>{d.size ? `(${humanSize(d.size)})` : ""}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {DOC_KIND_LABELS[d.kind]}
                {d.uploaded_by ? ` · déposé par ${d.uploaded_by}` : ""} · {new Date(d.created_at).toLocaleDateString("fr-FR")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
              <a href={contractDocumentDownloadUrl(contractId, d.id)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--eclosion)", fontWeight: 600 }}>
                Télécharger
              </a>
              {canManage && (
                <button onClick={() => remove(d.id)} style={{ ...linkButtonStyle, color: "var(--alert)" }}>
                  Retirer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {canManage && (
        <div style={{ marginTop: 8, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as ContractDocumentKind)} style={{ fontSize: 12.5, padding: 5 }}>
              <option value="signed_scan">Contrat signé (scan)</option>
              <option value="annexe">Annexe</option>
            </select>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Intitulé (facultatif)" style={{ flex: 1, minWidth: 140, padding: "6px 9px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5 }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
              style={{ fontSize: 12.5 }}
            />
            {busy && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Envoi…</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>PDF ou images (JPG, PNG…). Jusqu'à 200 Mo par fichier.</div>
        </div>
      )}
    </div>
  );
}

// Traçabilité (contrainte d'intégrité — modèle §13) : chaque contrat conserve
// qui l'a saisi et qui l'a modifié en dernier. Ligne informative, non modifiable.
function TraceabilityLine({ contract }: { contract: Contract }) {
  if (!contract.createdByName && !contract.updatedByName) return null;
  const created = contract.createdAt ? new Date(contract.createdAt).toLocaleDateString("fr-FR") : null;
  const updated = contract.updatedAt ? new Date(contract.updatedAt).toLocaleDateString("fr-FR") : null;
  return (
    <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
      🔒 Traçabilité —{" "}
      {contract.createdByName && (
        <>
          saisi par <strong>{contract.createdByName}</strong>
          {created ? ` le ${created}` : ""}
        </>
      )}
      {contract.updatedByName && (
        <>
          {contract.createdByName ? " · " : ""}dernière modification par <strong>{contract.updatedByName}</strong>
          {updated ? ` le ${updated}` : ""}
        </>
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

// Formulaire de création d'un partenaire (auteur / prestataire) avec ses
// coordonnées de notification (e-mail + WhatsApp) — remplace l'ancienne saisie
// par fenêtres successives, peu lisible.
function PartnerFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (partner: Partner) => void;
}) {
  const [category, setCategory] = useState<PartnerCategory>("auteur");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [penName, setPenName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Le prénom et le nom sont requis.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const partner = await createPartner({
        category,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        pen_name: penName.trim() || undefined,
        email: email.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      onCreated(partner);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouveau partenaire"
      onClose={onClose}
      footer={
        <>
          <Button variant="view" size="sm" onClick={onClose}>Annuler</Button>
          <Button variant="add" size="sm" onClick={submit} disabled={busy}>
            {busy ? "Création…" : "Créer le partenaire"}
          </Button>
        </>
      }
    >
      <Field label="Catégorie">
        <select value={category} onChange={(e) => setCategory(e.target.value as PartnerCategory)}>
          {(Object.keys(PARTNER_CATEGORY_LABELS) as PartnerCategory[]).map((c) => (
            <option key={c} value={c}>
              {PARTNER_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Prénom">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
        </Field>
        <Field label="Nom">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
        </Field>
      </div>
      <Field label="Nom de plume (facultatif)">
        <input value={penName} onChange={(e) => setPenName(e.target.value)} placeholder="Pseudonyme d'auteur" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="E-mail (pour les notifications)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="auteur@exemple.com" />
        </Field>
        <Field label="Numéro WhatsApp">
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+237 6 XX XX XX XX" />
        </Field>
      </div>
      <Field label="Téléphone (facultatif)">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Fixe / autre" />
      </Field>
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
  const [showPartnerForm, setShowPartnerForm] = useState(false);

  const refreshPartners = () => listPartners().then(setPartners);

  useEffect(() => {
    refreshPartners();
  }, []);

  const selectedPartner = partners.find((p) => p.id === partnerId);

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
          <button type="button" onClick={() => setShowPartnerForm(true)} style={secondaryButtonStyle}>
            + Nouveau partenaire
          </button>
        </div>
        <label style={{ fontSize: 12 }}>
          Avance (FCFA)
          <input type="number" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={inputStyle} />
        </label>
      </div>

      {selectedPartner && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          Coordonnées :{" "}
          {selectedPartner.email ? `✉️ ${selectedPartner.email}` : <span style={{ color: "var(--alert)" }}>e-mail manquant</span>}
          {"  ·  "}
          {selectedPartner.whatsapp ? `💬 ${selectedPartner.whatsapp}` : <span style={{ color: "var(--alert)" }}>WhatsApp non renseigné</span>}
          {" — modifiables sur le contrat une fois créé."}
        </div>
      )}

      <div style={{ fontSize: 12, marginTop: 10 }}>
        Taux de droits d'auteur — cochez le pourcentage validé pour cet ouvrage (entre 8 % et 15 %)
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {[8, 9, 10, 11, 12, 13, 14, 15].map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setRate(p)}
              aria-pressed={rate === p}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${rate === p ? "var(--eclosion)" : "var(--line)"}`,
                background: rate === p ? "var(--eclosion)" : "#fff",
                color: rate === p ? "#fff" : "var(--muted)",
                fontWeight: rate === p ? 700 : 500,
                fontFamily: "var(--font-mono, monospace)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {p} %
            </button>
          ))}
        </div>
      </div>
      <button type="submit" style={{ ...secondaryButtonStyle, marginTop: 10, background: "var(--eclosion)", color: "#fff", border: "none" }}>
        Créer le contrat
      </button>

      {showPartnerForm && (
        <PartnerFormModal
          onClose={() => setShowPartnerForm(false)}
          onCreated={async (partner) => {
            setShowPartnerForm(false);
            await refreshPartners();
            setPartnerId(partner.id);
          }}
        />
      )}
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
const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--eclosion)",
  cursor: "pointer",
  textDecoration: "underline",
};
