import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";
import { getVapidPublicKey, isPushConfigured } from "../lib/pushWeb.js";

// Notifications « Web Push » : abonnement d'un appareil (téléphone) pour
// recevoir les alertes application fermée. Chaque route est nominative — un
// utilisateur ne gère que ses propres abonnements.

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export default async function pushRoutes(fastify: FastifyInstance) {
  // Clé publique VAPID (et disponibilité du service) pour que le navigateur
  // crée l'abonnement. Sans clés configurées : `configured=false`, le frontend
  // masque simplement le bouton d'activation.
  fastify.get("/api/v1/push/public-key", { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ configured: isPushConfigured(), publicKey: getVapidPublicKey() });
  });

  // Enregistre (ou réattribue) un abonnement à l'utilisateur courant. Idempotent
  // par `endpoint` : réabonner le même appareil met simplement à jour ses clés.
  fastify.post("/api/v1/push/subscribe", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Abonnement invalide.", details: parsed.error.issues });
    }
    const { endpoint, keys } = parsed.data;
    const userAgent = request.headers["user-agent"]?.slice(0, 300) ?? null;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: request.user!.id, p256dh: keys.p256dh, auth: keys.auth, userAgent, lastSeenAt: new Date() },
      create: { userId: request.user!.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    });
    return reply.code(201).send({ ok: true });
  });

  // Désabonne un appareil (bouton « Désactiver » ou désinstallation). On ne
  // supprime que si l'abonnement appartient bien à l'utilisateur courant.
  fastify.post("/api/v1/push/unsubscribe", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = unsubscribeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Requête invalide.", details: parsed.error.issues });
    }
    await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: request.user!.id } });
    return reply.send({ ok: true });
  });
}
