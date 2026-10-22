import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

// L'éditorial peut renseigner, DÈS l'enregistrement/l'évaluation, l'infographe
// qui suivra le manuscrit, pour qu'à la correction de couverture le rapport lui
// soit adressé automatiquement.
describe("Enregistrement : infographe pressenti (suivi couverture)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let infographeId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findFirstOrThrow()).id;
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "InfoGraph123!");
    infographeId = (await prisma.user.findUniqueOrThrow({ where: { username: info.username } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const createPayload = (title: string, coverIntegratorId?: string) => ({
    title, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais",
    ...(coverIntegratorId ? { cover_integrator_id: coverIntegratorId } : {}),
    author: { first_name: "Auteur", last_name: title, id_type: "CNI", id_number: `ID${rnd()}` },
  });

  it("enregistre l'infographe pressenti à la création, et il est retrouvé comme intégrateur de couverture", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie: adminCookie }, payload: createPayload(`Avec infographe ${rnd()}`, infographeId) });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    const m = await prisma.manuscript.findUniqueOrThrow({ where: { id } });
    expect(m.coverIntegratorId).toBe(infographeId);
    // Exposé par l'endpoint d'intégrateur de couverture (routage du rapport).
    const integ = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/cover-integrator`, headers: { cookie: adminCookie } });
    expect(integ.json().integrator?.id).toBe(infographeId);
  });

  it("refuse un intégrateur qui n'est pas un infographe (400)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie: adminCookie }, payload: createPayload(`Mauvais intégrateur ${rnd()}`, adminId) });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("invalid_integrator");
  });

  it("reste facultatif : sans infographe, l'enregistrement passe et le champ est vide", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie: adminCookie }, payload: createPayload(`Sans infographe ${rnd()}`) });
    expect(r.statusCode).toBe(201);
    const m = await prisma.manuscript.findUniqueOrThrow({ where: { id: r.json().id as string } });
    expect(m.coverIntegratorId).toBeNull();
  });
});
