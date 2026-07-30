import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { EmployeeStatus, HrContractType, AbsenceType, AbsenceStatus, AccessReviewDecision } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { activityClosureStatus, sweepClosureReminders, sendClosureReminderNow } from "../lib/activityClosure.js";

const employeeSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  department_id: z.string().uuid().optional(),
  status: z.nativeEnum(EmployeeStatus).default("salarie"),
  position: z.string().optional(),
  manager_id: z.string().uuid().optional(),
  hire_date: z.string().datetime().optional(),
  birth_date: z.string().datetime().optional(),
  // Arrivée (Ch. 19 §19.3) : création du compte utilisateur avec le rôle du
  // poste, dans le même mouvement que le dossier — champs optionnels, aucun
  // compte n'est créé si absents (bénévoles, dossiers sans accès système).
  account: z
    .object({
      username: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
      role_code: z.string().min(1),
    })
    .optional(),
});

const employeeUpdateSchema = z.object({
  department_id: z.string().uuid().nullable().optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  position: z.string().optional(),
  manager_id: z.string().uuid().nullable().optional(),
  birth_date: z.string().datetime().nullable().optional(),
});

const hrContractSchema = z.object({
  type: z.nativeEnum(HrContractType),
  linked_contract_id: z.string().uuid().optional(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime().optional(),
});

const confidentialSchema = z.object({
  base_salary: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const absenceSchema = z.object({
  employee_id: z.string().uuid(),
  type: z.nativeEnum(AbsenceType),
  from_date: z.string().datetime(),
  to_date: z.string().datetime(),
  reason: z.string().optional(),
});

const skillSchema = z.object({
  category: z.string().min(1),
  label: z.string().min(1),
});

const employeeSkillSchema = z.object({
  skill_id: z.string().uuid(),
  level: z.number().int().min(1).max(5).optional(),
});

const payrollVariableSchema = z.object({
  employee_id: z.string().uuid(),
  period_key: z.string().regex(/^\d{4}-\d{2}$/),
  presence_days: z.number().nonnegative().optional(),
  absence_days: z.number().nonnegative().optional(),
  bonus_amount: z.number().nonnegative().optional(),
  missions_amount: z.number().nonnegative().optional(),
});

const grantRoleSchema = z.object({
  role_code: z.string().min(1),
  justification: z.string().min(1),
});

const revokeRoleSchema = z.object({
  justification: z.string().min(1),
});

// Ch. 19 : Ressources humaines — le dossier RH est la source, le compte
// utilisateur en est la conséquence (§19.1, en binôme avec le Ch. 2).
export default async function hrRoutes(fastify: FastifyInstance) {
  // --- Dossier du collaborateur (Ch. 19 §19.2) ---

  fastify.post("/api/v1/employees", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const parsed = employeeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;

    if (body.account) {
      const role = await prisma.role.findUnique({
        where: { code: body.account.role_code },
        include: { rolePermissions: { include: { permission: true } } },
      });
      if (!role) {
        return reply.code(400).send({ code: "validation_error", message: `Rôle inconnu : ${body.account.role_code}.` });
      }
      // Garde-fou anti-escalade : ouvrir un compte à l'embauche ne doit pas
      // permettre d'accorder un rôle de gestion des comptes (users:administration,
      // ou l'administrateur général) à quelqu'un qui n'a pas lui-même ce droit.
      const grantsUserAdmin =
        role.code === "ADMIN_GENERAL" ||
        role.rolePermissions.some((rp) => rp.permission.module === "users" && rp.permission.action === "administration");
      if (grantsUserAdmin && !request.user!.permissions.has("users:administration")) {
        return reply.code(403).send({
          code: "forbidden_role",
          message: `Le rôle « ${role.label} » donne la gestion des utilisateurs : son attribution est réservée à l'administration des comptes.`,
        });
      }
    }

    const employee = await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          firstName: body.first_name,
          lastName: body.last_name,
          departmentId: body.department_id,
          status: body.status,
          position: body.position,
          managerId: body.manager_id,
          hireDate: body.hire_date ? new Date(body.hire_date) : undefined,
          birthDate: body.birth_date ? new Date(body.birth_date) : undefined,
          createdBy: request.user!.id,
        },
      });

      if (body.account) {
        const passwordHash = await argon2.hash(body.account.password);
        const user = await tx.user.create({
          data: {
            employeeId: created.id,
            username: body.account.username,
            email: body.account.email,
            passwordHash,
            createdBy: request.user!.id,
          },
        });
        const role = await tx.role.findUniqueOrThrow({ where: { code: body.account.role_code } });
        await tx.userRole.create({
          data: { userId: user.id, roleId: role.id, grantedBy: request.user!.id, justification: "Arrivée : rôle du poste (Ch. 19 §19.3)." },
        });
      }

      if (created.managerId) {
        const managerUser = await tx.user.findUnique({ where: { employeeId: created.managerId } });
        if (managerUser) {
          await tx.notification.create({
            data: {
              userId: managerUser.id,
              type: "affectation",
              priority: "medium",
              title: "Nouvelle arrivée dans votre équipe",
              body: `${created.firstName} ${created.lastName} rejoint votre équipe — pensez à l'accueil.`,
              entityType: "employee",
              entityId: created.id,
            },
          });
        }
      }

      return created;
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "employee",
      entityId: employee.id,
      newValues: employee,
      ipAddress: request.ip,
    });

    return reply.code(201).send(employee);
  });

  fastify.get("/api/v1/employees", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const query = request.query as { department_id?: string; status?: string };
    const employees = await prisma.employee.findMany({
      where: {
        deletedAt: null,
        ...(query.department_id ? { departmentId: query.department_id } : {}),
        ...(query.status ? { status: query.status as EmployeeStatus } : {}),
      },
      include: { department: true, manager: true },
      orderBy: { lastName: "asc" },
    });
    return reply.send(employees);
  });

  fastify.get("/api/v1/employees/:id", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const employee = await prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: { department: true, manager: true, reports: true, user: { select: { id: true, username: true, status: true } }, hrContracts: true, employeeSkills: { include: { skill: true } } },
    });
    if (!employee) {
      return reply.code(404).send({ code: "not_found", message: "Dossier collaborateur introuvable." });
    }
    return reply.send(employee);
  });

  // Mobilité interne (Ch. 19 §19.3) : changement de poste/département,
  // effectif immédiatement. Le rôle applicatif se change via les routes
  // dédiées (attribution/retrait, ci-dessous), pas automatiquement ici — le
  // cahier des charges ne fixe pas de correspondance poste→rôle univoque.
  fastify.patch("/api/v1/employees/:id", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = employeeUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        departmentId: parsed.data.department_id,
        status: parsed.data.status,
        position: parsed.data.position,
        managerId: parsed.data.manager_id,
        ...(parsed.data.birth_date !== undefined ? { birthDate: parsed.data.birth_date ? new Date(parsed.data.birth_date) : null } : {}),
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "employee",
      entityId: id,
      newValues: parsed.data,
      ipAddress: request.ip,
    });
    return reply.send(employee);
  });

  // Départ (Ch. 19 §19.3) : désactivation automatique du compte à la date de
  // départ — immédiate si la date est déjà passée, sinon vérifiée de façon
  // paresseuse à la prochaine connexion (lib/permissions.ts, aucune tâche
  // planifiée dans le projet).
  fastify.patch(
    "/api/v1/employees/:id/departure",
    { preHandler: requirePermission("rh", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ date: z.string().datetime() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const departureDate = new Date(parsed.data.date);
      const employee = await prisma.$transaction(async (tx) => {
        const updated = await tx.employee.update({ where: { id }, data: { departureDate, updatedBy: request.user!.id } });
        if (departureDate <= new Date()) {
          const user = await tx.user.findUnique({ where: { employeeId: id } });
          if (user) await tx.user.update({ where: { id: user.id }, data: { status: "disabled" } });
        }
        return updated;
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "status_change",
        entityType: "employee",
        entityId: id,
        newValues: { departureDate },
        ipAddress: request.ip,
      });
      return reply.send(employee);
    },
  );

  // Suspension (congé longue durée, procédure) : gel du compte sans perte de
  // données (Ch. 19 §19.3), distincte du départ.
  fastify.patch(
    "/api/v1/employees/:id/suspend",
    { preHandler: requirePermission("rh", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await prisma.user.findUnique({ where: { employeeId: id } });
      if (!user) {
        return reply.code(404).send({ code: "not_found", message: "Aucun compte utilisateur pour ce dossier." });
      }
      const updated = await prisma.user.update({ where: { id: user.id }, data: { status: "suspended" } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "user", entityId: user.id, newValues: { status: "suspended" }, ipAddress: request.ip });
      return reply.send(updated);
    },
  );

  fastify.patch(
    "/api/v1/employees/:id/reinstate",
    { preHandler: requirePermission("rh", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await prisma.user.findUnique({ where: { employeeId: id } });
      if (!user) {
        return reply.code(404).send({ code: "not_found", message: "Aucun compte utilisateur pour ce dossier." });
      }
      const updated = await prisma.user.update({ where: { id: user.id }, data: { status: "active" } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "user", entityId: user.id, newValues: { status: "active" }, ipAddress: request.ip });
      return reply.send(updated);
    },
  );

  fastify.post("/api/v1/employees/:id/contracts", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = hrContractSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const contract = await prisma.hrContract.create({
      data: {
        employeeId: id,
        type: parsed.data.type,
        linkedContractId: parsed.data.linked_contract_id,
        startDate: new Date(parsed.data.start_date),
        endDate: parsed.data.end_date ? new Date(parsed.data.end_date) : undefined,
        createdBy: request.user!.id,
      },
    });
    return reply.code(201).send(contract);
  });

  fastify.get("/api/v1/employees/:id/contracts", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const contracts = await prisma.hrContract.findMany({ where: { employeeId: id }, orderBy: { startDate: "desc" } });
    return reply.send(contracts);
  });

  // Données confidentielles (Ch. 19 §19.2) : accès restreint, consultation
  // journalisée comme le juridique (Ch. 9 §9.11).
  fastify.get(
    "/api/v1/employees/:id/confidential",
    { preHandler: requirePermission("rh_confidentiel", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await writeAuditLog({ userId: request.user!.id, action: "view_sensitive", entityType: "employee_confidential", entityId: id, ipAddress: request.ip });
      const confidential = await prisma.employeeConfidential.findUnique({ where: { employeeId: id } });
      return reply.send(confidential ?? {});
    },
  );

  fastify.patch(
    "/api/v1/employees/:id/confidential",
    { preHandler: requirePermission("rh_confidentiel", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = confidentialSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const confidential = await prisma.employeeConfidential.upsert({
        where: { employeeId: id },
        update: { baseSalary: parsed.data.base_salary, notes: parsed.data.notes, updatedBy: request.user!.id },
        create: { employeeId: id, baseSalary: parsed.data.base_salary, notes: parsed.data.notes, updatedBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "employee_confidential", entityId: id, ipAddress: request.ip });
      return reply.send(confidential);
    },
  );

  // --- Rôles et habilitations (Ch. 2 §2.4, Ch. 19 §19.4) ---

  fastify.post("/api/v1/users/:id/roles", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = grantRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const role = await prisma.role.findUnique({ where: { code: parsed.data.role_code } });
    if (!role) {
      return reply.code(400).send({ code: "validation_error", message: `Rôle inconnu : ${parsed.data.role_code}.` });
    }
    const userRole = await prisma.userRole.create({
      data: { userId: id, roleId: role.id, grantedBy: request.user!.id, justification: parsed.data.justification },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "user_role",
      entityId: userRole.id,
      newValues: { userId: id, roleCode: parsed.data.role_code, justification: parsed.data.justification },
      ipAddress: request.ip,
    });
    return reply.code(201).send(userRole);
  });

  fastify.patch(
    "/api/v1/user-roles/:id/revoke",
    { preHandler: requirePermission("users", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = revokeRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      // Le compte passe-partout ne peut pas être privé de son rôle de secours.
      const existingRole = await prisma.userRole.findUnique({
        where: { id },
        include: { user: { select: { isProtected: true } }, role: { select: { code: true } } },
      });
      if (existingRole?.user.isProtected && existingRole.role.code === "ADMIN_GENERAL") {
        return reply.code(409).send({ code: "protected_account", message: "Le rôle du compte passe-partout ne peut pas être retiré." });
      }
      const userRole = await prisma.userRole.update({
        where: { id },
        data: { revokedAt: new Date(), justification: parsed.data.justification },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "user_role",
        entityId: id,
        newValues: { revoked: true, justification: parsed.data.justification },
        ipAddress: request.ip,
      });
      return reply.send(userRole);
    },
  );

  // Détection d'anomalies (Ch. 19 §19.4) : compte actif sans dossier RH actif
  // (hors comptes techniques ADMIN_GENERAL, documenté), cumul saisie +
  // administration sur un même module sensible (Ch. 18 §18.11).
  fastify.get("/api/v1/access-anomalies", { preHandler: requirePermission("rh", "consultation") }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { status: "active", deletedAt: null },
      include: { employee: true, userRoles: { where: { revokedAt: null }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });

    const anomalies: { type: string; user_id: string; username: string; detail: string }[] = [];
    const sensitiveModules = ["finance", "royalties"];

    for (const user of users) {
      const roleCodes = user.userRoles.map((ur) => ur.role.code);
      const hasEmployee = user.employee !== null && !user.employee.departureDate;
      if (!hasEmployee && !roleCodes.includes("ADMIN_GENERAL")) {
        anomalies.push({ type: "compte_sans_dossier_rh", user_id: user.id, username: user.username, detail: "Compte actif sans dossier RH actif." });
      }
      for (const module of sensitiveModules) {
        const perms = new Set(user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`)));
        if (perms.has(`${module}:saisie`) && perms.has(`${module}:administration`) && !roleCodes.includes("ADMIN_GENERAL")) {
          anomalies.push({
            type: "cumul_saisie_administration",
            user_id: user.id,
            username: user.username,
            detail: `Cumule saisie et administration sur le module "${module}" — risque de séparation des tâches (Ch. 18 §18.11).`,
          });
        }
      }
    }
    return reply.send(anomalies);
  });

  // Revue périodique des habilitations (Ch. 19 §19.4) : un item par employé
  // ayant un responsable identifié — un employé sans responsable n'a pas de
  // réviseur naturel désigné par le texte (simplification documentée).
  fastify.post("/api/v1/access-reviews", { preHandler: requirePermission("rh", "administration") }, async (request, reply) => {
    const schema = z.object({ label: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const employees = await prisma.employee.findMany({ where: { deletedAt: null, departureDate: null, managerId: { not: null } } });
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.accessReview.create({ data: { label: parsed.data.label, launchedBy: request.user!.id } });
      await tx.accessReviewItem.createMany({
        data: employees.map((e) => ({ accessReviewId: created.id, employeeId: e.id, reviewerId: e.managerId! })),
      });
      return created;
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "access_review", entityId: review.id, newValues: { label: parsed.data.label, itemCount: employees.length }, ipAddress: request.ip });
    return reply.code(201).send(review);
  });

  fastify.get("/api/v1/access-reviews", { preHandler: requirePermission("rh", "consultation") }, async (_request, reply) => {
    const reviews = await prisma.accessReview.findMany({ orderBy: { launchedAt: "desc" } });
    return reply.send(reviews);
  });

  fastify.get("/api/v1/access-reviews/:id/items", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { reviewer?: string };
    const items = await prisma.accessReviewItem.findMany({
      where: {
        accessReviewId: id,
        ...(query.reviewer === "me" ? { reviewer: { user: { id: request.user!.id } } } : {}),
      },
      include: { employee: true, reviewer: true },
    });
    return reply.send(items);
  });

  fastify.patch(
    "/api/v1/access-review-items/:id",
    { preHandler: requirePermission("rh", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ decision: z.nativeEnum(AccessReviewDecision), comment: z.string().optional() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const item = await prisma.accessReviewItem.update({
        where: { id },
        data: { decision: parsed.data.decision, comment: parsed.data.comment, decidedAt: new Date() },
      });
      return reply.send(item);
    },
  );

  // --- Absences et disponibilité (Ch. 19 §19.5) ---

  fastify.post("/api/v1/absences", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const parsed = absenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const fromDate = new Date(parsed.data.from_date);
    const toDate = new Date(parsed.data.to_date);
    if (toDate < fromDate) {
      return reply.code(400).send({ code: "validation_error", message: "La date de fin doit suivre la date de début." });
    }
    const employee = await prisma.employee.findUnique({ where: { id: parsed.data.employee_id } });
    if (!employee) {
      return reply.code(404).send({ code: "not_found", message: "Dossier collaborateur introuvable." });
    }
    const absence = await prisma.absence.create({
      data: {
        employeeId: parsed.data.employee_id,
        type: parsed.data.type,
        fromDate,
        toDate,
        reason: parsed.data.reason,
        createdBy: request.user!.id,
      },
    });

    if (employee.managerId) {
      const managerUser = await prisma.user.findUnique({ where: { employeeId: employee.managerId } });
      if (managerUser) {
        await prisma.notification.create({
          data: {
            userId: managerUser.id,
            type: "validation",
            priority: "medium",
            title: "Demande d'absence à valider",
            body: `${employee.firstName} ${employee.lastName} demande une absence du ${fromDate.toISOString().slice(0, 10)} au ${toDate.toISOString().slice(0, 10)}.`,
            entityType: "absence",
            entityId: absence.id,
          },
        });
      }
    }

    return reply.code(201).send(absence);
  });

  fastify.get("/api/v1/absences", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const query = request.query as { employee_id?: string; status?: string };
    const absences = await prisma.absence.findMany({
      where: {
        ...(query.employee_id ? { employeeId: query.employee_id } : {}),
        ...(query.status ? { status: query.status as AbsenceStatus } : {}),
      },
      orderBy: { fromDate: "desc" },
    });
    return reply.send(absences);
  });

  // Circuit demandeur → responsable (Ch. 19 §19.5) : seul un "conge" validé
  // décrémente le solde de congés (nombre de jours calendaires — pas de
  // calendrier de jours ouvrés/fériés paramétré, simplification documentée).
  fastify.patch("/api/v1/absences/:id/decide", { preHandler: requirePermission("rh", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({ decision: z.enum(["validee", "refusee"]) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const absence = await prisma.absence.findUnique({ where: { id } });
    if (!absence) {
      return reply.code(404).send({ code: "not_found", message: "Demande d'absence introuvable." });
    }
    if (absence.status !== "en_attente") {
      return reply.code(409).send({ code: "invalid_transition", message: "Cette demande a déjà été traitée." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.absence.update({
        where: { id },
        data: { status: parsed.data.decision, approvedBy: request.user!.id, approvedAt: new Date() },
      });
      if (parsed.data.decision === "validee" && absence.type === "conge") {
        const days = Math.ceil((absence.toDate.getTime() - absence.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        await tx.employee.update({ where: { id: absence.employeeId }, data: { leaveBalanceDays: { decrement: days } } });
      }
      return result;
    });
    return reply.send(updated);
  });

  // Alimente le Gantt et l'affectation des missions (Ch. 8 §8.7, Ch. 19 §19.5).
  fastify.get("/api/v1/availability", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const query = request.query as { department?: string; period_start?: string; period_end?: string };
    const periodStart = query.period_start ? new Date(query.period_start) : new Date();
    const periodEnd = query.period_end ? new Date(query.period_end) : new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

    const employees = await prisma.employee.findMany({
      where: { deletedAt: null, departureDate: null, ...(query.department ? { departmentId: query.department } : {}) },
      include: {
        absences: {
          where: { status: "validee", fromDate: { lte: periodEnd }, toDate: { gte: periodStart } },
        },
      },
    });

    return reply.send(
      employees.map((e) => ({
        employee_id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        unavailable_periods: e.absences.map((a) => ({ from: a.fromDate, to: a.toDate, type: a.type })),
      })),
    );
  });

  // --- Charge de travail (Ch. 19 §19.6) — consolidée depuis les autres
  // modules, aucune saisie supplémentaire. ---

  fastify.get("/api/v1/workload", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const query = request.query as { department_id?: string; person_id?: string };
    const employees = await prisma.employee.findMany({
      where: { deletedAt: null, ...(query.department_id ? { departmentId: query.department_id } : {}), ...(query.person_id ? { id: query.person_id } : {}) },
      include: { user: true },
    });

    const workload = await Promise.all(
      employees
        .filter((e) => e.user)
        .map(async (e) => {
          const userId = e.user!.id;
          const [tasksInProgress, tasksDone, tasksLate, upcoming] = await Promise.all([
            prisma.task.count({ where: { assigneeId: userId, status: { in: ["en_cours"] }, deletedAt: null } }),
            prisma.task.count({ where: { assigneeId: userId, status: "terminee", deletedAt: null } }),
            prisma.task.count({
              where: { assigneeId: userId, deletedAt: null, status: { notIn: ["terminee"] }, plannedEnd: { lt: new Date() } },
            }),
            prisma.task.count({ where: { assigneeId: userId, deletedAt: null, status: "non_commencee", plannedStart: { gte: new Date() } } }),
          ]);
          return {
            employee_id: e.id,
            name: `${e.firstName} ${e.lastName}`,
            tasks_in_progress: tasksInProgress,
            tasks_done: tasksDone,
            tasks_late: tasksLate,
            tasks_upcoming: upcoming,
          };
        }),
    );
    return reply.send(workload);
  });

  // --- Compétences (Ch. 19 §19.8) ---

  fastify.post("/api/v1/skills", { preHandler: requirePermission("rh", "administration") }, async (request, reply) => {
    const parsed = skillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const skill = await prisma.skill.upsert({
      where: { category_label: { category: parsed.data.category, label: parsed.data.label } },
      update: {},
      create: { category: parsed.data.category, label: parsed.data.label },
    });
    return reply.code(201).send(skill);
  });

  fastify.get("/api/v1/skills", { preHandler: requirePermission("rh", "consultation") }, async (_request, reply) => {
    const skills = await prisma.skill.findMany({ orderBy: [{ category: "asc" }, { label: "asc" }] });
    return reply.send(skills);
  });

  fastify.post("/api/v1/employees/:id/skills", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = employeeSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const employeeSkill = await prisma.employeeSkill.upsert({
      where: { employeeId_skillId: { employeeId: id, skillId: parsed.data.skill_id } },
      update: { level: parsed.data.level },
      create: { employeeId: id, skillId: parsed.data.skill_id, level: parsed.data.level },
    });
    return reply.code(201).send(employeeSkill);
  });

  // --- Variables de paie (Ch. 19 §19.7) ---

  fastify.post("/api/v1/payroll-variables", { preHandler: requirePermission("rh_confidentiel", "saisie") }, async (request, reply) => {
    const parsed = payrollVariableSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const variable = await prisma.payrollVariable.upsert({
      where: { employeeId_periodKey: { employeeId: parsed.data.employee_id, periodKey: parsed.data.period_key } },
      update: {
        presenceDays: parsed.data.presence_days,
        absenceDays: parsed.data.absence_days,
        bonusAmount: parsed.data.bonus_amount,
        missionsAmount: parsed.data.missions_amount,
      },
      create: {
        employeeId: parsed.data.employee_id,
        periodKey: parsed.data.period_key,
        presenceDays: parsed.data.presence_days,
        absenceDays: parsed.data.absence_days,
        bonusAmount: parsed.data.bonus_amount,
        missionsAmount: parsed.data.missions_amount,
        createdBy: request.user!.id,
      },
    });
    return reply.code(201).send(variable);
  });

  fastify.get("/api/v1/payroll-variables", { preHandler: requirePermission("rh_confidentiel", "consultation") }, async (request, reply) => {
    const query = request.query as { period_key?: string; employee_id?: string };
    const variables = await prisma.payrollVariable.findMany({
      where: { ...(query.period_key ? { periodKey: query.period_key } : {}), ...(query.employee_id ? { employeeId: query.employee_id } : {}) },
    });
    return reply.send(variables);
  });

  fastify.patch(
    "/api/v1/payroll-variables/:id/export",
    { preHandler: requirePermission("rh_confidentiel", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const variable = await prisma.payrollVariable.update({ where: { id }, data: { exportedAt: new Date() } });
      await writeAuditLog({ userId: request.user!.id, action: "export", entityType: "payroll_variable", entityId: id, ipAddress: request.ip });
      return reply.send(variable);
    },
  );

  // ── Signalement de clôture d'activité mensuelle (rubrique RH) ───────────────
  // État de la prochaine clôture (dernier jour ouvrable du mois) + rappels émis.
  // Consulter cette rubrique déclenche aussi, au passage, la génération
  // paresseuse des rappels automatiques (jour-2 / jour-1, au meilleur effort).
  fastify.get(
    "/api/v1/hr/activity-closure",
    { preHandler: requirePermission("rh", "consultation") },
    async (_request, reply) => {
      void sweepClosureReminders().catch(() => {});
      return reply.send(await activityClosureStatus());
    },
  );

  // Envoi manuel du rappel (responsable habilité), hors fenêtre automatique.
  fastify.post(
    "/api/v1/hr/activity-closure/remind",
    { preHandler: requirePermission("rh", "administration") },
    async (request, reply) => {
      try {
        const result = await sendClosureReminderNow({ id: request.user!.id, ip: request.ip });
        return reply.send({ ok: true, ...result });
      } catch (err) {
        return reply.code(409).send({ code: "reminder_failed", message: err instanceof Error ? err.message : "Envoi impossible." });
      }
    },
  );

  // Le jour de clôture n'est plus paramétrable : c'est le dernier jour ouvrable
  // du mois, calculé automatiquement (horaire de la maison + jours fériés).
}
