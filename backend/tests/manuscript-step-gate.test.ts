import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, seedManuscriptSourceFile } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Blocage d'étape : la « Vérification administrative » ne se valide pas tant que
// la fiche de l'auteur est incomplète — le système dit précisément ce qui manque.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("blocage d'étape : vérification administrative incomplète", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login(app, "admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function create(payloadExtra: object, author: object) {
    const r = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title: `G-${Math.random().toString(36).slice(2, 6)}`, genre_id: genreId, language: "fr", owner_id: adminId, author, ...payloadExtra } });
    return r.json().id as string;
  }

  it("refuse la validation et liste ce qui manque (409)", async () => {
    const id = await create({}, { first_name: "In", last_name: "Complet" });
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/steps/VERIF_ADMIN/validate`, headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(409);
    const msg = res.json().message as string;
    expect(msg).toContain("Il manque");
    expect(msg).toContain("moyen de contact");
    expect(msg).toContain("pièce d'identité");
    expect(msg).toContain("frais de dépôt");
  });

  it("refuse tant que le fichier source n'est pas déposé, même fiche complète (409)", async () => {
    const id = await create({ evaluation_fee_choice: "sans_frais" }, { first_name: "Com", last_name: "Plet", email: "a@example.com", id_type: "CNI", id_number: "123456" });
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/steps/VERIF_ADMIN/validate`, headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().message as string).toContain("fichier source");
  });

  it("autorise la validation quand la fiche est complète et le fichier source déposé (200)", async () => {
    const id = await create({ evaluation_fee_choice: "sans_frais" }, { first_name: "Com", last_name: "Plet", email: "a@example.com", id_type: "CNI", id_number: "123456" });
    await seedManuscriptSourceFile(id);
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/steps/VERIF_ADMIN/validate`, headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(200);
  });
});
