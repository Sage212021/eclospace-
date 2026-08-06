import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Formation : demandes, sessions et suivi de participation.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Formation123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("formation — demandes, sessions & participation", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    const u = `corr_${rnd()}`;
    await createUserWithRole(u, "CORRECTEUR", PWD); // pas de droit rh
    plainCookie = await login(app, u, PWD);
    const emp = await prisma.employee.create({ data: { firstName: "For", lastName: "Mation" } });
    employeeId = emp.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre une demande puis la décide (approuvée, horodatée)", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/api/v1/training-requests",
      headers: { cookie: adminCookie },
      payload: { employee_id: employeeId, topic: "InDesign avancé", motivation: "Maquettes complexes" },
    });
    expect(req.statusCode).toBe(201);
    const reqId = req.json().id as string;

    const decided = await app.inject({ method: "PATCH", url: `/api/v1/training-requests/${reqId}/status`, headers: { cookie: adminCookie }, payload: { status: "approuvee" } });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().status).toBe("approuvee");
    expect(decided.json().decidedAt).not.toBeNull();
  });

  it("crée une session, inscrit un collaborateur et l'émarge présent", async () => {
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/training-sessions",
      headers: { cookie: adminCookie },
      payload: { title: "Sécurité au travail", provider: "Organisme X", mode: "presentiel", cost: 250 },
    });
    expect(session.statusCode).toBe(201);
    const sessionId = session.json().id as string;

    const enrolled = await app.inject({ method: "POST", url: `/api/v1/training-sessions/${sessionId}/participants`, headers: { cookie: adminCookie }, payload: { employee_id: employeeId } });
    expect(enrolled.statusCode).toBe(201);
    const partId = enrolled.json().id as string;

    // Double inscription refusée (409).
    const again = await app.inject({ method: "POST", url: `/api/v1/training-sessions/${sessionId}/participants`, headers: { cookie: adminCookie }, payload: { employee_id: employeeId } });
    expect(again.statusCode).toBe(409);

    // Émargement présent.
    const present = await app.inject({ method: "PATCH", url: `/api/v1/training-participations/${partId}`, headers: { cookie: adminCookie }, payload: { status: "present" } });
    expect(present.statusCode).toBe(200);
    expect(present.json().status).toBe("present");

    // Le décompte apparaît dans la liste des sessions.
    const list = await app.inject({ method: "GET", url: "/api/v1/training-sessions", headers: { cookie: adminCookie } });
    const row = (list.json() as { id: string; participants_total: number; participants_by_status: Record<string, number> }[]).find((s) => s.id === sessionId)!;
    expect(row.participants_total).toBe(1);
    expect(row.participants_by_status.present).toBe(1);
  });

  it("refuse la création d'une demande sans droit RH (403)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/training-requests", headers: { cookie: plainCookie }, payload: { employee_id: employeeId, topic: "Interdit" } });
    expect(res.statusCode).toBe(403);
  });
});
