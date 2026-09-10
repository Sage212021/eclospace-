import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  assignReader,
  closeReadingCommittee,
  createExternalReviewer,
  deleteManuscript,
  sealManuscript,
  unsealManuscript,
  getManuscript,
  getManuscriptSourceFileMeta,
  manuscriptSourceFileUrl,
  uploadManuscriptSourceFile,
  listStepAttachments,
  uploadStepAttachment,
  deleteStepDocument,
  stepAttachmentDownloadUrl,
  type StepAttachment,
  getManuscriptLayoutMeta,
  manuscriptCorrectedFileUrl,
  manuscriptLayoutFileUrl,
  uploadManuscriptLayoutFile,
  getManuscriptBatMeta,
  manuscriptBatFileUrl,
  uploadManuscriptBatFile,
  getManuscriptTimeline,
  listReadingCandidates,
  revertManuscriptStep,
  setManuscriptSegment,
  setPublicationDate,
  submitEditorialDecision,
  getManuscriptDecisionLetter,
  previewDecisionLetter,
  getBranding,
  getAcceptanceConditions,
  addAcceptanceCondition,
  liftAcceptanceCondition,
  reopenAcceptanceCondition,
  deleteAcceptanceCondition,
  updateManuscriptRegistration,
  validateStep,
  getNextAssignees,
  getOptionalStep,
  listGenres,
  listUsers,
  type AcceptanceConditions,
  type EditorialSegment,
  type Genre,
  type ManuscriptDetail as ManuscriptDetailData,
  type NextAssignee,
  type OptionalStepMeta,
  type ReadingCandidate,
  type TimelineStep,
  type UserSummary,
} from "../api/client";
import { useConfirm } from "../components/ConfirmProvider";
import { DocPrintMenu } from "../components/DocPrintMenu";
import { printEditorialDecisionLetter, type PrintOpts } from "../lib/print";
import { Spine } from "../components/Spine";
import { ContractsSection } from "../components/ContractsSection";
import { EditorialQuotesSection } from "../components/EditorialQuotesSection";
import { TasksSection } from "../components/TasksSection";
import { CorrectionSection } from "../components/CorrectionSection";
import { CorrectionCyclePanel } from "../components/CorrectionCyclePanel";
import { StartingProofPanel } from "../components/StartingProofPanel";
import { StepDeliverableBlock } from "../components/StepDeliverableBlock";
import { ProductionSection } from "../components/ProductionSection";
import { IsbnSection } from "../components/IsbnSection";
import { BatSection } from "../components/BatSection";
import { PrintingSection } from "../components/PrintingSection";
import { AttachmentsSection } from "../components/AttachmentsSection";
import { ReadingEvaluationsSection } from "../components/ReadingEvaluationsSection";
import { AuthorFilesSection } from "../components/AuthorFilesSection";
import { FundingCheckpoint } from "../components/FundingCheckpoint";
import { FinanceRequestCard } from "../components/FinanceRequestCard";
import { EditorialQuotesInbox } from "../components/EditorialQuotesInbox";
import { AiReadingLauncher } from "../components/AiReadingLauncher";
import { SitePublicationSection } from "../components/SitePublicationSection";
import { ManuscriptStockSection } from "../components/ManuscriptStockSection";

interface ManuscriptDetailProps {
  manuscriptId: string;
  permissions: Set<string>;
  // Rubrique d'où l'ouvrage a été ouvert : sert à ne montrer QUE les tâches de
  // cette étape (le reste est masqué, avec une échappatoire « toute la fiche »).
  originKey?: string;
  onBack: () => void;
}

// Rubrique d'origine → module de la fiche à mettre en avant. Absent (ex. depuis
// « Manuscrits » global ou les archives) = fiche complète, comportement inchangé.
const FOCUS_BY_ORIGIN: Record<string, string> = {
  "ed-comite": "committee",
  "ed-direction": "decision",
  "ed-correction": "correction",
  "ed-expertise": "expertise",
  "ed-reecriture": "reecriture",
  "jf-contrats": "contracts",
  "pr-maquette": "production",
  "pr-infographie": "production",
  "pr-isbn": "isbn",
  "pr-bat": "bat",
  "pr-impression": "printing",
  "cm-messages-auteurs": "authors",
};
const FOCUS_LABELS: Record<string, string> = {
  committee: "Comité de lecture",
  decision: "Direction éditoriale",
  correction: "Correction éditoriale",
  expertise: "Expertise scientifique",
  reecriture: "Réécriture éditoriale",
  contracts: "Contrats & droits",
  production: "Maquette & production",
  isbn: "ISBN & dépôt légal",
  bat: "BAT Final & contrôle qualité",
  printing: "Impression",
  authors: "Messagerie des auteurs",
};

type ManuscriptWithExtras = ManuscriptDetailData;

const CONTRACTUALISATION_STEP_ORDER = 5;
const PLANIFICATION_STEP_ORDER = 6;
const MISE_EN_PAGE_STEP_ORDER = 10;

export function ManuscriptDetail({ manuscriptId, permissions, originKey, onBack }: ManuscriptDetailProps) {
  const confirm = useConfirm();
  const [manuscript, setManuscript] = useState<ManuscriptWithExtras | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Focalisation par rubrique : on n'affiche que les sections de l'étape d'où
  // l'ouvrage a été ouvert. « Voir toute la fiche » lève la restriction.
  const [showAll, setShowAll] = useState(false);
  const [editFiche, setEditFiche] = useState(false);
  const focus = originKey ? FOCUS_BY_ORIGIN[originKey] ?? null : null;
  const activeFocus = showAll ? null : focus;
  const show = (mod: string) => activeFocus === null || activeFocus === mod;

  const refresh = async () => {
    const [m, t] = await Promise.all([getManuscript(manuscriptId), getManuscriptTimeline(manuscriptId)]);
    setManuscript(m);
    setTimeline(t);
    return m;
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  if (!manuscript) return <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>Chargement…</div>;

  const canValidate = permissions.has("manuscripts:validation");
  const canEditFiche = permissions.has("manuscripts:saisie");
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

  function scrollToActions() {
    window.requestAnimationFrame(() =>
      document.getElementById("fiche-actions")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  // Enchaînement des étapes (demande opérateur) : après une validation qui fait
  // AVANCER le manuscrit, si l'étape suivante n'a PAS été confiée à quelqu'un
  // d'autre, on enchaîne directement — on lève la « vue centrée » et on amène
  // l'utilisateur sur l'action suivante, sans repasser par le menu. Si l'étape
  // a été confiée à un tiers, on ne force pas : on l'informe simplement.
  async function advanceAfterValidation(confided: boolean) {
    const previous = manuscript?.status.code;
    const m = await refresh();
    const advanced = m.status.code !== previous;
    if (confided) {
      setMessage("Étape validée et confiée : la personne désignée est notifiée.");
    } else if (advanced) {
      setShowAll(true); // on lève la vue centrée pour que l'action suivante soit visible
      setMessage(`Étape validée. Étape suivante : « ${m.status.label} » — continuez ci-dessous.`);
      scrollToActions();
    } else {
      setMessage("Étape validée.");
    }
  }

  // Comme confirmThen, mais enchaîne sur l'étape suivante après une validation.
  async function confirmThenAdvance(
    opts: { title: string; message: string; detail?: string; confirmLabel?: string; tone?: "default" | "danger" },
    action: () => Promise<unknown>,
    confided = false,
  ) {
    if (!(await confirm(opts))) return;
    setError(null);
    setMessage(null);
    try {
      await action();
      await advanceAfterValidation(confided);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la validation.");
    }
  }

  // Archivage définitif (scellé) : verrouille le dossier en lecture seule ; seule
  // l'administration peut le rouvrir (motif obligatoire).
  async function handleSeal() {
    const ok = await confirm({
      title: "Sceller le dossier (archivage définitif)",
      message: `Archiver définitivement et verrouiller « ${manuscript!.title} » ?`,
      detail: "Le dossier passera en LECTURE SEULE : plus aucune modification ni retrait de document. Seul un administrateur pourra le rouvrir (avec motif).",
      confirmLabel: "Sceller le dossier",
    });
    if (!ok) return;
    await handle(() => sealManuscript(manuscript!.id), "Dossier scellé : archivé définitivement, en lecture seule.");
  }
  async function handleUnseal() {
    const reason = window.prompt(`Rouvrir le dossier scellé « ${manuscript!.title} » ?\n\nMotif obligatoire (ce que vous allez corriger) :`, "");
    if (reason === null) return;
    if (!reason.trim()) { setError("Motif de réouverture obligatoire."); return; }
    await handle(() => unsealManuscript(manuscript!.id, reason.trim()), "Dossier rouvert : modifications possibles. Pensez à le re-sceller une fois corrigé.");
  }

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)", maxWidth: 760 }}>
      {/* Barre d'actions standard — toujours visible en haut de la fiche, pour
          ne pas avoir à chercher : Retour · Imprimer · (Valider l'étape) ·
          Supprimer. La validation détaillée reste dans « Étape courante » ; ce
          bouton y amène directement. La suppression est logique et réservée au
          niveau administration. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          background: "var(--paper, #F8F9FB)",
          borderBottom: "1px solid var(--line)",
          padding: "8px 0",
          marginBottom: 12,
        }}
      >
        <button onClick={onBack} style={barBtn()}>← Retour</button>
        <button onClick={() => window.print()} style={barBtn()}>🖨 Imprimer</button>
        {canValidate && (
          <button
            onClick={() => document.getElementById("fiche-actions")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            style={barBtn("primary")}
          >
            ✓ Valider → étape suivante
          </button>
        )}
        {canEditFiche && (
          <button
            onClick={() => setEditFiche(true)}
            disabled={manuscript.registrationLocked}
            title={manuscript.registrationLocked ? "Fiche verrouillée : le contrat est signé." : "Corriger une erreur ou un oubli de la fiche"}
            style={{ ...barBtn(), opacity: manuscript.registrationLocked ? 0.5 : 1, cursor: manuscript.registrationLocked ? "not-allowed" : "pointer" }}
          >
            ✎ Modifier la fiche
          </button>
        )}
        {canValidate && manuscript.status.code === "ARCHIVAGE" && !manuscript.sealed && (
          <button onClick={handleSeal} style={barBtn()} title="Archiver définitivement : verrouille le dossier en lecture seule.">
            🔒 Sceller le dossier
          </button>
        )}
        {manuscript.sealed && permissions.has("manuscripts:administration") && (
          <button onClick={handleUnseal} style={barBtn()} title="Rouvrir le dossier scellé (motif obligatoire, tracé).">
            🔓 Rouvrir le dossier
          </button>
        )}
        <span style={{ flex: 1 }} />
        {permissions.has("manuscripts:administration") && (
          <button
            onClick={async () => {
              const ok = await confirm({
                title: "Supprimer le manuscrit",
                message: `Supprimer « ${manuscript.title} » ?`,
                detail: "Suppression logique : le dossier disparaît des listes mais reste conservé en base et l'action est tracée au journal. À n'utiliser que pour un dossier créé par erreur.",
                tone: "danger",
                confirmLabel: "Supprimer",
              });
              if (!ok) return;
              try {
                await deleteManuscript(manuscript.id);
                onBack();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Suppression impossible.");
              }
            }}
            style={barBtn("danger")}
          >
            🗑 Supprimer le manuscrit
          </button>
        )}
      </div>

      {manuscript.sealed && (
        <div style={{ background: "var(--eclosion-soft, #eef1f7)", border: "1px solid var(--ink, #0b0b0c)", color: "var(--ink, #0b0b0c)", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          🔒 Dossier scellé — archivé définitivement, en lecture seule. Aucune modification ni retrait de document n'est possible.{" "}
          {permissions.has("manuscripts:administration")
            ? "Utilisez « Rouvrir le dossier » (motif requis) pour corriger."
            : "Seul un administrateur peut le rouvrir."}
        </div>
      )}

      {editFiche && (
        <EditFicheModal
          manuscript={manuscript}
          onClose={() => setEditFiche(false)}
          onSaved={async () => {
            setEditFiche(false);
            setMessage("Fiche corrigée. La modification est tracée au journal.");
            await refresh();
          }}
          onError={(m) => setError(m)}
        />
      )}

      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>{manuscript.title}</h1>
      <p style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 12 }}>{manuscript.manuscriptNumber}</p>
      <p style={{ fontSize: 13 }}>
        Auteur : {manuscript.workContributors.map((c) => `${c.partner.firstName} ${c.partner.lastName}`).join(", ")} · Genre :{" "}
        {manuscript.genre?.label ?? "—"} · Responsable : {manuscript.owner.username}
      </p>

      {permissions.has("stock:consultation") && show("stock") && (
        <ManuscriptStockSection manuscriptId={manuscript.id} canManage={permissions.has("stock:saisie")} />
      )}

      <SourceFileBlock
        manuscriptId={manuscript.id}
        canDeposit={permissions.has("manuscripts:saisie")}
        onMessage={setMessage}
        onError={setError}
      />

      <PublicationDateBlock
        manuscript={manuscript}
        canEdit={permissions.has("manuscripts:saisie")}
        onSaved={(msg) => handle(async () => {}, msg)}
        onError={setError}
      />

      {/* Segment éditorial : classe l'ouvrage pour la ventilation du chiffre
          d'affaires (livre scolaire & parascolaire vs général & littérature). */}
      {permissions.has("manuscripts:consultation") && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Segment éditorial</span>
            <span style={{ color: "var(--muted)" }}> — pour la ventilation du chiffre d'affaires</span>
          </div>
          {permissions.has("manuscripts:saisie") ? (
            <select
              value={manuscript.editorialSegment ?? ""}
              onChange={(e) => handle(() => setManuscriptSegment(manuscript.id, e.target.value as EditorialSegment), "Segment éditorial enregistré.")}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }}
            >
              <option value="" disabled>— à classer —</option>
              <option value="scolaire">Livre scolaire &amp; parascolaire</option>
              <option value="general">Livre général &amp; littérature</option>
            </select>
          ) : (
            <span style={{ fontSize: 13, color: manuscript.editorialSegment ? "var(--ink)" : "var(--amber)" }}>
              {manuscript.editorialSegment === "scolaire" ? "Livre scolaire & parascolaire" : manuscript.editorialSegment === "general" ? "Livre général & littérature" : "à classer"}
            </span>
          )}
        </div>
      )}

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

      <div id="fiche-actions" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20, scrollMarginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Étape courante : {manuscript.status.label}</div>

        {/* Un manuscrit resté à « Réception » (donnée ancienne : la création
            fait normalement passer directement à la vérification) : bouton pour
            le débloquer vers la vérification administrative. */}
        {manuscript.status.code === "RECEPTION" && canValidate && (
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton
              onClick={() =>
                confirmThenAdvance(
                  {
                    title: "Valider la réception",
                    message: "Confirmer la réception de ce manuscrit ?",
                    detail: "Le manuscrit passera à la vérification administrative.",
                    confirmLabel: "Réception confirmée",
                  },
                  () => validateStep(manuscript.id, "RECEPTION", { outcome: "conforme" }),
                )
              }
            >
              Réception confirmée
            </ActionButton>
          </div>
        )}

        {manuscript.status.code === "VERIF_ADMIN" && canValidate && (
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton
              onClick={() =>
                confirmThenAdvance(
                  {
                    title: "Valider l'étape",
                    message: "Confirmer que le dossier est conforme ?",
                    detail: "Le manuscrit passera au comité de lecture.",
                    confirmLabel: "Dossier conforme",
                  },
                  () => validateStep(manuscript.id, "VERIF_ADMIN", { outcome: "conforme" }),
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

        {manuscript.status.code === "COMITE_LECTURE" && canAssignReader && (
          <AiReadingLauncher manuscriptId={manuscript.id} workType="evaluation" stepCode="COMITE_LECTURE" title="Relecture IA — Rapport d'évaluation" />
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

        {show("committee") && permissions.has("comite_lecture:consultation") && (
          <ReadingEvaluationsSection
            manuscriptId={manuscript.id}
            canManage={canAssignReader}
            onChanged={() => refresh().catch((e) => setError(e.message))}
          />
        )}

        {show("authors") && permissions.has("manuscripts:consultation") && (
          <AuthorFilesSection manuscriptId={manuscript.id} canManage={permissions.has("manuscripts:saisie")} />
        )}

        {manuscript.status.code === "DECISION_EDITORIALE" && canDecide && (
          <EditorialDecisionForm
            manuscriptId={manuscript.id}
            confirm={confirm}
            onDecided={() => advanceAfterValidation(false)}
            onError={setError}
          />
        )}

        {/* Lettre officielle à l'auteur : dès qu'une décision donnant lieu à une
            lettre a été prise, on peut la (ré)imprimer à l'en-tête de la maison. */}
        {canDecide && <DecisionLetterCard manuscriptId={manuscript.id} />}

        {manuscript.status.code === "PLANIFICATION" && (
          <StartingProofPanel manuscriptId={manuscript.id} canManage={permissions.has("manuscripts:saisie") || permissions.has("tasks:saisie")} />
        )}

        {/* Acceptation sous conditions (audit éditorial, point n°2) : suivi des
            conditions à lever avant l'entrée en production (mise en page). */}
        {manuscript.status.stepOrder >= PLANIFICATION_STEP_ORDER && manuscript.status.stepOrder < MISE_EN_PAGE_STEP_ORDER && (
          <AcceptanceConditionsPanel manuscriptId={manuscript.id} canManage={canDecide} confirm={confirm} onError={setError} />
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

        {GENERIC_VALIDATION_STEPS.includes(manuscript.status.code) && (
          <StepAttachments
            manuscriptId={manuscript.id}
            stepLabel={manuscript.status.label}
            canDeposit={canEditFiche}
            onError={setError}
          />
        )}

        {GENERIC_VALIDATION_STEPS.includes(manuscript.status.code) && (
          <StepDeliverableBlock
            manuscriptId={manuscript.id}
            stepCode={manuscript.status.code}
            canManage={canEditFiche || permissions.has("tasks:saisie")}
          />
        )}

        {GENERIC_VALIDATION_STEPS.includes(manuscript.status.code) && canValidate && (
          <GenericStepValidation
            manuscriptId={manuscript.id}
            stepCode={manuscript.status.code}
            confirm={confirm}
            onValidated={(_status, opts) => advanceAfterValidation(opts?.confided ?? false)}
            onError={setError}
          />
        )}

        {!["RECEPTION", "VERIF_ADMIN", "COMITE_LECTURE", "DECISION_EDITORIALE", ...GENERIC_VALIDATION_STEPS].includes(
          manuscript.status.code,
        ) && (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Aucune action disponible à cette étape (étape terminale ou pilotée ailleurs).
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
                    title: "Revenir à l'étape précédente ?",
                    message: `Confirmez-vous de ramener « ${manuscript.title} » à l'étape précédant « ${manuscript.status.label} » ?`,
                    detail: "⚠ À n'utiliser que pour corriger une validation faite PAR ERREUR. Conséquences : l'étape « " + manuscript.status.label + " » est annulée, l'étape précédente redevient active, et le travail lié à l'étape en cours peut être à refaire. Action tracée au journal. Ne rien faire si vous n'êtes pas sûr.",
                    tone: "danger",
                    confirmLabel: "Oui, revenir en arrière",
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

      {/* Bandeau de focalisation : indique qu'on ne voit que l'étape d'origine,
          et propose d'afficher toute la fiche. */}
      {focus && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginTop: 12 }}>
          <span style={{ color: "var(--ink)" }}>
            {activeFocus ? <>Vue centrée sur <strong>{FOCUS_LABELS[focus]}</strong> — seules les tâches de cette étape sont affichées.</> : <>Vous voyez <strong>toute la fiche</strong>.</>}
          </span>
          <button onClick={() => setShowAll((v) => !v)} style={{ marginLeft: "auto", background: "#fff", border: "1px solid var(--eclosion)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {showAll ? `↩ Revenir à « ${FOCUS_LABELS[focus]} »` : "Voir toute la fiche"}
          </button>
        </div>
      )}

      {show("contracts") && manuscript.status.stepOrder >= CONTRACTUALISATION_STEP_ORDER && permissions.has("contracts:consultation") && (
        <ContractsSection
          manuscriptId={manuscript.id}
          defaultPartnerId={manuscript.workContributors[0]?.partner.id ?? ""}
          canCreate={permissions.has("contracts:saisie")}
          canValidate={permissions.has("contracts:validation")}
          canRemitAuthor={permissions.has("stock:saisie")}
        />
      )}

      {show("contracts") && permissions.has("manuscripts:consultation") && (
        <FundingCheckpoint
          manuscriptId={manuscript.id}
          fundingMode={manuscript.fundingMode ?? "publisher"}
          quoteDecision={manuscript.quoteDecision ?? "pending"}
          quoteDecisionNote={manuscript.quoteDecisionNote}
          canManage={permissions.has("manuscripts:saisie")}
          onChanged={() => refresh().catch((e) => setError(e.message))}
        />
      )}

      {/* Demandes à la Finance depuis la fiche : devis / facture frais de dépôt. */}
      {show("contracts") && permissions.has("manuscripts:consultation") && (
        <FinanceRequestCard manuscriptId={manuscript.id} canRequest={permissions.has("manuscripts:saisie")} />
      )}

      {show("finance") && permissions.has("finance:consultation") && (
        <EditorialQuotesSection
          manuscriptId={manuscript.id}
          defaultPartnerId={manuscript.workContributors[0]?.partner.id ?? ""}
          canCreate={permissions.has("finance:saisie")}
          canValidate={permissions.has("finance:validation")}
          canAdmin={permissions.has("finance:administration")}
        />
      )}

      {/* Circuit devis : côté Éditorial (devis transmis par la Finance pour cet
          ouvrage). Visible sur les rubriques Contrats/Finance pour l'éditorial. */}
      {(show("finance") || show("contracts")) && (permissions.has("manuscripts:saisie") || permissions.has("manuscripts:validation")) && (
        <EditorialQuotesInbox manuscriptId={manuscript.id} />
      )}

      {(show("correction") || show("expertise") || show("reecriture")) && manuscript.status.stepOrder >= PLANIFICATION_STEP_ORDER && permissions.has("tasks:consultation") && (
        <>
          <TasksSection manuscriptId={manuscript.id} canManage={permissions.has("tasks:saisie")} />
          <CorrectionCyclePanel manuscriptId={manuscript.id} canManage={permissions.has("tasks:saisie") || permissions.has("manuscripts:saisie")} />
          {(permissions.has("tasks:saisie") || permissions.has("manuscripts:saisie")) && (
            <>
              <AiReadingLauncher manuscriptId={manuscript.id} workType="correction_1" stepCode="CORRECTION" title="Relecture IA — BAT1" hint="Produit aussi le manuscrit corrigé BAT1 (à intégrer par le correcteur). Coût plus élevé qu'un simple rapport." />
              <AiReadingLauncher manuscriptId={manuscript.id} workType="correction_2" stepCode="CORRECTION" title="Relecture IA — BAT2" hint="Produit aussi le manuscrit corrigé BAT2 (à intégrer par le correcteur). Coût plus élevé qu'un simple rapport." />
              <AiReadingLauncher manuscriptId={manuscript.id} workType="couverture" stepCode="CORRECTION" title="Relecture IA — Couverture (1ʳᵉ, dos, 4ᵉ)" askCoverPass hint="Choisissez le passage : BAT1 (1ᵉʳ) ou BAT2. Au BAT2, l'IA reçoit le rapport du BAT précédent, vérifie les intégrations, ce qui manque et les améliorations." />
              {/* Assistants IA « Expertise scientifique » et « Réécriture » — branchés
                  sur les étapes éditoriales existantes (EXPERTISE, REECRITURE). La
                  consigne particulière permet de préciser le type d'expertise, les
                  paragraphes ciblés ou le niveau de préservation de la voix. */}
              <AiReadingLauncher
                manuscriptId={manuscript.id}
                workType="expertise"
                stepCode="EXPERTISE"
                title="🤖 Expertise scientifique IA"
                hint="Produit un rapport d'expertise scientifique (grille en 18 points, Constat/Problème/Explication/Recommandation) + une proposition d'avis assistée par IA. Aide à la décision — jamais une expertise humaine. Choisissez les objectifs ci-dessous ou précisez le domaine scientifique."
                presetGroups={[
                  { title: "Expertise ciblée (cumulable)", options: ["Analyse de la problématique", "Analyse des objectifs", "Analyse des hypothèses", "Analyse de la méthodologie", "Analyse de la cohérence scientifique", "Analyse de la structure", "Analyse de la qualité argumentative", "Analyse des résultats", "Analyse de la discussion", "Analyse des références bibliographiques", "Identification des affirmations nécessitant des sources", "Identification des incohérences", "Identification des contradictions", "Identification des lacunes scientifiques", "Analyse des limites du travail"] },
                  { title: "Expertise complète", options: ["Expertise scientifique complète (analyse structurée de tout le document)"] },
                ]}
              />
              <AiReadingLauncher
                manuscriptId={manuscript.id}
                workType="reecriture"
                stepCode="REECRITURE"
                title="🤖 Réécriture IA"
                hint="Produit une VERSION RÉÉCRITE (l'original est conservé, jamais écrasé) + un rapport de réécriture. Choisissez le type et le degré de préservation de la voix ci-dessous ; vous pouvez aussi cibler des paragraphes dans la consigne."
                presetGroups={[
                  { title: "Type de réécriture", options: ["Correction linguistique", "Amélioration stylistique", "Réécriture approfondie", "Réécriture académique", "Réécriture professionnelle"] },
                  { title: "Préserver la voix de l'auteur", options: ["Préservation de la voix : minimale", "Préservation de la voix : modérée", "Préservation de la voix : importante"] },
                ]}
              />
            </>
          )}
          <CorrectionSection manuscriptId={manuscript.id} canManage={permissions.has("tasks:saisie")} />
        </>
      )}

      {show("production") && manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("production:consultation") && (
        <>
          <MaquetteHandoffBlock
            manuscriptId={manuscript.id}
            canDeposit={permissions.has("production:saisie")}
            onMessage={setMessage}
            onError={setError}
          />
          <ProductionSection manuscriptId={manuscript.id} canManage={permissions.has("production:saisie")} />
        </>
      )}

      {show("isbn") && manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("isbn:consultation") && (
        <IsbnSection manuscriptId={manuscript.id} canManage={permissions.has("isbn:saisie")} />
      )}

      {show("bat") && manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("bat:consultation") && (
        <>
          <BatHandoffBlock
            manuscriptId={manuscript.id}
            canDeposit={permissions.has("bat:saisie")}
            onMessage={setMessage}
            onError={setError}
          />
          <BatSection
            manuscriptId={manuscript.id}
            canManage={permissions.has("bat:saisie")}
            canValidate={permissions.has("bat:validation")}
          />
          {permissions.has("bat:saisie") && (
            <AiReadingLauncher manuscriptId={manuscript.id} workType="couverture" stepCode="VALIDATION_BAT" title="Relecture IA — Couverture (BAT Final)" />
          )}
        </>
      )}

      {show("printing") && manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("printing:consultation") && (
        <>
          <ImpressionHandoffBlock manuscriptId={manuscript.id} />
          <PrintingSection
            manuscriptId={manuscript.id}
            canManage={permissions.has("printing:saisie")}
            canValidate={permissions.has("printing:validation")}
          />
        </>
      )}

      {/* Site vitrine : publication de l'ouvrage sur la boutique WordPress
          (action du maquettiste), à partir de la mise en page. */}
      {show("production") && manuscript.status.stepOrder >= MISE_EN_PAGE_STEP_ORDER && permissions.has("manuscripts:consultation") && (
        <SitePublicationSection manuscriptId={manuscript.id} canPublish={permissions.has("manuscripts:saisie")} />
      )}

      {/* Pièces jointes : disponibles à toutes les étapes, pour tous les pôles
          autorisés (couvertures, contrats scannés, pièces finance, archivage…). */}
      {activeFocus === null && permissions.has("documents:consultation") && (
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

// Fichier source du manuscrit : le dépôt à la réception (entrée du circuit).
// Une fois déposé, il est lu par le comité de lecture puis par le correcteur.
// Le secrétariat éditorial (manuscripts:saisie) le dépose sans droit « documents ».
function SourceFileBlock({
  manuscriptId,
  canDeposit,
  onMessage,
  onError,
}: {
  manuscriptId: string;
  canDeposit: boolean;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [hasFile, setHasFile] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    getManuscriptSourceFileMeta(manuscriptId)
      .then((m) => setHasFile(m.has_file))
      .catch(() => setHasFile(false));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function deposit(file: File) {
    setBusy(true);
    try {
      await uploadManuscriptSourceFile(manuscriptId, file);
      onMessage("Fichier du manuscrit déposé — il sera lu par le comité de lecture et le correcteur.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Dépôt impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--eclosion-dark, #9a7a12)", background: "var(--eclosion-soft)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
        Manuscrit (source)
      </span>
      {hasFile ? (
        <>
          <a href={manuscriptSourceFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600, fontSize: 13 }}>
            📄 Ouvrir le manuscrit déposé
          </a>
          <a href={manuscriptSourceFileUrl(manuscriptId)} download style={{ color: "var(--eclosion-dark)", fontWeight: 600, fontSize: 13 }}>
            ⬇️ Télécharger
          </a>
        </>
      ) : (
        <span style={{ color: "var(--eclosion-retard, #C4661F)", fontSize: 13 }}>
          Aucun fichier manuscrit déposé — obligatoire avant le passage au comité de lecture.
        </span>
      )}
      {canDeposit && (
        <label style={{ cursor: busy ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
          {busy ? "Envoi…" : hasFile ? "Remplacer le fichier" : "Déposer le fichier du manuscrit"}
          <input
            type="file"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) deposit(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
      <span style={{ color: "var(--muted)", fontSize: 11.5 }}>→ lu par le comité de lecture, puis le correcteur</span>
    </div>
  );
}

// Étape Maquette (mise en page) : entrée = le manuscrit corrigé (produit par
// la correction), sortie = la maquette mise en page (reçue par le BAT et
// l'infographie). Le maquettiste (production:saisie) dépose sans droit « documents ».
function MaquetteHandoffBlock({
  manuscriptId,
  canDeposit,
  onMessage,
  onError,
}: {
  manuscriptId: string;
  canDeposit: boolean;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof getManuscriptLayoutMeta>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => getManuscriptLayoutMeta(manuscriptId).then(setMeta).catch(() => setMeta(null));

  async function removeLayout() {
    if (!meta?.layout_doc_id) return;
    if (!window.confirm("Retirer la maquette déposée par erreur ? Vous pourrez en déposer une autre ensuite.")) return;
    setBusy(true);
    try {
      await deleteStepDocument(manuscriptId, meta.layout_doc_id);
      onMessage("Maquette retirée. Vous pouvez déposer le bon fichier.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Retrait impossible.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function deposit(file: File) {
    setBusy(true);
    try {
      await uploadManuscriptLayoutFile(manuscriptId, file);
      onMessage("Maquette déposée — elle sera reçue par le BAT et l'infographie.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Dépôt impossible.");
    } finally {
      setBusy(false);
    }
  }

  const tag = (dir: "in" | "out"): React.CSSProperties => ({
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: dir === "in" ? "var(--eclosion-dark, #9a7a12)" : "#2E6B4F",
    background: dir === "in" ? "var(--eclosion-soft)" : "#DDF0E5",
    borderRadius: 999,
    padding: "2px 9px",
    whiteSpace: "nowrap",
  });
  const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 };

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Maquette — mise en page</div>
      {/* ENTRÉE : le manuscrit corrigé. */}
      <div style={row}>
        <span style={tag("in")}>À mettre en page</span>
        {meta?.corrected_has_file ? (
          <>
            <a href={manuscriptCorrectedFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
              📖 Ouvrir le manuscrit corrigé
            </a>
            <a href={manuscriptCorrectedFileUrl(manuscriptId)} download style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
              ⬇️ Télécharger
            </a>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>Le manuscrit corrigé n'a pas encore été déposé par la correction.</span>
        )}
      </div>
      {/* SORTIE : la maquette. */}
      <div style={row}>
        <span style={tag("out")}>À remettre</span>
        {meta?.layout_has_file && (
          <a href={manuscriptLayoutFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📄 Ouvrir la maquette déposée
          </a>
        )}
        {canDeposit && (
          <label style={{ cursor: busy ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
            {busy ? "Envoi…" : meta?.layout_has_file ? "Remplacer la maquette" : "Déposer la maquette (fichier mis en page)"}
            <input
              type="file"
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) deposit(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {canDeposit && meta?.layout_has_file && meta?.layout_can_correct && (
          <button onClick={removeLayout} disabled={busy} style={{ fontWeight: 600, color: "var(--alert)", background: "#fff", border: "1px solid var(--alert)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: busy ? "default" : "pointer" }}>
            Retirer la maquette
          </button>
        )}
        <span style={{ color: "var(--muted)", fontSize: 11.5 }}>→ reçue par le BAT et l'infographie</span>
      </div>
    </div>
  );
}

// Étape BAT : entrée = la maquette (produite par la mise en page), sortie = le
// BAT signé (reçu par l'impression). La qualité (bat:saisie) dépose sans droit
// « documents ».
function BatHandoffBlock({
  manuscriptId,
  canDeposit,
  onMessage,
  onError,
}: {
  manuscriptId: string;
  canDeposit: boolean;
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof getManuscriptBatMeta>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => getManuscriptBatMeta(manuscriptId).then(setMeta).catch(() => setMeta(null));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function deposit(file: File) {
    setBusy(true);
    try {
      await uploadManuscriptBatFile(manuscriptId, file);
      onMessage("BAT signé déposé — il sera reçu par l'impression.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Dépôt impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function removeBat() {
    if (!meta?.bat_doc_id) return;
    if (!window.confirm("Retirer le BAT déposé par erreur ? Vous pourrez en déposer un autre ensuite.")) return;
    setBusy(true);
    try {
      await deleteStepDocument(manuscriptId, meta.bat_doc_id);
      onMessage("BAT retiré. Vous pouvez déposer le bon fichier.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Retrait impossible.");
    } finally {
      setBusy(false);
    }
  }

  const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 };
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>BAT — bon à tirer</div>
      <div style={row}>
        <span style={handoffTag("in")}>À vérifier</span>
        {meta?.layout_has_file ? (
          <>
            <a href={manuscriptLayoutFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
              📄 Ouvrir la maquette
            </a>
            <a href={manuscriptLayoutFileUrl(manuscriptId)} download style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
              ⬇️ Télécharger
            </a>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>La maquette n'a pas encore été déposée par la mise en page.</span>
        )}
      </div>
      <div style={row}>
        <span style={handoffTag("out")}>À remettre</span>
        {meta?.bat_has_file && (
          <a href={manuscriptBatFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📄 Ouvrir le BAT signé
          </a>
        )}
        {canDeposit && (
          <label style={{ cursor: busy ? "default" : "pointer", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5 }}>
            {busy ? "Envoi…" : meta?.bat_has_file ? "Remplacer le BAT signé" : "Déposer le BAT signé (fichier)"}
            <input
              type="file"
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) deposit(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {canDeposit && meta?.bat_has_file && meta?.bat_can_correct && (
          <button onClick={removeBat} disabled={busy} style={{ fontWeight: 600, color: "var(--alert)", background: "#fff", border: "1px solid var(--alert)", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: busy ? "default" : "pointer" }}>
            Retirer le BAT
          </button>
        )}
        <span style={{ color: "var(--muted)", fontSize: 11.5 }}>→ reçu par l'impression</span>
      </div>
    </div>
  );
}

// Étape Impression : entrée = le BAT signé (à transmettre à l'imprimeur). La
// sortie est physique — les exemplaires imprimés entrent en stock (gérée par la
// section Impression / le stock). Bloc d'entrée seul, pour ouvrir le fichier reçu.
function ImpressionHandoffBlock({ manuscriptId }: { manuscriptId: string }) {
  const [hasBat, setHasBat] = useState<boolean | null>(null);
  useEffect(() => {
    getManuscriptBatMeta(manuscriptId)
      .then((m) => setHasBat(m.bat_has_file))
      .catch(() => setHasBat(false));
  }, [manuscriptId]);
  const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 };
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Impression</div>
      <div style={row}>
        <span style={handoffTag("in")}>À imprimer</span>
        {hasBat ? (
          <>
            <a href={manuscriptBatFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
              📄 Ouvrir le BAT signé
            </a>
            <a href={manuscriptBatFileUrl(manuscriptId)} download style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
              ⬇️ Télécharger
            </a>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>Le BAT signé n'a pas encore été déposé par le contrôle qualité.</span>
        )}
        <span style={{ color: "var(--muted)", fontSize: 11.5 }}>à transmettre à l'imprimeur</span>
      </div>
      <div style={row}>
        <span style={handoffTag("out")}>En sortie</span>
        <span style={{ color: "var(--muted)" }}>Les exemplaires imprimés entrent en stock (bon de commande et réception ci-dessous).</span>
      </div>
    </div>
  );
}

// Étiquette entrée/sortie réutilisée par les blocs de transmission d'étape.
function handoffTag(dir: "in" | "out"): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: dir === "in" ? "var(--eclosion-dark, #9a7a12)" : "#2E6B4F",
    background: dir === "in" ? "var(--eclosion-soft)" : "#DDF0E5",
    borderRadius: 999,
    padding: "2px 9px",
    whiteSpace: "nowrap",
  };
}

// Bouton de la barre d'actions standard (haut de fiche). Trois tons : neutre,
// primaire (validation), danger (suppression).
function barBtn(tone: "neutral" | "primary" | "danger" = "neutral"): React.CSSProperties {
  const base: React.CSSProperties = {
    border: "1px solid var(--line)",
    borderRadius: 8,
    padding: "7px 13px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    background: "#fff",
    color: "var(--ink)",
    whiteSpace: "nowrap",
  };
  if (tone === "primary") return { ...base, background: "var(--eclosion)", borderColor: "var(--eclosion)", color: "#fff" };
  if (tone === "danger") return { ...base, color: "var(--alert)", borderColor: "var(--alert)" };
  return base;
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
  const [users, setUsers] = useState<ReadingCandidate[]>([]);
  const [readerId, setReaderId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [showExternal, setShowExternal] = useState(false);
  const [ext, setExt] = useState({ username: "", email: "", password: "" });
  const [creating, setCreating] = useState(false);

  const reload = (selectId?: string) =>
    // Comptes habilités (correcteur, comité, assistant/directeur éditorial, DG)
    // et relecteurs externes — jamais un auteur ou un autre pôle.
    listReadingCandidates().then((u) => {
      setUsers(u);
      if (selectId) setReaderId(selectId);
      else if (u[0] && !readerId) setReaderId(u[0].id);
    });

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createExternal() {
    if (creating) return;
    if (!ext.username.trim() || !ext.email.trim() || !ext.password) {
      onError("Relecteur externe : identifiant, e-mail et mot de passe sont requis.");
      return;
    }
    setCreating(true);
    try {
      const created = await createExternalReviewer({ username: ext.username.trim(), email: ext.email.trim(), password: ext.password });
      await reload(created.id);
      setShowExternal(false);
      setExt({ username: "", email: "", password: "" });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Création du relecteur externe impossible.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {users.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
          Aucun relecteur disponible. Créez un relecteur externe ci-dessous, ou attribuez un rôle éditorial (correcteur,
          comité de lecture…) à un compte dans « Utilisateurs & rôles ».
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!readerId) return;
            assignReader(manuscriptId, readerId, new Date(dueAt).toISOString())
              .then(onAssigned)
              .catch((err) => onError(err instanceof Error ? err.message : "Affectation impossible."));
          }}
          style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <label style={{ fontSize: 12 }}>
            Lecteur
            <select value={readerId} onChange={(e) => setReaderId(e.target.value)} style={{ display: "block", padding: 6 }}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}{u.external ? " · externe" : ""}
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
      )}

      {/* Relecteur externe : compte dédié à accès limité (espace relecteur). */}
      <div style={{ marginTop: 10 }}>
        {!showExternal ? (
          <button
            onClick={() => setShowExternal(true)}
            style={{ background: "none", border: "none", color: "var(--eclosion, #d9b21a)", cursor: "pointer", fontSize: 12.5, padding: 0, textDecoration: "underline" }}
          >
            + Relecteur externe (compte dédié)
          </button>
        ) : (
          <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 8, maxWidth: 420 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>Nouveau relecteur externe</div>
            <input value={ext.username} onChange={(e) => setExt((f) => ({ ...f, username: e.target.value }))} placeholder="Identifiant (ex. j.dupont.ext)" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={extInp} />
            <input type="email" value={ext.email} onChange={(e) => setExt((f) => ({ ...f, email: e.target.value }))} placeholder="E-mail" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={extInp} />
            <input type="text" value={ext.password} onChange={(e) => setExt((f) => ({ ...f, password: e.target.value }))} placeholder="Mot de passe (min. 8 car., une majuscule, un chiffre)" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={extInp} />
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: 0 }}>Le relecteur reçoit un compte à accès limité (espace relecteur) pour faire ses lectures. Communiquez-lui l'identifiant et le mot de passe.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowExternal(false)} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
              <button onClick={createExternal} disabled={creating} style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Créer le relecteur</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const extInp: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13.5, boxSizing: "border-box", width: "100%" };

const DECISION_LABELS: Record<string, string> = {
  acceptation: "Acceptation",
  acceptation_conditions: "Acceptation sous conditions",
  revision: "Révision demandée (nouvelle soumission possible)",
  attente: "Mise en attente",
  refus: "Refus",
  refus_resoumission: "Refus avec possibilité de nouvelle soumission",
};

function AcceptanceConditionsPanel({
  manuscriptId,
  canManage,
  confirm,
  onError,
}: {
  manuscriptId: string;
  canManage: boolean;
  confirm: (opts: { title: string; message: string; detail?: string; confirmLabel?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<AcceptanceConditions | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setData(await getAcceptanceConditions(manuscriptId));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec du chargement des conditions.");
    }
  };
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  // N'apparaît que pour une acceptation sous conditions (ou s'il reste des
  // conditions tracées) : aucune pollution pour les autres décisions.
  if (!data || (!data.conditional && data.total === 0)) return null;

  const add = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      await addAcceptanceCondition(manuscriptId, label);
      setNewLabel("");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec de l'ajout.");
    } finally {
      setBusy(false);
    }
  };
  const lift = async (id: string, label: string) => {
    const ok = await confirm({ title: "Lever la condition", message: `Confirmer que la condition est remplie ?`, detail: label, confirmLabel: "Lever la condition" });
    if (!ok) return;
    try {
      await liftAcceptanceCondition(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec.");
    }
  };
  const reopen = async (id: string) => {
    try {
      await reopenAcceptanceCondition(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec.");
    }
  };
  const remove = async (id: string, label: string) => {
    const ok = await confirm({ title: "Retirer la condition", message: "Retirer cette condition de la liste ?", detail: label, tone: "danger", confirmLabel: "Retirer" });
    if (!ok) return;
    try {
      await deleteAcceptanceCondition(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Échec.");
    }
  };

  const allLifted = data.remaining === 0 && data.total > 0;
  return (
    <div style={{ background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 8, padding: "10px 13px", fontSize: 12.5, color: "var(--ink)", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <strong>Acceptation sous conditions — conditions à lever</strong>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 999,
            background: allLifted ? "rgba(200,154,27,0.15)" : data.remaining > 0 ? "rgba(196,102,31,0.15)" : "transparent",
            color: allLifted ? "var(--eclosion)" : data.remaining > 0 ? "#C4661F" : "var(--muted)",
          }}
        >
          {data.total === 0 ? "aucune condition" : allLifted ? "toutes levées" : `${data.remaining} à lever / ${data.total}`}
        </span>
      </div>
      {data.remaining > 0 && (
        <p style={{ margin: "0 0 8px", color: "#C4661F", fontSize: 11.5 }}>
          Le manuscrit ne pourra pas entrer en mise en page tant que toutes les conditions ne sont pas levées.
        </p>
      )}
      {data.total === 0 ? (
        <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 11.5 }}>Aucune condition listée. Ajoutez celles posées par le comité pour en assurer le suivi.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((c) => (
            <li key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 8px", background: "var(--surface, #fff)", border: "1px solid var(--line)", borderRadius: 6 }}>
              <span style={{ fontSize: 14, lineHeight: "18px" }}>{c.lifted ? "✅" : "⏳"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ textDecoration: c.lifted ? "line-through" : "none", opacity: c.lifted ? 0.7 : 1 }}>{c.label}</div>
                {c.lifted && (
                  <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                    Levée{c.lifted_by ? ` par ${c.lifted_by}` : ""}{c.lifted_at ? ` le ${new Date(c.lifted_at).toLocaleDateString("fr-FR")}` : ""}
                  </div>
                )}
              </div>
              {canManage && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {c.lifted ? (
                    <button type="button" onClick={() => reopen(c.id)} style={smallBtnStyle}>Rouvrir</button>
                  ) : (
                    <button type="button" onClick={() => lift(c.id, c.label)} style={{ ...smallBtnStyle, borderColor: "var(--eclosion)", color: "var(--eclosion)" }}>Lever</button>
                  )}
                  <button type="button" onClick={() => remove(c.id, c.label)} style={{ ...smallBtnStyle, color: "#C24B3A", borderColor: "#C24B3A" }}>Retirer</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && data.conditional && (
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Ajouter une condition…"
            style={{ flex: 1, padding: "6px 8px", fontSize: 12, border: "1px solid var(--line)", borderRadius: 6 }}
          />
          <button type="button" onClick={add} disabled={busy || !newLabel.trim()} style={{ ...smallBtnStyle, borderColor: "var(--eclosion)", color: "var(--eclosion)" }}>Ajouter</button>
        </div>
      )}
    </div>
  );
}

const smallBtnStyle: CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "transparent",
  cursor: "pointer",
  color: "var(--ink)",
};

// Lettre officielle de décision, (ré)imprimable à l'en-tête de la maison une fois
// la décision prise. Se masque tant qu'aucune lettre n'existe pour le dossier.
function DecisionLetterCard({ manuscriptId }: { manuscriptId: string }) {
  const [letter, setLetter] = useState<Awaited<ReturnType<typeof getManuscriptDecisionLetter>> | null>(null);
  const [cachet, setCachet] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getManuscriptDecisionLetter(manuscriptId)
      .then((l) => { if (alive) setLetter(l); })
      .catch(() => { if (alive) setLetter(null); });
    getBranding().then((b) => { if (alive) setCachet(b.cachet_editoriale); }).catch(() => {});
    return () => { alive = false; };
  }, [manuscriptId]);

  if (!letter) return null;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", marginBottom: 12, background: "var(--paper, #faf8f2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Lettre officielle à l'auteur — {DECISION_LABELS[letter.decision] ?? letter.decision}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {letter.layout.objet}
            {letter.notified_to ? ` · envoyée à ${letter.notified_to}` : " · non envoyée par e-mail (imprimez et remettez la lettre)"}
          </div>
        </div>
        <DocPrintMenu label="Imprimer la lettre" onPrint={(o) => printEditorialDecisionLetter(letter.layout, o, cachet)} />
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0" }}>
        En-tête de la maison ; le bloc « Pour Éclosion Édition » (signature, cachet, nom du responsable) est à remplir à la main après impression. Choisissez « papier à en-tête intégré » ou « vierge » pour imprimer sur votre papier officiel.
      </p>
    </div>
  );
}

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
  const [decision, setDecision] = useState<"acceptation" | "acceptation_conditions" | "revision" | "attente" | "refus" | "refus_resoumission">("acceptation");
  const [motivation, setMotivation] = useState("");
  // Éléments COMMUNICABLES à l'auteur (la lettre n'en extrait que ceux-ci) :
  // points essentiels retenus + message complémentaire de la Direction.
  const [pointsText, setPointsText] = useState("");
  const [authorMessage, setAuthorMessage] = useState("");

  // Décisions qui déclenchent une lettre à l'auteur (toutes sauf « mise en attente »).
  const LETTER_DECISIONS = ["acceptation", "acceptation_conditions", "revision", "refus", "refus_resoumission"];
  // Décisions terminales (le dossier quitte l'étape décision) : acceptations →
  // planification ; refus / refus-resoumission → archivage. Révision et attente
  // laissent le dossier ouvert (en attente d'une version révisée).
  const TERMINAL = ["acceptation", "acceptation_conditions", "refus", "refus_resoumission"];
  // Décisions pour lesquelles on saisit des « points communicables » (conditions /
  // axes de révision / motifs) — pas l'acceptation simple ni le refus sec.
  const showPoints = ["acceptation_conditions", "revision", "refus_resoumission"].includes(decision);
  const pointsLabel =
    decision === "revision"
      ? "Axes de révision communiqués à l'auteur (un par ligne)"
      : decision === "refus_resoumission"
        ? "Motifs communiqués à l'auteur (un par ligne)"
        : "Conditions communiquées à l'auteur (une par ligne)";

  // Aperçu / impression de la lettre POUR LA DÉCISION EN COURS de sélection
  // (avant enregistrement) : la lettre correspond exactement à la décision choisie.
  async function printPreview(opts: PrintOpts) {
    const points = showPoints ? pointsText.split("\n").map((c) => c.trim()).filter((c) => c.length > 0) : [];
    try {
      const [res, brand] = await Promise.all([
        previewDecisionLetter(manuscriptId, {
          decision,
          author_message: authorMessage.trim() || undefined,
          author_points: points.length ? points : undefined,
        }),
        getBranding().catch(() => null),
      ]);
      printEditorialDecisionLetter(res.layout, opts, brand?.cachet_editoriale ?? null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Aperçu de la lettre impossible.");
    }
  }

  async function submit() {
    const points = showPoints ? pointsText.split("\n").map((c) => c.trim()).filter((c) => c.length > 0) : [];
    // Pour l'acceptation sous conditions, les points servent aussi de conditions
    // à lever (bloquantes avant la mise en page).
    const conditions = decision === "acceptation_conditions" ? points : [];
    const terminal = TERMINAL.includes(decision);
    const ok = await confirm({
      title: "Décision éditoriale",
      message: `Enregistrer la décision « ${DECISION_LABELS[decision]} » ?`,
      detail: terminal
        ? ["refus", "refus_resoumission"].includes(decision)
          ? "Le dossier est clôturé (archivage)." + (decision === "refus_resoumission" ? " Une nouvelle version repartira comme un nouveau dossier." : "")
          : decision === "acceptation_conditions"
            ? `Le manuscrit passe à la planification.${conditions.length ? ` ${conditions.length} condition(s) à lever avant la mise en page.` : ""}`
            : "Le manuscrit passe à la planification."
        : "Le dossier reste ouvert à l'étape de décision (en attente d'une version révisée).",
      tone: ["refus", "refus_resoumission"].includes(decision) ? "danger" : "default",
      confirmLabel: "Enregistrer la décision",
    });
    if (!ok) return;
    try {
      const res = await submitEditorialDecision(manuscriptId, decision, motivation, conditions, {
        author_message: authorMessage,
        author_points: points,
      });
      const notified = (res as { authorNotifiedTo?: string | null } | undefined)?.authorNotifiedTo;
      onDecided(
        `Décision enregistrée : ${DECISION_LABELS[decision]}.` +
          (LETTER_DECISIONS.includes(decision)
            ? notified
              ? ` Une lettre officielle a été adressée à l'auteur (${notified}).`
              : " ⚠ Aucune adresse e-mail auteur : imprimez la lettre et répondez manuellement."
            : ""),
      );
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
          <option value="revision">Révision demandée (nouvelle soumission possible)</option>
          <option value="attente">Mise en attente</option>
          <option value="refus">Refus</option>
          <option value="refus_resoumission">Refus avec possibilité de nouvelle soumission</option>
        </select>
      </label>
      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Motivation interne (obligatoire — dossier, jamais reproduite dans la lettre)
        <textarea
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          required
          rows={3}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4, fontFamily: "inherit", fontSize: 13 }}
        />
      </label>

      {/* Éléments communicables à l'auteur : la lettre officielle n'extrait que
          ceux-ci (jamais le rapport du comité ni la motivation interne). */}
      {LETTER_DECISIONS.includes(decision) && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: "var(--paper, #faf8f2)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>À communiquer à l'auteur (lettre officielle)</div>
          {showPoints && (
            <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
              {pointsLabel}
              <textarea
                value={pointsText}
                onChange={(e) => setPointsText(e.target.value)}
                rows={3}
                placeholder={"Ex. : Revoir la structure du chapitre 4\nÉtoffer la partie méthodologique"}
                style={{ display: "block", width: "100%", padding: 8, marginTop: 4, fontFamily: "inherit", fontSize: 13 }}
              />
              {decision === "acceptation_conditions" && (
                <span style={{ display: "block", marginTop: 4, color: "var(--muted, #667)", fontSize: 11 }}>
                  Ces points sont aussi enregistrés comme conditions à lever avant la mise en page.
                </span>
              )}
            </label>
          )}
          <label style={{ fontSize: 12, display: "block" }}>
            Message complémentaire de la Direction (facultatif)
            <textarea
              value={authorMessage}
              onChange={(e) => setAuthorMessage(e.target.value)}
              rows={2}
              placeholder="Phrase d'accompagnement, précision, encouragement…"
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4, fontFamily: "inherit", fontSize: 13 }}
            />
          </label>
          <span style={{ display: "block", marginTop: 6, color: "var(--muted, #667)", fontSize: 11 }}>
            La lettre reprend un modèle institutionnel sobre + ces éléments. Elle se termine par « Pour Éclosion Édition » avec une zone de signature et de cachet (à signer après impression).
          </span>
          {/* Aperçu aligné sur la décision EN COURS (avant enregistrement). */}
          <div style={{ marginTop: 10 }}>
            <DocPrintMenu label={`Aperçu de la lettre « ${DECISION_LABELS[decision]} »`} onPrint={printPreview} />
            <span style={{ display: "block", marginTop: 4, color: "var(--muted, #667)", fontSize: 11 }}>
              Vérifiez la lettre AVANT d'enregistrer : elle correspond exactement à la décision sélectionnée.
            </span>
          </div>
        </div>
      )}
      <ActionButton onClick={() => {}}>Enregistrer la décision</ActionButton>
    </form>
  );
}

const STEP_ACTION_LABELS: Record<string, string> = {
  CONTRACTUALISATION: "Valider la contractualisation",
  PLANIFICATION: "Valider la planification",
  CORRECTION: "Valider la correction",
  EXPERTISE: "Valider l'expertise scientifique",
  REECRITURE: "Valider la réécriture",
  MISE_EN_PAGE: "Valider la mise en page",
  INFOGRAPHIE: "Valider l'infographie",
  ATTRIBUTION_REFERENCES: "Valider l'attribution des références",
  VALIDATION_BAT: "Valider le BAT",
  IMPRESSION: "Valider l'impression",
  CONTROLE_QUALITE_IMPRESSION: "Valider le contrôle qualité",
  ENTREE_STOCK: "Valider l'entrée en stock",
  COMMERCIALISATION: "Valider la commercialisation",
  VENTE_LIVRAISON: "Valider la vente et livraison",
  SUIVI_POST_PUBLICATION: "Valider le suivi post-publication",
};

// Toutes les étapes que le responsable fait avancer par une simple validation
// depuis la fiche (le backend garde ses prérequis : fiche technique, BAT signé,
// bon de commande, prix public… et renvoie un message clair si l'un manque).
// Les étapes à flux dédié (réception, vérif. admin, comité, décision) ont leur
// propre bloc d'action ; l'archivage est terminal.
const GENERIC_VALIDATION_STEPS = [
  "PLANIFICATION",
  "CORRECTION",
  "EXPERTISE",
  "REECRITURE",
  "MISE_EN_PAGE",
  "INFOGRAPHIE",
  "ATTRIBUTION_REFERENCES",
  "VALIDATION_BAT",
  "CONTRACTUALISATION",
  "IMPRESSION",
  "CONTROLE_QUALITE_IMPRESSION",
  "ENTREE_STOCK",
  "COMMERCIALISATION",
  "VENTE_LIVRAISON",
  "SUIVI_POST_PUBLICATION",
];

// Dépôt libre de fichiers / scans à l'étape courante (demande opérateur du
// 19/08/2026) : l'acteur de l'étape joint une fiche technique, un justificatif,
// un document scanné… Chaque pièce est versionnée et téléchargeable.
function fmtSize(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}
function StepAttachments({
  manuscriptId,
  stepLabel,
  canDeposit,
  onError,
}: {
  manuscriptId: string;
  stepLabel: string;
  canDeposit: boolean;
  onError: (m: string) => void;
}) {
  const [files, setFiles] = useState<StepAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => listStepAttachments(manuscriptId).then(setFiles).catch(() => setFiles([]));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await uploadStepAttachment(manuscriptId, file, stepLabel);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Dépôt impossible.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeFile(docId: string) {
    if (!window.confirm("Retirer ce fichier déposé par erreur ? Les autres fichiers de l'étape sont conservés.")) return;
    setBusy(true);
    try {
      await deleteStepDocument(manuscriptId, docId);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Retrait impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: "10px 13px", marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>📎 Documents de l'étape (dépôt de fichiers / scans)</div>
      {files.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>Aucune pièce déposée pour l'instant.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px" }}>
          {files.map((f) => (
            <li key={f.id} style={{ fontSize: 12.5, padding: "3px 0", borderTop: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {f.version_id ? (
                <a href={stepAttachmentDownloadUrl(manuscriptId, f.version_id)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark, #9a7a12)", textDecoration: "underline", fontWeight: 600 }}>
                  📄 {f.title}
                </a>
              ) : (
                <span>{f.title}</span>
              )}
              <span style={{ color: "var(--muted)" }}>{fmtSize(f.file_size)} · {new Date(f.created_at).toLocaleDateString("fr-FR")}</span>
              {f.can_correct && (
                <button type="button" onClick={() => removeFile(f.id)} disabled={busy} style={{ color: "var(--alert)", background: "none", border: "none", fontSize: 12, fontWeight: 600, cursor: busy ? "default" : "pointer", textDecoration: "underline", padding: 0 }}>
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canDeposit && (
        <div>
          <input ref={inputRef} type="file" onChange={onPick} disabled={busy} style={{ display: "none" }} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            style={{ background: "#fff", color: "var(--eclosion-dark, #9a7a12)", border: "1px solid var(--eclosion)", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            {busy ? "Envoi…" : "＋ Déposer un fichier / scan"}
          </button>
        </div>
      )}
    </div>
  );
}

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
  onValidated: (status: string | null, opts?: { confided?: boolean }) => void;
  onError: (message: string) => void;
}) {
  const [requiresRewrite, setRequiresRewrite] = useState(false);
  const [assignees, setAssignees] = useState<NextAssignee[]>([]);
  const [nextLabel, setNextLabel] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  // Étape « à option » (Expertise, Réécriture, Projet) : décision Réaliser/Passer.
  const [optMeta, setOptMeta] = useState<OptionalStepMeta | null>(null);
  const [decision, setDecision] = useState<"realise" | "passe">("realise");
  const [skipReason, setSkipReason] = useState("");
  const [realization, setRealization] = useState<Record<string, string>>({});

  const label = STEP_ACTION_LABELS[stepCode] ?? "Valider cette étape";

  // Qui pourra prendre le dossier à l'étape SUIVANTE (maquettiste, infographe,
  // correcteur…) : on propose de le confier nommément à l'un d'eux.
  useEffect(() => {
    let alive = true;
    getNextAssignees(manuscriptId)
      .then((r) => { if (alive) { setAssignees(r.assignees); setNextLabel(r.next_step?.label ?? null); } })
      .catch(() => { if (alive) { setAssignees([]); setNextLabel(null); } });
    getOptionalStep(manuscriptId, stepCode)
      .then((m) => { if (alive) { setOptMeta(m); if (m.is_optional && m.mode === "obligatoire") setDecision("realise"); } })
      .catch(() => { if (alive) setOptMeta(null); });
    return () => { alive = false; };
  }, [manuscriptId, stepCode]);

  const isOptional = optMeta?.is_optional === true;
  const canSkip = optMeta?.is_optional === true && optMeta.mode === "facultative";

  async function handleValidate() {
    const chosen = assignees.find((a) => a.id === assigneeId);
    const passing = isOptional && decision === "passe";
    const ok = await confirm({
      title: passing ? "Passer l'étape" : "Valider l'étape",
      message: passing ? `Passer l'étape « ${optMeta && optMeta.is_optional ? optMeta.label : ""} » ?` : `${label} ?`,
      detail: passing
        ? "L'étape sera marquée « passée » (avec votre motif) et le manuscrit avancera à l'étape suivante."
        : chosen
          ? `Le manuscrit passera à l'étape suivante et sera confié à ${chosen.username}.`
          : "Le manuscrit passera à l'étape suivante.",
      confirmLabel: passing ? "Passer l'étape" : label,
    });
    if (!ok) return;
    try {
      const result = await validateStep(manuscriptId, stepCode, {
        ...(stepCode === "CORRECTION" ? { requires_rewrite: requiresRewrite } : {}),
        ...(assigneeId ? { assignee_id: assigneeId } : {}),
        ...(isOptional
          ? passing
            ? { step_decision: "passe", skip_reason: skipReason }
            : { step_decision: "realise", realization }
          : {}),
      });
      // Confié à un tiers = une personne précise a été désignée pour l'étape
      // suivante → on n'enchaîne pas automatiquement côté validateur.
      onValidated(result.status, { confided: Boolean(assigneeId) });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la validation.");
    }
  }

  return (
    <div>
      {optMeta?.is_optional && (
        <div style={{ background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 8, padding: "11px 13px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Étape « {optMeta.label} » —{" "}
            <span style={{ color: optMeta.mode === "obligatoire" ? "var(--eclosion-retard, #C4661F)" : "var(--muted)" }}>
              {optMeta.mode === "obligatoire" ? "obligatoire" : "facultative"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 16, margin: "8px 0", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="radio" name={`dec-${stepCode}`} checked={decision === "realise"} onChange={() => setDecision("realise")} />
              Réaliser l'étape
            </label>
            {canSkip && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="radio" name={`dec-${stepCode}`} checked={decision === "passe"} onChange={() => setDecision("passe")} />
                Passer l'étape
              </label>
            )}
          </div>
          {decision === "realise" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {optMeta.fields.map((f) => (
                <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
                  <span style={{ color: "var(--muted)" }}>{f.label}{f.required ? " *" : ""}</span>
                  {f.type === "textarea" ? (
                    <textarea rows={2} value={realization[f.key] ?? ""} onChange={(e) => setRealization((r) => ({ ...r, [f.key]: e.target.value }))} style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, resize: "vertical" }} />
                  ) : f.type === "select" ? (
                    <select value={realization[f.key] ?? ""} onChange={(e) => setRealization((r) => ({ ...r, [f.key]: e.target.value }))} style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 }}>
                      <option value="">— choisir —</option>
                      {(f.options ?? []).map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                  ) : (
                    <input type={f.type === "number" ? "number" : "text"} value={realization[f.key] ?? ""} onChange={(e) => setRealization((r) => ({ ...r, [f.key]: e.target.value }))} style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 }} />
                  )}
                </label>
              ))}
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                Le fichier attendu (rapport, version, fiche…) se dépose dans le bloc « Livrable de l'étape » ci-dessus.
              </span>
            </div>
          ) : (
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>Motif du passage (obligatoire) *</span>
              <textarea rows={2} value={skipReason} onChange={(e) => setSkipReason(e.target.value)} style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, resize: "vertical" }} placeholder="Ex. : ouvrage non scientifique, pas de réécriture nécessaire…" />
            </label>
          )}
        </div>
      )}
      {stepCode === "CORRECTION" && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={requiresRewrite} onChange={(e) => setRequiresRewrite(e.target.checked)} />
          Cette version nécessite une réécriture avant de poursuivre
        </label>
      )}
      {assignees.length > 0 && (
        <label style={{ display: "block", fontSize: 13, marginBottom: 10 }}>
          <span style={{ display: "block", color: "var(--muted)", marginBottom: 4 }}>
            Transmettre à{nextLabel ? ` (${nextLabel})` : ""} :
          </span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={{ padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, minWidth: 240 }}>
            <option value="">Tout le service (au choix)</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>{a.username}{a.role ? ` — ${a.role}` : ""}</option>
            ))}
          </select>
          <span style={{ display: "block", color: "var(--muted)", fontSize: 11.5, marginTop: 3 }}>
            Sans choix, tout le service est notifié. En désignant une personne, elle seule est prévenue et devient responsable de l'étape.
          </span>
        </label>
      )}
      <ActionButton onClick={handleValidate}>{isOptional && decision === "passe" ? "Passer l'étape" : label}</ActionButton>
    </div>
  );
}

// Édition de la fiche d'enregistrement (correction d'erreur/oubli) — ouvrage +
// identité complète de l'auteur + frais de dépôt + délai de réponse. Motif
// obligatoire ; verrouillée dès contrat signé (bouton d'ouverture désactivé).
const FICHE_INPUT: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 };
function FField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
      <span style={{ display: "block", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
function d10(v?: string | null): string {
  return v ? String(v).slice(0, 10) : "";
}
function EditFicheModal({
  manuscript,
  onClose,
  onSaved,
  onError,
}: {
  manuscript: ManuscriptDetailData;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const author = manuscript.workContributors.find((c) => c.role === "author")?.partner ?? manuscript.workContributors[0]?.partner;
  const [genres, setGenres] = useState<Genre[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  // Erreur affichée DANS le modal (l'ancienne bannière parente était masquée par
  // le voile du modal — le bouton semblait « ne pas réagir »).
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: manuscript.title ?? "",
    subtitle: manuscript.subtitle ?? "",
    language: manuscript.language ?? "fr",
    genre_id: manuscript.genreId ?? manuscript.genre?.id ?? "",
    owner_id: manuscript.owner.id,
    evaluation_fee_choice: (manuscript.evaluationFeeChoice ?? "non_defini") as "non_defini" | "a_payer" | "sans_frais",
    author_response_delay_days: manuscript.authorResponseDelayDays != null ? String(manuscript.authorResponseDelayDays) : "",
  });
  const [a, setA] = useState({
    first_name: author?.firstName ?? "",
    last_name: author?.lastName ?? "",
    pen_name: author?.penName ?? "",
    nationality: author?.nationality ?? "",
    birth_date: d10(author?.birthDate),
    birth_place: author?.birthPlace ?? "",
    profession: author?.profession ?? "",
    id_type: author?.idType ?? "",
    id_number: author?.idNumber ?? "",
    id_issued_date: d10(author?.idIssuedDate),
    id_issued_place: author?.idIssuedPlace ?? "",
    niu: author?.niu ?? "",
    country: author?.country ?? "",
    city: author?.city ?? "",
    quartier: author?.quartier ?? "",
    address: author?.address ?? "",
    postal_box: author?.postalBox ?? "",
    email: author?.email ?? "",
    phone: author?.phone ?? "",
    whatsapp: author?.whatsapp ?? "",
    other_contact: author?.otherContact ?? "",
  });
  const set = (k: keyof typeof a, v: string) => setA((cur) => ({ ...cur, [k]: v }));
  const setF = (k: keyof typeof form, v: string) => setForm((cur) => ({ ...cur, [k]: v }));

  useEffect(() => {
    listGenres().then(setGenres).catch(() => {});
    listUsers().then(setUsers).catch(() => {});
  }, []);

  async function submit() {
    setLocalErr(null);
    if (!a.first_name.trim() || !a.last_name.trim()) {
      setLocalErr("Le nom et le prénom de l'auteur sont obligatoires.");
      return;
    }
    if (!form.title.trim()) {
      setLocalErr("Le titre de l'ouvrage est obligatoire.");
      return;
    }
    if (reason.trim().length < 3) {
      setLocalErr("Indiquez le motif de la correction (au moins 3 caractères) dans le champ ci-dessous.");
      return;
    }
    setSaving(true);
    try {
      // Dates : vide → non transmis ; sinon ISO (le serveur efface avec \"\").
      const authorPayload: Record<string, string> = { first_name: a.first_name.trim(), last_name: a.last_name.trim() };
      for (const [k, v] of Object.entries(a)) {
        if (k === "first_name" || k === "last_name") continue;
        if (k === "birth_date" || k === "id_issued_date") {
          authorPayload[k] = v ? new Date(v).toISOString() : "";
        } else {
          authorPayload[k] = v;
        }
      }
      await updateManuscriptRegistration(manuscript.id, {
        modification_reason: reason.trim(),
        title: form.title.trim() || undefined,
        subtitle: form.subtitle,
        language: form.language.trim() || undefined,
        genre_id: form.genre_id || undefined,
        owner_id: form.owner_id || undefined,
        evaluation_fee_choice: form.evaluation_fee_choice,
        author_response_delay_days: form.author_response_delay_days.trim() ? Number(form.author_response_delay_days) : null,
        author: authorPayload as unknown as Parameters<typeof updateManuscriptRegistration>[1]["author"],
      });
      onSaved();
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,.55)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card, #fff)", borderRadius: 12, padding: 20, width: "min(720px, 100%)", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <h2 style={{ fontFamily: "var(--font-title)", fontSize: 18, margin: "0 0 4px" }}>Modifier la fiche — {manuscript.manuscriptNumber}</h2>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 14px" }}>
          Corrigez une erreur ou complétez un oubli. Chaque modification est tracée au journal avec son motif. La fiche se verrouille dès la signature du contrat.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1", fontWeight: 700, fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", marginTop: 2 }}>Ouvrage</div>
          <FField label="Titre *"><input style={FICHE_INPUT} value={form.title} onChange={(e) => setF("title", e.target.value)} /></FField>
          <FField label="Sous-titre"><input style={FICHE_INPUT} value={form.subtitle} onChange={(e) => setF("subtitle", e.target.value)} /></FField>
          <FField label="Langue *"><input style={FICHE_INPUT} value={form.language} onChange={(e) => setF("language", e.target.value)} /></FField>
          <FField label="Domaine"><select style={FICHE_INPUT} value={form.genre_id} onChange={(e) => setF("genre_id", e.target.value)}>{genres.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></FField>
          <FField label="Responsable du dossier"><select style={FICHE_INPUT} value={form.owner_id} onChange={(e) => setF("owner_id", e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select></FField>

          <div style={{ gridColumn: "1 / -1", fontWeight: 700, fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", marginTop: 8 }}>Auteur — état civil</div>
          <FField label="Prénom *"><input style={FICHE_INPUT} value={a.first_name} onChange={(e) => set("first_name", e.target.value)} /></FField>
          <FField label="Nom *"><input style={FICHE_INPUT} value={a.last_name} onChange={(e) => set("last_name", e.target.value)} /></FField>
          <FField label="Pseudonyme"><input style={FICHE_INPUT} value={a.pen_name} onChange={(e) => set("pen_name", e.target.value)} /></FField>
          <FField label="Nationalité"><input style={FICHE_INPUT} value={a.nationality} onChange={(e) => set("nationality", e.target.value)} /></FField>
          <FField label="Date de naissance"><input type="date" style={FICHE_INPUT} value={a.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></FField>
          <FField label="Lieu de naissance"><input style={FICHE_INPUT} value={a.birth_place} onChange={(e) => set("birth_place", e.target.value)} /></FField>
          <FField label="Travail / emploi"><input style={FICHE_INPUT} value={a.profession} onChange={(e) => set("profession", e.target.value)} /></FField>

          <div style={{ gridColumn: "1 / -1", fontWeight: 700, fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", marginTop: 8 }}>Auteur — pièce d'identité</div>
          <FField label="Type de pièce">
            <select style={FICHE_INPUT} value={a.id_type} onChange={(e) => set("id_type", e.target.value)}>
              <option value="">—</option>
              <option value="CNI">Carte nationale d'identité (CNI)</option>
              <option value="Passeport">Passeport</option>
              <option value="Carte de séjour">Carte de séjour</option>
              <option value="Permis de conduire">Permis de conduire</option>
              <option value="Récépissé">Récépissé</option>
              <option value="Autre">Autre</option>
            </select>
          </FField>
          <FField label="Numéro de la pièce"><input style={FICHE_INPUT} value={a.id_number} onChange={(e) => set("id_number", e.target.value)} /></FField>
          <FField label="Délivrée le"><input type="date" style={FICHE_INPUT} value={a.id_issued_date} onChange={(e) => set("id_issued_date", e.target.value)} /></FField>
          <FField label="Délivrée à"><input style={FICHE_INPUT} value={a.id_issued_place} onChange={(e) => set("id_issued_place", e.target.value)} /></FField>
          <FField label="NIU (identifiant fiscal)"><input style={FICHE_INPUT} value={a.niu} onChange={(e) => set("niu", e.target.value)} /></FField>

          <div style={{ gridColumn: "1 / -1", fontWeight: 700, fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", marginTop: 8 }}>Auteur — coordonnées & résidence</div>
          <FField label="Pays"><input style={FICHE_INPUT} value={a.country} onChange={(e) => set("country", e.target.value)} /></FField>
          <FField label="Ville"><input style={FICHE_INPUT} value={a.city} onChange={(e) => set("city", e.target.value)} /></FField>
          <FField label="Quartier"><input style={FICHE_INPUT} value={a.quartier} onChange={(e) => set("quartier", e.target.value)} /></FField>
          <FField label="Résidence / adresse"><input style={FICHE_INPUT} value={a.address} onChange={(e) => set("address", e.target.value)} /></FField>
          <FField label="Boîte postale (BP)"><input style={FICHE_INPUT} value={a.postal_box} onChange={(e) => set("postal_box", e.target.value)} /></FField>
          <FField label="E-mail"><input type="email" style={FICHE_INPUT} value={a.email} onChange={(e) => set("email", e.target.value)} /></FField>
          <FField label="Téléphone"><input style={FICHE_INPUT} value={a.phone} onChange={(e) => set("phone", e.target.value)} /></FField>
          <FField label="WhatsApp"><input style={FICHE_INPUT} value={a.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></FField>
          <FField label="Autre moyen de contact"><input style={FICHE_INPUT} value={a.other_contact} onChange={(e) => set("other_contact", e.target.value)} /></FField>

          <div style={{ gridColumn: "1 / -1", fontWeight: 700, fontSize: 13, color: "var(--eclosion-dark, #9a7a12)", marginTop: 8 }}>Traitement éditorial</div>
          <FField label="Frais de dépôt pour évaluation">
            <select style={FICHE_INPUT} value={form.evaluation_fee_choice} onChange={(e) => setF("evaluation_fee_choice", e.target.value)}>
              <option value="non_defini">À décider plus tard</option>
              <option value="a_payer">À payer par l'auteur</option>
              <option value="sans_frais">Sans frais</option>
            </select>
          </FField>
          <FField label="Délai de réponse à l'auteur (jours)"><input type="number" min={0} style={FICHE_INPUT} value={form.author_response_delay_days} onChange={(e) => setF("author_response_delay_days", e.target.value)} /></FField>
        </div>

        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <FField label="Motif de la correction * (tracé au journal)">
            <input style={FICHE_INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. Nom de l'auteur mal orthographié à la saisie." />
          </FField>
        </div>

        {localErr && (
          <div style={{ marginTop: 12, background: "var(--alert-soft, #f8e3dc)", color: "var(--alert, #C4661F)", border: "1px solid var(--alert, #C4661F)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
            {localErr}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={barBtn()}>Annuler</button>
          {/* Le bouton reste cliquable : la validation renvoie un message clair DANS
              le modal (avant, il était désactivé/silencieux → « ne réagit pas »). */}
          <button onClick={submit} disabled={saving} style={{ ...barBtn("primary"), opacity: saving ? 0.6 : 1 }}>
            {saving ? "Enregistrement…" : "Enregistrer les corrections"}
          </button>
        </div>
      </div>
    </div>
  );
}
