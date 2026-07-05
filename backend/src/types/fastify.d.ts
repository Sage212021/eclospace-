import type { EffectiveUser } from "../lib/permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: EffectiveUser | null;
  }
}
