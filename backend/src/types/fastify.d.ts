import type { EffectiveUser } from "../lib/permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: EffectiveUser | null;
    // Renseigné quand un administrateur agit sous l'identité d'un autre compte
    // (« Se connecter en tant que ») : id du compte administrateur réel.
    impersonatorId: string | null;
  }
}
