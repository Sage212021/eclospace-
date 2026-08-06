import { useEffect, useState } from "react";
import {
  assignReader,
  closeReadingCommittee,
  createExternalReviewer,
  deleteManuscript,
  getManuscript,
  getManuscriptSourceFileMeta,
  manuscriptSourceFileUrl,
  uploadManuscriptSourceFile,
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
  validateStep,
  type EditorialSegment,
  type Manuscript,
  type ReadingCandidate,
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
  contracts: "Contrats & droits",
  production: "Maquette & production",
  isbn: "ISBN & dépôt légal",
  bat: "BAT & contrôle qualité",
  printing: "Impression",
  authors: "Messagerie des auteurs",
};

type ManuscriptWithExtras = Manuscript & {
  workContributors: { partner: { id: string; firstName: string; lastName: string; penName: string | null } }[];
  owner: UserSummary;
};

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
  const focus = originKey ? FOCUS_BY_ORIGIN[originKey] ?? null : null;
  const activeFocus = showAll ? null : focus;
  const show = (mod: string) => activeFocus === null || activeFocus === mod;

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
            🗑 Supprimer
          </button>
        )}
      </div>

      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>{manuscript.title}</h1>
      <p style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 12 }}>{manuscript.manuscriptNumber}</p>
      <p style={{ fontSize: 13 }}>
        Auteur : {manuscript.workContributors.map((c) => `${c.partner.firstName} ${c.partner.lastName}`).join(", ")} · Genre :{" "}
        {manuscript.genre?.label ?? "—"} · Responsable : {manuscript.owner.username}
      </p>

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

      {/* Bandeau de focalisation : indique qu'on ne voit que l'étape d'origine,
          et propose d'afficher toute la fiche. */}
      {focus && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginTop: 12 }}>
          <span style={{ color: "var(--ink)" }}>
            {activeFocus ? <>Vue centrée sur <strong>{FOCUS_LABELS[focus]}</strong> — seules les tâches de cette étape sont affichées.</> : <>Vous voyez <strong>toute la fiche</strong>.</>}
          </span>
          <button onClick={() => setShowAll((v) => !v)} style={{ marginLeft: "auto", background: "#fff", border: "1px solid var(--eclosion)", color: "var(--eclosion-dark, #8A6A12)", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
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

      {show("finance") && permissions.has("finance:consultation") && (
        <EditorialQuotesSection
          manuscriptId={manuscript.id}
          defaultPartnerId={manuscript.workContributors[0]?.partner.id ?? ""}
          canCreate={permissions.has("finance:saisie")}
          canValidate={permissions.has("finance:validation")}
          canAdmin={permissions.has("finance:administration")}
        />
      )}

      {show("correction") && manuscript.status.stepOrder >= PLANIFICATION_STEP_ORDER && permissions.has("tasks:consultation") && (
        <>
          <TasksSection manuscriptId={manuscript.id} canManage={permissions.has("tasks:saisie")} />
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
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--eclosion-dark, #8A6A12)", background: "var(--eclosion-soft)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
        Manuscrit (source)
      </span>
      {hasFile ? (
        <a href={manuscriptSourceFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600, fontSize: 13 }}>
          📄 Ouvrir le manuscrit déposé
        </a>
      ) : (
        <span style={{ color: "var(--muted)", fontSize: 13 }}>Aucun fichier manuscrit déposé pour le moment.</span>
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
  const [meta, setMeta] = useState<{ corrected_has_file: boolean; layout_has_file: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => getManuscriptLayoutMeta(manuscriptId).then(setMeta).catch(() => setMeta(null));
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
    color: dir === "in" ? "var(--eclosion-dark, #8A6A12)" : "#2E6B4F",
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
          <a href={manuscriptCorrectedFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📖 Ouvrir le manuscrit corrigé
          </a>
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
  const [meta, setMeta] = useState<{ layout_has_file: boolean; bat_has_file: boolean } | null>(null);
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

  const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 };
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>BAT — bon à tirer</div>
      <div style={row}>
        <span style={handoffTag("in")}>À vérifier</span>
        {meta?.layout_has_file ? (
          <a href={manuscriptLayoutFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📄 Ouvrir la maquette
          </a>
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
          <a href={manuscriptBatFileUrl(manuscriptId)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📄 Ouvrir le BAT signé
          </a>
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
    color: dir === "in" ? "var(--eclosion-dark, #8A6A12)" : "#2E6B4F",
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
            style={{ background: "none", border: "none", color: "var(--eclosion, #C89A1B)", cursor: "pointer", fontSize: 12.5, padding: 0, textDecoration: "underline" }}
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
