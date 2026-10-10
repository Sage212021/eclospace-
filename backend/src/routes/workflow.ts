import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Manuscript, TaskType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission, requireAuth } from "../lib/permissions.js";
import { missingRequiredCorrectionPhases, missingRequiredCoverPhases, correctionCycleState } from "../lib/correctionCycle.js";
import { closeCorrectionCycle, ensureOpenCorrectionCycle } from "../lib/correctionCycleEntity.js";
import { isDeliverableRequired, hasStepDeliverable, DELIVERABLE_LABELS } from "../lib/stepDeliverables.js";
import { vc1State } from "../lib/startingProof.js";
import { isOptionalDecisionStep, stepMode, missingRealizationFields, sanitizeRealizationData, OPTIONAL_STEP_LABELS, type OptionalStepCode } from "../lib/stepRealization.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyUsers, notifyRole } from "../lib/notify.js";

// Éligibilité à l'affectation nominative d'une étape. Par défaut, ce sont les
// personnes du SERVICE de l'étape (maquettistes → mise en page, etc.). Certaines
// étapes admettent un ENSEMBLE DE RÔLES plus large que leur seul service — ainsi
// la Correction éditoriale peut être confiée aux relecteurs (comité de lecture),
// à la direction éditoriale et à l'assistant éditorial, en plus des correcteurs
// (décision opérateur 17/09/2026). Un profil hors de cette liste (ex. infographe)
// ne peut jamais y être affecté.
const STEP_ASSIGNABLE_ROLES: Record<string, string[]> = {
  CORRECTION: ["CORRECTEUR", "MEMBRE_COMITE_LECTURE", "DIR_EDITORIAL", "ASSISTANT_EDITORIAL"],
  // Attribution des références (ISBN/dépôt légal) : le secrétariat, mais AUSSI
  // les maquettistes — dans les faits ils s'en chargent parfois (demande
  // opérateur 01/10/2026). Ils reçoivent le droit ISBN au seed pour pouvoir le
  // faire réellement une fois le dossier transmis.
  ATTRIBUTION_REFERENCES: ["ASSISTANT_EDITORIAL", "DIR_EDITORIAL", "MAQUETTISTE", "RESP_INFOGRAPHIE"],
};

// Filtre Prisma sur `userRoles` désignant les personnes affectables à cette
// étape ; null quand l'affectation nominative ne s'applique pas (pas de service
// ni de liste de rôles).
function assigneeRoleFilter(status: { code: string; departmentId: string | null }) {
  const roles = STEP_ASSIGNABLE_ROLES[status.code];
  if (roles) return { some: { revokedAt: null, role: { code: { in: roles } } } };
  if (status.departmentId) return { some: { revokedAt: null, role: { departmentId: status.departmentId } } };
  return null;
}

// Types de tâches de correction (parallèle de la boîte « Mes corrections »).
const CORRECTION_TASK_TYPE_CODES = ["correction", "correction_ortho", "correction_gramm", "correction_typo", "correction_syntaxe", "correction_style", "harmonisation", "verif_biblio", "coherence"] as unknown as TaskType[];

// Étapes qu'un opérateur AFFECTÉ (sans droit de validation large) peut clôturer
// lui-même : la correction par le correcteur, la mise en page par le maquettiste,
// l'infographie par l'infographe, l'attribution des références par le secrétariat.
const SELF_CLOSE_STEPS = new Set(["CORRECTION", "MISE_EN_PAGE", "INFOGRAPHIE", "ATTRIBUTION_REFERENCES"]);

// L'opérateur AFFECTÉ à l'étape courante : responsable de l'étape OU (pour la
// correction) porteur d'une tâche de correction assignée. Sert à l'autoriser à
// CLÔTURER lui-même son étape (correction → mise en page, mise en page →
// infographie).
async function isAssignedForStep(manuscriptId: string, statusId: string, userId: string, stepCode: string): Promise<boolean> {
  const step = await prisma.manuscriptStep.findUnique({
    where: { manuscriptId_statusId: { manuscriptId, statusId } },
    select: { responsibleId: true },
  });
  if (step?.responsibleId === userId) return true;
  if (stepCode === "CORRECTION") {
    const task = await prisma.task.findFirst({
      where: { manuscriptId, deletedAt: null, assigneeId: userId, type: { in: CORRECTION_TASK_TYPE_CODES } },
      select: { id: true },
    });
    return !!task;
  }
  return false;
}

// Permission « métier » de l'étape : qui peut la traiter quand le dossier n'est
// confié à PERSONNE (transmis « à tout le service »). Un exécutant du bon pôle
// peut alors prendre en charge et CLÔTURER lui-même le dossier non assigné —
// sinon un dossier « à tout le service » resterait bloqué sans validateur.
const STEP_SAISIE_PERM: Record<string, string> = {
  MISE_EN_PAGE: "production:saisie",
  INFOGRAPHIE: "production:saisie",
  ATTRIBUTION_REFERENCES: "isbn:saisie",
};

// Un utilisateur SANS « manuscripts:validation » peut-il clôturer cette étape ?
// Oui s'il y est affecté (ou porte une tâche de correction), OU si le dossier
// n'est confié à personne et qu'il est du métier de l'étape.
async function canSelfCloseStep(
  manuscriptId: string,
  statusId: string,
  user: { id: string; permissions: Set<string> },
  stepCode: string,
): Promise<boolean> {
  if (!SELF_CLOSE_STEPS.has(stepCode)) return false;
  if (await isAssignedForStep(manuscriptId, statusId, user.id, stepCode)) return true;
  const perm = STEP_SAISIE_PERM[stepCode];
  if (!perm || !user.permissions.has(perm)) return false;
  const step = await prisma.manuscriptStep.findUnique({
    where: { manuscriptId_statusId: { manuscriptId, statusId } },
    select: { responsibleId: true },
  });
  return !step || step.responsibleId == null; // dossier non assigné → l'exécutant du pôle peut le clôturer
}
import { checkMaquetteInfographieConvergence } from "../lib/productionConvergence.js";
import { computeIsbnCompleteness } from "../lib/isbnCompleteness.js";
import { myCorrectionIntegrations } from "../lib/correctionIntegrations.js";

// Étapes « à option » — Expertise, Réécriture, Projet (demande opérateur
// 20/08/2026). Le manuscrit S'ARRÊTE désormais à ces étapes : l'opérateur y
// choisit explicitement « Réaliser » ou « Passer » (selon le mode défini dans
// les Paramètres). Elles ne sont donc plus sautées automatiquement — le choix
// est tracé sur l'étape (realizationMode / skipReason / realizationData). Les
// anciens drapeaux requiresExpertise / requiresRewrite ne servent plus qu'à
// pré-remplir la suggestion « à réaliser » à l'écran.
function isStepRequired(_statusCode: string, _manuscript: Manuscript): boolean {
  return true;
}

async function findNextApplicableStatus(fromStepOrder: number, manuscript: Manuscript) {
  const candidates = await prisma.workflowStatus.findMany({
    where: { stepOrder: { gt: fromStepOrder } },
    orderBy: { stepOrder: "asc" },
  });
  return candidates.find((candidate) => !candidate.isConditional || isStepRequired(candidate.code, manuscript)) ?? null;
}

// Symétrique de findNextApplicableStatus : l'étape applicable immédiatement
// précédente (en sautant les étapes conditionnelles non requises). Sert au
// retour arrière (correction d'une validation faite par erreur).
async function findPreviousApplicableStatus(fromStepOrder: number, manuscript: Manuscript) {
  const candidates = await prisma.workflowStatus.findMany({
    where: { stepOrder: { lt: fromStepOrder } },
    orderBy: { stepOrder: "desc" },
  });
  return candidates.find((candidate) => !candidate.isConditional || isStepRequired(candidate.code, manuscript)) ?? null;
}

const revertStepSchema = z.object({ reason: z.string().max(500).optional() });

const validateStepSchema = z.object({
  observations: z.string().optional(),
  // Utilisé uniquement par l'étape VERIF_ADMIN (Ch. 4 §4.3, étape 2) : un
  // dossier incomplet bloque le passage à l'étape suivante.
  outcome: z.enum(["conforme", "incomplet"]).default("conforme"),
  // Dérogation de la Direction générale (Ch. 9 §9.12) pour envoyer un
  // ouvrage en production sans contrat d'édition actif — motivée et tracée.
  override_justification: z.string().min(1).optional(),
  // Ch. 4 §4.3 : la réécriture est déclenchée par la correction ou
  // l'expertise — posé à la validation de l'une de ces deux étapes.
  requires_rewrite: z.boolean().optional(),
  // Affectation nominative (demande opérateur 20/08/2026) : l'étape qui
  // transmet peut désigner NOMMÉMENT la personne à qui confier le dossier pour
  // l'étape suivante (ex. tel correcteur, tel maquettiste, tel infographe). La
  // personne désignée est notifiée personnellement et devient responsable de
  // l'étape suivante. Facultatif : sans désignation, tout le service concerné
  // est notifié (comportement historique).
  assignee_id: z.string().uuid().optional(),
  // Étapes « à option » (Expertise, Réécriture, Projet) : décision explicite de
  // l'opérateur — « realise » (réaliser, avec les éléments renseignés) ou
  // « passe » (passer, motif obligatoire, autorisé seulement si l'étape est
  // déclarée facultative). Ignoré pour les étapes ordinaires.
  step_decision: z.enum(["realise", "passe"]).optional(),
  skip_reason: z.string().max(500).optional(),
  realization: z.record(z.union([z.string(), z.number()])).optional(),
});

// Étapes pilotées par un flux dédié plutôt que par cet endpoint générique :
// COMITE_LECTURE avance automatiquement quand tous les rapports de lecture
// sont remis (Ch. 7 §7.12) ; DECISION_EDITORIALE se prend via
// /editorial-decision (Ch. 8 §8.2).
const DEDICATED_FLOW_STEPS = new Set(["COMITE_LECTURE", "DECISION_EDITORIALE"]);

// Moteur de workflow générique (Ch. 4 §4.2, §4.5) : impossible de sauter une
// étape — on ne peut valider que l'étape où se trouve actuellement le
// manuscrit, ce qui garantit le séquencement par construction.
export default async function workflowRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/v1/manuscripts/:id/steps/:step/validate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, step } = request.params as { id: string; step: string };
      const parsed = validateStepSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const targetStatus = await prisma.workflowStatus.findUnique({ where: { code: step } });
      if (!targetStatus) {
        return reply.code(404).send({ code: "not_found", message: `Étape inconnue : ${step}.` });
      }

      // PERMISSION — la validation d'étape exige « manuscripts:validation ».
      // EXCEPTION (demande opérateur 26–27/09/2026) : l'opérateur AFFECTÉ peut
      // CLÔTURER lui-même son étape — le CORRECTEUR sa correction, le MAQUETTISTE
      // sa mise en page (uniquement SON ouvrage, à SON étape). Aucune autre étape
      // n'est ouverte aux non-validateurs.
      if (!request.user!.permissions.has("manuscripts:validation")) {
        // BAT à DOUBLE validation : l'opérateur de production (infographe affecté,
        // ou porteur du droit « bat:saisie ») peut PRÉ-valider le BAT Final — la
        // 1re signature. La contre-validation (2e signature) exige, elle,
        // « manuscripts:validation » (Direction générale) : elle est contrôlée plus
        // bas, dans le bloc VALIDATION_BAT. On laisse donc passer ici l'opérateur
        // habilité à soumettre, sans lui ouvrir l'avancement pour autant.
        const canSubmitBat =
          targetStatus.code === "VALIDATION_BAT" &&
          (request.user!.permissions.has("bat:saisie") ||
            (await isAssignedForStep(id, manuscript.statusId, request.user!.id, targetStatus.code)));
        const allowed =
          canSubmitBat || (await canSelfCloseStep(id, manuscript.statusId, request.user!, targetStatus.code));
        if (!allowed) {
          void writeAuditLog({ userId: request.user!.id, action: "access_denied", entityType: "permission", entityId: "manuscripts:validation", newValues: { method: request.method, url: request.url }, ipAddress: request.ip }).catch(() => {});
          return reply.code(403).send({ code: "forbidden", message: "Action non autorisée : réservé à la direction éditoriale — ou au correcteur affecté, pour clôturer sa propre correction." });
        }
      }

      if (DEDICATED_FLOW_STEPS.has(targetStatus.code)) {
        return reply.code(409).send({
          code: "dedicated_flow_required",
          message:
            targetStatus.code === "COMITE_LECTURE"
              ? "Cette étape se termine automatiquement quand tous les rapports de lecture attendus sont remis."
              : "Cette étape se valide via la décision éditoriale (POST /manuscripts/{id}/editorial-decision).",
        });
      }

      if (manuscript.statusId !== targetStatus.id) {
        const currentStatus = await prisma.workflowStatus.findUnique({ where: { id: manuscript.statusId } });
        return reply.code(409).send({
          code: "step_out_of_order",
          message: `Le manuscrit est actuellement à l'étape « ${currentStatus?.label} », pas « ${targetStatus.label} ».`,
        });
      }

      // INTÉGRITÉ DU CIRCUIT ÉDITORIAL — BACKSTOP (demande opérateur) : un
      // manuscrit ne doit jamais PROGRESSER depuis la planification tant que le
      // rapport d'évaluation (comité de lecture) ET la décision éditoriale n'ont
      // pas été réellement rendus. Le verrou PRINCIPAL est posé sur la décision
      // elle-même (pas d'acceptation sans évaluation ; l'entrée en planification
      // passe par la décision) ; ce backstop rattrape les dossiers déjà arrivés
      // en planification sans ces pièces (données anciennes). Le back-catalogue
      // (importé hors circuit) n'est pas concerné.
      if (!manuscript.isBackCatalogue && targetStatus.code === "PLANIFICATION") {
        const [evaluationDone, decisionDone] = await Promise.all([
          prisma.evaluation.findFirst({ where: { assignment: { manuscriptId: id } }, select: { id: true } }),
          prisma.editorialDecision.findFirst({ where: { manuscriptId: id }, select: { id: true } }),
        ]);
        const manque: string[] = [];
        if (!evaluationDone) manque.push("le rapport d'évaluation du comité de lecture");
        if (!decisionDone) manque.push("la décision éditoriale");
        if (manque.length > 0) {
          return reply.code(409).send({
            code: "editorial_prerequisites_missing",
            message: `Étapes éditoriales incomplètes — impossible de poursuivre depuis la planification tant que manque : ${manque.join(" ; ")}.`,
          });
        }
      }

      const { observations, outcome, requires_rewrite, assignee_id, step_decision, skip_reason, realization } = parsed.data;
      const now = new Date();

      // Étapes « à option » (Expertise, Réécriture, Projet) : l'opérateur décide
      // ici de RÉALISER ou de PASSER l'étape. On prépare la trace à écrire sur
      // l'étape et on contrôle la cohérence AVANT toute validation.
      let realizationMode: "realise" | "passe" | null = null;
      let realizationSkipReason: string | null = null;
      let realizationDataToStore: Record<string, unknown> | null = null;
      if (isOptionalDecisionStep(targetStatus.code)) {
        const code = targetStatus.code as OptionalStepCode;
        const mode = await stepMode(code);
        // Par défaut : réaliser (l'opérateur ne peut passer que si autorisé).
        const decision = step_decision ?? "realise";
        if (decision === "passe") {
          if (mode === "obligatoire") {
            return reply.code(409).send({
              code: "step_mandatory",
              message: `L'étape « ${OPTIONAL_STEP_LABELS[code]} » est déclarée obligatoire : elle doit être réalisée (elle ne peut pas être passée). Un administrateur peut la rendre facultative dans les Paramètres.`,
            });
          }
          if (!skip_reason || skip_reason.trim() === "") {
            return reply.code(409).send({
              code: "skip_reason_required",
              message: `Pour passer l'étape « ${OPTIONAL_STEP_LABELS[code]} », indiquez le motif (il sera tracé au journal).`,
            });
          }
          realizationMode = "passe";
          realizationSkipReason = skip_reason.trim();
        } else {
          // Réaliser : les éléments attendus doivent être renseignés.
          const missing = missingRealizationFields(code, realization);
          if (missing.length > 0) {
            return reply.code(409).send({
              code: "realization_incomplete",
              message: `Étape « ${OPTIONAL_STEP_LABELS[code]} » à réaliser — renseignez avant de valider : ${missing.join(" ; ")}.`,
            });
          }
          realizationMode = "realise";
          realizationDataToStore = sanitizeRealizationData(code, realization);
        }
      }

      // Vérification administrative : la fiche de l'auteur doit être suffisamment
      // renseignée avant de transmettre au comité de lecture. Si des éléments
      // manquent, on refuse (409) en disant précisément lesquels — l'étape
      // suivante reste inaccessible tant que le dossier n'est pas complété.
      if (targetStatus.code === "VERIF_ADMIN") {
        const contributor = await prisma.workContributor.findFirst({ where: { manuscriptId: id, role: "author" }, include: { partner: true } });
        const p = contributor?.partner;
        const missing: string[] = [];
        if (!p || !(p.email || p.phone || p.whatsapp)) missing.push("un moyen de contact de l'auteur (e-mail, téléphone ou WhatsApp)");
        if (!p?.idType || !p?.idNumber) missing.push("la pièce d'identité de l'auteur (type et numéro)");
        if (manuscript.evaluationFeeChoice === "non_defini") missing.push("le choix des frais de dépôt pour évaluation (à payer / sans frais)");
        // Le fichier source doit être déposé : le comité de lecture ne peut pas
        // évaluer un manuscrit sans son fichier (demande opérateur 19/08/2026).
        const sourceDoc = await prisma.document.findFirst({
          where: { entityType: "manuscript", entityId: id, category: "manuscrit", title: "Manuscrit (source)", deletedAt: null },
          select: { versions: { select: { id: true }, take: 1 } },
        });
        if (!sourceDoc || sourceDoc.versions.length === 0) missing.push("le fichier source du manuscrit (à déposer à la réception)");
        if (missing.length > 0) {
          return reply.code(409).send({
            code: "dossier_incomplete",
            message: `Vérification administrative incomplète — complétez la fiche de l'auteur avant de passer au comité de lecture. Il manque : ${missing.join(" ; ")}.`,
          });
        }
      }

      // Décision opérateur D-010 (18/08/2026) : la contractualisation a été
      // déplacée APRÈS la validation du BAT. La production (planification,
      // correction, mise en page, ISBN, BAT) démarre donc désormais SANS contrat
      // d'édition actif — l'ancien verrou « pas de production sans contrat »
      // (Ch. 9 §9.12) est retiré en conséquence. Le contrat est signé une fois le
      // BAT validé par l'auteur, à l'étape Contractualisation, avant l'impression.

      // Audit éditorial, point n°2 : un manuscrit accepté SOUS CONDITIONS ne
      // peut pas entrer en production (mise en page). La correction est la
      // dernière étape éditoriale (obligatoire, franchie par tout manuscrit) :
      // on y bloque le passage tant que toutes les conditions posées par le
      // comité n'ont pas été LEVÉES par la direction éditoriale. Un dossier
      // accepté sous conditions mais sans condition listée (données anciennes)
      // n'est pas piégé : rien à lever, rien à bloquer.
      if (targetStatus.code === "CORRECTION") {
        const lastDecision = await prisma.editorialDecision.findFirst({ where: { manuscriptId: id }, orderBy: { decidedAt: "desc" } });
        if (lastDecision?.decision === "acceptation_conditions") {
          const remaining = await prisma.editorialAcceptanceCondition.findMany({
            where: { manuscriptId: id, deletedAt: null, liftedAt: null },
            orderBy: { createdAt: "asc" },
            select: { label: true },
          });
          if (remaining.length > 0) {
            return reply.code(409).send({
              code: "conditions_not_lifted",
              message: `Acceptation sous conditions : ${remaining.length} condition(s) non levée(s) — impossible d'entrer en production (mise en page) tant qu'elles ne sont pas levées : ${remaining.map((c) => c.label).join(" ; ")}.`,
              missing: remaining.map((c) => c.label),
            });
          }
        }
      }

      // Ch. 10 §10.7 : un point bloquant non levé empêche la validation de
      // l'étape de correction.
      if (targetStatus.code === "CORRECTION") {
        const blockingComment = await prisma.taskComment.findFirst({
          where: { isBlocking: true, resolvedAt: null, task: { manuscriptId: id, deletedAt: null } },
        });
        if (blockingComment) {
          return reply.code(409).send({
            code: "blocking_comment_unresolved",
            message: "Au moins un point bloquant du correcteur n'a pas été levé sur ce manuscrit.",
          });
        }
        // Correction en deux temps (demande opérateur 20/08/2026) : on ne passe
        // pas à la mise en page tant que le rapport de correction ET la version
        // finale intégrée (après 2e relecture) ne sont pas déposés.
        const missingPhases = await missingRequiredCorrectionPhases(id);
        // Clôture (demande opérateur 26/09/2026) : la COUVERTURE corrigée finale
        // (1ʳᵉ, dos, 4ᵉ) est exigée en plus du texte — rien ne part en mise en
        // page sans le texte ET la couverture finalisés.
        const missingAll = [...missingPhases, ...(await missingRequiredCoverPhases(id))];
        if (missingAll.length > 0) {
          return reply.code(409).send({
            code: "correction_cycle_incomplete",
            message: `Correction incomplète — déposez, dans le cycle de correction, avant de poursuivre : ${missingAll.join(" ; ")}.`,
          });
        }
      }

      // Ch. 11 : la mise en page ne peut démarrer avant qu'une fiche technique
      // de fabrication (même partielle) n'ait été ouverte pour l'ouvrage.
      if (targetStatus.code === "MISE_EN_PAGE") {
        const specs = await prisma.productionSpecs.findUnique({ where: { manuscriptId: id } });
        if (!specs) {
          return reply.code(409).send({
            code: "production_specs_missing",
            message: "Aucune fiche technique de fabrication n'a été ouverte pour ce manuscrit.",
          });
        }
      }

      // Ch. 11/12 : Maquette et Infographie avancent en parallèle mais
      // convergent à cette étape (fiche technique complète, dos à jour,
      // couverture conforme et pourvue de ses droits).
      if (targetStatus.code === "INFOGRAPHIE") {
        const missing = await checkMaquetteInfographieConvergence(id);
        if (missing.length > 0) {
          // Message EXPLICITE (charte §5 « jamais une erreur est survenue ») : on
          // dit précisément ce qui manque, en clair, pour que l'infographe sache
          // quoi compléter — sinon le bouton « Valider » semble sans effet.
          const LABELS: Record<string, string> = {
            fiche_technique_incomplete: "la fiche technique de fabrication est incomplète (format, nombre de pages, papier intérieur, papier couverture, reliure)",
            dos_a_recalculer: "le dos doit être recalculé (épaisseur à mettre à jour)",
            couverture_non_conforme_ou_sans_droits: "la 1re de couverture doit être déposée comme IMAGE (JPEG/PNG) via « Déposer la couverture », avec l'origine de ses droits — le dépôt d'un PDF en livrable ne suffit pas",
          };
          const details = missing.map((m) => LABELS[m] ?? m).join(" ; ");
          return reply.code(409).send({
            code: "maquette_infographie_incomplete",
            message: `Impossible de valider l'infographie — à compléter avant de poursuivre : ${details}.`,
            missing,
          });
        }
      }

      // Ch. 13 §13.9 : contrôle de complétude bloquant (ISBN, dépôt légal,
      // métadonnées, classification) avant de libérer l'ouvrage vers le BAT.
      // Correction d'ordre du Lot 1 : cf. docs/JOURNAL_TECHNIQUE.md.
      if (targetStatus.code === "ATTRIBUTION_REFERENCES") {
        const completeness = await computeIsbnCompleteness(id);
        if (!completeness.complete) {
          return reply.code(409).send({
            code: "isbn_completeness_incomplete",
            message: "La liste de contrôle ISBN/dépôt légal/métadonnées n'est pas complète.",
            missing: completeness.missing,
          });
        }
      }

      // Ch. 14 §14.6 : la signature électronique du BAT est l'acte qui
      // autorise le passage à l'impression — cette étape ne fait que
      // constater qu'un BAT signé existe pour le cycle courant.
      //
      // BAT à DOUBLE VALIDATION (demande opérateur 03/10/2026) : le BAT Final
      // autorise l'impression, c'est l'étape la plus sensible. On exige DEUX
      // signatures de deux personnes différentes :
      //   1) PRÉ-VALIDATION — l'opérateur de production (infographe affecté, ou
      //      porteur de « bat:saisie ») soumet le BAT. L'ouvrage NE PROGRESSE PAS :
      //      il reste à l'étape, en attente de contre-validation. La Direction
      //      générale est notifiée.
      //   2) CONTRE-VALIDATION — la Direction générale (« manuscripts:validation »),
      //      qui ne peut PAS être la même personne que le pré-validateur, consulte
      //      puis contre-valide. C'est seulement là que l'ouvrage passe à
      //      l'impression.
      // Le bon à tirer signé par l'auteur (BatRecord « signed ») reste un
      // prérequis des DEUX actes.
      if (targetStatus.code === "VALIDATION_BAT") {
        const latestBat = await prisma.batRecord.findFirst({ where: { manuscriptId: id }, orderBy: { cycleNumber: "desc" } });
        if (!latestBat || latestBat.status !== "signed") {
          return reply.code(409).send({
            code: "bat_not_signed",
            message: "Le BAT n'est pas signé : impossible de valider cette étape.",
          });
        }

        const batStep = await prisma.manuscriptStep.findUnique({
          where: { manuscriptId_statusId: { manuscriptId: id, statusId: targetStatus.id } },
          select: { preValidatedAt: true, preValidatedBy: true },
        });
        const hasFinalAuthority = request.user!.permissions.has("manuscripts:validation");

        if (!batStep?.preValidatedAt) {
          // 1re signature — PRÉ-VALIDATION. On trace le pré-validateur, on NOTIFIE
          // la Direction générale, on NE FAIT PAS avancer l'ouvrage.
          await prisma.manuscriptStep.upsert({
            where: { manuscriptId_statusId: { manuscriptId: id, statusId: targetStatus.id } },
            update: { preValidatedAt: now, preValidatedBy: request.user!.id, observations, actualStart: now },
            create: { manuscriptId: id, statusId: targetStatus.id, preValidatedAt: now, preValidatedBy: request.user!.id, actualStart: now, observations },
          });
          await notifyRole({
            roleCode: "DIR_GENERAL",
            type: "autre",
            priority: "high",
            title: `BAT à contre-valider — ${manuscript.manuscriptNumber}`,
            body: `${request.user!.username} a validé le BAT Final de « ${manuscript.title} ». Votre contre-validation est requise pour autoriser l'impression.`,
            entityType: "manuscript",
            entityId: id,
          });
          await writeAuditLog({
            userId: request.user!.id,
            action: "validate",
            entityType: "manuscript",
            entityId: id,
            oldValues: { statusCode: targetStatus.code },
            newValues: { preValidated: true, advanced: false, observations },
            ipAddress: request.ip,
          });
          return reply.send({
            advanced: false,
            pending_counter_validation: true,
            message: "BAT validé — en attente de la contre-validation de la Direction générale pour autoriser l'impression.",
          });
        }

        // 2e signature — CONTRE-VALIDATION. Réservée à la Direction générale et
        // interdite au pré-validateur (double signature de deux personnes).
        if (!hasFinalAuthority) {
          void writeAuditLog({ userId: request.user!.id, action: "access_denied", entityType: "permission", entityId: "manuscripts:validation", newValues: { reason: "bat_counter_validation", method: request.method, url: request.url }, ipAddress: request.ip }).catch(() => {});
          return reply.code(403).send({
            code: "forbidden",
            message: "Le BAT est déjà pré-validé : seule la Direction générale peut le contre-valider pour autoriser l'impression.",
          });
        }
        if (batStep.preValidatedBy === request.user!.id) {
          return reply.code(409).send({
            code: "bat_same_signer",
            message: "Vous avez déjà pré-validé ce BAT : la contre-validation doit être faite par une autre personne de la Direction.",
          });
        }
        // Autorité confirmée, signataire différent : on laisse l'avancement
        // normal se poursuivre (le bloc transactionnel plus bas fait passer
        // l'ouvrage à l'impression et renseigne validatedAt).
      }

      // Ch. 15 §15.4 : l'impression proprement dite suppose un bon de
      // commande au moins transmis à l'imprimeur.
      if (targetStatus.code === "IMPRESSION") {
        const activeOrder = await prisma.purchaseOrder.findFirst({
          where: { quote: { manuscriptId: id }, status: { in: ["sent", "in_production", "completed"] } },
        });
        if (!activeOrder) {
          return reply.code(409).send({
            code: "purchase_order_not_sent",
            message: "Aucun bon de commande transmis à l'imprimeur pour ce manuscrit.",
          });
        }
      }

      // Ch. 14 §14.7 : seuls les exemplaires contrôlés (conformes ou
      // conformes avec réserves) peuvent être transmis à l'entrée en stock.
      if (targetStatus.code === "CONTROLE_QUALITE_IMPRESSION") {
        const acceptedReceipt = await prisma.goodsReceipt.findFirst({
          where: { po: { quote: { manuscriptId: id } }, qcVerdict: { in: ["conform", "with_reserves"] } },
        });
        if (!acceptedReceipt) {
          return reply.code(409).send({
            code: "no_accepted_receipt",
            message: "Aucune réception d'exemplaires n'a reçu de verdict de contrôle qualité acceptable.",
          });
        }
      }

      // Ch. 16 §16.4 : l'entrée en stock ne peut être validée qu'une fois
      // des exemplaires effectivement réceptionnés (mouvement production_in).
      if (targetStatus.code === "ENTREE_STOCK") {
        const printIsbn = await prisma.isbn.findFirst({ where: { manuscriptId: id, format: "print" } });
        const entryMovement = printIsbn
          ? await prisma.stockMovement.findFirst({ where: { isbnId: printIsbn.id, type: "production_in" } })
          : null;
        if (!entryMovement) {
          return reply.code(409).send({
            code: "no_stock_entry",
            message: "Aucun exemplaire n'a encore été réceptionné en stock pour cet ouvrage.",
          });
        }
      }

      // Ch. 17 §17.2 : la mise en vente suppose une fiche commerciale
      // minimale (prix public défini).
      if (targetStatus.code === "COMMERCIALISATION") {
        const printIsbn = await prisma.isbn.findFirst({ where: { manuscriptId: id, format: "print" } });
        const price = printIsbn ? await prisma.priceList.findFirst({ where: { isbnId: printIsbn.id } }) : null;
        if (!price) {
          return reply.code(409).send({
            code: "price_missing",
            message: "Aucun prix public n'a été défini pour cet ouvrage.",
          });
        }
      }

      // Ch. 17 §17.5 : la première commande ou vente enregistrée matérialise
      // le passage effectif à la commercialisation.
      if (targetStatus.code === "VENTE_LIVRAISON") {
        const printIsbn = await prisma.isbn.findFirst({ where: { manuscriptId: id, format: "print" } });
        const [order, posSale] = printIsbn
          ? await Promise.all([
              prisma.salesOrder.findFirst({ where: { lines: { some: { isbnId: printIsbn.id } }, status: { not: "cancelled" } } }),
              prisma.posSale.findFirst({ where: { isbnId: printIsbn.id } }),
            ])
          : [null, null];
        if (!order && !posSale) {
          return reply.code(409).send({
            code: "no_sale_recorded",
            message: "Aucune commande ou vente n'a encore été enregistrée pour cet ouvrage.",
          });
        }
      }

      // Ch. 4 §4.3 : la réécriture est déclenchée par la correction ou
      // l'expertise — le responsable de l'étape pose le drapeau ici.
      let manuscriptForNextStep = manuscript;
      if (["CORRECTION", "EXPERTISE"].includes(targetStatus.code) && requires_rewrite !== undefined) {
        manuscriptForNextStep = await prisma.manuscript.update({
          where: { id },
          data: { requiresRewrite: requires_rewrite },
        });
      }

      if (outcome === "incomplet") {
        await prisma.manuscriptStep.upsert({
          where: { manuscriptId_statusId: { manuscriptId: id, statusId: targetStatus.id } },
          update: { observations, actualEnd: now },
          create: { manuscriptId: id, statusId: targetStatus.id, actualStart: now, actualEnd: now, observations },
        });
        if (manuscript.ownerId) {
          await prisma.notification.create({
            data: {
              userId: manuscript.ownerId,
              type: "autre",
              priority: "high",
              title: "Dossier incomplet",
              body: `Le manuscrit ${manuscript.manuscriptNumber} a un dossier incomplet à l'étape « ${targetStatus.label} ».`,
              entityType: "manuscript",
              entityId: id,
            },
          });
        }
        return reply.send({ advanced: false, message: "Dossier incomplet : passage à l'étape suivante bloqué." });
      }

      // Verrou « livrable de sortie » (paramétrable) : les étapes qui produisent
      // un fichier pour l'étape suivante ne se valident pas tant que ce fichier
      // n'est pas déposé — pour qu'un manuscrit n'arrive jamais « les mains vides ».
      // Une étape « à option » PASSÉE ne produit pas de livrable : on n'exige
      // alors pas de fichier (le motif du passage suffit).
      if (realizationMode !== "passe" && (await isDeliverableRequired(targetStatus.code))) {
        if (!(await hasStepDeliverable(id, targetStatus.code))) {
          return reply.code(409).send({
            code: "deliverable_missing",
            message: `Livrable manquant — déposez « ${DELIVERABLE_LABELS[targetStatus.code] ?? "le livrable de l'étape"} » avant de passer à l'étape suivante.`,
          });
        }
      }

      // Planification : les DEUX dépôts VC1 sont obligatoires (demande opérateur
      // 11/09/2026) — le manuscrit à corriger ET le fichier des couvertures —
      // avant de passer à l'étape suivante. Une étape « passée » en est dispensée.
      if (realizationMode !== "passe" && targetStatus.code === "PLANIFICATION") {
        const missing = (await vc1State(id)).filter((s) => !s.has_file).map((s) => s.label);
        if (missing.length > 0) {
          return reply.code(409).send({
            code: "vc1_missing",
            message: `Fichiers manquants à la planification — déposez « ${missing.join(" » et « ")} » avant de passer à l'étape suivante.`,
          });
        }
        // L'aperçu (PDF officiel) du planning doit avoir été généré/téléchargé au
        // moins une fois avant de quitter l'étape (demande opérateur 11/09/2026).
        const plan = await prisma.projectPlan.findFirst({ where: { manuscriptId: id, deletedAt: null }, select: { pdfGeneratedAt: true } });
        if (!plan?.pdfGeneratedAt) {
          return reply.code(409).send({
            code: "plan_not_generated",
            message: "Aperçu du planning non téléchargé — ouvrez « Aperçu / Imprimer / PDF » et téléchargez le PDF du planning avant de passer à l'étape suivante.",
          });
        }
      }

      const nextStatus = await findNextApplicableStatus(targetStatus.stepOrder, manuscriptForNextStep);

      // Affectation nominative pour l'étape suivante : on vérifie, AVANT de
      // valider, que la personne désignée peut bien recevoir ce dossier — elle
      // doit être active et rattachée au service de l'étape suivante (ex. on ne
      // confie la mise en page qu'à un maquettiste). Le comité de lecture garde
      // son propre mode de répartition (plusieurs relecteurs, évaluations).
      if (assignee_id) {
        if (!nextStatus) {
          return reply.code(409).send({ code: "no_next_step", message: "Ce manuscrit n'a pas d'étape suivante : aucune affectation possible." });
        }
        if (nextStatus.code === "COMITE_LECTURE") {
          return reply.code(409).send({ code: "dedicated_flow_required", message: "Le comité de lecture se répartit via l'affectation des relecteurs (page Comité de lecture)." });
        }
        const roleFilter = assigneeRoleFilter(nextStatus);
        const assignee = await prisma.user.findFirst({
          where: { id: assignee_id, status: "active", ...(roleFilter ? { userRoles: roleFilter } : {}) },
          select: { id: true },
        });
        if (!assignee) {
          return reply.code(400).send({ code: "invalid_assignee", message: `La personne choisie n'est pas habilitée pour l'étape « ${nextStatus.label} » ou n'est plus active.` });
        }
      }

      // « MÊME AGENT SUR TOUTE LA PRODUCTION » (demande opérateur 03/10) :
      // l'infographe désigné à l'intégration des corrections de couverture
      // (coverIntegratorId) devient le PROPRIÉTAIRE DE PRODUCTION et suit/exécute
      // les étapes graphiques jusqu'à l'attribution des références. Quand aucune
      // affectation explicite n'est faite, on l'auto-affecte comme responsable de
      // l'étape suivante. Le BAT et l'impression restent au pôle dédié (contre-
      // validés par le DG) : on NE propage PAS au-delà de l'attribution des références.
      const PROD_OWNER_STEPS = ["MISE_EN_PAGE", "INFOGRAPHIE", "ATTRIBUTION_REFERENCES"];
      let autoOwnerId: string | null = null;
      if (!assignee_id && nextStatus && PROD_OWNER_STEPS.includes(nextStatus.code) && manuscript.coverIntegratorId) {
        const owner = await prisma.user.findFirst({ where: { id: manuscript.coverIntegratorId, status: "active" }, select: { id: true } });
        autoOwnerId = owner?.id ?? null;
      }
      const effectiveAssigneeId = assignee_id ?? autoOwnerId;

      await prisma.$transaction(async (tx) => {
        await tx.manuscriptStep.upsert({
          where: { manuscriptId_statusId: { manuscriptId: id, statusId: targetStatus.id } },
          update: {
            validationBy: request.user!.id,
            validatedAt: now,
            observations,
            actualEnd: now,
            ...(realizationMode ? { realizationMode, skipReason: realizationSkipReason, realizationData: (realizationDataToStore ?? undefined) as never } : {}),
          },
          create: {
            manuscriptId: id,
            statusId: targetStatus.id,
            validationBy: request.user!.id,
            validatedAt: now,
            actualStart: now,
            actualEnd: now,
            observations,
            ...(realizationMode ? { realizationMode, skipReason: realizationSkipReason, realizationData: (realizationDataToStore ?? undefined) as never } : {}),
          },
        });

        if (nextStatus) {
          await tx.manuscript.update({ where: { id }, data: { statusId: nextStatus.id, updatedBy: request.user!.id } });
          await tx.stepTransition.create({
            data: {
              manuscriptId: id,
              fromStatusCode: targetStatus.code,
              toStatusCode: nextStatus.code,
              fromDepartmentId: targetStatus.departmentId,
              toDepartmentId: nextStatus.departmentId,
              responsibleId: request.user!.id,
              observations,
            },
          });

          if (effectiveAssigneeId && nextStatus.code !== "COMITE_LECTURE") {
            // Affectation nominative (explicite OU propriétaire de production
            // auto-affecté) : la personne devient responsable de l'étape suivante
            // et est notifiée personnellement.
            await tx.manuscriptStep.upsert({
              where: { manuscriptId_statusId: { manuscriptId: id, statusId: nextStatus.id } },
              update: { responsibleId: effectiveAssigneeId, plannedStart: now },
              create: { manuscriptId: id, statusId: nextStatus.id, responsibleId: effectiveAssigneeId, plannedStart: now },
            });
            await tx.notification.create({
              data: {
                userId: effectiveAssigneeId,
                type: "affectation",
                priority: "medium",
                title: `Dossier confié — ${nextStatus.label}`,
                body: `Le manuscrit ${manuscript.manuscriptNumber} vous est confié pour l'étape « ${nextStatus.label} ».`,
                entityType: "manuscript",
                entityId: id,
              },
            });
          } else if (nextStatus.departmentId) {
            const departmentUsers = await tx.user.findMany({
              where: { userRoles: { some: { revokedAt: null, role: { departmentId: nextStatus.departmentId } } }, status: "active" },
            });
            // Le comité de lecture fonctionne par AFFECTATION : un relecteur ne
            // voit dans « Mes lectures » que les manuscrits qui lui sont
            // personnellement confiés. À l'arrivée au comité, aucun relecteur
            // n'est encore désigné : le manuscrit est « à répartir » (page
            // Comité de lecture), pas « à lire ». On adapte donc le message pour
            // cette étape — sinon l'opérateur cherche en vain le manuscrit dans
            // « Mes lectures » alors qu'il est en attente d'affectation.
            const isCommittee = nextStatus.code === "COMITE_LECTURE";
            const title = isCommittee ? "Manuscrit à répartir au comité de lecture" : "Nouveau dossier à traiter";
            const body = isCommittee
              ? `Le manuscrit ${manuscript.manuscriptNumber} est arrivé au comité de lecture : ouvrez « Comité de lecture » pour affecter un ou plusieurs relecteurs (il n'apparaît dans « Mes lectures » qu'une fois qu'il vous est confié).`
              : `Le manuscrit ${manuscript.manuscriptNumber} arrive à l'étape « ${nextStatus.label} ».`;
            for (const departmentUser of departmentUsers) {
              await tx.notification.create({
                data: {
                  userId: departmentUser.id,
                  type: "affectation",
                  priority: "medium",
                  title,
                  body,
                  entityType: "manuscript",
                  entityId: id,
                },
              });
            }
          }
        }
      });

      // OUVERTURE DU CYCLE DE CORRECTION (demande opérateur 01/10/2026) : dès que
      // l'ouvrage ENTRE en correction, on ouvre (si besoin) son cycle éditorial —
      // la référence COR-AAAA-NNN existe ainsi avant le premier dépôt.
      if (nextStatus?.code === "CORRECTION") {
        await ensureOpenCorrectionCycle(id, { userId: request.user!.id, userRole: request.user!.roles[0] ?? null });
      }

      // CLÔTURE DU CYCLE DE CORRECTION (demande opérateur 01/10/2026) : valider
      // l'étape Correction clôt le cycle éditorial actif de l'ouvrage — statut
      // TERMINÉE, date/heure, qui a clôturé, dernière version corrigée (VCF) et
      // observations historisées. Un nouveau cycle (#2…) pourra être ouvert si
      // l'ouvrage repasse un jour en correction.
      if (targetStatus.code === "CORRECTION") {
        const state = await correctionCycleState(id);
        const finalVersionId = state.find((p) => p.key === "integration_finale")?.version_id ?? null;
        await closeCorrectionCycle(id, {
          userId: request.user!.id,
          userRole: request.user!.roles[0] ?? null,
          finalVersionId,
          closureNote: observations ?? null,
          stepStatus: targetStatus.code,
        });
      }

      // CLÔTURE PAR L'OPÉRATEUR AFFECTÉ (demande opérateur 26–27/09/2026) : quand
      // c'est l'affecté — et non la Direction — qui clôture, les responsables sont
      // notifiés automatiquement de la clôture et du passage à l'étape suivante.
      //   • Correction (par le correcteur) → Directeur éditorial.
      //   • Mise en page (par le maquettiste) → Directeur éditorial + Responsable
      //     production/impression.
      //   • Infographie (par l'infographe) → Directeur éditorial + Responsable
      //     production/impression.
      if (nextStatus && SELF_CLOSE_STEPS.has(targetStatus.code) && !request.user!.permissions.has("manuscripts:validation")) {
        const SELF_CLOSE_NOTIFY: Record<string, { label: string; roles: string[] }> = {
          CORRECTION: { label: "Correction", roles: ["DIR_EDITORIAL"] },
          MISE_EN_PAGE: { label: "Mise en page", roles: ["DIR_EDITORIAL", "RESP_IMPRESSION"] },
          INFOGRAPHIE: { label: "Infographie", roles: ["DIR_EDITORIAL", "RESP_IMPRESSION"] },
          ATTRIBUTION_REFERENCES: { label: "Attribution des références", roles: ["DIR_EDITORIAL"] },
        };
        const cfg = SELF_CLOSE_NOTIFY[targetStatus.code];
        if (cfg) {
          for (const roleCode of cfg.roles) {
            await notifyRole({
              roleCode,
              type: "autre",
              priority: "high",
              title: `${cfg.label} clôturée — ${manuscript.manuscriptNumber}`,
              body: `${request.user!.username} a clôturé la ${cfg.label.toLowerCase()} de « ${manuscript.title} » : l'ouvrage passe en « ${nextStatus.label} ».`,
              entityType: "manuscript",
              entityId: id,
            });
          }
        }
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "validate",
        entityType: "manuscript",
        entityId: id,
        oldValues: { statusCode: targetStatus.code },
        newValues: {
          statusCode: nextStatus?.code ?? null,
          observations,
          ...(realizationMode ? { realizationMode, skipReason: realizationSkipReason } : {}),
        },
        ipAddress: request.ip,
      });

      return reply.send({ advanced: true, status: nextStatus?.code ?? null, realization_mode: realizationMode });
    },
  );

  // Écran « Mes corrections » — infos de CLÔTURE de la correction, accessibles au
  // CORRECTEUR (droit « tasks »). Donne l'étape suivante (mise en page), les
  // maquettistes destinataires possibles, et l'état des fichiers exigés (texte
  // VCF + couverture finale) pour savoir si l'on peut clôturer. Lecture seule.
  fastify.get(
    "/api/v1/manuscripts/:id/correction/close-info",
    { preHandler: requirePermission("tasks", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true, statusId: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const current = await prisma.workflowStatus.findUnique({ where: { id: manuscript.statusId } });
      const atCorrection = current?.code === "CORRECTION";
      const nextStatus = current ? await findNextApplicableStatus(current.stepOrder, manuscript as unknown as Manuscript) : null;
      const roleFilter = nextStatus ? assigneeRoleFilter(nextStatus) : null;
      let maquettistes: { id: string; username: string; role: string | null }[] = [];
      if (atCorrection && nextStatus && roleFilter) {
        const users = await prisma.user.findMany({
          where: { status: "active", userRoles: roleFilter },
          select: { id: true, username: true, userRoles: { where: { revokedAt: null }, select: { role: { select: { label: true, departmentId: true } } } } },
          orderBy: { username: "asc" },
        });
        maquettistes = users.map((u) => ({ id: u.id, username: u.username, role: u.userRoles.find((r) => r.role.departmentId === nextStatus.departmentId)?.role.label ?? u.userRoles[0]?.role.label ?? null }));
      }
      const textMissing = atCorrection ? await missingRequiredCorrectionPhases(id) : [];
      // Cycle couverture désormais obligatoire : « incomplet » tant qu'une phase
      // couverture requise manque (et plus seulement la couverture finale).
      const coverMissingList = atCorrection ? await missingRequiredCoverPhases(id) : [];
      const coverMissing = coverMissingList.length > 0;
      return reply.send({
        at_correction: atCorrection,
        next_step: nextStatus ? { code: nextStatus.code, label: nextStatus.label } : null,
        maquettistes,
        text_missing: textMissing,
        cover_missing: coverMissing,
        cover_missing_list: coverMissingList,
        ready: atCorrection && textMissing.length === 0 && !coverMissing,
      });
    },
  );

  // Candidats à l'affectation nominative de l'étape SUIVANTE : les personnes
  // actives du service de la prochaine étape (ex. les maquettistes pour la mise
  // en page, les infographes pour l'infographie, les correcteurs pour la
  // correction). Sert au sélecteur « Transmettre à… » lors de la validation.
  // Renvoie une liste vide quand l'affectation nominative ne s'applique pas
  // (dernière étape, service non défini, ou comité de lecture — répartition
  // dédiée via l'affectation des relecteurs).
  fastify.get(
    "/api/v1/manuscripts/:id/next-assignees",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const current = await prisma.workflowStatus.findUnique({ where: { id: manuscript.statusId } });
      if (!current) return reply.send({ next_step: null, assignees: [] });
      const nextStatus = await findNextApplicableStatus(current.stepOrder, manuscript);
      const roleFilter = nextStatus && nextStatus.code !== "COMITE_LECTURE" ? assigneeRoleFilter(nextStatus) : null;
      if (!nextStatus || !roleFilter) {
        return reply.send({ next_step: nextStatus ? { code: nextStatus.code, label: nextStatus.label } : null, assignees: [] });
      }
      const users = await prisma.user.findMany({
        where: { status: "active", userRoles: roleFilter },
        select: { id: true, username: true, userRoles: { where: { revokedAt: null }, select: { role: { select: { label: true, departmentId: true } } } } },
        orderBy: { username: "asc" },
      });
      const assignees = users.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.userRoles.find((r) => r.role.departmentId === nextStatus.departmentId)?.role.label ?? u.userRoles[0]?.role.label ?? null,
      }));
      return reply.send({ next_step: { code: nextStatus.code, label: nextStatus.label }, assignees });
    },
  );

  // Candidats + responsable actuel de l'ÉTAPE COURANTE : sert à CHOISIR ou
  // CHANGER la personne affectée à l'étape en cours (ex. attribuer la Correction
  // éditoriale à tel correcteur, ou corriger une affectation erronée). Le
  // sélecteur ne propose que les personnes du SERVICE de l'étape courante — un
  // infographe ne peut donc jamais être proposé pour la correction.
  fastify.get(
    "/api/v1/manuscripts/:id/current-step-assignees",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true, statusId: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const current = await prisma.workflowStatus.findUnique({ where: { id: manuscript.statusId } });
      if (!current) return reply.send({ step: null, has_department: false, current_assignee: null, assignees: [] });
      const step = await prisma.manuscriptStep.findUnique({
        where: { manuscriptId_statusId: { manuscriptId: id, statusId: manuscript.statusId } },
        select: { responsible: { select: { id: true, username: true } } },
      });
      const roleFilter = assigneeRoleFilter(current);
      let assignees: { id: string; username: string; role: string | null }[] = [];
      if (roleFilter) {
        const users = await prisma.user.findMany({
          where: { status: "active", userRoles: roleFilter },
          select: { id: true, username: true, userRoles: { where: { revokedAt: null }, select: { role: { select: { label: true, departmentId: true } } } } },
          orderBy: { username: "asc" },
        });
        assignees = users.map((u) => ({ id: u.id, username: u.username, role: u.userRoles.find((r) => r.role.departmentId === current.departmentId)?.role.label ?? u.userRoles[0]?.role.label ?? null }));
      }
      return reply.send({
        step: { code: current.code, label: current.label },
        has_department: !!roleFilter,
        current_assignee: step?.responsible ? { id: step.responsible.id, username: step.responsible.username } : null,
        assignees,
      });
    },
  );

  // État de la DOUBLE validation du BAT Final (demande opérateur 03/10/2026) :
  // dit à l'écran si la 1re signature (pré-validation de l'infographe) est posée,
  // par qui, et ce que l'utilisateur courant peut faire — pré-valider (soumettre)
  // ou contre-valider (autorité Direction générale, signataire différent).
  fastify.get(
    "/api/v1/manuscripts/:id/bat-validation-state",
    // Visible à qui peut consulter l'ouvrage, valider les étapes (Direction
    // générale contre-validatrice) ou consulter/soumettre le BAT (infographe).
    {
      preHandler: requireAnyPermission([
        { module: "manuscripts", action: "consultation" },
        { module: "manuscripts", action: "validation" },
        { module: "bat", action: "consultation" },
        { module: "bat", action: "saisie" },
      ]),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true, statusId: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const current = await prisma.workflowStatus.findUnique({ where: { id: manuscript.statusId } });
      const atBat = current?.code === "VALIDATION_BAT";
      const step = atBat
        ? await prisma.manuscriptStep.findUnique({
            where: { manuscriptId_statusId: { manuscriptId: id, statusId: manuscript.statusId } },
            select: { preValidatedAt: true, preValidatedBy: true, responsibleId: true },
          })
        : null;
      const preValidator = step?.preValidatedBy
        ? await prisma.user.findUnique({ where: { id: step.preValidatedBy }, select: { id: true, username: true } })
        : null;
      const hasFinalAuthority = request.user!.permissions.has("manuscripts:validation");
      const preValidated = Boolean(step?.preValidatedAt);
      const isAssigned = atBat ? await isAssignedForStep(id, manuscript.statusId, request.user!.id, "VALIDATION_BAT") : false;
      const canSubmit = request.user!.permissions.has("bat:saisie") || isAssigned;
      return reply.send({
        at_bat: atBat,
        pre_validated: preValidated,
        pre_validated_at: step?.preValidatedAt ?? null,
        pre_validator: preValidator ? { id: preValidator.id, username: preValidator.username } : null,
        // Ce que l'utilisateur courant peut faire maintenant :
        can_pre_validate: atBat && !preValidated && canSubmit,
        can_counter_validate: atBat && preValidated && hasFinalAuthority && step?.preValidatedBy !== request.user!.id,
        is_pre_validator: Boolean(step?.preValidatedBy && step.preValidatedBy === request.user!.id),
      });
    },
  );

  // (Ré)affecte le responsable de l'ÉTAPE COURANTE — ex. choisir/changer le
  // correcteur pendant la Correction éditoriale. Validé côté serveur : la
  // personne doit appartenir au SERVICE de l'étape (sinon 400). Tracé + notifié.
  fastify.patch(
    "/api/v1/manuscripts/:id/current-step/assignee",
    { preHandler: requirePermission("manuscripts", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ assignee_id: z.string().uuid() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Choisissez une personne à qui confier l'étape." });
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true, statusId: true, title: true, manuscriptNumber: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const current = await prisma.workflowStatus.findUnique({ where: { id: manuscript.statusId } });
      const roleFilter = current ? assigneeRoleFilter(current) : null;
      if (!current || !roleFilter) {
        return reply.code(409).send({ code: "no_named_assignment", message: "Cette étape ne se confie pas nominativement à une personne." });
      }
      const assignee = await prisma.user.findFirst({
        where: { id: parsed.data.assignee_id, status: "active", userRoles: roleFilter },
        select: { id: true },
      });
      if (!assignee) {
        return reply.code(400).send({ code: "invalid_assignee", message: `La personne choisie n'est pas habilitée pour l'étape « ${current.label} » ou n'est plus active.` });
      }
      await prisma.manuscriptStep.upsert({
        where: { manuscriptId_statusId: { manuscriptId: id, statusId: current.id } },
        update: { responsibleId: parsed.data.assignee_id },
        create: { manuscriptId: id, statusId: current.id, responsibleId: parsed.data.assignee_id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "manuscript_step", entityId: id, newValues: { step: current.code, assigned_to: parsed.data.assignee_id }, ipAddress: request.ip });
      await notifyUsers({
        userIds: [parsed.data.assignee_id],
        type: "affectation",
        priority: "high",
        title: `Manuscrit à traiter — ${current.label}`,
        body: `Le manuscrit « ${manuscript.title} » (${manuscript.manuscriptNumber}) vous est confié pour l'étape « ${current.label} ».`,
        entityType: "manuscript",
        entityId: id,
      }).catch(() => undefined);
      return reply.send({ ok: true });
    },
  );

  // « Mes dossiers à traiter » : les manuscrits dont l'ÉTAPE COURANTE m'est
  // personnellement confiée (responsable = moi et étape non encore validée).
  // Accessible à tout utilisateur connecté — chacun ne voit QUE ses propres
  // dossiers (un correcteur/maquettiste/infographe n'a pas forcément le droit
  // large « manuscripts:consultation »). Équivalent de « Mes lectures » pour le
  // reste de la chaîne.
  fastify.get("/api/v1/my-dossiers", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const steps = await prisma.manuscriptStep.findMany({
      where: { responsibleId: me, validatedAt: null, manuscript: { deletedAt: null } },
      include: {
        status: { select: { code: true, label: true } },
        manuscript: { select: { id: true, manuscriptNumber: true, title: true, statusId: true } },
      },
      orderBy: [{ plannedStart: "asc" }, { createdAt: "asc" }],
    });
    // On ne garde que les étapes où le manuscrit se trouve ENCORE (l'étape
    // courante) : une étape déjà dépassée n'est plus « à traiter ».
    const rows = steps
      .filter((s) => s.manuscript.statusId === s.statusId)
      .map((s) => ({
        manuscript_id: s.manuscript.id,
        manuscript_number: s.manuscript.manuscriptNumber,
        title: s.manuscript.title,
        step_code: s.status.code,
        step_label: s.status.label,
        since: (s.plannedStart ?? s.createdAt).toISOString(),
      }));
    return reply.send(rows);
  });

  // « Mes travaux de production » (demande opérateur 01/10) — ESPACE UNIQUE du
  // pôle Production : regroupe, pour l'utilisateur connecté, les ouvrages dont
  // une étape DE PRODUCTION lui est confiée, classés par état, avec la tâche
  // active et une progression. Ne crée aucune logique parallèle : on lit les
  // étapes du workflow existant (manuscript_steps) et on réutilise les contrôles
  // de pré-requis (convergence, complétude ISBN) pour détecter « en attente ».
  fastify.get("/api/v1/my-production-work", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    // Segment « production » du workflow (vraies étapes, dans l'ordre). Sert à la
    // progression X/N et à ne montrer ici que les travaux de production.
    const SEGMENT = ["MISE_EN_PAGE", "INFOGRAPHIE", "ATTRIBUTION_REFERENCES", "VALIDATION_BAT", "IMPRESSION", "CONTROLE_QUALITE_IMPRESSION"];
    const total = SEGMENT.length;

    // Étapes de production ACTIVES qui me sont confiées (étape courante, non validée).
    const activeSteps = await prisma.manuscriptStep.findMany({
      where: { responsibleId: me, validatedAt: null, status: { code: { in: SEGMENT } }, manuscript: { deletedAt: null } },
      include: {
        status: { select: { code: true, label: true } },
        manuscript: { select: { id: true, manuscriptNumber: true, title: true, statusId: true } },
      },
      orderBy: [{ plannedStart: "asc" }, { createdAt: "asc" }],
    });
    const active = activeSteps.filter((s) => s.manuscript.statusId === s.statusId);

    // Étapes de production que j'ai VALIDÉES récemment (bac « Terminés »).
    const doneSteps = await prisma.manuscriptStep.findMany({
      where: { validationBy: me, validatedAt: { not: null }, status: { code: { in: SEGMENT } }, manuscript: { deletedAt: null } },
      include: {
        status: { select: { code: true, label: true } },
        manuscript: { select: { id: true, manuscriptNumber: true, title: true } },
      },
      orderBy: { validatedAt: "desc" },
      // Plafond large : le tableau récapitulatif « Mes travaux de production »
      // compte les étapes livrées par étape — on ne veut pas sous-compter.
      take: 500,
    });

    // Progression : nombre d'étapes du segment déjà VALIDÉES pour chaque ouvrage.
    const manuscriptIds = [...new Set([...active.map((s) => s.manuscript.id), ...doneSteps.map((s) => s.manuscript.id)])];
    const validatedBySegment = manuscriptIds.length
      ? await prisma.manuscriptStep.groupBy({
          by: ["manuscriptId"],
          where: { manuscriptId: { in: manuscriptIds }, validatedAt: { not: null }, status: { code: { in: SEGMENT } } },
          _count: { _all: true },
        })
      : [];
    const doneCountById = new Map(validatedBySegment.map((g) => [g.manuscriptId, g._count._all]));
    const progressionFor = (manuscriptId: string) => ({ done: doneCountById.get(manuscriptId) ?? 0, total });

    // « En attente » : l'étape m'est confiée mais ne peut pas être validée car un
    // pré-requis manque (document/convergence/complétude) — on réutilise les
    // contrôles exacts du workflow pour que le motif soit fiable et explicite.
    const BLOCK_LABELS: Record<string, string> = {
      fiche_technique_incomplete: "fiche technique de fabrication incomplète",
      dos_a_recalculer: "dos à recalculer",
      couverture_non_conforme_ou_sans_droits: "1re de couverture (image + droits) à finaliser",
    };
    async function blockReason(stepCode: string, manuscriptId: string): Promise<string | null> {
      if (stepCode === "INFOGRAPHIE") {
        const missing = await checkMaquetteInfographieConvergence(manuscriptId);
        if (missing.length > 0) return missing.map((m) => BLOCK_LABELS[m] ?? m).join(" ; ");
      }
      if (stepCode === "ATTRIBUTION_REFERENCES") {
        const c = await computeIsbnCompleteness(manuscriptId);
        if (!c.complete) return "référencement ISBN / dépôt légal incomplet";
      }
      return null;
    }

    const activeRows = await Promise.all(
      active.map(async (s) => {
        const started = Boolean(s.actualStart);
        const reason = await blockReason(s.status.code, s.manuscript.id);
        const bucket = reason ? "en_attente" : started ? "en_cours" : "a_traiter";
        return {
          kind: "step" as const,
          manuscript_id: s.manuscript.id,
          manuscript_number: s.manuscript.manuscriptNumber,
          title: s.manuscript.title,
          step_code: s.status.code,
          step_label: s.status.label,
          bucket,
          started,
          blocked_reason: reason,
          detail: null as string | null,
          progression: progressionFor(s.manuscript.id),
          since: (s.plannedStart ?? s.createdAt).toISOString() as string | null,
        };
      }),
    );

    // INTÉGRATION DE CORRECTION (couverture) — travail de l'infographe/maquettiste
    // (demande opérateur 02/10) : inclus ici pour un point d'entrée unique. On
    // réutilise « Mes intégrations de correction » (branche couverture, actives).
    // Intégrations de couverture ACTIVES (non closes). La règle « uniquement si le
    // correcteur a transmis un rapport de couverture » est déjà appliquée dans
    // myCorrectionIntegrations (branche couverture), donc pas de filtre en doublon.
    const integrations = (await myCorrectionIntegrations(me)).filter((i) => i.branch === "couverture" && !i.closed_at);
    const integrationRows = integrations.map((i) => {
      const restant = i.counts.a_integrer + i.counts.a_revoir;
      const done = Math.max(0, i.counts.total - restant);
      const detail = i.counts.total === 0
        ? "couverture à intégrer (retours du correcteur)"
        : restant > 0
          ? `${restant} correction(s) de couverture à intégrer`
          : i.can_close
            ? "prêt à clore (couverture finale déposée)"
            : "déposer la couverture corrigée finale";
      // Actif = en cours, sauf s'il ne reste qu'à déposer le fichier final (à traiter).
      const bucket = restant === 0 && !i.can_close ? "a_traiter" : "en_cours";
      return {
        kind: "integration" as const,
        manuscript_id: i.id,
        manuscript_number: i.manuscript_number,
        title: i.title,
        step_code: "INTEGRATION_COUVERTURE",
        step_label: "Intégration de correction (couverture)",
        bucket,
        started: true,
        blocked_reason: null as string | null,
        detail,
        progression: { done, total: i.counts.total },
        since: null as string | null,
      };
    });

    // Un ouvrage ne figure dans « Terminés » que s'il n'a pas d'étape active à moi
    // (sinon il est déjà dans un bac actif) ; on garde le dernier validé par ouvrage.
    const activeIds = new Set(active.map((s) => s.manuscript.id));
    const seenDone = new Set<string>();
    const doneRows = doneSteps
      .filter((s) => !activeIds.has(s.manuscript.id))
      .filter((s) => (seenDone.has(s.manuscript.id) ? false : (seenDone.add(s.manuscript.id), true)))
      .map((s) => ({
        kind: "step" as const,
        manuscript_id: s.manuscript.id,
        manuscript_number: s.manuscript.manuscriptNumber,
        title: s.manuscript.title,
        step_code: s.status.code,
        step_label: s.status.label,
        bucket: "termine" as const,
        started: true,
        blocked_reason: null as string | null,
        detail: null as string | null,
        progression: progressionFor(s.manuscript.id),
        since: (s.validatedAt ?? s.createdAt).toISOString() as string | null,
      }));

    return reply.send([...activeRows, ...integrationRows, ...doneRows]);
  });

  // « Mes validations de production » (demande opérateur 03/10) — TABLEAU DE BORD
  // de la DIRECTION, pendant de « Mes travaux de production » mais orienté
  // VALIDATEUR : les ouvrages arrivés aux étapes de FIN de chaîne que le DG pilote
  // — BAT Final (contre-validation), Contractualisation, Impression, Contrôle
  // qualité. On liste TOUS les ouvrages à ces étapes (pas seulement ceux qui lui
  // sont « confiés »), avec l'action attendue et le motif d'attente (réutilise les
  // mêmes contrôles de pré-requis que la validation d'étape, pour rester fiable).
  fastify.get(
    "/api/v1/my-production-validations",
    { preHandler: requirePermission("manuscripts", "validation") },
    async (request, reply) => {
      const me = request.user!.id;
      // Ordre réel du workflow : BAT(12) → Contractualisation(13) → Impression(14)
      // → Contrôle qualité(15).
      const DG_SEGMENT = ["VALIDATION_BAT", "CONTRACTUALISATION", "IMPRESSION", "CONTROLE_QUALITE_IMPRESSION"];
      const total = DG_SEGMENT.length;

      // Ouvrages ACTUELLEMENT à l'une de ces étapes (quel que soit le responsable).
      const manuscripts = await prisma.manuscript.findMany({
        where: { deletedAt: null, status: { code: { in: DG_SEGMENT } } },
        select: { id: true, manuscriptNumber: true, title: true, statusId: true, status: { select: { code: true, label: true } } },
        orderBy: { updatedAt: "desc" },
      });

      // Étapes DG que J'AI validées récemment (bac « Validés »).
      const doneSteps = await prisma.manuscriptStep.findMany({
        where: { validationBy: me, validatedAt: { not: null }, status: { code: { in: DG_SEGMENT } }, manuscript: { deletedAt: null } },
        include: {
          status: { select: { code: true, label: true } },
          manuscript: { select: { id: true, manuscriptNumber: true, title: true } },
        },
        orderBy: { validatedAt: "desc" },
        take: 500,
      });

      // Progression : nombre d'étapes DG déjà validées pour chaque ouvrage.
      const ids = [...new Set([...manuscripts.map((m) => m.id), ...doneSteps.map((s) => s.manuscript.id)])];
      const validated = ids.length
        ? await prisma.manuscriptStep.groupBy({
            by: ["manuscriptId"],
            where: { manuscriptId: { in: ids }, validatedAt: { not: null }, status: { code: { in: DG_SEGMENT } } },
            _count: { _all: true },
          })
        : [];
      const doneById = new Map(validated.map((g) => [g.manuscriptId, g._count._all]));

      // Action attendue / motif d'attente par étape (mêmes contrôles que la
      // validation d'étape → le statut affiché est fiable).
      async function evaluate(code: string, manuscriptId: string, statusId: string): Promise<{ bucket: "en_attente" | "en_cours"; blocked_reason: string | null; detail: string | null }> {
        if (code === "VALIDATION_BAT") {
          const latestBat = await prisma.batRecord.findFirst({ where: { manuscriptId }, orderBy: { cycleNumber: "desc" } });
          if (!latestBat || latestBat.status !== "signed") return { bucket: "en_attente", blocked_reason: "bon à tirer non signé", detail: null };
          const step = await prisma.manuscriptStep.findUnique({ where: { manuscriptId_statusId: { manuscriptId, statusId } }, select: { preValidatedAt: true } });
          if (!step?.preValidatedAt) return { bucket: "en_attente", blocked_reason: "en attente de la 1re signature de l'infographe", detail: null };
          return { bucket: "en_cours", blocked_reason: null, detail: "à contre-valider (1re signature posée)" };
        }
        if (code === "IMPRESSION") {
          const activeOrder = await prisma.purchaseOrder.findFirst({ where: { quote: { manuscriptId }, status: { in: ["sent", "in_production", "completed"] } } });
          if (!activeOrder) return { bucket: "en_attente", blocked_reason: "bon de commande à transmettre à l'imprimeur", detail: null };
          return { bucket: "en_cours", blocked_reason: null, detail: "à valider (lancement de l'impression)" };
        }
        if (code === "CONTROLE_QUALITE_IMPRESSION") {
          const receipt = await prisma.goodsReceipt.findFirst({ where: { po: { quote: { manuscriptId } }, qcVerdict: { in: ["conform", "with_reserves"] } } });
          if (!receipt) return { bucket: "en_attente", blocked_reason: "contrôle qualité des exemplaires à faire", detail: null };
          return { bucket: "en_cours", blocked_reason: null, detail: "à valider (contrôle qualité conforme)" };
        }
        // CONTRACTUALISATION : pas de pré-requis technique particulier ici.
        return { bucket: "en_cours", blocked_reason: null, detail: "à valider (contractualisation)" };
      }

      const activeRows = await Promise.all(
        manuscripts.map(async (m) => {
          const ev = await evaluate(m.status.code, m.id, m.statusId);
          return {
            kind: "step" as const,
            manuscript_id: m.id,
            manuscript_number: m.manuscriptNumber,
            title: m.title,
            step_code: m.status.code,
            step_label: m.status.label,
            bucket: ev.bucket,
            started: ev.bucket === "en_cours",
            blocked_reason: ev.blocked_reason,
            detail: ev.detail,
            progression: { done: doneById.get(m.id) ?? 0, total },
            since: null as string | null,
          };
        }),
      );

      const activeIds = new Set(manuscripts.map((m) => m.id));
      const seen = new Set<string>();
      const doneRows = doneSteps
        .filter((s) => !activeIds.has(s.manuscript.id))
        .filter((s) => (seen.has(s.manuscript.id) ? false : (seen.add(s.manuscript.id), true)))
        .map((s) => ({
          kind: "step" as const,
          manuscript_id: s.manuscript.id,
          manuscript_number: s.manuscript.manuscriptNumber,
          title: s.manuscript.title,
          step_code: s.status.code,
          step_label: s.status.label,
          bucket: "termine" as const,
          started: true,
          blocked_reason: null as string | null,
          detail: null as string | null,
          progression: { done: doneById.get(s.manuscript.id) ?? total, total },
          since: (s.validatedAt ?? s.createdAt).toISOString() as string | null,
        }));

      return reply.send([...activeRows, ...doneRows]);
    },
  );

  // Retour à l'étape précédente (Ch. 4 §4.5, correction d'erreur) : ramène le
  // manuscrit à l'étape applicable immédiatement précédente et « rouvre » cette
  // étape (sa validation est effacée pour pouvoir être refaite). Tracé au
  // journal d'audit. Réservé aux profils habilités à valider les étapes ; à
  // n'utiliser que pour corriger une validation faite par erreur.
  fastify.post(
    "/api/v1/manuscripts/:id/steps/revert",
    { preHandler: requirePermission("manuscripts", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = revertStepSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, include: { status: true } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }
      const current = manuscript.status;
      const previous = await findPreviousApplicableStatus(current.stepOrder, manuscript);
      if (!previous) {
        return reply.code(409).send({
          code: "no_previous_step",
          message: `« ${current.label} » est la première étape du circuit : impossible de revenir en arrière.`,
        });
      }

      const now = new Date();
      await prisma.$transaction(async (tx) => {
        // Rouvre l'étape précédente (efface sa validation) pour qu'elle puisse
        // être de nouveau validée normalement.
        await tx.manuscriptStep.updateMany({
          where: { manuscriptId: id, statusId: previous.id },
          data: { validationBy: null, validatedAt: null, actualEnd: null },
        });
        await tx.manuscript.update({ where: { id }, data: { statusId: previous.id, updatedBy: request.user!.id } });
        await tx.stepTransition.create({
          data: {
            manuscriptId: id,
            fromStatusCode: current.code,
            toStatusCode: previous.code,
            fromDepartmentId: current.departmentId,
            toDepartmentId: previous.departmentId,
            responsibleId: request.user!.id,
            observations: parsed.data.reason ?? "Retour à l'étape précédente (correction d'une validation erronée).",
          },
        });
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "status_change",
        entityType: "manuscript",
        entityId: id,
        oldValues: { statusCode: current.code },
        newValues: { statusCode: previous.code, reverted: true, reason: parsed.data.reason ?? null },
        ipAddress: request.ip,
      });

      return reply.send({ reverted: true, status: previous.code, statusLabel: previous.label });
    },
  );
}
