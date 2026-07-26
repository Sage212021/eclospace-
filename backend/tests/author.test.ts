import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Espace Auteur (inc. 1) : isolation stricte (un auteur ne voit que ses ouvrages),
// cloisonnement (employé ↔ portail auteur), et création de compte auteur.

const PWD = "AuteurTest123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Espace Auteur — portail et isolation", () => {
  let app: FastifyInstance;
  let cookieA = "";
  let cookieB = "";
  let cookieEmp = "";
  let cookieAdmin = "";
  let msAId = "";
  let msBId = "";
  let partnerNoAccountId = "";
  const userIds: string[] = [];
  const partnerIds: string[] = [];
  const msIds: string[] = [];

  const login = async (u: string, p = PWD) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  async function makeAuthor(tag: string, ownerId: string, title: string) {
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: tag, lastName: "Test", email: `${tag}@ex.test` } });
    const user = await prisma.user.create({
      data: { username: `auth_${tag}`, email: `${tag}@ex.test`, passwordHash: await argon2.hash(PWD), status: "active", accountType: "external", partnerId: partner.id },
    });
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const ms = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-${tag}`, title, language: "fr", origin: "soumission", statusId: status.id, ownerId, receivedAt: new Date("2026-05-01") },
    });
    await prisma.workContributor.create({ data: { manuscriptId: ms.id, partnerId: partner.id, role: "author" } });
    userIds.push(user.id);
    partnerIds.push(partner.id);
    msIds.push(ms.id);
    return { partner, user, ms };
  }

  beforeAll(async () => {
    app = await buildApp();
    const empUser = `emp_${rnd()}`;
    const emp = await createUserWithRole(empUser, "CORRECTEUR", PWD);
    const a = await makeAuthor(`a${rnd()}`, emp.id, "Le Fleuve");
    const b = await makeAuthor(`b${rnd()}`, emp.id, "La Colline");
    msAId = a.ms.id;
    msBId = b.ms.id;
    const p = await prisma.partner.create({ data: { category: "auteur", firstName: `noacc${rnd()}`, lastName: "Test", email: `noacc${rnd()}@ex.test` } });
    partnerNoAccountId = p.id;
    partnerIds.push(p.id);

    cookieA = await login(a.user.username);
    cookieB = await login(b.user.username);
    cookieEmp = await login(empUser);
    cookieAdmin = await login("admin", "TestAdmin123!");
  });

  afterAll(async () => {
    // On ne supprime que les données du catalogue créées ici. Les comptes sont
    // laissés en place : le journal d'audit est append-only (règle du projet) et
    // référence ces utilisateurs ; la base de test est éphémère (reséedée à
    // chaque exécution), comme pour les autres suites.
    await prisma.authorFile.deleteMany({ where: { manuscriptId: { in: msIds } } });
    await prisma.workContributor.deleteMany({ where: { manuscriptId: { in: msIds } } });
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId: { in: msIds } } });
    await prisma.manuscript.deleteMany({ where: { id: { in: msIds } } });
    await app.close();
  });

  it("un auteur ne voit QUE ses propres ouvrages", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/author/works", headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const works = res.json() as { id: string; title: string }[];
    expect(works).toHaveLength(1);
    expect(works[0].id).toBe(msAId);
    expect(works[0].title).toBe("Le Fleuve");
  });

  it("un auteur ne peut pas ouvrir l'ouvrage d'un autre auteur (404)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author/works/${msBId}`, headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(404);
  });

  it("le détail d'un ouvrage expose un fil d'avancement", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author/works/${msBId}`, headers: { cookie: cookieB } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("La Colline");
    expect(Array.isArray(body.timeline)).toBe(true);
  });

  it("le profil auteur renvoie le nom et le nombre d'ouvrages", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/author/me", headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    expect(res.json().works_count).toBe(1);
  });

  it("un employé n'accède pas au portail auteur (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/author/works", headers: { cookie: cookieEmp } });
    expect(res.statusCode).toBe(403);
  });

  it("un auteur n'accède à aucun module ERP (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(403);
  });

  it("un auteur n'apparaît pas dans l'annuaire de la messagerie interne", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/chat/directory", headers: { cookie: cookieEmp } });
    const dir = res.json() as { id: string }[];
    expect(dir.some((d) => userIds.includes(d.id))).toBe(false);
  });

  it("le personnel crée un compte auteur pour une fiche, puis rejette les doublons", async () => {
    const ok = await app.inject({ method: "POST", url: `/api/v1/partners/${partnerNoAccountId}/author-account`, headers: { cookie: cookieAdmin }, payload: { username: `newauth_${rnd()}`, password: PWD } });
    expect(ok.statusCode).toBe(201);
    userIds.push(ok.json().id);
    // doublon : la fiche a déjà un compte
    const dup = await app.inject({ method: "POST", url: `/api/v1/partners/${partnerNoAccountId}/author-account`, headers: { cookie: cookieAdmin }, payload: { username: `x_${rnd()}`, password: PWD } });
    expect(dup.statusCode).toBe(409);
  });

  it("un employé sans droit d'administration ne peut pas créer de compte auteur (403)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/partners/${partnerNoAccountId}/author-account`, headers: { cookie: cookieEmp }, payload: { username: `y_${rnd()}`, password: PWD } });
    expect(res.statusCode).toBe(403);
  });

  // ── Échange de fichiers (inc. 2a) ──────────────────────────────────────────
  function multipart(fileName: string, contentType: string, content: Buffer, label?: string) {
    const boundary = "----ecl" + Math.random().toString(36).slice(2);
    const parts: Buffer[] = [];
    if (label) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n${label}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`));
    parts.push(content, Buffer.from(`\r\n--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  it("l'auteur dépose un fichier sur son ouvrage, le liste et le télécharge", async () => {
    const mp = multipart("corr.txt", "text/plain", Buffer.from("mes corrections"), "Corrections ch. 1");
    const up = await app.inject({ method: "POST", url: `/api/v1/author/works/${msAId}/files`, headers: { cookie: cookieA, "content-type": mp.contentType }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    const fileId = up.json().id;
    expect(up.json().direction).toBe("from_author");

    const list = await app.inject({ method: "GET", url: `/api/v1/author/works/${msAId}/files`, headers: { cookie: cookieA } });
    expect((list.json() as unknown[]).length).toBe(1);

    const dl = await app.inject({ method: "GET", url: `/api/v1/author/files/${fileId}/download`, headers: { cookie: cookieA } });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("mes corrections");
  });

  it("un auteur ne peut pas déposer sur l'ouvrage d'un autre (404)", async () => {
    const mp = multipart("x.txt", "text/plain", Buffer.from("intrus"));
    const res = await app.inject({ method: "POST", url: `/api/v1/author/works/${msBId}/files`, headers: { cookie: cookieA, "content-type": mp.contentType }, payload: mp.body });
    expect(res.statusCode).toBe(404);
  });

  it("la maison partage un fichier à l'auteur, qui le voit et le télécharge", async () => {
    const mp = multipart("bat.txt", "text/plain", Buffer.from("BAT a valider"), "BAT");
    const share = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${msAId}/author-files`, headers: { cookie: cookieAdmin, "content-type": mp.contentType }, payload: mp.body });
    expect(share.statusCode).toBe(201);
    expect(share.json().from_house).toBe(true);

    const list = await app.inject({ method: "GET", url: `/api/v1/author/works/${msAId}/files`, headers: { cookie: cookieA } });
    const houseFile = (list.json() as { id: string; from_house: boolean }[]).find((f) => f.from_house);
    expect(houseFile).toBeTruthy();
    const dl = await app.inject({ method: "GET", url: `/api/v1/author/files/${houseFile!.id}/download`, headers: { cookie: cookieA } });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("BAT a valider");
  });

  it("un auteur ne télécharge pas le fichier d'un autre auteur (404)", async () => {
    const mp = multipart("b.txt", "text/plain", Buffer.from("prive B"));
    const up = await app.inject({ method: "POST", url: `/api/v1/author/works/${msBId}/files`, headers: { cookie: cookieB, "content-type": mp.contentType }, payload: mp.body });
    const idB = up.json().id;
    const res = await app.inject({ method: "GET", url: `/api/v1/author/files/${idB}/download`, headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(404);
  });

  it("l'auteur retire son propre dépôt mais pas un fichier de la maison (403)", async () => {
    const mp = multipart("todel.txt", "text/plain", Buffer.from("a retirer"));
    const up = await app.inject({ method: "POST", url: `/api/v1/author/works/${msAId}/files`, headers: { cookie: cookieA, "content-type": mp.contentType }, payload: mp.body });
    const del = await app.inject({ method: "DELETE", url: `/api/v1/author/files/${up.json().id}`, headers: { cookie: cookieA } });
    expect(del.statusCode).toBe(200);
    // Un fichier partagé par la maison ne peut pas être retiré par l'auteur.
    const houseShare = multipart("house.txt", "text/plain", Buffer.from("maison"), "doc");
    const share = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${msAId}/author-files`, headers: { cookie: cookieAdmin, "content-type": houseShare.contentType }, payload: houseShare.body });
    const delHouse = await app.inject({ method: "DELETE", url: `/api/v1/author/files/${share.json().id}`, headers: { cookie: cookieA } });
    expect(delHouse.statusCode).toBe(403);
  });
});
