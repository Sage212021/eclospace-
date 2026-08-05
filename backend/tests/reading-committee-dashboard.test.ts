import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Sous-module « Comité de lecture » (refonte éditoriale) : tableau de bord
// réservé à l'éditorial/direction ; structure des indicateurs et sous-états.

const PWD = "Edi123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("tableau de bord du sous-module Comité de lecture", () => {
  let app: FastifyInstance;
  let edCookie: string;
  let jurCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const ed = `ed_${rnd()}`;
    await createUserWithRole(ed, "DIR_EDITORIAL", PWD);
    edCookie = await login(app, ed);
    const jur = `jur_${rnd()}`;
    await createUserWithRole(jur, "RESP_JURIDIQUE", PWD);
    jurCookie = await login(app, jur);
  });

  afterAll(async () => {
    await app.close();
  });

  it("renvoie les indicateurs et sous-états pour un rôle éditorial", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/reading-committee/dashboard", headers: { cookie: edCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(typeof b.en_comite).toBe("number");
    expect(typeof b.a_affecter).toBe("number");
    expect(typeof b.en_lecture).toBe("number");
    expect(typeof b.rapports_remis).toBe("number");
    expect(typeof b.en_retard).toBe("number");
    expect(typeof b.rapports_en_attente).toBe("number");
    expect(typeof b.relecteurs_actifs).toBe("number");
    expect(Array.isArray(b.manuscripts)).toBe(true);
    // Cohérence : la somme des sous-états égale le total au comité.
    expect(b.a_affecter + b.en_lecture + b.rapports_remis).toBe(b.en_comite);
  });

  it("refuse un rôle non éditorial (juridique → 403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/reading-committee/dashboard", headers: { cookie: jurCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/reading-committee/dashboard" });
    expect(res.statusCode).toBe(401);
  });
});
