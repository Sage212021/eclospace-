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

describe("paramètres (settings)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste les paramètres pour un profil habilité et incrémente la version à la modification, avec trace d'audit", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);

    const list = await app.inject({ method: "GET", url: "/api/v1/settings", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const before = list.json().find((s: { key: string }) => s.key === "stock_default_alert_threshold");
    expect(before).toBeTruthy();

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings/stock_default_alert_threshold",
      headers: { cookie },
      payload: { value: before.value + 1 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().version).toBe(before.version + 1);
    expect(patch.json().value).toBe(before.value + 1);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "setting", entityId: "stock_default_alert_threshold" },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("update");
  });

  it("refuse la modification à un profil sans habilitation d'administration (403)", async () => {
    await createUserWithRole("correcteur_settings_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_settings_test", "Correcteur123!");

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings/stock_default_alert_threshold",
      headers: { cookie },
      payload: { value: 99 },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("refuse une clé inconnue (404) plutôt que de créer un réglage mort", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings/cle_inexistante",
      headers: { cookie },
      payload: { value: 1 },
    });
    expect(patch.statusCode).toBe(404);
  });

  it("diagnostic de persistance : base connectée et comptes réels d'enregistrements", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const res = await app.inject({ method: "GET", url: "/api/v1/system/diagnostic", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.database.connected).toBe(true);
    expect(typeof d.instance_id).toBe("string");
    // Le compteur d'un enregistrement réel augmente après une création.
    const before = d.records.users;
    await createUserWithRole(`diag_${Math.random().toString(36).slice(2, 7)}`, "MAGASINIER", "DiagTest123!");
    const after = (await app.inject({ method: "GET", url: "/api/v1/system/diagnostic", headers: { cookie } })).json();
    expect(after.records.users).toBe(before + 1);
  });
});
