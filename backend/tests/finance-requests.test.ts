import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Demandes Finance depuis la fiche manuscrit : devis / facture frais de dépôt.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "FinReq123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("demandes Finance depuis la fiche manuscrit", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;
  let adminId: string;
  let genreId: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    const u = `corr_${rnd()}`;
    await createUserWithRole(u, "CORRECTEUR", PWD); // ni manuscrits:saisie ni finance
    plainCookie = await login(app, u, PWD);
    const m = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title: "Œuvre demande finance", genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Dem", last_name: "Andeur" } },
    });
    manuscriptId = m.json().id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("émet une demande, la Finance la reçoit puis la traite", async () => {
    const req = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscriptId}/finance-requests`,
      headers: { cookie: adminCookie },
      payload: { type: "frais_depot", note: "Frais de dépôt à facturer à l'auteur" },
    });
    expect(req.statusCode).toBe(201);
    const reqId = req.json().id as string;

    // Doublon du même type refusé tant qu'il est en attente (409).
    const dup = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/finance-requests`, headers: { cookie: adminCookie }, payload: { type: "frais_depot" } });
    expect(dup.statusCode).toBe(409);

    // La Finance reçoit la demande dans sa file, avec titre + auteur.
    const queue = await app.inject({ method: "GET", url: "/api/v1/finance-requests", headers: { cookie: adminCookie } });
    const row = (queue.json() as { id: string; title: string; author: string | null; type: string }[]).find((r) => r.id === reqId)!;
    expect(row.type).toBe("frais_depot");
    expect(row.author).toBe("Dem Andeur");

    // Traitement : la demande sort de la file en attente.
    const done = await app.inject({ method: "PATCH", url: `/api/v1/finance-requests/${reqId}`, headers: { cookie: adminCookie }, payload: { status: "processed", resolution: "Facture FR-2026-001 établie" } });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe("processed");
    const queueAfter = await app.inject({ method: "GET", url: "/api/v1/finance-requests", headers: { cookie: adminCookie } });
    expect((queueAfter.json() as { id: string }[]).some((r) => r.id === reqId)).toBe(false);

    // Un nouveau devis peut alors être demandé (type distinct, et l'ancien traité).
    const devis = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/finance-requests`, headers: { cookie: adminCookie }, payload: { type: "devis" } });
    expect(devis.statusCode).toBe(201);
  });

  it("refuse l'émission sans droit de saisie manuscrit (403)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/finance-requests`, headers: { cookie: plainCookie }, payload: { type: "devis" } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse un type de demande inconnu (400)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/finance-requests`, headers: { cookie: adminCookie }, payload: { type: "n_importe_quoi" } });
    expect(res.statusCode).toBe(400);
  });
});
