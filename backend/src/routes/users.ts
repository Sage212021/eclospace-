import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { PermissionAction } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { validatePasswordComplexity } from "../lib/passwordPolicy.js";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "../lib/session.js";

const resetPasswordSchema = z.object({ new_password: z.string().min(1) });

// Rôle super-administrateur : conserve toujours l'accès complet. Sa matrice de
// droits n'est pas modifiable (garde-fou anti-verrouillage) et il ne peut être
// vidé de ses titulaires.
const SUPERADMIN_ROLE = "ADMIN_GENERAL";

// Identifiant/e-mail « libérés » d'un compte supprimé : on suffixe la valeur
// avec l'id du compte (unique) pour lever la contrainte d'unicité tout en
// gardant la trace de la valeur d'origine. Le compte reste supprimé (logique).
function freedIdentifier(value: string, id: string): string {
  return `${value}#supprimé-${id}`;
}

// Un compte SUPPRIMÉ occupe encore l'identifiant et l'e-mail (contrainte
// d'unicité en base, indépendante de la suppression logique). Avant de créer un
// nouveau compte, on libère ces valeurs sur les éventuels comptes supprimés qui
// les détiennent, pour permettre la réutilisation d'un e-mail/identifiant après
// suppression. Les comptes supprimés ne servent plus à se connecter.
async function releaseDeletedIdentifiers(username: string, email: string): Promise<void> {
  const held = await prisma.user.findMany({
    where: { deletedAt: { not: null }, OR: [{ username }, { email }] },
    select: { id: true, username: true, email: true },
  });
  for (const u of held) {
    await prisma.user.update({
      where: { id: u.id },
      data: {
        ...(u.username === username ? { username: freedIdentifier(u.username, u.id) } : {}),
        ...(u.email === email ? { email: freedIdentifier(u.email, u.id) } : {}),
      },
    });
  }
}

// Vrai si l'erreur est une violation de contrainte d'unicité Prisma (P2002).
function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2002");
}

const createUserSchema = z.object({
  // Espaces de début/fin rognés (fréquents au clavier mobile) pour éviter un
  // identifiant/e-mail « invisible » qui empêcherait ensuite la connexion.
  username: z.string().trim().min(3).max(60),
  email: z.string().trim().email(),
  password: z.string().min(1),
  role_codes: z.array(z.string()).default([]),
});

const patchUserSchema = z
  .object({
    username: z.string().trim().min(3).max(60).optional(),
    email: z.string().trim().email().optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((v) => v.username || v.email || v.status, { message: "Aucune modification fournie." });

const permissionToggleSchema = z.object({
  module: z.string().min(1),
  action: z.nativeEnum(PermissionAction),
  granted: z.boolean(),
});

const departmentSchema = z.object({ name: z.string().min(1), code: z.string().min(1).max(30).optional() });

function slugCode(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "POLE"
  );
}

// Comptes et habilitations (Ch. 2). La liste minimale des comptes actifs sert
// aux sélecteurs "responsable du dossier" / "lecteur affecté" (Ch. 6, Ch. 7) ;
// l'attribution/retrait de rôle vit dans hr.ts. Les deux routes de lecture
// ci-dessous alimentent l'écran dédié « Utilisateurs & rôles ».
export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/users", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, status: "active" },
      select: { id: true, username: true, email: true },
      orderBy: { username: "asc" },
    });
    return reply.send(users);
  });

  // Référentiel des rôles applicatifs (Ch. 2 §2.2) — pour le sélecteur
  // d'attribution de rôle de l'écran Utilisateurs & rôles.
  fastify.get("/api/v1/roles", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const roles = await prisma.role.findMany({
      include: { department: { select: { name: true } } },
      orderBy: { label: "asc" },
    });
    return reply.send(
      roles.map((r) => ({ id: r.id, code: r.code, label: r.label, department: r.department?.name ?? null })),
    );
  });

  // Audit des accès (Ch. 2 §2.4) : « qui détient tel accès sensible, et par
  // quel rôle ? ». Résout, pour une permission module:action, la liste des
  // comptes actifs qui la détiennent (via leurs rôles) — pour repérer et
  // corriger les habilitations accordées à tort. Réservé à l'administration.
  fastify.get("/api/v1/access-audit", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const q = request.query as { permission?: string };
    const target = (q.permission ?? "users:administration").trim();
    const [module, action] = target.split(":");
    if (!module || !action) {
      return reply.code(400).send({ code: "validation_error", message: "Permission invalide (format attendu : module:action)." });
    }

    // Rôles qui incluent la permission cible.
    const roles = await prisma.role.findMany({ include: { rolePermissions: { include: { permission: true } } } });
    const grantingRoleIds = new Set(
      roles
        .filter((r) => r.rolePermissions.some((rp) => rp.permission.module === module && rp.permission.action === action))
        .map((r) => r.id),
    );

    const users = await prisma.user.findMany({
      where: { deletedAt: null, status: "active" },
      select: {
        id: true,
        username: true,
        email: true,
        userRoles: { where: { revokedAt: null }, select: { role: { select: { id: true, code: true, label: true } } } },
      },
      orderBy: { username: "asc" },
    });

    const holders = users
      .map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        via_roles: u.userRoles
          .filter((ur) => grantingRoleIds.has(ur.role.id))
          .map((ur) => ({ code: ur.role.code, label: ur.role.label })),
      }))
      .filter((u) => u.via_roles.length > 0);

    return reply.send({ permission: target, holders });
  });

  // Comptes avec leurs rôles actifs (Ch. 2 §2.4) — vue consolidée pour la
  // gestion des habilitations.
  fastify.get("/api/v1/users-with-roles", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        userRoles: {
          where: { revokedAt: null },
          select: { id: true, role: { select: { code: true, label: true } } },
        },
      },
      orderBy: { username: "asc" },
    });
    return reply.send(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        status: u.status,
        roles: u.userRoles.map((ur) => ({ userRoleId: ur.id, code: ur.role.code, label: ur.role.label })),
      })),
    );
  });

  // Réinitialisation du mot de passe par un administrateur (Ch. 2, sécurité des
  // comptes). Réservé au niveau « administration » : l'admin fixe un nouveau
  // mot de passe pour un compte (ex. utilisateur ayant perdu le sien). Le
  // nouveau mot de passe doit respecter les règles de complexité ; l'opération
  // est tracée au journal d'audit sans jamais y inscrire le mot de passe.
  fastify.post(
    "/api/v1/users/:id/reset-password",
    { preHandler: requirePermission("users", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
      if (!target) {
        return reply.code(404).send({ code: "not_found", message: "Compte introuvable." });
      }

      const complexityError = validatePasswordComplexity(parsed.data.new_password);
      if (complexityError) {
        return reply.code(400).send({ code: "weak_password", message: complexityError });
      }

      const passwordHash = await argon2.hash(parsed.data.new_password);
      await prisma.user.update({ where: { id: target.id }, data: { passwordHash } });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "user",
        entityId: target.id,
        newValues: { change: "password_reset_by_admin" },
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );

  // --- Gestion des comptes (spéc. fonctionnelle §2) : création, modification,
  // suspension/réactivation, suppression logique. Réservé à l'administration. ---

  fastify.post("/api/v1/users", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const { username, email, password, role_codes } = parsed.data;

    const complexityError = validatePasswordComplexity(password);
    if (complexityError) {
      return reply.code(400).send({ code: "weak_password", message: complexityError });
    }
    if (await prisma.user.findFirst({ where: { username, deletedAt: null } })) {
      return reply.code(409).send({ code: "username_taken", message: `L'identifiant « ${username} » est déjà utilisé.` });
    }
    if (await prisma.user.findFirst({ where: { email, deletedAt: null } })) {
      return reply.code(409).send({ code: "email_taken", message: `L'e-mail « ${email} » est déjà utilisé.` });
    }

    const roles = role_codes.length ? await prisma.role.findMany({ where: { code: { in: role_codes } } }) : [];
    if (roles.length !== role_codes.length) {
      return reply.code(400).send({ code: "unknown_role", message: "Un des rôles indiqués est inconnu." });
    }

    // Un compte supprimé peut encore détenir cet identifiant/e-mail : on le
    // libère pour permettre la réutilisation après suppression.
    await releaseDeletedIdentifiers(username, email);

    const passwordHash = await argon2.hash(password);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
          status: "active",
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
          userRoles: { create: roles.map((r) => ({ roleId: r.id, grantedBy: request.user!.id })) },
        },
        select: { id: true, username: true, email: true, status: true },
      });
    } catch (err) {
      // Filet de sécurité : jamais d'erreur technique brute à l'écran (règle §5).
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ code: "identifiant_taken", message: `L'identifiant « ${username} » ou l'e-mail « ${email} » est déjà utilisé par un autre compte.` });
      }
      throw err;
    }

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "user",
      entityId: user.id,
      newValues: { username, email, roles: role_codes },
      ipAddress: request.ip,
    });

    return reply.code(201).send(user);
  });

  fastify.patch("/api/v1/users/:id", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Champs invalides." });
    }
    const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) {
      return reply.code(404).send({ code: "not_found", message: "Compte introuvable." });
    }
    const { username, email, status } = parsed.data;

    if (status === "suspended" && target.isProtected) {
      return reply.code(409).send({ code: "protected_account", message: "Le compte passe-partout ne peut pas être suspendu." });
    }
    if (status === "suspended" && target.id === request.user!.id) {
      return reply.code(409).send({ code: "cannot_suspend_self", message: "Vous ne pouvez pas suspendre votre propre compte." });
    }
    if (username && username !== target.username && (await prisma.user.findFirst({ where: { username, deletedAt: null, id: { not: id } } }))) {
      return reply.code(409).send({ code: "username_taken", message: `L'identifiant « ${username} » est déjà utilisé.` });
    }
    if (email && email !== target.email && (await prisma.user.findFirst({ where: { email, deletedAt: null, id: { not: id } } }))) {
      return reply.code(409).send({ code: "email_taken", message: `L'e-mail « ${email} » est déjà utilisé.` });
    }
    // Libère l'identifiant/e-mail retenus par d'éventuels comptes supprimés.
    if (username || email) await releaseDeletedIdentifiers(username ?? target.username, email ?? target.email);

    let updated;
    try {
      updated = await prisma.user.update({
      where: { id },
      data: {
        ...(username ? { username } : {}),
        ...(email ? { email } : {}),
        ...(status ? { status } : {}),
        updatedBy: request.user!.id,
      },
      select: { id: true, username: true, email: true, status: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ code: "identifiant_taken", message: `L'identifiant ou l'e-mail indiqué est déjà utilisé par un autre compte.` });
      }
      throw err;
    }

    await writeAuditLog({
      userId: request.user!.id,
      action: status ? "status_change" : "update",
      entityType: "user",
      entityId: id,
      oldValues: { username: target.username, email: target.email, status: target.status },
      newValues: parsed.data,
      ipAddress: request.ip,
    });

    return reply.send(updated);
  });

  fastify.delete("/api/v1/users/:id", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) {
      return reply.code(404).send({ code: "not_found", message: "Compte introuvable." });
    }
    if (target.isProtected) {
      return reply.code(409).send({ code: "protected_account", message: "Le compte passe-partout ne peut pas être supprimé." });
    }
    if (target.id === request.user!.id) {
      return reply.code(409).send({ code: "cannot_delete_self", message: "Vous ne pouvez pas supprimer votre propre compte." });
    }

    // Garde-fou : ne jamais retirer le dernier administrateur général actif.
    const isTargetAdmin = await prisma.userRole.findFirst({
      where: { userId: id, revokedAt: null, role: { code: SUPERADMIN_ROLE } },
    });
    if (isTargetAdmin) {
      const otherAdmins = await prisma.userRole.count({
        where: { revokedAt: null, role: { code: SUPERADMIN_ROLE }, userId: { not: id }, user: { status: "active", deletedAt: null } },
      });
      if (otherAdmins === 0) {
        return reply.code(409).send({ code: "last_admin", message: "Impossible de supprimer le dernier administrateur général actif." });
      }
    }

    // Suppression logique (le compte reste en base, tracé) MAIS on libère
    // l'identifiant et l'e-mail (en les suffixant) pour qu'ils puissent être
    // réutilisés par un nouveau compte — sinon la contrainte d'unicité bloque.
    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: "disabled",
        username: freedIdentifier(target.username, id),
        email: freedIdentifier(target.email, id),
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "user",
      entityId: id,
      oldValues: { username: target.username, email: target.email },
      newValues: { removed: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // --- Matrice des droits éditable (spéc. fonctionnelle §3, décision A) :
  // l'administrateur ajuste les permissions par rôle. Le super-administrateur
  // reste intouchable pour garantir un accès de secours. ---

  fastify.get("/api/v1/permissions", { preHandler: requirePermission("users", "administration") }, async (_request, reply) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }] });
    return reply.send(permissions.map((p) => ({ id: p.id, module: p.module, action: p.action })));
  });

  fastify.get("/api/v1/roles/:id/permissions", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const role = await prisma.role.findFirst({ where: { id, deletedAt: null }, include: { rolePermissions: { include: { permission: true } } } });
    if (!role) {
      return reply.code(404).send({ code: "not_found", message: "Rôle introuvable." });
    }
    return reply.send({
      role: { id: role.id, code: role.code, label: role.label },
      editable: role.code !== SUPERADMIN_ROLE,
      permissions: role.rolePermissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`),
    });
  });

  fastify.post("/api/v1/roles/:id/permissions", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = permissionToggleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const role = await prisma.role.findFirst({ where: { id, deletedAt: null } });
    if (!role) {
      return reply.code(404).send({ code: "not_found", message: "Rôle introuvable." });
    }
    if (role.code === SUPERADMIN_ROLE) {
      return reply.code(409).send({ code: "role_protected", message: "Les droits de l'administrateur général ne sont pas modifiables." });
    }
    const permission = await prisma.permission.findUnique({
      where: { module_action: { module: parsed.data.module, action: parsed.data.action } },
    });
    if (!permission) {
      return reply.code(400).send({ code: "unknown_permission", message: "Permission inconnue." });
    }

    if (parsed.data.granted) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: id, permissionId: permission.id } },
        update: {},
        create: { roleId: id, permissionId: permission.id, createdBy: request.user!.id },
      });
    } else {
      await prisma.rolePermission.deleteMany({ where: { roleId: id, permissionId: permission.id } });
    }

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "role",
      entityId: id,
      newValues: { permission: `${parsed.data.module}:${parsed.data.action}`, granted: parsed.data.granted },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });

  // --- Gestion des pôles / départements (spéc. fonctionnelle §3, décision A :
  // pôle = département, créable par l'administrateur). ---

  fastify.get("/api/v1/departments", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const departments = await prisma.department.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, isActive: true },
    });
    return reply.send(departments);
  });

  fastify.post("/api/v1/departments", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const parsed = departmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Nom du pôle requis.", details: parsed.error.issues });
    }
    const code = parsed.data.code ?? slugCode(parsed.data.name);
    const existing = await prisma.department.findUnique({ where: { code } });
    if (existing && !existing.deletedAt) {
      return reply.code(409).send({ code: "code_taken", message: `Un pôle avec le code « ${code} » existe déjà.` });
    }
    const department = existing
      ? await prisma.department.update({ where: { id: existing.id }, data: { name: parsed.data.name, deletedAt: null, isActive: true, updatedBy: request.user!.id } })
      : await prisma.department.create({ data: { code, name: parsed.data.name, createdBy: request.user!.id, updatedBy: request.user!.id } });

    await writeAuditLog({
      userId: request.user!.id,
      action: existing ? "update" : "create",
      entityType: "department",
      entityId: department.id,
      newValues: { code: department.code, name: department.name },
      ipAddress: request.ip,
    });
    return reply.code(201).send({ id: department.id, code: department.code, name: department.name, isActive: department.isActive });
  });

  fastify.delete("/api/v1/departments/:id", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const department = await prisma.department.findFirst({ where: { id, deletedAt: null } });
    if (!department) {
      return reply.code(404).send({ code: "not_found", message: "Pôle introuvable." });
    }
    const rolesCount = await prisma.role.count({ where: { departmentId: id, deletedAt: null } });
    const employeesCount = await prisma.employee.count({ where: { departmentId: id, deletedAt: null } });
    if (rolesCount > 0 || employeesCount > 0) {
      return reply.code(409).send({
        code: "department_in_use",
        message: `Ce pôle est rattaché à ${rolesCount} rôle(s) et ${employeesCount} employé(s) ; il ne peut pas être retiré.`,
      });
    }
    await prisma.department.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "department",
      entityId: id,
      oldValues: { code: department.code, name: department.name },
      newValues: { removed: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // Réglage des droits pour TOUT un pôle en une opération (spéc. fonctionnelle
  // §3) : applique un droit à tous les rôles du département, sauf le rôle
  // super-administrateur (protégé). Chaque rôle touché reste tracé globalement.
  fastify.post("/api/v1/departments/:id/permissions", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = permissionToggleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const department = await prisma.department.findFirst({ where: { id, deletedAt: null } });
    if (!department) {
      return reply.code(404).send({ code: "not_found", message: "Pôle introuvable." });
    }
    const permission = await prisma.permission.findUnique({
      where: { module_action: { module: parsed.data.module, action: parsed.data.action } },
    });
    if (!permission) {
      return reply.code(400).send({ code: "unknown_permission", message: "Permission inconnue." });
    }

    const roles = await prisma.role.findMany({ where: { departmentId: id, deletedAt: null, code: { not: SUPERADMIN_ROLE } } });
    for (const role of roles) {
      if (parsed.data.granted) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id, createdBy: request.user!.id },
        });
      } else {
        await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      }
    }

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "department",
      entityId: id,
      newValues: {
        bulk_permission: `${parsed.data.module}:${parsed.data.action}`,
        granted: parsed.data.granted,
        roles_affected: roles.length,
      },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true, roles_affected: roles.length });
  });

  // « Se connecter en tant que » (usurpation d'identité, spéc. fonctionnelle
  // §4) : un administrateur agit sous l'identité d'un autre compte pour
  // l'assistance. Bracketé au journal (début/fin) et signalé par un bandeau
  // côté interface. Interdit de viser le compte passe-partout ou soi-même.
  fastify.post("/api/v1/users/:id/impersonate", { preHandler: requirePermission("users", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user!.id) {
      return reply.code(409).send({ code: "cannot_impersonate_self", message: "Vous êtes déjà connecté avec ce compte." });
    }
    const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) {
      return reply.code(404).send({ code: "not_found", message: "Compte introuvable." });
    }
    if (target.status !== "active") {
      return reply.code(409).send({ code: "inactive_account", message: "Ce compte n'est pas actif." });
    }
    if (target.isProtected) {
      return reply.code(409).send({ code: "protected_account", message: "Le compte passe-partout ne peut pas être usurpé." });
    }

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "user",
      entityId: target.id,
      newValues: { impersonation: "start", target: target.username },
      ipAddress: request.ip,
    });

    reply.setCookie(SESSION_COOKIE, createSessionToken(target.id, request.user!.id), sessionCookieOptions());
    return reply.send({ ok: true, impersonating: target.username });
  });
}
