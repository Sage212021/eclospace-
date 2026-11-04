import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Sous-module « Correction éditoriale » (refonte éditoriale) : tableau de bord
// réservé à l'éditorial/direction ; structure des indicateurs et sous-états.

const PWD = "Edi123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("tableau de bord du sous-module Correction éditoriale", () => {
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
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard", headers: { cookie: edCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(typeof b.en_correction).toBe("number");
    expect(typeof b.a_demarrer).toBe("number");
    expect(typeof b.en_cours).toBe("number");
    expect(typeof b.points_bloquants).toBe("number");
    expect(typeof b.prets_a_valider).toBe("number");
    expect(typeof b.points_bloquants_total).toBe("number");
    expect(typeof b.en_retard).toBe("number");
    expect(Array.isArray(b.manuscripts)).toBe(true);
    // Cohérence : la somme des sous-états égale le total en correction.
    expect(b.a_demarrer + b.en_cours + b.points_bloquants + b.prets_a_valider).toBe(b.en_correction);
  });

  it("expose les champs de regroupement par responsable (infographe / correcteur) et l'auteur", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard", headers: { cookie: edCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    for (const m of b.manuscripts as Record<string, unknown>[]) {
      // Chaque manuscrit porte l'axe infographe ET l'axe correcteur (id + nom),
      // l'auteur et la date d'entrée en correction — pour les accordéons par
      // responsable, sans jamais figurer à la fois en « à affecter » et dans un
      // portefeuille (une seule affectation active par axe).
      expect(m).toHaveProperty("author");
      expect(m).toHaveProperty("correction_started_at");
      expect(m).toHaveProperty("infographe_id");
      expect(m).toHaveProperty("infographe_name");
      expect(m).toHaveProperty("correcteur_id");
      expect(m).toHaveProperty("correcteur_name");
    }
  });

  it("refuse un rôle non éditorial (juridique → 403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard", headers: { cookie: jurCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard" });
    expect(res.statusCode).toBe(401);
  });
});
