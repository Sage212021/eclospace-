import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Recrutement : postes à pourvoir et circuit des candidatures.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Recrut123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("recrutement — postes & candidatures", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    const u = `corr_${rnd()}`;
    await createUserWithRole(u, "CORRECTEUR", PWD); // pas de droit rh
    plainCookie = await login(app, u, PWD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("crée un poste, reçoit une candidature et l'avance dans le circuit", async () => {
    const opening = await app.inject({
      method: "POST",
      url: "/api/v1/job-openings",
      headers: { cookie: adminCookie },
      payload: { title: "Correcteur bilingue", contract_type: "cdd" },
    });
    expect(opening.statusCode).toBe(201);
    const openingId = opening.json().id as string;

    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/job-openings/${openingId}/applications`,
      headers: { cookie: adminCookie },
      payload: { first_name: "Awa", last_name: "Ndiaye", email: "awa@example.com", source: "Spontanée" },
    });
    expect(applied.statusCode).toBe(201);
    const appId = applied.json().id as string;
    expect(applied.json().status).toBe("recue");

    // Avancement : entretien puis retenue → decidedAt renseigné.
    await app.inject({ method: "PATCH", url: `/api/v1/job-applications/${appId}/status`, headers: { cookie: adminCookie }, payload: { status: "entretien" } });
    const retained = await app.inject({ method: "PATCH", url: `/api/v1/job-applications/${appId}/status`, headers: { cookie: adminCookie }, payload: { status: "retenue" } });
    expect(retained.statusCode).toBe(200);
    expect(retained.json().status).toBe("retenue");
    expect(retained.json().decidedAt).not.toBeNull();

    // Le décompte par état apparaît dans la liste des postes.
    const list = await app.inject({ method: "GET", url: "/api/v1/job-openings", headers: { cookie: adminCookie } });
    const row = (list.json() as { id: string; applications_total: number; applications_by_status: Record<string, number> }[]).find((o) => o.id === openingId)!;
    expect(row.applications_total).toBe(1);
    expect(row.applications_by_status.retenue).toBe(1);

    // Clôture du poste (pourvu).
    const closed = await app.inject({ method: "PATCH", url: `/api/v1/job-openings/${openingId}/status`, headers: { cookie: adminCookie }, payload: { status: "pourvu" } });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe("pourvu");
    expect(closed.json().closedAt).not.toBeNull();
  });

  it("refuse un statut de candidature inconnu (400)", async () => {
    const opening = await app.inject({ method: "POST", url: "/api/v1/job-openings", headers: { cookie: adminCookie }, payload: { title: `Poste ${rnd()}` } });
    const openingId = opening.json().id as string;
    const applied = await app.inject({ method: "POST", url: `/api/v1/job-openings/${openingId}/applications`, headers: { cookie: adminCookie }, payload: { first_name: "Test", last_name: "Cand" } });
    const appId = applied.json().id as string;
    const res = await app.inject({ method: "PATCH", url: `/api/v1/job-applications/${appId}/status`, headers: { cookie: adminCookie }, payload: { status: "n_importe_quoi" } });
    expect(res.statusCode).toBe(400);
  });

  it("refuse la création d'un poste sans droit RH (403)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/job-openings", headers: { cookie: plainCookie }, payload: { title: "Poste interdit" } });
    expect(res.statusCode).toBe(403);
  });
});
