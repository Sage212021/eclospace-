import { useEffect, useMemo, useRef, useState } from "react";
import {
  createContract,
  createPartner,
  updatePartner,
  getContract,
  getPublisherIdentity,
  deleteContract,
  listContracts,
  listPartners,
  signContract,
  updateContractStatus,
  updateContractTerms,
  addContractClause,
  replaceContractClauses,
  setContractArticleOverride,
  getContractTemplates,
  setContractClauseTemplate,
  type ContractDetail,
  listContractDocuments,
  uploadContractDocument,
  contractDocumentDownloadUrl,
  deleteContractDocument,
  getChatDirectory,
  startConversation,
  sendChatMessageWithFile,
  listContractDispatches,
  recordContractDispatch,
  type Contract,
  type ContractDispatch,
  type ContractDocument,
  type ContractDocumentKind,
  type ContractSignature,
  type ContractStatus,
  type Partner,
  type PartnerCategory,
  type SignatureParty,
  type ChatDirectoryEntry,
} from "../api/client";
import { printContract, printAuthorContract, buildAuthorContractHtml, AUTHOR_CONTRACT_ARTICLES, printServiceContract, buildServiceContractHtml, SERVICE_CONTRACT_ARTICLES } from "../lib/print";
import { pasteTidied } from "../lib/tidyProse";
import { getBranding } from "../api/client";
import { buildAuthorContractPdf, downloadAuthorContractPdf } from "../lib/contractPdf";
import { Modal, Field } from "./Modal";
import { Button } from "./Button";
import { DocPrintMenu } from "./DocPrintMenu";
import { CollapsibleSection } from "./CollapsibleSection";
import { AuthorAccountBlock } from "./AuthorAccountBlock";

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

// Quel document générer ? Un contrat de PRESTATION / à compte d'auteur pour les
// types de service (prestation, correction, illustration) ou le modèle « à compte
// d'auteur » ; sinon le contrat d'édition (comportement existant). D-054 / §9.
function isServiceContract(c: { type: string; economicModel?: string | null }): boolean {
  return c.economicModel === "compte_auteur" || ["prestation", "correction", "illustration"].includes(c.type);
}

// Des droits d'auteur s'appliquent-ils ? Oui pour un type rémunérant l'auteur
// (édition, coédition, cession, traduction) à compte d'éditeur ou à demi. Pilote
// l'affichage des champs « droits » (taux, à-valoir, durée de cession, relevés).
function royaltiesApplyFor(type: string, economicModel?: string | null): boolean {
  return ["edition", "coedition", "cession", "traduction"].includes(type) && (economicModel === "compte_editeur" || economicModel === "compte_demi");
}
// Est-ce la maison qui PAIE la contrepartie (→ retenue fiscale pertinente) ? Oui
// quand des droits s'appliquent, ou pour une prestation que nous commandons ;
// NON en « compte d'auteur » (c'est l'auteur qui nous paie).
function weOwePayeeFor(type: string, economicModel?: string | null): boolean {
  if (economicModel === "compte_auteur") return false;
  return royaltiesApplyFor(type, economicModel) || ["prestation", "correction", "illustration"].includes(type);
}

// Libellés courts du modèle économique (D-054) pour l'affichage sur la fiche.
const ECONOMIC_MODEL_LABELS: Record<string, string> = {
  compte_editeur: "à compte d'éditeur",
  compte_auteur: "à compte d'auteur",
  compte_demi: "à compte à demi",
  autre: "autre modèle",
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
  canRemitAuthor?: boolean;
}

// Juridique et contrats (Ch. 9) — circuit de validation affiché comme une
// suite d'étapes, cohérent avec la frise du manuscrit (guide de style §5.1).
// La contrepartie du contrat est un Partenaire (fiche unique auteur +
// prestataires externes — décision opérateur du 04/07/2026).
export function ContractsSection({ manuscriptId, defaultPartnerId, canCreate, canValidate, canRemitAuthor = false }: ContractsSectionProps) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState<Contract | null>(null);
  const [transferContract, setTransferContract] = useState<Contract | null>(null);
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [amendContract, setAmendContract] = useState<Contract | null>(null);
  const [articleContract, setArticleContract] = useState<Contract | null>(null);
  // Incrémenté à chaque envoi enregistré : recharge les journaux d'envoi.
  const [dispatchVersion, setDispatchVersion] = useState(0);
  const bumpDispatch = () => setDispatchVersion((v) => v + 1);
  // Modèles de contrat éditables (§9) : texte par défaut des articles, par type.
  const [templates, setTemplates] = useState<{ edition: Record<number, string>; service: Record<number, string> }>({ edition: {}, service: {} });
  const [showTemplates, setShowTemplates] = useState(false);
  const loadTemplates = () =>
    getContractTemplates()
      .then((rows) => {
        const m = { edition: {} as Record<number, string>, service: {} as Record<number, string> };
        for (const r of rows) m[r.template_key][r.article_number] = r.body;
        setTemplates(m);
      })
      .catch(() => {});
  const templateMapFor = (c: { type: string; economicModel?: string | null }) => (isServiceContract(c) ? templates.service : templates.edition);

  const refresh = () => listContracts(manuscriptId).then(setContracts).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    loadTemplates();
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

  async function removeContract(contract: Contract) {
    if (!window.confirm(`Supprimer le contrat ${contract.contractNumber} ? Il n'est pas signé (suppression logique, conservée au journal).`)) return;
    try {
      await deleteContract(contract.id);
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  return (
    <CollapsibleSection title="Contrats" storageKey="fiche:contrats">
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {canValidate && (
          <button onClick={() => setShowTemplates(true)} style={secondaryButtonStyle} title="Modifier les textes par défaut des contrats (sans développeur)">
            📝 Modèles de contrats
          </button>
        )}
        {canCreate && (
          <button onClick={() => setShowForm((v) => !v)} style={secondaryButtonStyle}>
            {showForm ? "Annuler" : "+ Nouveau contrat"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {/* Joindre un contrat signé en indiquant explicitement le n° de contrat :
          le fichier est attribué au contrat portant ce numéro (sécurité). */}
      {canCreate && contracts.length > 0 && (
        <SignedScanByNumber contracts={contracts} onDone={refresh} onError={setError} />
      )}

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
            {contract.type}
            {contract.economicModel ? ` (${ECONOMIC_MODEL_LABELS[contract.economicModel] ?? contract.economicModel})` : ""} — {contract.partner.firstName} {contract.partner.lastName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "2px 10px", fontSize: 11 }}>
              {STATUS_LABELS[contract.status]}
            </span>
            <DocPrintMenu label="Fiche (résumé)" onPrint={(o) => getContract(contract.id).then((c) => printContract(c, o)).catch((e) => setError(e.message))} />
            <DocPrintMenu
              label={isServiceContract(contract) ? "Contrat (prestation)" : "Contrat d'édition"}
              // PDF vectoriel « net » : disponible pour le contrat d'édition
              // (modèle jsPDF). Le contrat de prestation passe par l'impression
              // (bouton « Enregistrer en PDF » de la fenêtre).
              onDownloadPdf={isServiceContract(contract) ? undefined : () =>
                Promise.all([getContract(contract.id), getPublisherIdentity().catch(() => null), getBranding().catch(() => null)])
                  .then(([c, pub, brand]) => downloadAuthorContractPdf(c, pub, brand, templates.edition))
                  .catch((e) => setError(e.message))
              }
              onPrint={(o) =>
                Promise.all([getContract(contract.id), getPublisherIdentity().catch(() => null), getBranding().catch(() => null)])
                  .then(([c, pub, brand]) => {
                    // Signature + cachet DG apposés seulement si le réglage l'autorise.
                    const sign = brand && brand.auto_sign_contracts
                      ? { cachet: brand.cachet_generale, signature: brand.signature_dg, dgName: brand.dg_name, dgTitle: brand.dg_title }
                      : null;
                    // Document adapté au type / au modèle économique (§9), avec
                    // les textes par défaut du modèle éditable.
                    if (isServiceContract(c)) printServiceContract(c, o, pub, sign, templates.service);
                    else printAuthorContract(c, o, pub, sign, templates.edition);
                  })
                  .catch((e) => setError(e.message))
              }
              extras={[
                { label: "Transférer (messagerie / WhatsApp)", onSelect: () => setTransferContract(contract) },
                ...(canCreate ? [{ label: "Ajouter un avenant", onSelect: () => setAmendContract(contract) }] : []),
                ...(canCreate && !["active", "terminated", "expired"].includes(contract.status) ? [{ label: "👁 Aperçu & modifier le contrat (clauses)", onSelect: () => setArticleContract(contract) }] : []),
              ]}
            />
            {/* « Modifier » VISIBLE (plus seulement dans le menu) : revenir sur les
                renseignements du contrat tant qu'il n'est pas signé. */}
            {canCreate && !["active", "terminated", "expired"].includes(contract.status) && (
              <button onClick={() => setEditContract(contract)} style={secondaryButtonStyle}>
                ✏️ Modifier
              </button>
            )}
            {canValidate && contract.status === "awaiting_signature" && (
              <button onClick={() => setSigning(contract)} style={{ ...secondaryButtonStyle, borderColor: "var(--eclosion)", color: "var(--eclosion)", fontWeight: 600 }}>
                ✍️ Signer
              </button>
            )}
            {canValidate &&
              STATUS_CHAIN.indexOf(contract.status) >= 0 &&
              contract.status !== "awaiting_signature" &&
              STATUS_CHAIN.indexOf(contract.status) < STATUS_CHAIN.length - 1 && (
                <button onClick={() => advance(contract)} style={secondaryButtonStyle} title="Valide l'étape en cours et passe à la suivante du circuit de contractualisation">
                  Faire avancer → {STATUS_LABELS[STATUS_CHAIN[STATUS_CHAIN.indexOf(contract.status) + 1]]}
                </button>
              )}
            {canValidate && !["active", "terminated", "expired"].includes(contract.status) && (
              <button
                onClick={() => removeContract(contract)}
                title="Supprimer ce contrat non signé"
                style={{ ...secondaryButtonStyle, borderColor: "var(--alert)", color: "var(--alert)" }}
              >
                🗑 Supprimer
              </button>
            )}
          </div>

          {/* Repère sur le circuit de contractualisation : « Faire avancer » fait
              progresser le contrat d'une étape ; à « En attente de signature » on
              SIGNE ; « Actif » = contrat validé et en vigueur. */}
          {canValidate && !["terminated", "expired"].includes(contract.status) && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Circuit : En préparation → Relecture juridique → Validation direction → En attente de signature (✍️ on signe) → Actif.{" "}
              {contract.status === "active" ? "✅ Contrat validé et en vigueur." : contract.status === "awaiting_signature" ? "Étape : à signer." : "« Faire avancer » valide l'étape en cours et passe à la suivante."}
            </div>
          )}

          {/* Coordonnées de la contrepartie — e-mail et WhatsApp pour les notifications. */}
          <ContactBlock partner={contract.partner} canEdit={canCreate} onChanged={refresh} onError={setError} />

          {/* Identité civile de l'auteur reprise en tête du contrat d'édition. */}
          {contract.type === "edition" && <AuthorIdentityBlock partner={contract.partner} canEdit={canCreate} onChanged={refresh} onError={setError} />}

          {/* Contrat physique signé, numérisé (PDF ou images) + annexes. */}
          <DocumentsBlock contractId={contract.id} canManage={canCreate} partnerWhatsapp={contract.partner.whatsapp} onDispatched={bumpDispatch} onError={setError} />

          {/* Journal d'envoi : preuve de transmission du contrat à l'auteur. */}
          <DispatchJournal contractId={contract.id} refreshToken={dispatchVersion} />

          {/* Compte auteur : exemplaires dus vs effectivement remis (§14). */}
          {contract.type === "edition" && (
            <AuthorAccountBlock
              contractId={contract.id}
              partnerId={contract.partner.id}
              manuscriptId={manuscriptId}
              canManage={canCreate}
              canRemit={canRemitAuthor}
              onError={setError}
            />
          )}

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

      {/* Transfert du contrat d'édition généré (PDF construit côté navigateur). */}
      {transferContract && (
        <TransferDocDialog
          title={`Contrat d'édition ${transferContract.contractNumber}`}
          fileName={`Contrat-${transferContract.contractNumber}.pdf`}
          getFile={async () => {
            const [c, pub] = await Promise.all([getContract(transferContract.id), getPublisherIdentity().catch(() => null)]);
            return new File([buildAuthorContractPdf(c, pub)], `Contrat-${transferContract.contractNumber}.pdf`, { type: "application/pdf" });
          }}
          partnerWhatsapp={transferContract.partner.whatsapp}
          contractId={transferContract.id}
          onDispatched={bumpDispatch}
          onClose={() => setTransferContract(null)}
          onError={setError}
        />
      )}

      {/* Modifier les termes du contrat (tant qu'il n'est pas signé/actif). */}
      {editContract && (
        <EditContractModal
          contract={editContract}
          onClose={() => setEditContract(null)}
          onSaved={() => { setEditContract(null); refresh(); }}
          onError={setError}
        />
      )}

      {/* Ajouter un avenant : nouveau contrat lié au contrat d'origine. */}
      {amendContract && (
        <AmendmentModal
          parent={amendContract}
          manuscriptId={manuscriptId}
          onClose={() => setAmendContract(null)}
          onCreated={() => { setAmendContract(null); refresh(); }}
          onError={setError}
        />
      )}

      {/* Ajouter un article : clause propre au contrat, reprise en fin de contrat. */}
      {articleContract && (
        <ArticleModal
          contract={articleContract}
          templates={templates}
          onClose={() => setArticleContract(null)}
          onSaved={() => { setArticleContract(null); refresh(); }}
          onError={setError}
        />
      )}
      {showTemplates && (
        <ContractTemplatesModal
          templates={templates}
          onClose={() => setShowTemplates(false)}
          canEdit={canValidate}
          onSaved={loadTemplates}
          onError={setError}
        />
      )}
    </CollapsibleSection>
  );
}

// Joindre un contrat signé (scan) en NOMMANT le numéro de contrat auto-généré :
// l'utilisateur saisit le n° (CT-…) pour attribuer explicitement le fichier au
// bon contrat. Sécurité contre les pièces jointes mal rattachées.
function SignedScanByNumber({ contracts, onDone, onError }: { contracts: Contract[]; onDone: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setMessage(null);
    const wanted = number.trim().toUpperCase();
    if (!wanted) { onError("Indiquez le numéro du contrat (ex. CT-2026-0003) avant de joindre le fichier."); return; }
    const match = contracts.find((c) => c.contractNumber.toUpperCase() === wanted);
    if (!match) {
      onError(`Aucun contrat « ${wanted} » sur cet ouvrage. Vérifiez le numéro (il est affiché sur chaque contrat ci-dessous).`);
      return;
    }
    setBusy(true);
    try {
      await uploadContractDocument(match.id, { label: "Contrat signé (scan)", kind: "signed_scan", file });
      setMessage(`Contrat signé joint au contrat ${match.contractNumber} (${match.partner.firstName} ${match.partner.lastName}).`);
      setNumber("");
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Téléversement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => setOpen(true)} style={secondaryButtonStyle}>📎 Joindre un contrat signé (par n° de contrat)</button>
      </div>
    );
  }

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 12, marginBottom: 12, background: "var(--bg, #F8F9FB)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Joindre un contrat signé par l'auteur</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>Indiquez le numéro du contrat auto-généré (affiché sur chaque contrat, ex. <span style={{ fontFamily: "var(--font-mono)" }}>CT-2026-0003</span>) : le fichier scanné sera rattaché à ce contrat.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="N° de contrat (CT-…)" style={{ ...inputStyle, width: 190, fontFamily: "var(--font-mono)" }} />
        <label style={{ ...secondaryButtonStyle, cursor: busy ? "default" : "pointer" }}>
          {busy ? "Envoi…" : "Choisir le fichier signé (PDF/images)"}
          <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} disabled={busy || !number.trim()} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        </label>
        <button onClick={() => { setOpen(false); setMessage(null); }} style={{ ...linkButtonStyle }}>Fermer</button>
      </div>
      {message && <div style={{ marginTop: 8, fontSize: 12, color: "var(--eclosion)", background: "var(--eclosion-soft)", borderRadius: 6, padding: "6px 10px" }}>{message}</div>}
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

// Identité civile de l'auteur reprise en tête du contrat d'édition. Collectée à
// l'enregistrement du manuscrit ; complétable / corrigeable ici (utile pour les
// auteurs saisis avant sa collecte, et si le terme change d'un auteur à l'autre).
function AuthorIdentityBlock({ partner, canEdit, onChanged, onError }: { partner: Contract["partner"]; canEdit: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const iso = (v?: string | null) => (v ? v.slice(0, 10) : "");
  const [f, setF] = useState({
    address: partner.address ?? "",
    nationality: partner.nationality ?? "",
    profession: partner.profession ?? "",
    birth_date: iso(partner.birthDate),
    birth_place: partner.birthPlace ?? "",
    id_number: partner.idNumber ?? "",
    id_issued_date: iso(partner.idIssuedDate),
    id_issued_place: partner.idIssuedPlace ?? "",
  });

  useEffect(() => {
    setF({
      address: partner.address ?? "",
      nationality: partner.nationality ?? "",
      profession: partner.profession ?? "",
      birth_date: iso(partner.birthDate),
      birth_place: partner.birthPlace ?? "",
      id_number: partner.idNumber ?? "",
      id_issued_date: iso(partner.idIssuedDate),
      id_issued_place: partner.idIssuedPlace ?? "",
    });
  }, [partner]);

  async function save() {
    setBusy(true);
    try {
      await updatePartner(partner.id, {
        address: f.address.trim(),
        nationality: f.nationality.trim(),
        profession: f.profession.trim(),
        birth_place: f.birth_place.trim(),
        id_number: f.id_number.trim(),
        id_issued_place: f.id_issued_place.trim(),
        birth_date: f.birth_date ? new Date(f.birth_date).toISOString() : "",
        id_issued_date: f.id_issued_date ? new Date(f.id_issued_date).toISOString() : "",
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const filled = [partner.address, partner.nationality, partner.idNumber, partner.birthDate].filter(Boolean).length;

  if (!editing) {
    return (
      <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span>🪪 Identité (contrat) : {filled > 0 ? `${filled} renseignement(s) fourni(s)` : <em style={{ color: "var(--alert)" }}>à compléter</em>}</span>
        {canEdit && <button onClick={() => setEditing(true)} style={linkButtonStyle}>{filled > 0 ? "Modifier l'identité" : "Compléter l'identité"}</button>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, border: "1px dashed var(--line)", borderRadius: 8, padding: 10, background: "var(--bg, #F8F9FB)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>Identité de {partner.firstName} {partner.lastName} — reprise en tête du contrat</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 11.5 }}>Adresse / BP<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 11.5 }}>Nationalité<input value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 11.5 }}>Date de naissance<input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 11.5 }}>Lieu de naissance<input value={f.birth_place} onChange={(e) => setF({ ...f, birth_place: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 11.5 }}>Profession<input value={f.profession} onChange={(e) => setF({ ...f, profession: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 11.5 }}>N° CNI<input value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 11.5 }}>CNI délivrée le<input type="date" value={f.id_issued_date} onChange={(e) => setF({ ...f, id_issued_date: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 11.5 }}>CNI délivrée à<input value={f.id_issued_place} onChange={(e) => setF({ ...f, id_issued_place: e.target.value })} style={inputStyle} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={save} disabled={busy} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
        <button onClick={() => setEditing(false)} disabled={busy} style={secondaryButtonStyle}>Annuler</button>
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
function DocumentsBlock({ contractId, canManage, partnerWhatsapp, onDispatched, onError }: { contractId: string; canManage: boolean; partnerWhatsapp?: string | null; onDispatched?: () => void; onError: (m: string) => void }) {
  const [docs, setDocs] = useState<ContractDocument[]>([]);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<ContractDocumentKind>("signed_scan");
  const [busy, setBusy] = useState(false);
  const [transferDoc, setTransferDoc] = useState<ContractDocument | null>(null);
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
              <button onClick={() => setTransferDoc(d)} style={{ ...linkButtonStyle, color: "var(--eclosion)" }}>
                Transférer
              </button>
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

      {transferDoc && (
        <TransferDocDialog
          title={transferDoc.label || transferDoc.name}
          fileName={transferDoc.name || transferDoc.label || "document"}
          getFile={async () => {
            const resp = await fetch(contractDocumentDownloadUrl(contractId, transferDoc.id), { credentials: "include" });
            const blob = await resp.blob();
            return new File([blob], transferDoc.name || transferDoc.label || "document", { type: blob.type || "application/octet-stream" });
          }}
          partnerWhatsapp={partnerWhatsapp}
          contractId={contractId}
          onDispatched={onDispatched}
          onClose={() => setTransferDoc(null)}
          onError={onError}
        />
      )}
    </div>
  );
}

const DISPATCH_CHANNEL_LABELS: Record<ContractDispatch["channel"], string> = {
  messagerie_interne: "💬 Messagerie interne",
  whatsapp: "💬 WhatsApp",
};

// Journal d'envoi du contrat : historique horodaté des transmissions à l'auteur
// (preuve d'envoi côté éditeur). Se recharge quand `refreshToken` change (après
// un nouvel envoi). N'affiche rien tant qu'aucun envoi n'a eu lieu.
function DispatchJournal({ contractId, refreshToken }: { contractId: string; refreshToken: number }) {
  const [rows, setRows] = useState<ContractDispatch[]>([]);
  useEffect(() => {
    listContractDispatches(contractId).then(setRows).catch(() => setRows([]));
  }, [contractId, refreshToken]);

  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Journal d'envoi ({rows.length})</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", borderLeft: "2px solid var(--eclosion-soft)", paddingLeft: 8 }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{new Date(r.sent_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
            <span style={{ color: "var(--eclosion)", fontWeight: 600 }}>{DISPATCH_CHANNEL_LABELS[r.channel]}</span>
            {r.recipient && <span>→ {r.recipient}</span>}
            {r.sent_by_name && <span style={{ color: "var(--muted)" }}>(par {r.sent_by_name})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Transfert d'un document du contrat (pièce numérisée OU contrat d'édition
// généré en PDF) vers la messagerie interne (fichier réellement joint) ou
// WhatsApp (message pré-rempli ; la pièce est téléchargée pour être jointe à la
// main, faute de passerelle WhatsApp automatique côté serveur — cf. AVANCEMENT).
// Générique : `getFile` fournit le fichier à transférer (fetch d'une pièce ou
// génération d'un PDF côté navigateur).
function TransferDocDialog({ title, fileName, getFile, partnerWhatsapp, contractId, onDispatched, onClose, onError }: { title: string; fileName: string; getFile: () => Promise<File> | File; partnerWhatsapp?: string | null; contractId?: string; onDispatched?: () => void; onClose: () => void; onError: (m: string) => void }) {
  const [dir, setDir] = useState<ChatDirectoryEntry[]>([]);
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getChatDirectory().then((d) => { setDir(d); if (d[0]) setRecipient(d[0].id); }).catch(() => setDir([]));
  }, []);

  // Inscrit l'envoi au journal du contrat (preuve de transmission). Best-effort :
  // le transfert reste valable même si l'inscription échoue.
  async function logDispatch(channel: "messagerie_interne" | "whatsapp", recipientLabel: string) {
    if (!contractId) return;
    try {
      await recordContractDispatch(contractId, { channel, document_label: title, recipient: recipientLabel, note: note.trim() || undefined });
      onDispatched?.();
    } catch {
      /* l'échec du journal ne doit pas bloquer l'envoi lui-même */
    }
  }

  async function sendInternal() {
    if (!recipient) return;
    setSending(true);
    try {
      const conv = await startConversation(recipient);
      const body = (note.trim() ? note.trim() + "\n\n" : "") + `Document du contrat : ${title}`;
      const file = await getFile();
      await sendChatMessageWithFile(conv.id, body, file);
      await logDispatch("messagerie_interne", dir.find((u) => u.id === recipient)?.name ?? "");
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Transfert impossible.");
    } finally {
      setSending(false);
    }
  }

  async function shareWhatsApp() {
    // Télécharge la pièce (à joindre dans WhatsApp), puis ouvre WhatsApp avec un
    // message pré-rempli — vers le numéro de l'auteur s'il est renseigné, sinon
    // le sélecteur de contact WhatsApp.
    try {
      const file = await getFile();
      const objUrl = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
      const text = encodeURIComponent(`${note.trim() ? note.trim() + " — " : ""}Document du contrat : ${title} (pièce jointe téléchargée à joindre au message).`);
      const num = (partnerWhatsapp ?? "").replace(/[^\d]/g, "");
      const url = num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`;
      window.open(url, "_blank", "noopener");
      await logDispatch("whatsapp", partnerWhatsapp ? partnerWhatsapp : "Contact WhatsApp");
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Préparation du fichier impossible.");
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 440, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 4 }}>Transférer le document</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>{title}</div>

        <label style={{ fontSize: 11.5, display: "block", marginBottom: 10 }}>
          Message (facultatif)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Un mot d'accompagnement…" />
        </label>

        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Messagerie interne</div>
          {dir.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Aucun destinataire disponible.</p>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ fontSize: 11.5, flex: 1, minWidth: 160 }}>
                Destinataire
                <select value={recipient} onChange={(e) => setRecipient(e.target.value)} style={inputStyle}>
                  {dir.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <button onClick={sendInternal} disabled={sending || !recipient} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          )}
        </div>

        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>WhatsApp</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
            {partnerWhatsapp ? <>Vers le numéro de l'auteur : <span style={{ fontFamily: "var(--font-mono)" }}>{partnerWhatsapp}</span>.</> : "Vous choisirez le contact dans WhatsApp."} La pièce sera téléchargée pour être jointe au message.
          </div>
          <button onClick={shareWhatsApp} style={{ ...secondaryButtonStyle, borderColor: "#25D366", color: "#128C3E", fontWeight: 600 }}>
            💬 Ouvrir WhatsApp
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} style={secondaryButtonStyle}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

const CONTRACT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "edition", label: "Édition" },
  { value: "coedition", label: "Coédition" },
  { value: "cession", label: "Cession de droits" },
  { value: "traduction", label: "Traduction" },
  { value: "correction", label: "Correction" },
  { value: "illustration", label: "Illustration" },
  { value: "prestation", label: "Prestation de services" },
];

// Modifier les termes d'un contrat NON SIGNÉ : type, taux de droits, avance,
// durée. Enregistré côté serveur (PATCH /contracts/:id/terms) — la modification
// est persistée et tracée. Interdite une fois le contrat signé/actif (409).
function EditContractModal({ contract, onClose, onSaved, onError }: { contract: Contract; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [type, setType] = useState(contract.type);
  const [economicModel, setEconomicModel] = useState<"compte_editeur" | "compte_auteur" | "compte_demi" | "autre">(contract.economicModel ?? "compte_editeur");
  const [rate, setRate] = useState<number>(10);
  const [advance, setAdvance] = useState<number>(0);
  const [durationYears, setDurationYears] = useState<number>(0);
  // Conditions de prestation / à compte d'auteur.
  const [serviceCost, setServiceCost] = useState<number>(0);
  const [serviceDeposit, setServiceDeposit] = useState<number>(0);
  const [serviceCopies, setServiceCopies] = useState<number>(0);
  const [serviceDelivery, setServiceDelivery] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getContract(contract.id).then((c) => {
      if (c.economicModel) setEconomicModel(c.economicModel);
      const firstRate = c.royaltyTerms?.tiers?.[0]?.rate;
      if (typeof firstRate === "number") setRate(Math.round(firstRate * 100));
      const adv = c.royaltyTerms?.advanceAmount;
      if (adv != null) setAdvance(Number(adv));
      if (c.durationMonths) setDurationYears(Math.round(c.durationMonths / 12));
      const ft = (c.financialTerms ?? {}) as Record<string, unknown>;
      if (typeof ft.service_cost === "number") setServiceCost(ft.service_cost);
      if (typeof ft.service_deposit === "number") setServiceDeposit(ft.service_deposit);
      if (typeof ft.service_copies === "number") setServiceCopies(ft.service_copies);
      if (typeof ft.service_delivery === "string") setServiceDelivery(ft.service_delivery);
      setLoaded(true);
    }).catch((e) => onError(e instanceof Error ? e.message : "Chargement impossible."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id]);

  // Champs de droits d'auteur affichés selon le type + le modèle économique.
  const royaltiesApply = royaltiesApplyFor(type, economicModel);

  async function save() {
    setBusy(true);
    try {
      await updateContractTerms(contract.id, {
        type,
        economic_model: economicModel,
        // Droits d'auteur OU conditions de prestation, selon le modèle.
        ...(royaltiesApply
          ? { rate: rate / 100, advance_amount: advance, duration_months: durationYears > 0 ? durationYears * 12 : null }
          : {
              service_cost: serviceCost,
              service_deposit: serviceDeposit,
              ...(economicModel === "compte_auteur" ? { service_copies: serviceCopies } : {}),
              service_delivery: serviceDelivery.trim(),
            }),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 460, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 4 }}>Modifier le contrat {contract.contractNumber}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Modification possible tant que le contrat n'est pas signé. Enregistrée et tracée.</div>
        {!loaded ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ fontSize: 12 }}>Type<select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>{CONTRACT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              <label style={{ fontSize: 12 }}>Modèle économique<select value={economicModel} onChange={(e) => setEconomicModel(e.target.value as typeof economicModel)} style={inputStyle}>
                <option value="compte_editeur">À compte d'éditeur</option>
                <option value="compte_auteur">À compte d'auteur</option>
                <option value="compte_demi">À compte à demi</option>
                <option value="autre">Autre modèle</option>
              </select></label>
              {royaltiesApply && <label style={{ fontSize: 12 }}>Taux de droits (%)<input type="number" min={0} max={100} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={inputStyle} /></label>}
              {royaltiesApply && <label style={{ fontSize: 12 }}>Avance (à-valoir, FCFA)<input type="number" min={0} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={inputStyle} /></label>}
              {royaltiesApply && <label style={{ fontSize: 12 }}>Durée de la cession (années)<input type="number" min={0} value={durationYears} onChange={(e) => setDurationYears(Number(e.target.value))} style={inputStyle} /></label>}
              {/* Conditions de prestation / à compte d'auteur, corrigeables ici. */}
              {!royaltiesApply && <label style={{ fontSize: 12 }}>Coût total (FCFA)<input type="number" min={0} value={serviceCost} onChange={(e) => setServiceCost(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} /></label>}
              {!royaltiesApply && <label style={{ fontSize: 12 }}>Acompte (FCFA)<input type="number" min={0} value={serviceDeposit} onChange={(e) => setServiceDeposit(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} /></label>}
              {!royaltiesApply && economicModel === "compte_auteur" && <label style={{ fontSize: 12 }}>Nombre d'exemplaires<input type="number" min={0} value={serviceCopies} onChange={(e) => setServiceCopies(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} /></label>}
              {!royaltiesApply && <label style={{ fontSize: 12, gridColumn: "1 / span 2" }}>Conditions de livraison<input type="text" value={serviceDelivery} onChange={(e) => setServiceDelivery(e.target.value)} placeholder="ex. livraison sous 30 jours après BAT" style={inputStyle} /></label>}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={onClose} disabled={busy} style={secondaryButtonStyle}>Annuler</button>
              <button onClick={save} disabled={busy} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Ajouter un avenant : crée un nouveau contrat LIÉ au contrat d'origine
// (parent_contract_id), avec les termes révisés. L'avenant apparaît comme un
// contrat rattaché — le contrat d'origine, une fois signé, reste inchangé.
function AmendmentModal({ parent, manuscriptId, onClose, onCreated, onError }: { parent: Contract; manuscriptId: string; onClose: () => void; onCreated: () => void; onError: (m: string) => void }) {
  const [type, setType] = useState(parent.type);
  const [rate, setRate] = useState<number>(10);
  const [advance, setAdvance] = useState<number>(0);
  const [durationYears, setDurationYears] = useState<number>(5);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await createContract({
        type,
        manuscript_id: manuscriptId,
        partner_id: parent.partner.id,
        parent_contract_id: parent.id,
        ...(durationYears > 0 ? { duration_months: durationYears * 12 } : {}),
        financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: rate / 100 }], advance_amount: advance, payment_schedule: "semestriel" },
      });
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Création de l'avenant impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 460, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 4 }}>Avenant au contrat {parent.contractNumber}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Nouveau contrat rattaché au contrat d'origine, avec les termes révisés (même auteur, même ouvrage).</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 12 }}>Type<select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>{CONTRACT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label style={{ fontSize: 12 }}>Taux de droits (%)<input type="number" min={0} max={100} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={inputStyle} /></label>
          <label style={{ fontSize: 12 }}>Avance (FCFA)<input type="number" min={0} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={inputStyle} /></label>
          <label style={{ fontSize: 12 }}>Durée de la cession (années)<input type="number" min={0} value={durationYears} onChange={(e) => setDurationYears(Number(e.target.value))} style={inputStyle} /></label>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} disabled={busy} style={secondaryButtonStyle}>Annuler</button>
          <button onClick={create} disabled={busy} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>{busy ? "Création…" : "Créer l'avenant"}</button>
        </div>
      </div>
    </div>
  );
}

// « Ajuster le contrat avant impression » (contrat non signé) : surcharger le
// texte d'un article standard (1–15) et gérer les clauses additionnelles
// (ajouter / modifier / retirer). L'impression/PDF reflète les ajustements ;
// tout est tracé ; verrouillé dès signature (côté serveur).
function ArticleModal({ contract, templates, onClose, onSaved, onError }: { contract: Contract; templates: { edition: Record<number, string>; service: Record<number, string> }; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  // Document adapté au type / au modèle économique (§9) : contrat de prestation /
  // à compte d'auteur, ou contrat d'édition. Détermine le modèle d'articles et le
  // générateur d'aperçu.
  const service = isServiceContract(contract);
  const ARTICLES = service ? SERVICE_CONTRACT_ARTICLES : AUTHOR_CONTRACT_ARTICLES;
  const maxArt = ARTICLES.length;
  const buildHtml = service ? buildServiceContractHtml : buildAuthorContractHtml;
  // Textes par défaut du modèle éditable pour ce type de document.
  const tplMap = service ? templates.service : templates.edition;
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [busy, setBusy] = useState(false);
  // Surcharge d'article.
  const [artN, setArtN] = useState(1);
  const [artText, setArtText] = useState("");
  // Zone de texte de l'article, focalisée quand on clique un article dans l'aperçu.
  const artTextRef = useRef<HTMLTextAreaElement>(null);
  // Clauses additionnelles (édition locale avant enregistrement).
  const [clauses, setClauses] = useState<{ title: string; body: string }[]>([]);
  // Identité éditeur + branding (cachet/signature DG) pour un APERÇU fidèle au
  // document final — chargés une fois à l'ouverture.
  const [pub, setPub] = useState<Awaited<ReturnType<typeof getPublisherIdentity>> | null>(null);
  const [brand, setBrand] = useState<Awaited<ReturnType<typeof getBranding>> | null>(null);
  useEffect(() => {
    getPublisherIdentity().then(setPub).catch(() => setPub(null));
    getBranding().then(setBrand).catch(() => setBrand(null));
  }, []);
  // Signature/cachet apposés sur l'aperçu seulement si le réglage l'autorise.
  const sign = brand && brand.auto_sign_contracts
    ? { cachet: brand.cachet_generale, signature: brand.signature_dg, dgName: brand.dg_name, dgTitle: brand.dg_title }
    : null;

  const load = () => getContract(contract.id).then((d) => {
    setDetail(d);
    setClauses((d.customClauses ?? []).map((c) => ({ title: c.title, body: c.body })));
    const ov = (d.articleOverrides ?? {})[String(artN)] ?? "";
    setArtText(ov);
  }).catch((e) => onError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contract.id]);
  // Quand on change d'article dans le sélecteur, précharger sa surcharge courante.
  useEffect(() => { if (detail) setArtText((detail.articleOverrides ?? {})[String(artN)] ?? ""); /* eslint-disable-next-line */ }, [artN]);

  const overrides = (detail?.articleOverrides ?? {}) as Record<string, string>;

  async function saveOverride(clear: boolean) {
    setBusy(true);
    try {
      const d = await setContractArticleOverride(contract.id, artN, clear ? "" : artText);
      setDetail(d);
      onSaved();
    } catch (e) { onError(e instanceof Error ? e.message : "Ajustement impossible."); }
    finally { setBusy(false); }
  }
  async function saveClauses() {
    setBusy(true);
    try {
      const clean = clauses.map((c) => ({ title: c.title.trim(), body: c.body.trim() })).filter((c) => c.title.length >= 2 && c.body.length >= 2);
      const d = await replaceContractClauses(contract.id, clean);
      setDetail(d);
      setClauses((d.customClauses ?? []).map((c) => ({ title: c.title, body: c.body })));
      onSaved();
    } catch (e) { onError(e instanceof Error ? e.message : "Enregistrement des clauses impossible."); }
    finally { setBusy(false); }
  }

  const label = ARTICLES.find((a) => a.n === artN)?.title ?? "";

  // Copie de travail du contrat reflétant les ajustements EN COURS DE SAISIE
  // (surcharge de l'article sélectionné + clauses), pour un aperçu live : ce que
  // l'on voit est ce qui sera imprimé/téléchargé.
  const workingDetail = useMemo<ContractDetail | null>(() => {
    if (!detail) return null;
    const ov: Record<string, string> = { ...((detail.articleOverrides ?? {}) as Record<string, string>) };
    ov[String(artN)] = artText; // "" = texte standard du modèle
    const clean = clauses.map((c) => ({ title: c.title.trim(), body: c.body.trim() })).filter((c) => c.title.length >= 2 && c.body.length >= 2);
    return { ...detail, articleOverrides: ov, customClauses: clean };
  }, [detail, artN, artText, clauses]);

  // Aperçu HTML (corps du contrat) régénéré à chaque frappe — avec les textes
  // par défaut du modèle éditable (les surcharges du contrat restent prioritaires).
  const previewHtml = workingDetail ? buildHtml(workingDetail, pub, sign, tplMap) : "";

  // Aperçu cliquable : cliquer un article dans l'aperçu l'ouvre à l'édition
  // (sélecteur positionné + zone de texte focalisée). Seuls les articles standard
  // (1..maxArt) sont éditables ici (les clauses additionnelles se gèrent à part).
  const onPreviewClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[data-article]");
    if (!el) return;
    const n = Number(el.getAttribute("data-article"));
    if (!Number.isFinite(n) || n < 1 || n > maxArt) return;
    setArtN(n);
    setTimeout(() => artTextRef.current?.focus(), 0);
  };

  // Imprimer / Télécharger le PDF à partir de la copie de travail (WYSIWYG).
  const printWorking = () => { if (!workingDetail) return; if (service) printServiceContract(workingDetail, {}, pub, sign, tplMap); else printAuthorContract(workingDetail, {}, pub, sign, tplMap); };
  // PDF vectoriel « net » : seulement pour le contrat d'édition (modèle jsPDF).
  const pdfWorking = () => { if (workingDetail) downloadAuthorContractPdf(workingDetail, pub, brand, tplMap).catch((e) => onError(e instanceof Error ? e.message : "PDF impossible.")); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 1000, width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 4 }}>Aperçu et modification du contrat — {contract.contractNumber}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>Modifiez le texte d'un article ou ajoutez/retirez des clauses : l'aperçu à droite se met à jour à la saisie. Quand tout vous convient, imprimez ou téléchargez le PDF. Les ajustements doivent être enregistrés pour être conservés ; impossible une fois le contrat signé.</div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Colonne d'édition */}
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        {/* Surcharge d'un article standard */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Ajuster le texte d'un article</div>
          <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>Article
            <select value={artN} onChange={(e) => setArtN(Number(e.target.value))} style={inputStyle}>
              {ARTICLES.map((a) => (
                <option key={a.n} value={a.n}>Article {a.n} — {a.title}{overrides[String(a.n)] ? " (ajusté)" : ""}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, display: "block" }}>Texte de remplacement de l'article {artN} ({label})
            <textarea ref={artTextRef} value={artText} onChange={(e) => setArtText(e.target.value)} onPaste={(e) => pasteTidied(e, artText, setArtText)} rows={6} placeholder="Laissez vide pour conserver le texte standard du modèle." style={{ ...inputStyle, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            {overrides[String(artN)] && <button onClick={() => saveOverride(true)} disabled={busy} style={secondaryButtonStyle}>Rétablir le texte standard</button>}
            <button onClick={() => saveOverride(false)} disabled={busy || artText.trim().length < 2} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>{busy ? "…" : "Enregistrer l'ajustement"}</button>
          </div>
        </div>

        {/* Clauses additionnelles */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Clauses additionnelles (reprises après l'article 15)</div>
          {clauses.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>Aucune clause additionnelle.</p>}
          <div style={{ display: "grid", gap: 10 }}>
            {clauses.map((cl, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
                <input value={cl.title} onChange={(e) => setClauses((cs) => cs.map((c, j) => j === i ? { ...c, title: e.target.value } : c))} placeholder="Intitulé de la clause" style={{ ...inputStyle, marginBottom: 6 }} />
                <textarea value={cl.body} onChange={(e) => setClauses((cs) => cs.map((c, j) => j === i ? { ...c, body: e.target.value } : c))} onPaste={(e) => pasteTidied(e, cl.body, (next) => setClauses((cs) => cs.map((c, j) => j === i ? { ...c, body: next } : c)))} rows={3} placeholder="Texte de la clause" style={{ ...inputStyle, resize: "vertical" }} />
                <div style={{ textAlign: "right", marginTop: 4 }}>
                  <button onClick={() => setClauses((cs) => cs.filter((_, j) => j !== i))} style={{ ...secondaryButtonStyle, color: "var(--alert, #B23A2E)" }}>Retirer</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => setClauses((cs) => [...cs, { title: "", body: "" }])} style={secondaryButtonStyle}>+ Ajouter une clause</button>
            <button onClick={saveClauses} disabled={busy} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>{busy ? "Enregistrement…" : "Enregistrer les clauses"}</button>
          </div>
        </div>
        </div>{/* fin colonne d'édition */}

        {/* Colonne d'aperçu — rendu live du contrat (reflète la saisie en cours).
            L'en-tête officiel et le filigrane s'ajoutent à l'impression/PDF. */}
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Aperçu du contrat <span style={{ fontWeight: 400, color: "var(--muted)" }}>— cliquez un article pour le modifier</span></div>
          <div className="ecl-contract-preview" onClick={onPreviewClick} style={{ border: "1px solid var(--line)", borderRadius: 8, background: "#fff", padding: 16, maxHeight: "62vh", overflowY: "auto", color: "#0b0b0c" }}>
            <style>{`
              .ecl-contract-preview .doc__title { font-family: Georgia, serif; font-size: 19px; margin: 6px 0 2px; color:#0b0b0c; }
              .ecl-contract-preview .meta { display:flex; gap:20px; flex-wrap:wrap; margin:4px 0 12px; font-size:12px; color:#444; }
              .ecl-contract-preview .meta b { color:#0b0b0c; }
              .ecl-contract-preview .party__label { font-size:10.5px; text-transform:uppercase; letter-spacing:.6px; color:#6b7280; margin-bottom:3px; }
              .ecl-contract-preview .num { font-family: ui-monospace, "IBM Plex Mono", monospace; }
              .ecl-contract-preview h3 { font-family: Georgia, serif; }
              .ecl-contract-preview .art { cursor: pointer; border-radius: 6px; padding: 2px 8px; margin: 0 -8px; transition: background .12s; }
              .ecl-contract-preview .art:hover { background: #faf8f2; }
              .ecl-contract-preview .art[data-article="${artN}"] { background: var(--eclosion-soft, #f6efd8); box-shadow: inset 0 0 0 1px var(--eclosion, #D9B21A); }
            `}</style>
            {/* eslint-disable-next-line react/no-danger */}
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Cliquez un article dans l'aperçu pour l'ouvrir à l'édition à gauche. L'en-tête Éclosion, le filigrane et le pied de page s'ajoutent automatiquement à l'impression et au PDF.</div>
        </div>
        </div>{/* fin grille édition / aperçu */}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={printWorking} style={secondaryButtonStyle}>🖨 Imprimer / PDF</button>
          {!service && <button onClick={pdfWorking} style={{ ...secondaryButtonStyle, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)" }}>📄 Télécharger le PDF (net)</button>}
          <button onClick={onClose} disabled={busy} style={secondaryButtonStyle}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

// §9 — « Modèles de contrats » : éditer SANS CODE le texte par défaut de chaque
// article, par type de document (Édition / Prestation). Vide = texte standard de
// la maison. Les champs {{…}} restent remplis automatiquement à la génération.
// S'applique à tous les contrats à venir ; la surcharge propre à un contrat reste
// prioritaire. Réservé à l'autorité juridique / direction (canEdit = validation).
const TEMPLATE_PLACEHOLDERS: Record<"edition" | "service", string> = {
  edition: "{{titre}} {{auteur}} {{editeur}} {{numero}} {{modele}} {{taux}} {{duree}}",
  service: "{{titre}} {{auteur}} {{editeur}} {{numero}} {{modele}} {{cout}} {{acompte}} {{exemplaires}} {{livraison}}",
};
function ContractTemplatesModal({ templates, canEdit, onClose, onSaved, onError }: {
  templates: { edition: Record<number, string>; service: Record<number, string> };
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [key, setKey] = useState<"edition" | "service">("edition");
  const [drafts, setDrafts] = useState<{ edition: Record<number, string>; service: Record<number, string> }>({
    edition: { ...templates.edition },
    service: { ...templates.service },
  });
  const [busy, setBusy] = useState<number | null>(null);
  const ARTICLES = key === "service" ? SERVICE_CONTRACT_ARTICLES : AUTHOR_CONTRACT_ARTICLES;
  const setDraft = (n: number, v: string) => setDrafts((d) => ({ ...d, [key]: { ...d[key], [n]: v } }));

  async function save(n: number) {
    setBusy(n);
    try {
      await setContractClauseTemplate(key, n, (drafts[key][n] ?? "").trim());
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement du modèle impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 4 }}>Modèles de contrats</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          Modifiez ici le texte PAR DÉFAUT de chaque article, sans développeur. Laissez vide pour garder le texte standard de la maison. Ces textes s'appliquent à <b>tous les contrats à venir</b> ; un ajustement propre à un contrat reste prioritaire.{!canEdit && " (Lecture seule : droit « contrats (validation) » requis pour modifier.)"}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["edition", "service"] as const).map((k) => (
            <button key={k} onClick={() => setKey(k)} style={{ ...secondaryButtonStyle, ...(key === k ? { background: "var(--eclosion)", color: "#fff", border: "none" } : {}) }}>
              {k === "edition" ? "Contrat d'édition" : "Contrat de prestation"}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>
          Champs insérables (remplis automatiquement) : <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{TEMPLATE_PLACEHOLDERS[key]}</code>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {ARTICLES.map((a) => {
            const standard = !((drafts[key][a.n] ?? "").trim());
            return (
              <div key={a.n} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
                  Article {a.n} — {a.title}{standard ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · texte standard</span> : <span style={{ fontWeight: 400, color: "var(--eclosion-dark, #9a7a12)" }}> · personnalisé</span>}
                </div>
                <textarea
                  value={drafts[key][a.n] ?? ""}
                  onChange={(e) => setDraft(a.n, e.target.value)}
                  onPaste={(e) => pasteTidied(e, drafts[key][a.n] ?? "", (next) => setDraft(a.n, next))}
                  rows={4}
                  disabled={!canEdit}
                  placeholder="Laissez vide pour conserver le texte standard de la maison."
                  style={{ ...inputStyle, resize: "vertical" }}
                />
                {canEdit && (
                  <div style={{ textAlign: "right", marginTop: 6 }}>
                    <button onClick={() => save(a.n)} disabled={busy === a.n} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none" }}>
                      {busy === a.n ? "…" : "Enregistrer cet article"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={secondaryButtonStyle}>Fermer</button>
        </div>
      </div>
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
  // Modèle économique (D-054) — axe distinct du type. Pilote l'affichage :
  // droits d'auteur quand ils s'appliquent, sinon champs de prestation.
  const [economicModel, setEconomicModel] = useState<"compte_editeur" | "compte_auteur" | "compte_demi" | "autre">("compte_editeur");
  const [advance, setAdvance] = useState(0);
  // Champs « prestation / à compte d'auteur » (contrats sans droits d'auteur) —
  // stockés dans les termes financiers (aucune table dédiée).
  const [serviceCost, setServiceCost] = useState(0);
  const [serviceDeposit, setServiceDeposit] = useState(0);
  const [serviceCopies, setServiceCopies] = useState(0);
  const [serviceDelivery, setServiceDelivery] = useState("");
  // Durée de la cession (terme du contrat) — variable d'un auteur à l'autre,
  // reprise automatiquement sur le contrat imprimé. 0 = non précisée.
  const [durationYears, setDurationYears] = useState(5);
  // Termes financiers VARIABLES par contrat/auteur :
  const [base, setBase] = useState<"prix_public_ht" | "prix_net_editeur">("prix_public_ht");
  // Paliers de droits d'auteur : { up_to: N exemplaires (null = au-delà), rate: % }.
  const [tiers, setTiers] = useState<{ up_to: number | null; rate: number }[]>([{ up_to: null, rate: 10 }]);
  const [paymentSchedule, setPaymentSchedule] = useState("semestriel");
  const [statementPeriodicity, setStatementPeriodicity] = useState<"mensuelle" | "trimestrielle" | "semestrielle" | "annuelle">("semestrielle");
  const [taxWithholding, setTaxWithholding] = useState(0);
  const setTier = (i: number, patch: Partial<{ up_to: number | null; rate: number }>) => setTiers((cur) => cur.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const addTier = () => setTiers((cur) => [...cur.slice(0, -1), { up_to: cur[cur.length - 1].up_to ?? 3000, rate: cur[cur.length - 1].rate }, { up_to: null, rate: cur[cur.length - 1].rate }]);
  const removeTier = (i: number) => setTiers((cur) => (cur.length > 1 ? cur.filter((_, k) => k !== i) : cur));
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState(defaultPartnerId);
  const [showPartnerForm, setShowPartnerForm] = useState(false);

  const refreshPartners = () => listPartners().then(setPartners);

  useEffect(() => {
    refreshPartners();
  }, []);

  const selectedPartner = partners.find((p) => p.id === partnerId);

  // Les droits d'auteur s'appliquent-ils ? (type rémunérant l'auteur à compte
  // d'éditeur ou à demi). Sinon : contrat de prestation / à compte d'auteur.
  const royaltiesApply = royaltiesApplyFor(type, economicModel);
  // La maison paie-t-elle la contrepartie (→ retenue fiscale pertinente) ?
  const weOwePayee = weOwePayeeFor(type, economicModel);
  // La fourchette 8–15 % ne s'impose qu'à une édition à compte d'éditeur (D-054).
  const rangeEnforced = type === "edition" && economicModel === "compte_editeur";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createContract({
        type,
        economic_model: economicModel,
        manuscript_id: manuscriptId,
        partner_id: partnerId,
        ...(durationYears > 0 ? { duration_months: durationYears * 12 } : {}),
        financial_terms: royaltiesApply
          ? {
              // Contrat avec droits d'auteur : base + paliers (moteur de droits).
              base,
              tiers: tiers.map((t) => ({ up_to: t.up_to, rate: t.rate / 100 })),
              advance_amount: advance,
              payment_schedule: paymentSchedule,
              statement_periodicity: statementPeriodicity,
              ...(taxWithholding > 0 ? { tax_withholding_pct: taxWithholding } : {}),
            }
          : {
              // Contrat de prestation / à compte d'auteur : AUCUN palier de droits
              // (on n'envoie ni base ni tiers → pas de RoyaltyTerms créés). Les
              // conditions financières de la prestation vivent dans les termes.
              service_cost: serviceCost,
              service_deposit: serviceDeposit,
              ...(economicModel === "compte_auteur" && serviceCopies > 0 ? { service_copies: serviceCopies } : {}),
              ...(serviceDelivery.trim() ? { service_delivery: serviceDelivery.trim() } : {}),
              ...(weOwePayee && taxWithholding > 0 ? { tax_withholding_pct: taxWithholding } : {}),
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
        {/* « Avance » (à-valoir) et « Durée de la cession » : propres aux contrats
            à droits d'auteur. Masqués pour une prestation / un compte d'auteur. */}
        {royaltiesApply && (
          <>
            <label style={{ fontSize: 12 }}>
              Avance (à-valoir, FCFA)
              <input type="number" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={inputStyle} />
            </label>
            <label style={{ fontSize: 12 }}>
              Durée de la cession (années)
              <input type="number" min={0} value={durationYears} onChange={(e) => setDurationYears(Number(e.target.value))} style={inputStyle} />
            </label>
          </>
        )}
      </div>

      {/* Modèle économique (D-054) — distinct du type ; détermine les champs
          financiers affichés (droits d'auteur vs prestation). */}
      <label style={{ fontSize: 12, display: "block", marginTop: 10 }}>
        Modèle économique
        <select value={economicModel} onChange={(e) => setEconomicModel(e.target.value as typeof economicModel)} style={inputStyle}>
          <option value="compte_editeur">À compte d'éditeur (l'éditeur finance, l'auteur perçoit des droits)</option>
          <option value="compte_auteur">À compte d'auteur (l'auteur finance la fabrication)</option>
          <option value="compte_demi">À compte à demi (coûts et recettes partagés)</option>
          <option value="autre">Autre modèle (précisé dans les termes)</option>
        </select>
      </label>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
        {royaltiesApply
          ? "Des droits d'auteur s'appliquent : renseignez la base et les paliers ci-dessous."
          : "Pas de droits d'auteur pour ce modèle : renseignez les conditions de la prestation ci-dessous."}
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

      {/* Termes financiers VARIABLES par auteur : base, paliers de droits,
          périodicités, retenue fiscale. Chaque contrat peut différer. */}
      <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, color: "var(--eclosion-dark, #9a7a12)" }}>Termes financiers (propres à cet auteur / cet ouvrage)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {royaltiesApply && (
            <label style={{ fontSize: 12 }}>Base de calcul
              <select value={base} onChange={(e) => setBase(e.target.value as typeof base)} style={inputStyle}>
                <option value="prix_public_ht">Prix public HT</option>
                <option value="prix_net_editeur">Prix net éditeur</option>
              </select>
            </label>
          )}
          {/* Retenue fiscale : pertinente seulement quand la MAISON paie la
              contrepartie (droits d'auteur, ou prestataire que nous commandons).
              Jamais en compte d'auteur (c'est l'auteur qui paie la maison). */}
          {weOwePayee && (
            <label style={{ fontSize: 12 }}>Retenue fiscale (%)
              <input type="number" min={0} max={100} step={0.5} value={taxWithholding} onChange={(e) => setTaxWithholding(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} />
            </label>
          )}
          {royaltiesApply && (
            <label style={{ fontSize: 12 }}>Périodicité des relevés
              <select value={statementPeriodicity} onChange={(e) => setStatementPeriodicity(e.target.value as typeof statementPeriodicity)} style={inputStyle}>
                <option value="mensuelle">Mensuelle</option>
                <option value="trimestrielle">Trimestrielle</option>
                <option value="semestrielle">Semestrielle</option>
                <option value="annuelle">Annuelle</option>
              </select>
            </label>
          )}
          {/* Échéancier des droits d'auteur : propre aux contrats à droits. */}
          {royaltiesApply && (
            <label style={{ fontSize: 12 }}>Échéancier de paiement
              <select value={paymentSchedule} onChange={(e) => setPaymentSchedule(e.target.value)} style={inputStyle}>
                <option value="a_la_signature">À la signature</option>
                <option value="mensuel">Mensuel</option>
                <option value="trimestriel">Trimestriel</option>
                <option value="semestriel">Semestriel</option>
                <option value="annuel">Annuel</option>
              </select>
            </label>
          )}
        </div>

        {royaltiesApply ? (
          <>
            <div style={{ fontSize: 12, marginTop: 12, fontWeight: 600 }}>
              Paliers de droits d'auteur {rangeEnforced ? "(taux entre 8 % et 15 %)" : "(taux libre)"}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>Un seul palier = taux unique. Plusieurs paliers = taux progressif selon le nombre d'exemplaires vendus.</div>
            {tiers.map((tri, i) => {
              const last = i === tiers.length - 1;
              return (
                <div key={i} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Jusqu'à</span>
                  {last ? (
                    <span style={{ fontSize: 12.5, fontStyle: "italic", minWidth: 120 }}>au-delà (dernier palier)</span>
                  ) : (
                    <input type="number" min={1} value={tri.up_to ?? ""} onChange={(e) => setTier(i, { up_to: e.target.value ? Number(e.target.value) : null })} placeholder="ex. 3000" style={{ ...inputStyle, width: 120, display: "inline-block", marginTop: 0 }} />
                  )}
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>exemplaires →</span>
                  <input type="number" min={rangeEnforced ? 8 : 0} max={rangeEnforced ? 15 : 100} step={0.5} value={tri.rate} onChange={(e) => setTier(i, { rate: Number(e.target.value) || 0 })} style={{ ...inputStyle, width: 90, display: "inline-block", marginTop: 0 }} />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>%</span>
                  {tiers.length > 1 && <button type="button" onClick={() => removeTier(i)} style={{ ...secondaryButtonStyle, padding: "3px 8px", color: "var(--alert, #C4661F)" }}>Retirer</button>}
                </div>
              );
            })}
            <button type="button" onClick={addTier} style={{ ...secondaryButtonStyle, marginTop: 4 }}>+ Ajouter un palier</button>
          </>
        ) : (
          <>
            {/* Contrat de prestation / à compte d'auteur : conditions financières
                de la prestation (aucun droit d'auteur). */}
            <div style={{ fontSize: 12, marginTop: 12, fontWeight: 600 }}>Conditions de la prestation</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              <label style={{ fontSize: 12 }}>Coût total (FCFA)
                <input type="number" min={0} value={serviceCost} onChange={(e) => setServiceCost(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} />
              </label>
              <label style={{ fontSize: 12 }}>Acompte (FCFA)
                <input type="number" min={0} value={serviceDeposit} onChange={(e) => setServiceDeposit(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} />
              </label>
              {economicModel === "compte_auteur" && (
                <label style={{ fontSize: 12 }}>Nombre d'exemplaires
                  <input type="number" min={0} value={serviceCopies} onChange={(e) => setServiceCopies(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} />
                </label>
              )}
              <label style={{ fontSize: 12, gridColumn: economicModel === "compte_auteur" ? "auto" : "1 / span 2" }}>Conditions de livraison
                <input type="text" value={serviceDelivery} onChange={(e) => setServiceDelivery(e.target.value)} placeholder="ex. livraison sous 30 jours après BAT" style={inputStyle} />
              </label>
            </div>
          </>
        )}
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
