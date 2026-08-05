import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Identifiant d'instance (par processus) et heure de démarrage : servent au
// diagnostic de persistance. Si l'identifiant change d'un rafraîchissement à
// l'autre, plusieurs serveurs répondent sans base partagée (cause classique de
// « données enregistrées puis disparues »).
const INSTANCE_ID = randomUUID().slice(0, 8);
const STARTED_AT = Date.now();

// Paramétrage clé/valeur versionné (Ch. 21 §21.5 : seuils, pondérations et
// calendriers ajustables sans redéploiement). La table `settings` était
// jusqu'ici alimentée par le seed et lue par les modules métier (ISBN,
// impression, stock, dépenses, comité de lecture…), mais n'était exposée
// par aucune route : cet écran de consultation/modification manquait.
const patchSettingSchema = z.object({
  // La valeur d'un paramètre est un JSON libre (nombre, objet de seuils…).
  value: z.unknown(),
});

// Administration du workflow éditorial (refonte — Lot C). Paramétrage SANS
// code des étapes : libellé, département responsable, délai cible et
// notifications. L'ordre des étapes et les règles métier profondes (contrat
// signé, BAT signé…) restent gérés par le moteur (elles sont liées au CODE de
// l'étape) : cet écran ne les modifie pas, il ajuste ce qui est sûr à régler.
const TARGET_DAYS_KEY = "workflow.step_target_days";
const NOTIFY_ON_ENTRY_KEY = "workflow.step_notify_on_entry";

const patchWorkflowStepSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  department_id: z.string().uuid().nullable().optional(),
  target_days: z.number().int().min(0).max(3650).nullable().optional(),
  notify_on_entry: z.boolean().optional(),
});

// Lit un paramètre « map { code → valeur } » (délais, notifications).
async function readStepMap(key: string): Promise<Record<string, unknown>> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return (s?.value as Record<string, unknown> | undefined) ?? {};
}

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/v1/settings",
    { preHandler: requirePermission("settings", "consultation") },
    async (_request, reply) => {
      const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
      return reply.send(
        settings.map((s) => ({
          key: s.key,
          value: s.value,
          version: s.version,
          updatedAt: s.updatedAt,
          updatedBy: s.updatedBy,
        })),
      );
    },
  );

  fastify.patch(
    "/api/v1/settings/:key",
    { preHandler: requirePermission("settings", "administration") },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const parsed = patchSettingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Valeur invalide.", details: parsed.error.issues });
      }

      const existing = await prisma.setting.findUnique({ where: { key } });
      if (!existing) {
        // Les paramètres sont créés par le seed : on n'autorise pas la création
        // de clés arbitraires depuis l'interface (une clé inconnue ne serait lue
        // par aucun module et resterait un réglage mort).
        return reply.code(404).send({ code: "not_found", message: `Paramètre « ${key} » inconnu.` });
      }

      const updated = await prisma.setting.update({
        where: { key },
        data: {
          value: parsed.data.value as never,
          version: { increment: 1 },
          updatedBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "setting",
        entityId: key,
        oldValues: existing.value as never,
        newValues: updated.value as never,
        ipAddress: request.ip,
      });

      return reply.send({
        key: updated.key,
        value: updated.value,
        version: updated.version,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      });
    },
  );

  // Configuration du workflow éditorial : les étapes dans l'ordre, avec leur
  // libellé, département responsable, délai cible et notifications — plus la
  // liste des départements (pour le choix du responsable).
  fastify.get(
    "/api/v1/workflow/config",
    { preHandler: requirePermission("settings", "consultation") },
    async (_request, reply) => {
      const [statuses, departments, targetMap, notifyMap] = await Promise.all([
        prisma.workflowStatus.findMany({ orderBy: { stepOrder: "asc" }, include: { department: { select: { id: true, name: true } } } }),
        prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
        readStepMap(TARGET_DAYS_KEY),
        readStepMap(NOTIFY_ON_ENTRY_KEY),
      ]);
      return reply.send({
        steps: statuses.map((s) => ({
          code: s.code,
          label: s.label,
          step_order: s.stepOrder,
          is_conditional: s.isConditional,
          department_id: s.departmentId,
          department_name: s.department?.name ?? null,
          target_days: typeof targetMap[s.code] === "number" ? (targetMap[s.code] as number) : null,
          // Notifications à l'entrée de l'étape : activées par défaut (comportement
          // historique) tant qu'elles ne sont pas explicitement désactivées.
          notify_on_entry: notifyMap[s.code] !== false,
        })),
        departments,
      });
    },
  );

  // Modification d'une étape (paramétrage sans code). Réservé à l'administration.
  fastify.patch(
    "/api/v1/workflow/steps/:code",
    { preHandler: requirePermission("settings", "administration") },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsed = patchWorkflowStepSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const status = await prisma.workflowStatus.findUnique({ where: { code } });
      if (!status) return reply.code(404).send({ code: "not_found", message: `Étape « ${code} » inconnue.` });

      const body = parsed.data;
      // Libellé et département : colonnes de l'étape (sûres à modifier).
      const statusData: { label?: string; departmentId?: string | null } = {};
      if (body.label !== undefined) statusData.label = body.label;
      if (body.department_id !== undefined) {
        if (body.department_id) {
          const dept = await prisma.department.findUnique({ where: { id: body.department_id } });
          if (!dept) return reply.code(400).send({ code: "invalid_department", message: "Département inconnu." });
        }
        statusData.departmentId = body.department_id;
      }
      if (Object.keys(statusData).length > 0) {
        await prisma.workflowStatus.update({ where: { code }, data: statusData });
      }

      // Délai cible et notifications : paramètres « map { code → valeur } ».
      if (body.target_days !== undefined) {
        const map = await readStepMap(TARGET_DAYS_KEY);
        if (body.target_days === null) delete map[code];
        else map[code] = body.target_days;
        await prisma.setting.upsert({
          where: { key: TARGET_DAYS_KEY },
          update: { value: map as never, version: { increment: 1 }, updatedBy: request.user!.id },
          create: { key: TARGET_DAYS_KEY, value: map as never, updatedBy: request.user!.id },
        });
      }
      if (body.notify_on_entry !== undefined) {
        const map = await readStepMap(NOTIFY_ON_ENTRY_KEY);
        // On ne stocke que les désactivations (false) ; true = valeur par défaut.
        if (body.notify_on_entry) delete map[code];
        else map[code] = false;
        await prisma.setting.upsert({
          where: { key: NOTIFY_ON_ENTRY_KEY },
          update: { value: map as never, version: { increment: 1 }, updatedBy: request.user!.id },
          create: { key: NOTIFY_ON_ENTRY_KEY, value: map as never, updatedBy: request.user!.id },
        });
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "workflow_step",
        entityId: code,
        newValues: body as never,
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );

  // Diagnostic de persistance : vérifie, DEPUIS L'INTERFACE, que la base de
  // données est joignable, à jour (migrations appliquées) et DURABLE — en
  // affichant le nombre réel d'enregistrements. L'opérateur enregistre une donnée
  // puis rafraîchit : le compteur correspondant doit augmenter. Sert à confirmer
  // qu'un enregistrement est réellement persisté (demande RH) et à détecter une
  // base non persistante ou plusieurs instances non partagées.
  fastify.get(
    "/api/v1/system/diagnostic",
    { preHandler: requirePermission("settings", "consultation") },
    async (_request, reply) => {
      const t0 = Date.now();
      let dbConnected = false;
      let serverTime: string | null = null;
      try {
        const rows = await prisma.$queryRawUnsafe<{ now: Date }[]>("SELECT NOW() as now");
        serverTime = rows[0]?.now instanceof Date ? rows[0].now.toISOString() : String(rows[0]?.now ?? "");
        dbConnected = true;
      } catch {
        dbConnected = false;
      }
      const latencyMs = Date.now() - t0;

      // Migrations réellement appliquées (production : Prisma « migrate deploy »).
      // applied = null si la table de suivi est absente (ex. base montée par
      // « db push ») : on ne prétend pas « 0 appliquée », ce serait trompeur.
      let migrationsApplied: number | null = null;
      let lastMigration: string | null = null;
      try {
        const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
          'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC',
        );
        migrationsApplied = rows.length;
        lastMigration = rows[0]?.migration_name ?? null;
      } catch {
        /* table de suivi absente ou base injoignable : reste « inconnu » (null) */
      }

      const [users, employees, weeklyReports, invoices, billingOrders, manuscripts] = await Promise.all([
        prisma.user.count().catch(() => -1),
        prisma.employee.count().catch(() => -1),
        prisma.weeklyReport.count().catch(() => -1),
        prisma.invoice.count().catch(() => -1),
        prisma.billingOrder.count().catch(() => -1),
        prisma.manuscript.count().catch(() => -1),
      ]);

      return reply.send({
        instance_id: INSTANCE_ID,
        uptime_seconds: Math.round((Date.now() - STARTED_AT) / 1000),
        database: { connected: dbConnected, server_time: serverTime, latency_ms: latencyMs },
        migrations: { applied: migrationsApplied, last: lastMigration },
        records: { users, employees, weekly_reports: weeklyReports, invoices, billing_orders: billingOrders, manuscripts },
      });
    },
  );
}
