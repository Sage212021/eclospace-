import { useEffect, useState } from "react";
import {
  assignReader,
  closeReadingCommittee,
  getManuscript,
  getManuscriptTimeline,
  listUsers,
  revertManuscriptStep,
  setPublicationDate,
  submitEditorialDecision,
  validateStep,
  type Manuscript,
  type TimelineStep,
  type UserSummary,
} from "../api/client";
import { useConfirm } from "../components/ConfirmProvider";
import { Spine } from "../components/Spine";
import { ContractsSection } from "../components/ContractsSection";
import { EditorialQuotesSection } from "../components/EditorialQuotesSection";
import { TasksSection } from "../components/TasksSection";
import { CorrectionSection } from "../components/CorrectionSection";
import { ProductionSection } from "../components/ProductionSection";
import { IsbnSection } from "../components/IsbnSection";
import { BatSection } from "../components/BatSection";
import { PrintingSection } from "../components/PrintingSection";
import { AttachmentsSection } from "../components/AttachmentsSection";
import { ReadingEvaluationsSection } from "../components/ReadingEvaluationsSection";
import { AuthorFilesSection } from "../components/AuthorFilesSection";
import { FundingCheckpoint } from "../components/FundingCheckpoint";
import { SitePublicationSection } from "../components/SitePublicationSection";

interface ManuscriptDetailProps {
  manuscriptId: string;
  permissions: Set<string>;
  onBack: () => void;
}

type ManuscriptWithExtras = Manuscript & {
  workContributors: { partner: { id: string; firstName: string; lastName: string; penName: string | null } }[];
  owner: UserSummary;
};

const CONTRACTUALISATION_STEP_ORDER = 5;
const PLANIFICATION_STEP_ORDER = 6;
const MISE_EN_PAGE_STEP_ORDER = 10;

export function ManuscriptDetail({ manuscriptId, permissions, onBack }: ManuscriptDetailProps) {
  const confirm = useConfirm();
  const [manuscript, setManuscript] = useState<ManuscriptWithExtras | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [m, t] = await Promise.all([getManuscript(manuscriptId), getManuscriptTimeline(manuscriptId)]);
    setManuscript(m);
    setTimeline(t);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  if (!manuscript) return <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>Chargement…</div>;

  const canValidate = permissions.has("manuscripts:validation");
  const canAssignReader = permissions.has("comite_lecture:saisie");
  const canCloseCommittee = permissions.has("comite_lecture:validation");
  const canDecide = permissions.has("decision_editoriale:validation");

  async function handle(action: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une action a échoué.");
    }
  }

  // Validation en deux temps : toute action d'étape (valider, revenir en
  // arrière, décider) est précédée d'une confirmation pour éviter les erreurs.
  async function confirmThen(
    opts: { title: string; message: string; detail?: string; confirmLabel?: string; tone?: "default" | "danger" },
    action: () => Promise<unknown>,
    successMessage: string,
  ) {
    if (await confirm(opts)) await handle(action, successMessage);
  }

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)", maxWidth: 760 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 12 }}>
        ← Manuscrits
      </button>

      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>{manuscript.title}</h1>
      <p style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 12 }}>{manuscript.manuscriptNumber}</p>
      <p style={{ fontSize: 13 }}>
        Auteur : {manuscript.workContributors.map((c) => `${c.partner.firstName} ${c.partner.lastName}`).join(", ")} · Genre :{" "}
        {manuscript.genre?.label ?? "—"} · Responsable : {manuscript.owner.username}
      </p>

      <PublicationDateBlock
        manuscript={manuscript}
        canEdit={permissions.has("manuscripts:saisie")}
        onSaved={(msg) => handle(async () => {}, msg)}
        onError={setError}
      />

      <Spine steps={timeline} currentStatusCode={manuscript.status.code} />

      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Étape courante : {manuscript.status.label}</div>

        {manuscript.status.code === "VERIF_ADMIN" && canValidate && (
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton
              onClick={() =>
                confirmThen(
                  {
                    title: "Valider l'étape",
                    message: "Confirmer que le dossier est conforme ?",
                    detail: "Le manuscrit passera au comité de lecture.",
                    confirmLabel: "Dossier conforme",
                  },
                  () => validateStep(manuscript.id, "VERIF_ADMIN", { outcome: "conforme" }),
                  "Dossier conforme : passage au comité de lecture.",
                )
              }
            >
              Dossier conforme
            </ActionButton>
            <SecondaryButton
              onClick={() =>
                confirmThen(
                  {
                    title: "Dossier incomplet",
                    message: "Signaler ce dossier comme incomplet ?",
                    detail: "Le secrétariat sera notifié ; le passage à l'étape suivante reste bloqué.",
                    confirmLabel: "Signaler incomplet",
                  },
                  () => validateStep(manuscript.id, "VERIF_ADMIN", { outcome: "incomplet", observations: "Pièces manquantes" }),
                  "Dossier incomplet : le secrétariat a été notifié.",
                )
              }
            >
              Dossier incomplet
            </SecondaryButton>
          </div>
        )}

        {manuscript.status.code === "COMITE_LECTURE" && canAssignReader && (
          <AssignReaderForm
            manuscriptId={manuscript.id}
            onAssigned={() => handle(async () => {}, "Lecteur affecté.")}
            onError={setError}
          />
        )}

        {manuscript.status.code === "COMITE_LECTURE" && canCloseCommittee && (
          <div style={{ marginTop: 12 }}>
            <SecondaryButton
              onClick={() =>
                confirmThen(
                  {
                    title: "Clore le comité",
                    message: "Clore le comité de lecture et passer à la décision éditoriale ?",
                    detail: "Les lectures encore en attente seront annulées.",
                    confirmLabel: "Clore le comité",
                  },
                  () => closeReadingCommittee(manuscript.id),
                  "Comité clos : le manuscrit passe à la décision éditoriale.",
                )
              }
            >
              Clore le comité et passer à la décision
            </SecondaryButton>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>
              Annule les lectures encore en attente et transmet le dossier à la décision éditoriale (au moins un rapport de lecture doit être remis).
            </p>
          </div>
        )}

        {permissions.has("comite_lecture:consultation") && (
          <ReadingEvaluationsSection
            manuscriptId={manuscript.id}
            canManage={canAssignReader}
            onChanged={() => refresh().catch((e) => setError(e.message))}
          />
        )}

        {permissions.has("manuscripts:consultation") && (
          <AuthorFilesSection manuscriptId={manuscript.id} canManage={permissions.has("manuscripts:saisie")} />
        )}

        {manuscript.status.code === "DECISION_EDITORIALE" && canDecide && (
          <EditorialDecisionForm
            manuscriptId={manuscript.id}
            confirm={confirm}
            onDecided={(msg) => handle(async () => {}, msg)}
            onError={setError}
          />
        )}

        {manuscript.status.code === "CORRECTION" && (
          <div style={{ background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 8, padding: "10px 13px", fontSize: 12.5, color: "var(--ink)", marginBottom: 12 }}>
            <strong>Étape de correction — dans l'ordre :</strong>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Le correcteur dépose le manuscrit corrigé dans « Correction et versions » (plus bas) et signale ses points bloquants.</li>
              <li>Les points bloquants sont levés (sinon la validation est refusée).</li>
              <li>Vous validez l'étape ci-dessous — le manuscrit passe alors à la mise en page.</li>
            </ol>
          </div>
        )}

        {["CONTRACTUALISATION", "PLANIFICATION", "CORRECTION"].includes(manuscript.status.code) && canValidate && (
          <GenericStepValidation
            manuscriptId={manuscript.id}
            stepCode={manuscript.status.code}
            confirm={confirm}
            onValidated={(status) =>
              handle(async () => {}, status ? `Étape validée : passage à « ${status} ».` : "Étape validée.")
            }
            onError={setError}
          />
        )}

        {!["VERIF_ADMIN", "COMITE_LECTURE", "DECISION_EDITORIALE", "CONTRACTUALISATION", "PLANIFICATION", "CORRECTION"].includes(
          manuscript.status.code,
        ) && (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Aucune action disponible à cette étape dans les lots actuellement livrés.
          </p>
        )}

        {/* Retour arrière : corriger une étape validée par erreur. Réservé aux
            profils habilités à valider (comme la validation elle-même). */}
        {canValidate && manuscript.status.stepOrder > 1 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--line)" }}>
            <button
              onClick={() =>
                confirmThen(
                  {
                    title: "Revenir à l'étape précédente",
                    message: `Ramener « ${manuscript.title} » à l'étape précédant « ${manuscript.status.label} » ?`,
                    detail: "À n'utiliser que pour corriger une validation faite par erreur. L'étape précédente sera rouverte. Action tracée au journal.",
                    tone: "danger",
                    confirmLabel: "Revenir en arrière",
                  },
                  () => revertManuscriptStep(manuscript.id),
                  "Manuscrit ramené à l'étape précédente.",
                )
              }
              style={{ background: "#fff", color: "var(--alert)", border: "1px solid var(--alert)", borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer" }}
            >
              ↩ Revenir à l'étape précédente
            </button>
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>
              Corrige une étape validée par erreur (l'étape précédente redevient active).
            </p>
          </div>
        )}
      </div>

      {manuscript.status.stepOrder >= CONTRACTUALISATION_STEP_ORDER && permissions.has("contracts:consultation") && (
        <ContractsSection
          manuscriptId={manuscript.id}
          defaultPartnerId={manuscript.workContributors[0]?.partner.id ?? ""}
          canCreate={permissions.has("contracts:saisie")}
          canValidate={permissions.has("contracts:validation")}
        />
      )}

      {permissions.has("manuscripts:consultation") && (
        <FundingCheckpoint
          manuscriptId={manuscript.id}
          fundingMode={manuscript.fundingMode ?? "publisher"}
          quoteDecision={manuscript.quoteDecision ?? "pending"}
          quoteDecisionNote={manuscript.quoteDecisionNote}
          canManage={permissions.has("manuscripts:saisie")}
          onChanged={() => refresh().catch((e) => setError(e.message))}
        />
      )}

      {permissions.has("finance:consultation") && (
        <EditorialQuotesSection
          manuscriptId={manuscript.id}
          defaultPartnerId={manuscript.workContributors[0]?.partner.id ?? ""}
          canCreate={permissions.has("finance:saisie")}
          canValidate={permissions.has("finance:validation")}
          canAdmin={permissions.has("finance:administration")}
        />
      )}

      {manuscript.status.stepOrder >= PLANIFICATION_STEP_ORDER && permissions.has("tasks:consultation") && (
        <>
          <TasksSection manuscriptId={manuscript.id} canManage={permissions.has("tasks:saisie")} />
          <CorrectionSection manuscriptId={manuscript.id} canManage={permissions.has("tasks:saisie")} />
        </>
      )}

      {manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("production:consultation") && (
        <ProductionSection manuscriptId={manuscript.id} canManage={permissions.has("production:saisie")} />
      )}

      {manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("isbn:consultation") && (
        <IsbnSection manuscriptId={manuscript.id} canManage={permissions.has("isbn:saisie")} />
      )}

      {manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("bat:consultation") && (
        <BatSection
          manuscriptId={manuscript.id}
          canManage={permissions.has("bat:saisie")}
          canValidate={permissions.has("bat:validation")}
        />
      )}

      {manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("printing:consultation") && (
        <PrintingSection
          manuscriptId={manuscript.id}
          canManage={permissions.has("printing:saisie")}
          canValidate={permissions.has("printing:validation")}
        />
      )}

      {/* Site vitrine : publication de l'ouvrage sur la boutique WordPress
          (action du maquettiste), à partir de la mise en page. */}
      {manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("manuscripts:consultation") && (
        <SitePublicationSection manuscriptId={manuscript.id} canPublish={permissions.has("manuscripts:saisie")} />
      )}

      {/* Pièces jointes : disponibles à toutes les étapes, pour tous les pôles
          autorisés (couvertures, contrats scannés, pièces finance, archivage…). */}
      {permissions.has("documents:consultation") && (
        <AttachmentsSection manuscriptId={manuscript.id} canManage={permissions.has("documents:saisie")} />
      )}
    </div>
  );
}

// Date de parution / antidatage (spéc. fonctionnelle §8) : affiche la date de
// parution et, pour les profils habilités, permet de la renseigner ou de la
// corriger. Toute saisie est datée du jour au journal (l'antidatage y est
// signalé), qu'il s'agisse d'un ouvrage déjà paru ou d'une parution à venir.
function PublicationDateBlock({
  manuscript,
  canEdit,
  onSaved,
  onError,
}: {
  manuscript: ManuscriptWithExtras;
  canEdit: boolean;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const current = manuscript.publicationDate ? manuscript.publicationDate.slice(0, 10) : "";
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(current);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date) return;
    setSaving(true);
    try {
      await setPublicationDate(manuscript.id, date);
      setEditing(false);
      onSaved("Date de parution enregistrée.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'enregistrement de la date de parution.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4, fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>Date de parution :</span>
      <strong style={{ fontFamily: "var(--font-mono)" }}>
        {manuscript.publicationDate ? new Date(manuscript.publicationDate).toLocaleDateString("fr-FR") : "non renseignée"}
      </strong>
      {manuscript.isBackCatalogue && (
        <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "1px 8px", fontSize: 11 }}>
          ouvrage déjà paru
        </span>
      )}
      {canEdit && !editing && (
        <button
          onClick={() => {
            setDate(current);
            setEditing(true);
          }}
          className="linklike"
          style={{ background: "none", border: "none", color: "var(--eclosion)", cursor: "pointer", fontSize: 12, padding: 0 }}
        >
          {manuscript.publicationDate ? "Modifier" : "Renseigner"}
        </button>
      )}
      {canEdit && editing && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 4, fontSize: 12 }} />
          <button
            onClick={save}
            disabled={saving || !date}
            style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: saving ? "default" : "pointer" }}
          >
            Enregistrer
          </button>
          <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>
            Annuler
          </button>
        </span>
      )}
    </div>
  );
}

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "#fff", color: "var(--alert)", border: "1px solid var(--alert)", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

function AssignReaderForm({
  manuscriptId,
  onAssigned,
  onError,
}: {
  manuscriptId: string;
  onAssigned: () => void;
  onError: (message: string) => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [readerId, setReaderId] = useState("");
  const [dueAt, setDueAt] = useState("");

  useEffect(() => {
    listUsers().then((u) => {
      setUsers(u);
      if (u[0]) setReaderId(u[0].id);
    });
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        assignReader(manuscriptId, readerId, new Date(dueAt).toISOString())
          .then(onAssigned)
          .catch((err) => onError(err instanceof Error ? err.message : "Affectation impossible."));
      }}
      style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
    >
      <label style={{ fontSize: 12 }}>
        Lecteur
        <select value={readerId} onChange={(e) => setReaderId(e.target.value)} style={{ display: "block", padding: 6 }}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 12 }}>
        Échéance
        <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required style={{ display: "block", padding: 6 }} />
      </label>
      <ActionButton onClick={() => {}}>Affecter</ActionButton>
    </form>
  );
}

const DECISION_LABELS: Record<string, string> = {
  acceptation: "Acceptation",
  acceptation_conditions: "Acceptation sous conditions",
  revision: "Demande de révision",
  attente: "Mise en attente",
  refus: "Refus motivé",
};

function EditorialDecisionForm({
  manuscriptId,
  confirm,
  onDecided,
  onError,
}: {
  manuscriptId: string;
  confirm: (opts: { title: string; message: string; detail?: string; confirmLabel?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  onDecided: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [decision, setDecision] = useState<"acceptation" | "acceptation_conditions" | "revision" | "attente" | "refus">("acceptation");
  const [motivation, setMotivation] = useState("");

  async function submit() {
    const terminal = ["acceptation", "acceptation_conditions", "refus"].includes(decision);
    const ok = await confirm({
      title: "Décision éditoriale",
      message: `Enregistrer la décision « ${DECISION_LABELS[decision]} » ?`,
      detail: terminal
        ? decision === "refus"
          ? "Un refus clôt le circuit (archivage)."
          : "Une acceptation fait passer le manuscrit à la contractualisation."
        : "Le manuscrit reste à l'étape de décision.",
      tone: decision === "refus" ? "danger" : "default",
      confirmLabel: "Enregistrer la décision",
    });
    if (!ok) return;
    try {
      await submitEditorialDecision(manuscriptId, decision, motivation);
      onDecided(`Décision enregistrée : ${DECISION_LABELS[decision]}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'enregistrement de la décision.");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Décision
        <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} style={{ display: "block", padding: 6, marginTop: 4 }}>
          <option value="acceptation">Acceptation</option>
          <option value="acceptation_conditions">Acceptation sous conditions</option>
          <option value="revision">Demande de révision</option>
          <option value="attente">Mise en attente</option>
          <option value="refus">Refus motivé</option>
        </select>
      </label>
      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Motivation (obligatoire)
        <textarea
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          required
          rows={3}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4, fontFamily: "inherit", fontSize: 13 }}
        />
      </label>
      <ActionButton onClick={() => {}}>Enregistrer la décision</ActionButton>
    </form>
  );
}

const STEP_ACTION_LABELS: Record<string, string> = {
  CONTRACTUALISATION: "Valider la contractualisation",
  PLANIFICATION: "Valider la planification",
  CORRECTION: "Valider la correction",
};

// Étapes pilotées par le moteur de workflow générique (Ch. 4 §4.2), au-delà
// de la décision éditoriale. La réécriture (Ch. 4 §4.3) est activée mais
// facultative (décision opérateur du 04/07/2026) : le responsable de la
// correction décide ici si elle est nécessaire.
function GenericStepValidation({
  manuscriptId,
  stepCode,
  confirm,
  onValidated,
  onError,
}: {
  manuscriptId: string;
  stepCode: string;
  confirm: (opts: { title: string; message: string; detail?: string; confirmLabel?: string }) => Promise<boolean>;
  onValidated: (status: string | null) => void;
  onError: (message: string) => void;
}) {
  const [requiresRewrite, setRequiresRewrite] = useState(false);

  const label = STEP_ACTION_LABELS[stepCode] ?? "Valider cette étape";

  async function handleValidate() {
    const ok = await confirm({
      title: "Valider l'étape",
      message: `${label} ?`,
      detail: "Le manuscrit passera à l'étape suivante.",
      confirmLabel: label,
    });
    if (!ok) return;
    try {
      const result = await validateStep(
        manuscriptId,
        stepCode,
        stepCode === "CORRECTION" ? { requires_rewrite: requiresRewrite } : undefined,
      );
      onValidated(result.status);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la validation.");
    }
  }

  return (
    <div>
      {stepCode === "CORRECTION" && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={requiresRewrite} onChange={(e) => setRequiresRewrite(e.target.checked)} />
          Cette version nécessite une réécriture avant de poursuivre
        </label>
      )}
      <ActionButton onClick={handleValidate}>{label}</ActionButton>
    </div>
  );
}
