import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Confidentialité des indicateurs éditoriaux de la page d'accueil (correctif du
// 05/08) : le nombre d'ouvrages et le pipeline « où en sont les ouvrages » ne
// s'affichent QUE pour la direction et la tête du pôle éditorial — pas pour un
// compte non éditorial, même s'il a manuscripts:consultation (juridique, QC…).

const PWD = "Dash123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function login(app: FastifyInstance, u: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("indicateurs éditoriaux de l'accueil réservés à l'éditorial/direction", () => {
  let app: FastifyInstance;
  let jurCookie: string;
  let edCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    // RESP_JURIDIQUE a manuscripts:consultation (catalogue) mais n'est PAS éditorial.
    const jur = `jur_${rnd()}`;
    await createUserWithRole(jur, "RESP_JURIDIQUE", PWD);
    jurCookie = await login(app, jur);
    // DIR_EDITORIAL : rôle éditorial autorisé.
    const ed = `ed_${rnd()}`;
    await createUserWithRole(ed, "DIR_EDITORIAL", PWD);
    edCookie = await login(app, ed);
  });

  afterAll(async () => {
    await app.close();
  });

  it("masque ouvrages + pipeline pour un rôle non éditorial (juridique)", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie: jurCookie } })).json();
    expect(b.pipeline).toBeNull();
    expect(b.ouvrages).toBeNull();
    expect(b.ouvrages_en_cours).toBeNull();
  });

  it("affiche ouvrages + pipeline pour un rôle éditorial (directeur éditorial)", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie: edCookie } })).json();
    expect(b.pipeline).not.toBeNull();
    expect(typeof b.ouvrages).toBe("number");
  });
});
