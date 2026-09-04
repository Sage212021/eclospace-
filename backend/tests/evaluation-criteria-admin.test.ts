import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Administration de la grille d'évaluation (critères + coefficients) : sert au
// comité de lecture ET au rapport d'évaluation IA.
describe("Grille d'évaluation — administration (critères + coefficients)", () => {
  let app: FastifyInstance;
  let adminCookie: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    // Nettoyage de l'état partagé (grille par défaut) pour ne pas polluer les
    // autres fichiers de test qui s'appuient sur la grille par défaut.
    await prisma.manuscript.deleteMany({ where: { manuscriptNumber: { startsWith: "GT-" } } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { manuscriptNumber: { startsWith: "GD-" } } }).catch(() => {});
    await prisma.evaluationCriterion.deleteMany({ where: { OR: [{ label: { startsWith: "Critère test" } }, { label: "Critère spécifique au type" }, { genre: { code: { startsWith: "GT-" } } }] } }).catch(() => {});
    await prisma.genre.deleteMany({ where: { code: { startsWith: "GT-" } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("liste toutes les critères avec la somme des coefficients actifs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/evaluation-criteria/all", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { criteria: unknown[]; active_coefficient_sum: number };
    expect(Array.isArray(body.criteria)).toBe(true);
    expect(body.active_coefficient_sum).toBeGreaterThan(0);
  });

  it("crée, modifie le coefficient, désactive puis réactive un critère", async () => {
    const label = `Critère test ${Math.random().toString(36).slice(2, 6)}`;
    const created = await app.inject({ method: "POST", url: "/api/v1/evaluation-criteria", headers: { cookie: adminCookie }, payload: { label, coefficient: 2 } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/evaluation-criteria/${id}`, headers: { cookie: adminCookie }, payload: { coefficient: 4 } });
    expect(patched.statusCode).toBe(200);
    expect(Number(patched.json().coefficient)).toBe(4);

    // Désactivation → n'apparaît plus dans la liste "active".
    const del = await app.inject({ method: "DELETE", url: `/api/v1/evaluation-criteria/${id}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(200);
    const active = await app.inject({ method: "GET", url: "/api/v1/evaluation-criteria", headers: { cookie: adminCookie } });
    expect((active.json() as { id: string }[]).some((c) => c.id === id)).toBe(false);

    // Réactivation.
    const reactivate = await app.inject({ method: "PATCH", url: `/api/v1/evaluation-criteria/${id}`, headers: { cookie: adminCookie }, payload: { is_active: true } });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json().isActive).toBe(true);
  });

  it("refuse un coefficient invalide (≤ 0)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/evaluation-criteria", headers: { cookie: adminCookie }, payload: { label: "X", coefficient: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it("les manuels scolaires ont leur grille propre (semée)", async () => {
    const manuel = await prisma.genre.findFirst({ where: { label: "Manuel scolaire ou pratique", deletedAt: null } });
    expect(manuel).not.toBeNull();
    const res = await app.inject({ method: "GET", url: `/api/v1/evaluation-criteria/all?genre=${manuel!.id}`, headers: { cookie: adminCookie } });
    const labels = (res.json().criteria as { label: string }[]).map((c) => c.label);
    expect(labels).toContain("Conformité au programme / curriculum officiel");
    // Distincte de la grille par défaut (qui n'a pas ce critère).
    expect(labels).not.toContain("Potentiel commercial");
  });

  it("grille propre à un TYPE de manuscrit (domaine) : copie + priorité sur la grille par défaut", async () => {
    // Un domaine dédié pour le test.
    const genre = await prisma.genre.create({ data: { code: `GT-${Math.random().toString(36).slice(2, 6)}`, label: "Genre test grille" } });

    // Sans grille propre : la vue "all?genre" est vide, mais la copie initialise.
    const before = await app.inject({ method: "GET", url: `/api/v1/evaluation-criteria/all?genre=${genre.id}`, headers: { cookie: adminCookie } });
    expect((before.json().criteria as unknown[]).length).toBe(0);

    const clone = await app.inject({ method: "POST", url: "/api/v1/evaluation-criteria/clone-default", headers: { cookie: adminCookie }, payload: { genre_id: genre.id } });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().copied).toBeGreaterThan(0);

    // Un 2ᵉ clone est refusé (grille déjà propre).
    const clone2 = await app.inject({ method: "POST", url: "/api/v1/evaluation-criteria/clone-default", headers: { cookie: adminCookie }, payload: { genre_id: genre.id } });
    expect(clone2.statusCode).toBe(409);

    // Ajoute un critère SPÉCIFIQUE au domaine.
    await app.inject({ method: "POST", url: "/api/v1/evaluation-criteria", headers: { cookie: adminCookie }, payload: { label: "Critère spécifique au type", coefficient: 5, genre_id: genre.id } });

    // La grille effective d'un manuscrit de ce domaine inclut le critère spécifique.
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const owner = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const ms = await prisma.manuscript.create({ data: { manuscriptNumber: `GT-${Math.random().toString(36).slice(2, 6)}`, title: "MS type", language: "fr", statusId: status.id, ownerId: owner, genreId: genre.id, receivedAt: new Date() } });
    const eff = await app.inject({ method: "GET", url: `/api/v1/evaluation-criteria?manuscript=${ms.id}`, headers: { cookie: adminCookie } });
    const labels = (eff.json() as { label: string }[]).map((c) => c.label);
    expect(labels).toContain("Critère spécifique au type");
    // Un manuscrit SANS domaine retombe sur la grille par défaut (n'a pas ce critère).
    const msDefault = await prisma.manuscript.create({ data: { manuscriptNumber: `GD-${Math.random().toString(36).slice(2, 6)}`, title: "MS défaut", language: "fr", statusId: status.id, ownerId: owner, receivedAt: new Date() } });
    const effD = await app.inject({ method: "GET", url: `/api/v1/evaluation-criteria?manuscript=${msDefault.id}`, headers: { cookie: adminCookie } });
    expect((effD.json() as { label: string }[]).map((c) => c.label)).not.toContain("Critère spécifique au type");
  });
});
