import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, seedInfographe } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Envoi par e-mail de la version finale du rapport de lecture : autorisations
// (relecteur ou comité) et atteinte du flux d'expédition.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};
const PDF_B64 = Buffer.from("%PDF-1.4 test").toString("base64");

describe("envoi e-mail de la version finale du rapport", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let readerCookie: string;
  let outsiderCookie: string;
  let adminId: string;
  let genreId: string;
  let readerId: string;
  let assignmentId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    const reader = await createUserWithRole(`reader_${rnd()}`, "CORRECTEUR", "Reader123!");
    readerId = reader.id;
    readerCookie = await login(app, reader.username, "Reader123!");
    const outsider = await createUserWithRole(`out_${rnd()}`, "CORRECTEUR", "Out123!");
    outsiderCookie = await login(app, outsider.username, "Out123!");

    // Manuscrit complet → validation VERIF_ADMIN → affectation du relecteur.
    const m = (await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie: adminCookie }, payload: { title: `Email ${rnd()}`, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais", author: { first_name: "A", last_name: "B", email: "a@example.com", id_type: "CNI", id_number: "1" } } })).json();
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/VERIF_ADMIN/validate`, headers: { cookie: adminCookie }, payload: { infographe_id: await seedInfographe() } });
    const a = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/reading-assignments`, headers: { cookie: adminCookie }, payload: { reader_id: readerId, due_at: "2026-12-31T00:00:00.000Z" } });
    assignmentId = a.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse un tiers (ni relecteur ni comité) — 403", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/email-report`, headers: { cookie: outsiderCookie }, payload: { to: "client@example.com", pdf_base64: PDF_B64 } });
    expect(res.statusCode).toBe(403);
  });

  it("relecteur autorisé : atteint le flux d'expédition (503 si SMTP non configuré)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/email-report`, headers: { cookie: readerCookie }, payload: { to: "client@example.com", pdf_base64: PDF_B64 } });
    // 200 si un SMTP est configuré en CI, 503 sinon — dans les deux cas, l'auteur
    // et le flux sont validés (pas de 403/400).
    expect([200, 502, 503]).toContain(res.statusCode);
  });

  it("refuse une adresse invalide (400)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/email-report`, headers: { cookie: readerCookie }, payload: { to: "pas-un-email", pdf_base64: PDF_B64 } });
    expect(res.statusCode).toBe(400);
  });
});
