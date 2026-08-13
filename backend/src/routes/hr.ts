import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { EmployeeStatus, HrContractType, AbsenceType, AbsenceStatus, AccessReviewDecision, JobOpeningStatus, JobApplicationStatus, TrainingRequestStatus, TrainingSessionMode, TrainingSessionStatus, TrainingParticipationStatus } from "@prisma/client";
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
  marital_status: z.string().max(60).optional(),
  children_count: z.number().int().min(0).max(30).optional(),
  phone: z.string().max(40).optional(),
  leave_taken_days: z.number().min(0).max(400).optional(),
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
  // Rattachement à un compte EXISTANT (créé auparavant par l'administrateur,
  // sans dossier RH) : on lie ce compte au nouveau dossier au lieu d'en créer
  // un. Exclusif avec `account`.
  link_user_id: z.string().uuid().optional(),
});

const employeeUpdateSchema = z.object({
  // Identité éditable après création : jusqu'ici le PATCH ignorait nom / prénom /
  // date d'embauche, ce qui donnait l'impression que la modification « ne se
  // sauvegardait pas » (Problème A — persistance de la fiche employé).
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  hire_date: z.string().datetime().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  position: z.string().optional(),
  manager_id: z.string().uuid().nullable().optional(),
  birth_date: z.string().datetime().nullable().optional(),
  marital_status: z.string().max(60).nullable().optional(),
  children_count: z.number().int().min(0).max(30).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  leave_taken_days: z.number().min(0).max(400).nullable().optional(),
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

    if (body.account && body.link_user_id) {
      return reply.code(400).send({ code: "validation_error", message: "Choisissez soit un nouveau compte, soit le rattachement à un compte existant — pas les deux." });
    }

    // Rattachement à un compte existant : il doit exister, être actif, interne
    // et ne pas déjà porter un dossier RH.
    if (body.link_user_id) {
      const target = await prisma.user.findFirst({ where: { id: body.link_user_id, deletedAt: null } });
      if (!target) {
        return reply.code(404).send({ code: "not_found", message: "Compte à rattacher introuvable." });
      }
      if (target.accountType !== "internal") {
        return reply.code(400).send({ code: "external_account", message: "Un compte externe (auteur, relecteur) ne peut pas porter un dossier RH." });
      }
      if (target.employeeId) {
        return reply.code(409).send({ code: "already_linked", message: "Ce compte a déjà un dossier RH." });
      }
    }

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
          maritalStatus: body.marital_status,
          childrenCount: body.children_count,
          phone: body.phone,
          leaveTakenDays: body.leave_taken_days,
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
      } else if (body.link_user_id) {
        // Rattachement d'un compte déjà ouvert par l'administrateur à ce nouveau
        // dossier RH : le compte existe déjà, on ne crée ni compte ni rôle, on
        // le relie simplement à la fiche employé. Régularise les « comptes
        // actifs sans dossier RH ».
        await tx.user.update({ where: { id: body.link_user_id }, data: { employeeId: created.id, updatedBy: request.user!.id } });
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
        // Chaque champ n'est réécrit QUE s'il est présent dans la requête
        // (`!== undefined`) : une modification partielle ne remet jamais un autre
        // champ à zéro. Corrige la « disparition » du nom / de la date d'embauche.
        ...(parsed.data.first_name !== undefined ? { firstName: parsed.data.first_name.trim() } : {}),
        ...(parsed.data.last_name !== undefined ? { lastName: parsed.data.last_name.trim() } : {}),
        ...(parsed.data.hire_date !== undefined ? { hireDate: parsed.data.hire_date ? new Date(parsed.data.hire_date) : null } : {}),
        departmentId: parsed.data.department_id,
        status: parsed.data.status,
        position: parsed.data.position,
        managerId: parsed.data.manager_id,
        ...(parsed.data.birth_date !== undefined ? { birthDate: parsed.data.birth_date ? new Date(parsed.data.birth_date) : null } : {}),
        ...(parsed.data.marital_status !== undefined ? { maritalStatus: parsed.data.marital_status } : {}),
        ...(parsed.data.children_count !== undefined ? { childrenCount: parsed.data.children_count } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
        ...(parsed.data.leave_taken_days !== undefined ? { leaveTakenDays: parsed.data.leave_taken_days } : {}),
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
    const contracts = await prisma.hrContract.findMany({
      where: { employeeId: id },
      orderBy: { startDate: "desc" },
      include: { amendments: { orderBy: { effectiveDate: "desc" } } },
    });
    return reply.send(contracts);
  });

  // Avenant à un contrat de travail (modification tracée, date d'effet).
  fastify.post("/api/v1/employees/:id/contracts/:contractId/amendments", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id, contractId } = request.params as { id: string; contractId: string };
    const parsed = z.object({ effective_date: z.string().datetime(), subject: z.string().min(2).max(200), description: z.string().max(4000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const contract = await prisma.hrContract.findFirst({ where: { id: contractId, employeeId: id } });
    if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat de travail introuvable." });
    const amendment = await prisma.hrContractAmendment.create({
      data: { contractId, effectiveDate: new Date(parsed.data.effective_date), subject: parsed.data.subject, description: parsed.data.description, createdBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "hr_contract_amendment", entityId: amendment.id, newValues: { contractId, subject: parsed.data.subject }, ipAddress: request.ip });
    return reply.code(201).send(amendment);
  });

  // Évaluations annuelles d'un collaborateur (note + objectifs individuels).
  fastify.get("/api/v1/employees/:id/evaluations", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.employeeEvaluation.findMany({ where: { employeeId: id }, orderBy: { year: "desc" } });
    return reply.send(rows);
  });

  fastify.put("/api/v1/employees/:id/evaluations", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ year: z.number().int().min(2000).max(2100), rating: z.number().int().min(1).max(5), strengths: z.string().max(4000).optional(), areas_to_improve: z.string().max(4000).optional(), objectives: z.string().max(4000).optional() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) return reply.code(404).send({ code: "not_found", message: "Collaborateur introuvable." });
    const b = parsed.data;
    const saved = await prisma.employeeEvaluation.upsert({
      where: { employeeId_year: { employeeId: id, year: b.year } },
      create: { employeeId: id, year: b.year, rating: b.rating, strengths: b.strengths, areasToImprove: b.areas_to_improve, objectives: b.objectives, createdBy: request.user!.id },
      update: { rating: b.rating, strengths: b.strengths, areasToImprove: b.areas_to_improve, objectives: b.objectives },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "employee_evaluation", entityId: saved.id, newValues: { year: b.year, rating: b.rating }, ipAddress: request.ip });
    return reply.send(saved);
  });

  // Alertes d'expiration des contrats de travail (refonte RH — Étape 3) :
  // contrats à échéance dans l'horizon (défaut 60 jours) ou déjà échus, pour les
  // collaborateurs en poste. Permet d'anticiper renouvellements et fins de CDD.
  fastify.get("/api/v1/hr/contract-alerts", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const days = Math.max(1, Math.min(365, Number((request.query as { days?: string }).days) || 60));
    const now = new Date();
    const limit = new Date(now.getTime() + days * 864e5);
    const rows = await prisma.hrContract.findMany({
      where: { endDate: { not: null, lte: limit }, employee: { deletedAt: null, departureDate: null } },
      include: { employee: { select: { id: true, firstName: true, lastName: true, position: true } } },
      orderBy: { endDate: "asc" },
      take: 100,
    });
    const alerts = rows.map((c) => ({
      contract_id: c.id,
      employee: `${c.employee.firstName} ${c.employee.lastName}`,
      position: c.employee.position,
      type: c.type,
      end_date: c.endDate,
      status: c.endDate && c.endDate < now ? "expired" : "expiring",
      days_left: c.endDate ? Math.ceil((c.endDate.getTime() - now.getTime()) / 864e5) : null,
    }));
    return reply.send({ horizon_days: days, alerts });
  });

  // ─── Tableau de bord RH (remplace l'ancien tableau de présence) ────────────
  // Indicateurs utiles au RH : effectif & répartition, contrats à échéance,
  // congés, recrutement & formation. Aucune donnée de présence/pointage.
  fastify.get("/api/v1/hr/dashboard", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 864e5);
    const in30 = new Date(now.getTime() + 30 * 864e5);
    const today0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [employees, endingContracts, leavesPending, leavesOngoing, leavesUpcoming, openPositions, applicationsActive, trainingsPlanned, trainingRequestsPending] = await Promise.all([
      // Effectif actif (non supprimé, non parti) avec département et dernier contrat.
      prisma.employee.findMany({
        where: { deletedAt: null, departureDate: null },
        select: {
          id: true, status: true, leaveBalanceDays: true,
          department: { select: { name: true } },
          hrContracts: { orderBy: { startDate: "desc" }, take: 1, select: { type: true } },
        },
      }),
      // Contrats (CDD/stage/prestation surtout) arrivant à échéance sous 60 jours.
      prisma.hrContract.findMany({
        where: { endDate: { not: null, gte: now, lte: in60 }, employee: { deletedAt: null, departureDate: null } },
        include: { employee: { select: { firstName: true, lastName: true, position: true } } },
        orderBy: { endDate: "asc" }, take: 20,
      }),
      // Congés en attente de validation.
      prisma.absence.findMany({
        where: { type: "conge", status: "en_attente" },
        include: { employee: { select: { firstName: true, lastName: true } } },
        orderBy: { fromDate: "asc" }, take: 20,
      }),
      prisma.absence.count({ where: { type: "conge", status: "validee", fromDate: { lte: now }, toDate: { gte: today0 } } }),
      prisma.absence.count({ where: { type: "conge", status: "validee", fromDate: { gt: now, lte: in30 } } }),
      prisma.jobOpening.count({ where: { status: "ouvert" } }),
      prisma.jobApplication.count({ where: { status: { in: ["recue", "entretien"] } } }),
      prisma.trainingSession.count({ where: { status: "planifiee" } }),
      prisma.trainingRequest.count({ where: { status: "demandee" } }),
    ]);

    const byDepartment: Record<string, number> = {};
    const byContractType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let leaveBalanceTotal = 0;
    for (const e of employees) {
      const dep = e.department?.name ?? "Sans département";
      byDepartment[dep] = (byDepartment[dep] ?? 0) + 1;
      const ct = e.hrContracts[0]?.type ?? "sans_contrat";
      byContractType[ct] = (byContractType[ct] ?? 0) + 1;
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      leaveBalanceTotal += e.leaveBalanceDays != null ? Number(e.leaveBalanceDays) : 0;
    }

    return reply.send({
      effectif: {
        total: employees.length,
        by_department: Object.entries(byDepartment).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        by_contract_type: Object.entries(byContractType).map(([type, count]) => ({ type, count })),
        by_status: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      },
      contracts: {
        ending_soon: endingContracts.map((c) => ({
          employee: `${c.employee.firstName} ${c.employee.lastName}`,
          position: c.employee.position,
          type: c.type,
          end_date: c.endDate,
          days_left: c.endDate ? Math.ceil((c.endDate.getTime() - now.getTime()) / 864e5) : null,
        })),
      },
      leaves: {
        balance_total_days: Math.round(leaveBalanceTotal * 10) / 10,
        pending_count: leavesPending.length,
        ongoing_count: leavesOngoing,
        upcoming_count: leavesUpcoming,
        pending: leavesPending.map((a) => ({ employee: `${a.employee.firstName} ${a.employee.lastName}`, from: a.fromDate, to: a.toDate })),
      },
      recruitment_training: {
        open_positions: openPositions,
        applications_active: applicationsActive,
        trainings_planned: trainingsPlanned,
        training_requests_pending: trainingRequestsPending,
      },
    });
  });

  // ─── Détection des doublons d'employés ─────────────────────────────────────
  // Regroupe les fiches qui désignent probablement la MÊME personne : même
  // nom+prénom (insensible à la casse et aux accents) OU même téléphone. Pour
  // chaque fiche, on remonte de quoi décider laquelle garder (matricule, date
  // d'embauche, et le volume de données liées : contrats, absences, bulletins…).
  fastify.get("/api/v1/hr/duplicates", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const employees = await prisma.employee.findMany({
      where: { deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, phone: true, hireDate: true, createdAt: true,
        payrollProfile: { select: { matricule: true } },
        _count: { select: { hrContracts: true, absences: true, payrollMonthlyLines: true, payrollVariables: true, evaluations: true, trainingRequests: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    // Tokens significatifs du nom complet (mots de ≥ 2 lettres).
    const tokensOf = (e: (typeof employees)[number]) => new Set(norm(`${e.firstName} ${e.lastName}`).split(" ").filter((w) => w.length >= 2));
    const tok = employees.map(tokensOf);
    // Union-find : deux fiches sont réunies si elles PARTAGENT ≥ 2 mots de nom
    // (ex. « NOAH MBA » / « NOAH MBALA » partagent NOAH+…), OU même matricule,
    // OU même téléphone. Détection large → l'opérateur tranche (rien d'automatique).
    const parent = employees.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
    for (let i = 0; i < employees.length; i++) {
      for (let j = i + 1; j < employees.length; j++) {
        let shared = 0;
        for (const w of tok[i]) if (tok[j].has(w)) shared++;
        const sameMat = employees[i].payrollProfile?.matricule && employees[i].payrollProfile?.matricule === employees[j].payrollProfile?.matricule;
        const samePhone = employees[i].phone && employees[i].phone === employees[j].phone;
        if (shared >= 2 || sameMat || samePhone) union(i, j);
      }
    }
    const groups = new Map<number, typeof employees>();
    employees.forEach((e, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(e); });
    const duplicates = [...groups.values()]
      .filter((g) => g.length > 1)
      .map((g) => ({
        key: `${g[0].firstName} ${g[0].lastName}`,
        records: g.map((e) => {
          const linked = e._count.hrContracts + e._count.absences + e._count.payrollMonthlyLines + e._count.payrollVariables + e._count.evaluations + e._count.trainingRequests;
          return {
            employee_id: e.id,
            name: `${e.firstName} ${e.lastName}`,
            matricule: e.payrollProfile?.matricule ?? null,
            phone: e.phone,
            hire_date: e.hireDate ? e.hireDate.toISOString().slice(0, 10) : null,
            created_at: e.createdAt,
            linked_total: linked,
            linked: {
              contrats: e._count.hrContracts, absences: e._count.absences, bulletins: e._count.payrollMonthlyLines,
              variables_paie: e._count.payrollVariables, evaluations: e._count.evaluations, formations: e._count.trainingRequests,
            },
          };
        }),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return reply.send({ groups: duplicates, total_groups: duplicates.length });
  });

  // Suppression LOGIQUE d'une fiche employé (doublon). Réversible (deletedAt) :
  // les données liées éventuelles sont conservées, jamais cassées. On renvoie
  // le volume de données liées pour information (le front demande confirmation).
  fastify.delete("/api/v1/employees/:id", { preHandler: requirePermission("rh", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const emp = await prisma.employee.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, _count: { select: { payrollMonthlyLines: true, absences: true, hrContracts: true } } },
    });
    if (!emp) return reply.code(404).send({ code: "not_found", message: "Employé introuvable." });
    await prisma.employee.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id, action: "update", entityType: "employee", entityId: id,
      oldValues: { name: `${emp.firstName} ${emp.lastName}`, deletedAt: null },
      newValues: { deletedAt: new Date().toISOString(), reason: "suppression logique (doublon)", linked: emp._count },
      ipAddress: request.ip,
    });
    return reply.send({ deleted: true, name: `${emp.firstName} ${emp.lastName}` });
  });

  // ─── Recrutement : postes à pourvoir & candidatures (module amont RH) ───────
  // Un poste ouvert reçoit des candidatures ; chaque candidature suit le circuit
  // reçue → entretien → retenue / refusée. Le poste se clôt (pourvu / annulé).

  fastify.post("/api/v1/job-openings", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const parsed = z
      .object({
        title: z.string().min(2).max(200),
        department_id: z.string().uuid().optional(),
        contract_type: z.nativeEnum(HrContractType).optional(),
        description: z.string().max(8000).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const opening = await prisma.jobOpening.create({
      data: {
        title: parsed.data.title,
        departmentId: parsed.data.department_id,
        contractType: parsed.data.contract_type,
        description: parsed.data.description,
        createdBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "job_opening", entityId: opening.id, newValues: { title: opening.title }, ipAddress: request.ip });
    return reply.code(201).send(opening);
  });

  // Liste des postes (filtre statut) avec le décompte des candidatures par état.
  fastify.get("/api/v1/job-openings", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const status = (request.query as { status?: string }).status;
    const where = status && (Object.values(JobOpeningStatus) as string[]).includes(status) ? { status: status as JobOpeningStatus } : {};
    const rows = await prisma.jobOpening.findMany({
      where,
      orderBy: { openedAt: "desc" },
      include: {
        department: { select: { name: true } },
        applications: { select: { status: true } },
      },
    });
    const openings = rows.map((o) => {
      const counts = { recue: 0, entretien: 0, retenue: 0, refusee: 0 };
      for (const a of o.applications) counts[a.status] += 1;
      return {
        id: o.id,
        title: o.title,
        department: o.department?.name ?? null,
        contract_type: o.contractType,
        description: o.description,
        status: o.status,
        opened_at: o.openedAt,
        closed_at: o.closedAt,
        applications_total: o.applications.length,
        applications_by_status: counts,
      };
    });
    return reply.send(openings);
  });

  // Clôture / réouverture d'un poste (pourvu, annulé, réouvert).
  fastify.patch("/api/v1/job-openings/:id/status", { preHandler: requirePermission("rh", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.nativeEnum(JobOpeningStatus) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Statut invalide.", details: parsed.error.issues });
    const opening = await prisma.jobOpening.findUnique({ where: { id } });
    if (!opening) return reply.code(404).send({ code: "not_found", message: "Poste introuvable." });
    const updated = await prisma.jobOpening.update({
      where: { id },
      data: { status: parsed.data.status, closedAt: parsed.data.status === "ouvert" ? null : new Date(), updatedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "job_opening", entityId: id, newValues: { status: parsed.data.status }, ipAddress: request.ip });
    return reply.send(updated);
  });

  // Ajout d'une candidature sur un poste.
  fastify.post("/api/v1/job-openings/:id/applications", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        first_name: z.string().min(1).max(120),
        last_name: z.string().min(1).max(120),
        email: z.string().email().max(200).optional(),
        phone: z.string().max(40).optional(),
        source: z.string().max(120).optional(),
        notes: z.string().max(8000).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const opening = await prisma.jobOpening.findUnique({ where: { id } });
    if (!opening) return reply.code(404).send({ code: "not_found", message: "Poste introuvable." });
    const app = await prisma.jobApplication.create({
      data: {
        jobOpeningId: id,
        firstName: parsed.data.first_name,
        lastName: parsed.data.last_name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        source: parsed.data.source,
        notes: parsed.data.notes,
        createdBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "job_application", entityId: app.id, newValues: { jobOpeningId: id }, ipAddress: request.ip });
    return reply.code(201).send(app);
  });

  // Candidatures d'un poste (les plus récentes d'abord).
  fastify.get("/api/v1/job-openings/:id/applications", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.jobApplication.findMany({ where: { jobOpeningId: id }, orderBy: { appliedAt: "desc" } });
    return reply.send(rows);
  });

  // Avancement d'une candidature dans le circuit (entretien, retenue, refusée).
  fastify.patch("/api/v1/job-applications/:id/status", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.nativeEnum(JobApplicationStatus), notes: z.string().max(8000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Statut invalide.", details: parsed.error.issues });
    const application = await prisma.jobApplication.findUnique({ where: { id } });
    if (!application) return reply.code(404).send({ code: "not_found", message: "Candidature introuvable." });
    const decided = parsed.data.status === "retenue" || parsed.data.status === "refusee";
    const updated = await prisma.jobApplication.update({
      where: { id },
      data: { status: parsed.data.status, notes: parsed.data.notes ?? application.notes, decidedAt: decided ? new Date() : null, updatedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "job_application", entityId: id, newValues: { status: parsed.data.status }, ipAddress: request.ip });
    return reply.send(updated);
  });

  // ─── Formation : demandes, sessions & suivi de participation ────────────────

  // Demande de formation d'un collaborateur (sujet + motivation).
  fastify.post("/api/v1/training-requests", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const parsed = z.object({ employee_id: z.string().uuid(), topic: z.string().min(2).max(200), motivation: z.string().max(4000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employee_id, deletedAt: null } });
    if (!employee) return reply.code(404).send({ code: "not_found", message: "Collaborateur introuvable." });
    const req = await prisma.trainingRequest.create({
      data: { employeeId: parsed.data.employee_id, topic: parsed.data.topic, motivation: parsed.data.motivation, createdBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "training_request", entityId: req.id, newValues: { topic: req.topic }, ipAddress: request.ip });
    return reply.code(201).send(req);
  });

  // Liste des demandes (filtre statut) avec le nom du collaborateur.
  fastify.get("/api/v1/training-requests", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const status = (request.query as { status?: string }).status;
    const where = status && (Object.values(TrainingRequestStatus) as string[]).includes(status) ? { status: status as TrainingRequestStatus } : {};
    const rows = await prisma.trainingRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return reply.send(rows.map((r) => ({
      id: r.id,
      employee_id: r.employeeId,
      employee: `${r.employee.firstName} ${r.employee.lastName}`,
      topic: r.topic,
      motivation: r.motivation,
      status: r.status,
      decided_at: r.decidedAt,
      created_at: r.createdAt,
    })));
  });

  // Décision sur une demande (approuvée / refusée / planifiée).
  fastify.patch("/api/v1/training-requests/:id/status", { preHandler: requirePermission("rh", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.nativeEnum(TrainingRequestStatus) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Statut invalide.", details: parsed.error.issues });
    const existing = await prisma.trainingRequest.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    const decided = parsed.data.status !== "demandee";
    const updated = await prisma.trainingRequest.update({
      where: { id },
      data: { status: parsed.data.status, decidedBy: decided ? request.user!.id : null, decidedAt: decided ? new Date() : null, updatedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "training_request", entityId: id, newValues: { status: parsed.data.status }, ipAddress: request.ip });
    return reply.send(updated);
  });

  // Session de formation (organisme, thème, mode, date, coût).
  fastify.post("/api/v1/training-sessions", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const parsed = z
      .object({
        title: z.string().min(2).max(200),
        provider: z.string().max(200).optional(),
        theme: z.string().max(200).optional(),
        mode: z.nativeEnum(TrainingSessionMode).optional(),
        session_date: z.string().datetime().optional(),
        cost: z.number().nonnegative().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const session = await prisma.trainingSession.create({
      data: {
        title: parsed.data.title,
        provider: parsed.data.provider,
        theme: parsed.data.theme,
        mode: parsed.data.mode ?? "presentiel",
        sessionDate: parsed.data.session_date ? new Date(parsed.data.session_date) : undefined,
        cost: parsed.data.cost,
        createdBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "training_session", entityId: session.id, newValues: { title: session.title }, ipAddress: request.ip });
    return reply.code(201).send(session);
  });

  // Liste des sessions avec le décompte des participants par état.
  fastify.get("/api/v1/training-sessions", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const status = (request.query as { status?: string }).status;
    const where = status && (Object.values(TrainingSessionStatus) as string[]).includes(status) ? { status: status as TrainingSessionStatus } : {};
    const rows = await prisma.trainingSession.findMany({
      where,
      orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
      include: { participations: { select: { status: true } } },
    });
    return reply.send(rows.map((s) => {
      const counts = { inscrit: 0, present: 0, absent: 0 };
      for (const p of s.participations) counts[p.status] += 1;
      return {
        id: s.id,
        title: s.title,
        provider: s.provider,
        theme: s.theme,
        mode: s.mode,
        session_date: s.sessionDate,
        status: s.status,
        cost: s.cost,
        participants_total: s.participations.length,
        participants_by_status: counts,
      };
    }));
  });

  // Clôture d'une session (réalisée / annulée / re-planifiée).
  fastify.patch("/api/v1/training-sessions/:id/status", { preHandler: requirePermission("rh", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.nativeEnum(TrainingSessionStatus) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Statut invalide.", details: parsed.error.issues });
    const existing = await prisma.trainingSession.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Session introuvable." });
    const updated = await prisma.trainingSession.update({ where: { id }, data: { status: parsed.data.status, updatedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "training_session", entityId: id, newValues: { status: parsed.data.status }, ipAddress: request.ip });
    return reply.send(updated);
  });

  // Participants d'une session.
  fastify.get("/api/v1/training-sessions/:id/participants", { preHandler: requirePermission("rh", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.trainingParticipation.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "asc" },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return reply.send(rows.map((p) => ({ id: p.id, employee_id: p.employeeId, employee: `${p.employee.firstName} ${p.employee.lastName}`, status: p.status })));
  });

  // Inscription d'un collaborateur à une session (idempotent par session+collaborateur).
  fastify.post("/api/v1/training-sessions/:id/participants", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ employee_id: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const session = await prisma.trainingSession.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ code: "not_found", message: "Session introuvable." });
    const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employee_id, deletedAt: null } });
    if (!employee) return reply.code(404).send({ code: "not_found", message: "Collaborateur introuvable." });
    const existing = await prisma.trainingParticipation.findUnique({ where: { sessionId_employeeId: { sessionId: id, employeeId: parsed.data.employee_id } } });
    if (existing) return reply.code(409).send({ code: "already_enrolled", message: "Ce collaborateur est déjà inscrit à cette session." });
    const p = await prisma.trainingParticipation.create({ data: { sessionId: id, employeeId: parsed.data.employee_id, createdBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "training_participation", entityId: p.id, newValues: { sessionId: id, employeeId: parsed.data.employee_id }, ipAddress: request.ip });
    return reply.code(201).send(p);
  });

  // Émargement d'un participant (présent / absent / inscrit).
  fastify.patch("/api/v1/training-participations/:id", { preHandler: requirePermission("rh", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.nativeEnum(TrainingParticipationStatus) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Statut invalide.", details: parsed.error.issues });
    const existing = await prisma.trainingParticipation.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Participation introuvable." });
    const updated = await prisma.trainingParticipation.update({ where: { id }, data: { status: parsed.data.status } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "training_participation", entityId: id, newValues: { status: parsed.data.status }, ipAddress: request.ip });
    return reply.send(updated);
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
      // Un compte EXTERNE (auteur, relecteur externe) n'a légitimement pas de
      // dossier RH : ce n'est pas un salarié. On ne le signale donc pas comme
      // « compte sans dossier RH » (sinon faux positif, ex. amina.auteur).
      if (!hasEmployee && user.accountType === "internal" && !roleCodes.includes("ADMIN_GENERAL")) {
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
