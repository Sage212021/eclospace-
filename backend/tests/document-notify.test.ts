import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("signaler une pièce jointe à un pôle", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("notifie les titulaires du rôle visé et trace le signalement", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);

    // Un destinataire : un correcteur (titulaire du rôle CORRECTEUR).
    const dest = await createUserWithRole(`dest_notify_${Math.random().toString(36).slice(2, 7)}`, "CORRECTEUR", "Dest123!");

    // Une pièce rattachée à une entité quelconque (le contexte manuscrit est optionnel).
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: { cookie },
      payload: {
        entity_type: "manuscript",
        entity_id: "11111111-1111-1111-1111-111111111111",
        category: "contrat",
        title: "Contrat signé test",
        confidentiality: "restreint",
      },
    });
    expect(create.statusCode).toBe(201);
    const documentId = create.json().id;

    const before = await prisma.notification.count({ where: { userId: dest.id } });

    const notify = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/notify`,
      headers: { cookie },
      payload: { role_code: "CORRECTEUR" },
    });
    expect(notify.statusCode).toBe(200);

    const after = await prisma.notification.count({ where: { userId: dest.id } });
    expect(after).toBe(before + 1);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "document", entityId: documentId },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuse un rôle inconnu (400)", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: { cookie },
      payload: { entity_type: "manuscript", entity_id: "11111111-1111-1111-1111-111111111111", category: "autre", title: "X" },
    });
    const documentId = create.json().id;
    const notify = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/notify`,
      headers: { cookie },
      payload: { role_code: "ROLE_BIDON" },
    });
    expect(notify.statusCode).toBe(400);
  });
});
