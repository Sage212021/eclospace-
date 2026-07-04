import argon2 from "argon2";
import { prisma } from "../src/lib/prisma.js";

// Pas d'endpoint de création de compte au Lot 0 (RH complet = Lot 6) : les
// tests provisionnent directement via Prisma, comme le fait le seed.
export async function createUserWithRole(username: string, roleCode: string, password: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, status: "active", mfaEnabled: false, mfaSecret: null },
    create: { username, email: `${username}@eclospace.local`, passwordHash, status: "active" },
  });
  const existing = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id, revokedAt: null } });
  if (!existing) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

export function extractSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) throw new Error("Aucun cookie de session reçu.");
  return raw.split(";")[0];
}

// isbn13 est unique en base : un préfixe de test statique collisionne dès la
// deuxième exécution de la suite sur une base non réinitialisée entre les runs.
export function uniqueIsbnPrefix(digitWidth: number): string {
  const length = 12 - digitWidth;
  let result = "";
  for (let i = 0; i < length; i++) result += Math.floor(Math.random() * 10).toString();
  return result;
}
