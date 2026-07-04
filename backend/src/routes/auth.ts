import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { authenticator } from "otplib";
import { prisma } from "../lib/prisma.js";
import { createSessionToken, SESSION_COOKIE } from "../lib/session.js";
import { requireAuth, loadEffectiveUser } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const INVALID_CREDENTIALS = { code: "invalid_credentials", message: "Identifiants invalides." };

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const twoFactorSchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().min(6).max(6),
});

const mfaActivateSchema = z.object({
  code: z.string().min(6).max(6),
});

function setSessionCookie(reply: import("fastify").FastifyReply, userId: string) {
  reply.setCookie(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const { username, password } = parsed.data;

    const user = await prisma.user.findFirst({ where: { username, deletedAt: null } });
    if (!user || user.status !== "active" || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    if (user.mfaEnabled) {
      const challenge = await prisma.loginChallenge.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
      });
      return reply.send({ requires_2fa: true, challenge_id: challenge.id });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAuditLog({
      userId: user.id,
      action: "login",
      entityType: "user",
      entityId: user.id,
      ipAddress: request.ip,
    });
    setSessionCookie(reply, user.id);
    return reply.send({ requires_2fa: false });
  });

  fastify.post("/api/v1/auth/2fa", async (request, reply) => {
    const parsed = twoFactorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const { challenge_id, code } = parsed.data;

    const challenge = await prisma.loginChallenge.findUnique({
      where: { id: challenge_id },
      include: { user: true },
    });
    if (!challenge || challenge.expiresAt < new Date()) {
      return reply.code(401).send({ code: "challenge_expired", message: "Le défi de connexion a expiré, reconnectez-vous." });
    }

    const user = challenge.user;
    if (!user.mfaSecret || !authenticator.check(code, user.mfaSecret)) {
      return reply.code(401).send({ code: "invalid_code", message: "Code de vérification invalide." });
    }

    await prisma.loginChallenge.delete({ where: { id: challenge.id } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAuditLog({
      userId: user.id,
      action: "login",
      entityType: "user",
      entityId: user.id,
      ipAddress: request.ip,
    });
    setSessionCookie(reply, user.id);
    return reply.send({ requires_2fa: false });
  });

  fastify.post("/api/v1/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  // La réponse de /me pilote l'interface : menus et actions affichés = permissions retournées.
  fastify.get("/api/v1/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    return reply.send({
      id: user.id,
      username: user.username,
      email: user.email,
      mfa_enabled: user.mfaEnabled,
      roles: user.roles,
      permissions: [...user.permissions],
    });
  });

  fastify.post("/api/v1/auth/mfa/enroll", { preHandler: requireAuth }, async (request, reply) => {
    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: request.user!.id }, data: { mfaSecret: secret, mfaEnabled: false } });
    const otpauthUrl = authenticator.keyuri(request.user!.username, "Eclospace", secret);
    return reply.send({ secret, otpauth_url: otpauthUrl });
  });

  fastify.post("/api/v1/auth/mfa/activate", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = mfaActivateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    if (!fresh.mfaSecret || !authenticator.check(parsed.data.code, fresh.mfaSecret)) {
      return reply.code(401).send({ code: "invalid_code", message: "Code de vérification invalide." });
    }
    await prisma.user.update({ where: { id: fresh.id }, data: { mfaEnabled: true } });
    request.user = await loadEffectiveUser(fresh.id);
    return reply.send({ mfa_enabled: true });
  });
}
