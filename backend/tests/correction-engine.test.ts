import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { effectiveControlPoints, buildCorrectionMethodText } from "../src/lib/correctionProfile.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Moteur de correction éditoriale : la grille se charge selon le TYPE d'ouvrage,
// avec repli sur le profil par défaut ; le bloc « méthode » injecté porte la
// grille + les sévérités officielles + les règles de fiabilité ; et un NOUVEAU
// type s'ajoute sans toucher au moteur (modularité, §17).

describe("Moteur de correction éditoriale — grilles paramétrables", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });
  afterAll(async () => {
    await prisma.correctionControlPoint.deleteMany({ where: { profile: { bookTypeCode: "test_type_xyz" } } }).catch(() => {});
    await prisma.correctionProfile.deleteMany({ where: { bookTypeCode: "test_type_xyz" } }).catch(() => {});
    await prisma.bookType.deleteMany({ where: { code: "test_type_xyz" } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("un type avec grille propre renvoie SA grille ; un type sans grille retombe sur le profil par défaut", async () => {
    const roman = await effectiveControlPoints("roman");
    expect(roman.length).toBeGreaterThan(12);
    expect(roman.some((p) => /personnages/i.test(p.label))).toBe(true);

    // « documentaire » n'a pas de profil propre → grille par défaut (commune).
    const documentaire = await effectiveControlPoints("documentaire");
    const defaut = await effectiveControlPoints(null);
    expect(documentaire.map((p) => p.label)).toEqual(defaut.map((p) => p.label));
    expect(defaut.length).toBeGreaterThan(0);
  });

  it("le bloc « méthode » porte la grille, les sévérités officielles et les règles de fiabilité", async () => {
    const txt = await buildCorrectionMethodText({ bookTypeCode: "poesie", bookTypeLabel: "Poésie", support: "manuscrit_interieur", relecture: 1 });
    expect(txt).toContain("Type d'ouvrage = Poésie");
    expect(txt).toContain("Relecture 1");
    expect(txt).toContain("C1 (BLOQUANT");
    expect(txt).toContain("[S]"); // la poésie classe les ruptures volontaires en suggestion
    expect(txt).toContain("ne jamais inventer");
  });

  it("GET /ai-editorial/book-types renvoie les types et les supports", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/ai-editorial/book-types", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.book_types.length).toBeGreaterThanOrEqual(20);
    expect(body.supports.some((s: { code: string }) => s.code === "couverture")).toBe(true);
  });

  it("un NOUVEAU type d'ouvrage + sa grille s'ajoutent sans toucher au moteur", async () => {
    const put1 = await app.inject({ method: "PUT", url: "/api/v1/ai-editorial/book-types/test_type_xyz", headers: { cookie }, payload: { label: "Type de test" } });
    expect(put1.statusCode).toBe(200);
    const put2 = await app.inject({
      method: "PUT",
      url: "/api/v1/ai-editorial/correction-profiles/test_type_xyz",
      headers: { cookie },
      payload: { label: "Grille de test", points: [{ label: "Contrôle spécifique de test", default_severity: "C1" }] },
    });
    expect(put2.statusCode).toBe(200);
    const pts = await effectiveControlPoints("test_type_xyz");
    expect(pts).toHaveLength(1);
    expect(pts[0].label).toBe("Contrôle spécifique de test");
    expect(pts[0].defaultSeverity).toBe("C1");
  });
});
