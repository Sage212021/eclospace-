import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Manuscript } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { checkMaquetteInfographieConvergence } from "../lib/productionConvergence.js";
import { computeIsbnCompleteness } from "../lib/isbnCompleteness.js";

// Ch. 4 §4.3, §4.6 : les étapes 8 (expertise) et 9 (réécriture) ne sont
// activées que si le projet le requiert ; leur absence n'est pas comptée
// comme une étape sautée. Décision opérateur du 04/07/2026 : la réécriture
// est activée mais facultative, déclenchée par un drapeau posé à la
// validation de CORRECTION ou EXPERTISE (voir plus bas), au même titre que
// l'expertise.
function isStepRequired(statusCode: string, manuscript: Manuscript): boolean {
  if (statusCode === "EXPERTISE") return manuscript.requiresExpertise;
  if (statusCode === "REECRITURE") return manuscript.requiresRewrite;
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
    { preHandler: requirePermission("manuscripts", "validation") },
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

      const { observations, outcome, requires_rewrite } = parsed.data;
      const now = new Date();

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
          return reply.code(409).send({
            code: "maquette_infographie_incomplete",
            message: "La convergence Maquette/Infographie n'est pas atteinte.",
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
      if (targetStatus.code === "VALIDATION_BAT") {
        const latestBat = await prisma.batRecord.findFirst({ where: { manuscriptId: id }, orderBy: { cycleNumber: "desc" } });
        if (!latestBat || latestBat.status !== "signed") {
          return reply.code(409).send({
            code: "bat_not_signed",
            message: "Le BAT n'est pas signé : impossible de valider cette étape.",
          });
        }
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

      const nextStatus = await findNextApplicableStatus(targetStatus.stepOrder, manuscriptForNextStep);

      await prisma.$transaction(async (tx) => {
        await tx.manuscriptStep.upsert({
          where: { manuscriptId_statusId: { manuscriptId: id, statusId: targetStatus.id } },
          update: { validationBy: request.user!.id, validatedAt: now, observations, actualEnd: now },
          create: {
            manuscriptId: id,
            statusId: targetStatus.id,
            validationBy: request.user!.id,
            validatedAt: now,
            actualStart: now,
            actualEnd: now,
            observations,
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

          if (nextStatus.departmentId) {
            const departmentUsers = await tx.user.findMany({
              where: { userRoles: { some: { revokedAt: null, role: { departmentId: nextStatus.departmentId } } }, status: "active" },
            });
            for (const departmentUser of departmentUsers) {
              await tx.notification.create({
                data: {
                  userId: departmentUser.id,
                  type: "affectation",
                  priority: "medium",
                  title: "Nouveau dossier à traiter",
                  body: `Le manuscrit ${manuscript.manuscriptNumber} arrive à l'étape « ${nextStatus.label} ».`,
                  entityType: "manuscript",
                  entityId: id,
                },
              });
            }
          }
        }
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "validate",
        entityType: "manuscript",
        entityId: id,
        oldValues: { statusCode: targetStatus.code },
        newValues: { statusCode: nextStatus?.code ?? null, observations },
        ipAddress: request.ip,
      });

      return reply.send({ advanced: true, status: nextStatus?.code ?? null });
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
