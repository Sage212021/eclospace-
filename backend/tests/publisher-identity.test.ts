import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Identité de l'éditeur (contrats) : lecture pour tout utilisateur authentifié,
// écriture réservée à settings:administration. Défauts servis tant qu'aucune
// saisie n'a été faite.

const PWD = "Pub123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("Identité de l'éditeur (paramètres)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const adminUser = `adm_${rnd()}`;
    await createUserWithRole(adminUser, "ADMIN_GENERAL", PWD);
    adminCookie = await login(app, adminUser);
    const u = `corr_${rnd()}`;
    await createUserWithRole(u, "CORRECTEUR", PWD); // pas de settings:administration
    plainCookie = await login(app, u);
  });

  afterAll(async () => {
    await app.close();
  });

  it("sert les valeurs par défaut à la lecture", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/publisher-identity", headers: { cookie: plainCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBeTruthy();
    expect(res.json().rc).toBeTruthy();
  });

  it("refuse la lecture sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/publisher-identity" });
    expect(res.statusCode).toBe(401);
  });

  it("refuse la modification sans settings:administration (403)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/publisher-identity", headers: { cookie: plainCookie }, payload: { name: "X", desc: "", rc: "", niu: "", siege: "", tel: "", email: "", web: "", rep: "", ville: "" } });
    expect(res.statusCode).toBe(403);
  });

  it("enregistre puis relit la nouvelle identité (administration)", async () => {
    const payload = { name: "EDITIONS TEST", desc: "d", rc: "RC1", niu: "NIU1", siege: "S", tel: "T", email: "e@e.cm", web: "w", rep: "R", ville: "Yaoundé" };
    const put = await app.inject({ method: "PUT", url: "/api/v1/publisher-identity", headers: { cookie: adminCookie }, payload });
    expect(put.statusCode).toBe(200);
    expect(put.json().name).toBe("EDITIONS TEST");

    const get = await app.inject({ method: "GET", url: "/api/v1/publisher-identity", headers: { cookie: plainCookie } });
    expect(get.json().name).toBe("EDITIONS TEST");
    expect(get.json().rc).toBe("RC1");
  });

  it("rejette une saisie invalide (400)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/publisher-identity", headers: { cookie: adminCookie }, payload: { name: 123 } });
    expect(res.statusCode).toBe(400);
  });
});
