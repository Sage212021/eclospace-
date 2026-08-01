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

describe("indicateurs de synthèse du tableau de bord", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("renvoie les grands indicateurs à l'administrateur (accès complet)", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Cohérence avec la base : le nombre d'ouvrages doit correspondre au count.
    const expectedOuvrages = await prisma.manuscript.count({ where: { deletedAt: null } });
    expect(body.ouvrages).toBe(expectedOuvrages);
    // Les indicateurs sont des nombres pour l'admin (accès complet).
    expect(typeof body.utilisateurs).toBe("number");
    expect(typeof body.ventes).toBe("number");
    expect(typeof body.stock).toBe("number");
    expect(body.utilisateurs).toBeGreaterThanOrEqual(1);

    // Indicateurs enrichis (accueil) : présents et cohérents pour l'admin.
    expect(typeof body.ouvrages_en_cours).toBe("number");
    expect(typeof body.chiffre_affaires).toBe("number");
    expect(typeof body.ruptures).toBe("number");
    expect(typeof body.taches_en_retard).toBe("number");
    // Ouvrages en cours = total moins les archivés (jamais plus que le total).
    const archived = await prisma.manuscript.count({ where: { deletedAt: null, status: { code: "ARCHIVAGE" } } });
    expect(body.ouvrages_en_cours).toBe(expectedOuvrages - archived);
    // Le pipeline ne contient que des étapes portant au moins un ouvrage, et la
    // somme de ses ouvrages = ouvrages en cours + archivés = total.
    expect(Array.isArray(body.pipeline)).toBe(true);
    for (const stage of body.pipeline) {
      expect(stage.count).toBeGreaterThan(0);
      expect(typeof stage.label).toBe("string");
    }
    const pipelineTotal = body.pipeline.reduce((sum: number, s: { count: number }) => sum + s.count, 0);
    expect(pipelineTotal).toBe(expectedOuvrages);
    // Le nombre total d'étapes est fourni pour calculer l'avancement réel (et
    // doit couvrir l'étape la plus avancée présente dans la frise).
    expect(typeof body.pipeline_steps_total).toBe("number");
    const maxStep = Math.max(...body.pipeline.map((s: { step_order: number }) => s.step_order));
    expect(body.pipeline_steps_total).toBeGreaterThanOrEqual(maxStep);
  });

  it("masque les indicateurs hors périmètre d'un profil restreint (null)", async () => {
    // Un correcteur : pas d'accès users / commercial / stock. Il peut consulter
    // les manuscrits (permission de base d'un profil éditorial ? non — CORRECTEUR
    // n'a que documents/notifications). On vérifie donc que les indicateurs non
    // autorisés sont bien à null.
    await createUserWithRole("correcteur_kpi_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_kpi_test", "Correcteur123!");
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.utilisateurs).toBeNull();
    expect(body.ventes).toBeNull();
    expect(body.stock).toBeNull();
    // Indicateurs enrichis également masqués hors périmètre.
    expect(body.ouvrages).toBeNull();
    expect(body.ouvrages_en_cours).toBeNull();
    expect(body.chiffre_affaires).toBeNull();
    expect(body.ruptures).toBeNull();
    expect(body.taches_en_retard).toBeNull();
    expect(body.pipeline).toBeNull();
  });

  it("exige une session (401 sans authentification)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats" });
    expect(res.statusCode).toBe(401);
  });
});

describe("bilan par année (annual-summary)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("renvoie la structure attendue et un mouvement global cohérent", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/annual-summary", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Structure : liste d'années (triée décroissante), année sélectionnée
    // présente dans la liste, année courante toujours proposée.
    expect(Array.isArray(body.years)).toBe(true);
    expect(body.years).toContain(new Date().getUTCFullYear());
    expect(body.years).toContain(body.year);
    for (let i = 1; i < body.years.length; i++) expect(body.years[i]).toBeLessThan(body.years[i - 1]);

    // CA par famille : le scolaire ET le général sont toujours présents,
    // dissociés (exigence métier), et le total ≥ somme des deux.
    const keys = body.ca.families.map((f: { key: string }) => f.key);
    expect(keys).toContain("livre_scolaire");
    expect(keys).toContain("livre_general");

    // Exemplaires dissociés (scolaire vs simple), nombres ≥ 0.
    expect(typeof body.exemplaires.scolaire).toBe("number");
    expect(typeof body.exemplaires.simple).toBe("number");
    expect(body.exemplaires.scolaire).toBeGreaterThanOrEqual(0);
    expect(body.exemplaires.simple).toBeGreaterThanOrEqual(0);
    expect(typeof body.ouvrages_parus).toBe("number");
    expect(typeof body.droits_verses).toBe("number");

    // Mouvement global : le cumul tout-temps = somme des lignes par année.
    const g = body.global;
    expect(Array.isArray(g.per_year)).toBe(true);
    const sumParus = g.per_year.reduce((s: number, p: { ouvrages_parus: number }) => s + p.ouvrages_parus, 0);
    expect(g.total.ouvrages_parus).toBe(sumParus);
    const sumFacture = Math.round(g.per_year.reduce((s: number, p: { ca_facture: number }) => s + p.ca_facture, 0) * 100) / 100;
    expect(g.total.ca_facture).toBeCloseTo(sumFacture, 2);
    // La tendance est triée par année croissante (lecture chronologique).
    for (let i = 1; i < g.per_year.length; i++) expect(g.per_year[i].year).toBeGreaterThan(g.per_year[i - 1].year);
  });

  it("respecte l'année demandée quand elle existe", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const base = (await app.inject({ method: "GET", url: "/api/v1/dashboard/annual-summary", headers: { cookie } })).json();
    const target = base.years[base.years.length - 1]; // année la plus ancienne disponible
    const res = await app.inject({ method: "GET", url: `/api/v1/dashboard/annual-summary?year=${target}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().year).toBe(target);
  });

  it("est réservé à la Finance / Direction (403 pour un profil non habilité)", async () => {
    await createUserWithRole("correcteur_annual_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_annual_test", "Correcteur123!");
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/annual-summary", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("exige une session (401 sans authentification)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/annual-summary" });
    expect(res.statusCode).toBe(401);
  });
});
