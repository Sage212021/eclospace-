import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Sous-module « Manuscrits » (refonte éditoriale) : tableau de bord réservé à
// l'éditorial/direction ; structure des indicateurs.

const PWD = "Edi123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("tableau de bord du sous-module Manuscrits", () => {
  let app: FastifyInstance;
  let edCookie: string;
  let jurCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    await createUserWithRole(`ed_${rnd()}`, "DIR_EDITORIAL", PWD).then((u) => (edCookie = u.username));
    // On récupère un cookie via login (createUserWithRole renvoie l'user).
    const ed = `ed2_${rnd()}`;
    await createUserWithRole(ed, "DIR_EDITORIAL", PWD);
    edCookie = await login(app, ed);
    const jur = `jur_${rnd()}`;
    await createUserWithRole(jur, "RESP_JURIDIQUE", PWD);
    jurCookie = await login(app, jur);
  });

  afterAll(async () => {
    await app.close();
  });

  it("renvoie les indicateurs pour un rôle éditorial", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/manuscripts/dashboard", headers: { cookie: edCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(typeof b.recus).toBe("number");
    expect(typeof b.en_evaluation).toBe("number");
    expect(typeof b.en_retard).toBe("number");
    expect(Array.isArray(b.by_status)).toBe(true);
    expect("taux_acceptation" in b).toBe(true);
    expect("delai_moyen_traitement_jours" in b).toBe(true);
  });

  it("refuse un rôle non éditorial (juridique → 403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/manuscripts/dashboard", headers: { cookie: jurCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/manuscripts/dashboard" });
    expect(res.statusCode).toBe(401);
  });
});
