import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Attribution nominative par étape : mise en page → maquettistes ; infographie →
// infographes ; ISBN & dépôt légal → secrétariat/assistant éditorial ; BAT Final
// → contrôle qualité ; impression → production. On peut choisir/changer la
// personne, et un profil hors service est refusé (chacun sa spécialité).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Attribution par étape — mise en page & infographie", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let maquettisteId: string;
  let infographeId: string;
  let assistantId: string;
  let qualiteId: string;
  let imprimeurId: string;
  const s = Math.random().toString(36).slice(2, 7);
  const ids: string[] = [];

  const login = async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const makeManuscript = async (statusCode: string, title: string) => {
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: statusCode } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-${statusCode}-${s}-${ids.length}`, title, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    ids.push(m.id);
    return m.id;
  };
  const assigneeIds = async (manuscriptId: string) => {
    const r = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/current-step-assignees`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return (r.json().assignees as Array<{ id: string }>).map((a) => a.id);
  };
  const assign = (manuscriptId: string, assigneeId: string) =>
    app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/current-step/assignee`, headers: { cookie }, payload: { assignee_id: assigneeId } });

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    maquettisteId = (await createUserWithRole(`maq_${s}`, "MAQUETTISTE", "Maq123!")).id;
    infographeId = (await createUserWithRole(`info_${s}`, "RESP_INFOGRAPHIE", "Info123!")).id;
    assistantId = (await createUserWithRole(`ast_${s}`, "ASSISTANT_EDITORIAL", "Asst123!")).id;
    qualiteId = (await createUserWithRole(`cq_${s}`, "RESP_QUALITE", "Qual123!")).id;
    imprimeurId = (await createUserWithRole(`imp_${s}`, "RESP_IMPRESSION", "Impr123!")).id;
  });

  afterAll(async () => {
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId: { in: ids } } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("mise en page : propose les maquettistes, refuse un infographe", async () => {
    const m = await makeManuscript("MISE_EN_PAGE", `Maquette ${s}`);
    const list = await assigneeIds(m);
    expect(list).toContain(maquettisteId);
    expect(list).not.toContain(infographeId);

    expect((await assign(m, maquettisteId)).statusCode).toBe(200);
    const bad = await assign(m, infographeId);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("invalid_assignee");
  });

  it("infographie : propose les infographes, refuse un maquettiste", async () => {
    const m = await makeManuscript("INFOGRAPHIE", `Infographie ${s}`);
    const list = await assigneeIds(m);
    expect(list).toContain(infographeId);
    expect(list).not.toContain(maquettisteId);

    expect((await assign(m, infographeId)).statusCode).toBe(200);
    expect((await assign(m, maquettisteId)).statusCode).toBe(400);
  });

  it("ISBN & dépôt légal : propose le secrétariat/assistant éditorial, refuse un imprimeur", async () => {
    const m = await makeManuscript("ATTRIBUTION_REFERENCES", `ISBN ${s}`);
    const list = await assigneeIds(m);
    expect(list).toContain(assistantId);
    expect(list).not.toContain(imprimeurId);

    expect((await assign(m, assistantId)).statusCode).toBe(200);
    const bad = await assign(m, imprimeurId);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("invalid_assignee");
  });

  it("BAT Final : propose le contrôle qualité, refuse un maquettiste", async () => {
    const m = await makeManuscript("VALIDATION_BAT", `BAT ${s}`);
    const list = await assigneeIds(m);
    expect(list).toContain(qualiteId);
    expect(list).not.toContain(maquettisteId);

    expect((await assign(m, qualiteId)).statusCode).toBe(200);
    expect((await assign(m, maquettisteId)).statusCode).toBe(400);
  });

  it("Impression : propose la production/impression, refuse un correcteur hors service", async () => {
    const m = await makeManuscript("IMPRESSION", `Impression ${s}`);
    const list = await assigneeIds(m);
    expect(list).toContain(imprimeurId);
    expect(list).not.toContain(maquettisteId);

    expect((await assign(m, imprimeurId)).statusCode).toBe(200);
    expect((await assign(m, maquettisteId)).statusCode).toBe(400);
  });
});
