import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE, verifySession } from "../lib/session.js";
import { loadEffectiveUser } from "../lib/permissions.js";

// Résout la session à chaque requête et attache l'utilisateur effectif
// (rôles + permissions) sur request.user. Ne bloque rien ici : les routes
// publiques (login, 2fa) doivent rester accessibles sans session.
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("user", null);
  fastify.decorateRequest("impersonatorId", null);

  fastify.addHook("onRequest", async (request) => {
    const session = verifySession(request.cookies[SESSION_COOKIE]);
    request.user = session ? await loadEffectiveUser(session.userId) : null;
    request.impersonatorId = session?.impersonatorId ?? null;
  });
});
