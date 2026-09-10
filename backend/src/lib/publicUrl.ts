import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

// Adresse web PUBLIQUE de l'ERP (celle qu'un auteur ouvre depuis son e-mail).
// Priorité : réglage « public_base_url » (modifiable dans les Réglages) → variable
// d'environnement APP_BASE_URL → origine de la requête (même hôte que l'app servie).
export const PUBLIC_BASE_URL_KEY = "public_base_url";

export async function resolvePublicBaseUrl(request: FastifyRequest): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: PUBLIC_BASE_URL_KEY } });
  const configured = typeof row?.value === "string" ? row.value.trim() : "";
  const fromEnv = process.env.APP_BASE_URL?.trim() || "";
  const fromRequest = `${request.protocol}://${request.headers.host ?? ""}`;
  return (configured || fromEnv || fromRequest).replace(/\/$/, "");
}
