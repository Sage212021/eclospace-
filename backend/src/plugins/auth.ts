import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE, verifySessionToken } from "../lib/session.js";
import { loadEffectiveUser } from "../lib/permissions.js";

// Résout la session à chaque requête et attache l'utilisateur effectif
// (rôles + permissions) sur request.user. Ne bloque rien ici : les routes
// publiques (login, 2fa) doivent rester accessibles sans session.
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("user", null);

  fastify.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const userId = verifySessionToken(token);
    request.user = userId ? await loadEffectiveUser(userId) : null;
  });
});
