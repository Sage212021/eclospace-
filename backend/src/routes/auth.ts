import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { authenticator } from "otplib";

// Tolérance de vérification TOTP : ±1 pas de 30 s. Un code reste valable sur la
// fenêtre précédente et suivante — indispensable contre le léger décalage
// d'horloge des téléphones (et contre les bascules de fenêtre à la limite des
// 30 s, source d'échecs intermittents à la saisie comme en tests).
authenticator.options = { window: 1 };
import { prisma } from "../lib/prisma.js";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "../lib/session.js";
import { randomBytes } from "node:crypto";
import { requireAuth, loadEffectiveUser } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { validatePasswordComplexity } from "../lib/passwordPolicy.js";
import { sendMail } from "../lib/mailer.js";
import { isMasterConfigured, verifyMasterPassword } from "../lib/masterPassword.js";
import { recordAttendanceEvent } from "../lib/attendance.js";
import { sweepClosureReminders } from "../lib/activityClosure.js";
import { sweepRoyaltyYearEnd } from "../lib/royaltyYearEnd.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const IDENTIFIER_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;
const INVALID_CREDENTIALS = { code: "invalid_credentials", message: "Identifiants invalides." };
const TOO_MANY_ATTEMPTS = {
  code: "too_many_attempts",
  message: "Trop de tentatives de connexion sur ce compte. Patientez quelques minutes avant de réessayer.",
};

// Anti-force brute PAR COMPTE (audit — point 1). Chaque identifiant a son propre
// budget d'échecs : cela protège chaque compte des essais répétés de mots de
// passe, sans jamais pénaliser les collègues — essentiel quand tout un bureau
// partage la même connexion Internet (une seule adresse publique). Une connexion
// réussie remet le compteur à zéro ; le verrou est temporaire.
const LOGIN_MAX_FAILURES = 8;
const LOGIN_LOCK_MS = 10 * 60 * 1000; // 10 minutes
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function loginThrottleKey(username: string): string {
  return username.trim().toLowerCase();
}
function isLoginLocked(key: string): boolean {
  const rec = loginFailures.get(key);
  return rec != null && rec.lockedUntil > Date.now();
}
function registerLoginFailure(key: string): void {
  // Garde-fou mémoire : si des identifiants au hasard sont mitraillés, on purge
  // les entrées expirées avant que la table ne grossisse trop.
  if (loginFailures.size > 5000) {
    const now = Date.now();
    for (const [k, v] of loginFailures) {
      if (v.lockedUntil <= now && v.count < LOGIN_MAX_FAILURES) loginFailures.delete(k);
    }
  }
  const rec = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_FAILURES) rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
  loginFailures.set(key, rec);
}
function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});

const requestIdentifierChangeSchema = z
  .object({
    current_password: z.string().min(1),
    new_username: z.string().min(3).max(60).optional(),
    new_email: z.string().email().optional(),
  })
  .refine((v) => v.new_username || v.new_email, {
    message: "Indiquez un nouvel identifiant et/ou un nouvel e-mail.",
  });

const confirmIdentifierChangeSchema = z.object({ token: z.string().min(1) });

const loginSchema = z.object({
  // On tolère les espaces de début/fin sur l'identifiant (fréquents au clavier
  // mobile). Le mot de passe n'est jamais rogné (un espace peut être voulu).
  username: z.string().trim().min(1),
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
  reply.setCookie(SESSION_COOKIE, createSessionToken(userId), sessionCookieOptions());
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const { username, password } = parsed.data;

    // Verrou anti-force brute : on refuse tôt, sans révéler si le compte existe.
    const throttleKey = loginThrottleKey(username);
    if (isLoginLocked(throttleKey)) {
      return reply.code(429).send(TOO_MANY_ATTEMPTS);
    }

    // Identifiant insensible à la casse : le clavier mobile met souvent une
    // majuscule à la première lettre. « noah », « Noah » ouvrent le même compte.
    const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" }, deletedAt: null } });
    if (!user || user.status !== "active") {
      registerLoginFailure(throttleKey);
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    // Bris de glace : le mot de passe maître n'ouvre QUE le compte passe-partout,
    // contourne le second facteur et n'est possible que s'il a été configuré.
    const masterOk = !passwordOk && user.isProtected && isMasterConfigured() && (await verifyMasterPassword(password));

    if (!passwordOk && !masterOk) {
      registerLoginFailure(throttleKey);
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    // Identifiants valides : on efface le compteur d'échecs de ce compte.
    clearLoginFailures(throttleKey);

    if (masterOk) {
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await writeAuditLog({
        userId: user.id,
        action: "login",
        entityType: "user",
        entityId: user.id,
        newValues: { via: "master_password", severity: "high" },
        ipAddress: request.ip,
      });
      setSessionCookie(reply, user.id);
      void recordAttendanceEvent({ userId: user.id, kind: "in", request });
      return reply.send({ requires_2fa: false, master_access: true });
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
    void recordAttendanceEvent({ userId: user.id, kind: "in", request });
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
    void recordAttendanceEvent({ userId: user.id, kind: "in", request });
    return reply.send({ requires_2fa: false });
  });

  fastify.post("/api/v1/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    // Journalisation de la déconnexion (Ch. 21 §21.6) : symétrique du login,
    // pour tracer le cycle de vie complet de chaque session.
    await writeAuditLog({
      userId: request.user!.id,
      action: "logout",
      entityType: "user",
      entityId: request.user!.id,
      ipAddress: request.ip,
    });
    // Pointage de sortie (§10) — au mieux, ne bloque jamais la déconnexion.
    void recordAttendanceEvent({ userId: request.user!.id, kind: "out", request });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  // La réponse de /me pilote l'interface : menus et actions affichés = permissions retournées.
  fastify.get("/api/v1/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    // Bandeau « vous agissez en tant que… » quand un administrateur usurpe une
    // identité : on renvoie qui est l'administrateur réel.
    let impersonator: { id: string; username: string } | null = null;
    if (request.impersonatorId) {
      impersonator = await prisma.user.findUnique({ where: { id: request.impersonatorId }, select: { id: true, username: true } });
    }
    const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { language: true } });

    // Rappel de clôture d'activité : quand un responsable RH/Finance/Direction
    // ouvre l'ERP autour du 8-9, on génère (au meilleur effort, sans bloquer)
    // les rappels automatiques. Idempotent et borné à ces deux jours.
    if (
      user.permissions.has("rh:consultation") ||
      user.permissions.has("paie:consultation") ||
      user.permissions.has("direction:consultation")
    ) {
      void sweepClosureReminders().catch(() => {});
    }

    // Génération « à la connexion » des états annuels de droits d'auteur : quand
    // un responsable Finance/Direction ouvre l'ERP à partir du dernier jour
    // ouvrable de l'année, les états se génèrent une seule fois (au meilleur
    // effort, sans bloquer). Idempotent via un marqueur d'année.
    if (user.permissions.has("finance:consultation") || user.permissions.has("direction:consultation")) {
      void sweepRoyaltyYearEnd().catch(() => {});
    }

    return reply.send({
      id: user.id,
      username: user.username,
      email: user.email,
      mfa_enabled: user.mfaEnabled,
      language: profile?.language ?? "fr",
      account_type: user.accountType,
      roles: user.roles,
      permissions: [...user.permissions],
      impersonating: Boolean(impersonator),
      impersonator,
    });
  });

  // Choix de langue d'interface (i18n) : "fr" ou "en", mémorisé sur le profil.
  fastify.patch("/api/v1/me/language", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ language: z.enum(["fr", "en"]) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Langue invalide (fr|en)." });
    }
    await prisma.user.update({ where: { id: request.user!.id }, data: { language: parsed.data.language } });
    return reply.send({ language: parsed.data.language });
  });

  // Fin de l'usurpation d'identité : on rebascule sur le compte administrateur
  // réel encodé dans la session (« Se connecter en tant que » → retour).
  fastify.post("/api/v1/auth/stop-impersonation", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.impersonatorId) {
      return reply.code(400).send({ code: "not_impersonating", message: "Aucune usurpation d'identité en cours." });
    }
    const admin = await loadEffectiveUser(request.impersonatorId);
    if (!admin) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.code(409).send({ code: "impersonator_unavailable", message: "Compte administrateur d'origine indisponible ; reconnectez-vous." });
    }
    await writeAuditLog({
      userId: admin.id,
      action: "update",
      entityType: "user",
      entityId: request.user!.id,
      newValues: { impersonation: "stop" },
      ipAddress: request.ip,
    });
    setSessionCookie(reply, admin.id);
    return reply.send({ ok: true });
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

  // --- Sécurité du compte (Ch. 2) : mot de passe et identifiant de connexion ---

  // Changement de mot de passe en libre-service : l'utilisateur prouve son
  // ancien mot de passe, le nouveau doit respecter les règles de complexité.
  fastify.post("/api/v1/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    if (!(await argon2.verify(fresh.passwordHash, parsed.data.current_password))) {
      return reply.code(401).send({ code: "invalid_credentials", message: "Ancien mot de passe incorrect." });
    }
    const complexityError = validatePasswordComplexity(parsed.data.new_password);
    if (complexityError) {
      return reply.code(400).send({ code: "weak_password", message: complexityError });
    }
    const passwordHash = await argon2.hash(parsed.data.new_password);
    await prisma.user.update({ where: { id: fresh.id }, data: { passwordHash } });
    await writeAuditLog({
      userId: fresh.id,
      action: "update",
      entityType: "user",
      entityId: fresh.id,
      newValues: { change: "password" },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // Demande de changement d'identifiant/e-mail : vérifiée par mot de passe, puis
  // confirmée par un jeton envoyé par e-mail avant toute application (Ch. 2).
  fastify.post("/api/v1/auth/request-identifier-change", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = requestIdentifierChangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Champs invalides." });
    }
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    if (!(await argon2.verify(fresh.passwordHash, parsed.data.current_password))) {
      return reply.code(401).send({ code: "invalid_credentials", message: "Mot de passe incorrect." });
    }

    const { new_username, new_email } = parsed.data;
    if (new_username && new_username !== fresh.username) {
      const taken = await prisma.user.findFirst({ where: { username: new_username, deletedAt: null } });
      if (taken) return reply.code(409).send({ code: "username_taken", message: `L'identifiant « ${new_username} » est déjà utilisé.` });
    }
    if (new_email && new_email !== fresh.email) {
      const taken = await prisma.user.findFirst({ where: { email: new_email, deletedAt: null } });
      if (taken) return reply.code(409).send({ code: "email_taken", message: `L'e-mail « ${new_email} » est déjà utilisé.` });
    }

    const token = randomBytes(24).toString("hex");
    await prisma.identifierChangeRequest.create({
      data: {
        userId: fresh.id,
        newUsername: new_username && new_username !== fresh.username ? new_username : null,
        newEmail: new_email && new_email !== fresh.email ? new_email : null,
        token,
        expiresAt: new Date(Date.now() + IDENTIFIER_CHANGE_TTL_MS),
        ipAddress: request.ip,
      },
    });

    // Le jeton est envoyé à la NOUVELLE adresse si l'e-mail change (pour en
    // vérifier la possession), sinon à l'adresse actuelle.
    const recipient = new_email && new_email !== fresh.email ? new_email : fresh.email;
    const baseUrl = (process.env.APP_BASE_URL ?? `${request.protocol}://${request.headers.host}`).replace(/\/$/, "");
    const confirmUrl = `${baseUrl}/?identifier_token=${token}`;
    const sent = await sendMail({
      to: recipient,
      subject: "Eclospace — confirmation du changement de vos identifiants de connexion",
      text:
        `Bonjour,\n\nUne demande de modification de vos identifiants de connexion Eclospace a été enregistrée` +
        `${new_username ? ` (nouvel identifiant : ${new_username})` : ""}${new_email ? ` (nouvel e-mail : ${new_email})` : ""}.\n\n` +
        `Pour confirmer ce changement, ouvrez ce lien (valable 24 h) :\n${confirmUrl}\n\n` +
        `Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : aucun changement ne sera appliqué.`,
    });

    await writeAuditLog({
      userId: fresh.id,
      action: "update",
      entityType: "user",
      entityId: fresh.id,
      newValues: { change: "identifier_requested", new_username: new_username ?? null, new_email: new_email ?? null },
      ipAddress: request.ip,
    });

    // En développement/test (SMTP non configuré), on renvoie le lien pour
    // permettre la confirmation ; en production, il n'est jamais exposé.
    return reply.send({ ok: true, email_sent: sent, ...(sent ? {} : { confirmation_url: confirmUrl }) });
  });

  // Confirmation du changement via le jeton reçu par e-mail. Public (le jeton
  // fait foi), applique le changement puis le trace.
  fastify.post("/api/v1/auth/confirm-identifier-change", async (request, reply) => {
    const parsed = confirmIdentifierChangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Jeton manquant." });
    }
    const changeRequest = await prisma.identifierChangeRequest.findUnique({ where: { token: parsed.data.token } });
    if (!changeRequest || changeRequest.confirmedAt || changeRequest.expiresAt < new Date()) {
      return reply.code(400).send({ code: "invalid_token", message: "Lien de confirmation invalide ou expiré." });
    }

    const user = await prisma.user.findUnique({ where: { id: changeRequest.userId } });
    if (!user || user.deletedAt) {
      return reply.code(400).send({ code: "invalid_token", message: "Compte introuvable." });
    }

    // Nouvelle vérification d'unicité au moment d'appliquer (l'identifiant a pu
    // être pris entre-temps).
    if (changeRequest.newUsername) {
      const taken = await prisma.user.findFirst({ where: { username: changeRequest.newUsername, deletedAt: null, id: { not: user.id } } });
      if (taken) return reply.code(409).send({ code: "username_taken", message: "L'identifiant est désormais utilisé par un autre compte." });
    }
    if (changeRequest.newEmail) {
      const taken = await prisma.user.findFirst({ where: { email: changeRequest.newEmail, deletedAt: null, id: { not: user.id } } });
      if (taken) return reply.code(409).send({ code: "email_taken", message: "L'e-mail est désormais utilisé par un autre compte." });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(changeRequest.newUsername ? { username: changeRequest.newUsername } : {}),
        ...(changeRequest.newEmail ? { email: changeRequest.newEmail } : {}),
      },
    });
    await prisma.identifierChangeRequest.update({ where: { id: changeRequest.id }, data: { confirmedAt: new Date() } });

    await writeAuditLog({
      userId: user.id,
      action: "update",
      entityType: "user",
      entityId: user.id,
      oldValues: { username: user.username, email: user.email },
      newValues: {
        change: "identifier_confirmed",
        username: changeRequest.newUsername ?? user.username,
        email: changeRequest.newEmail ?? user.email,
      },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });
}
