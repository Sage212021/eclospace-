import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, realizationPayload } from "./helpers.js";

// Verrou « livrable de sortie » : une étape soumise au verrou (Planification…)
// ne se valide pas tant que son fichier livrable n'est pas déposé.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

async function manuscriptAt(code: string) {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-LIV-${rnd()}`, title: `Livrable ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

describe("verrou « livrable de sortie » d'étape", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("bloque la validation tant que le livrable n'est pas déposé, puis autorise", async () => {
    const m = await manuscriptAt("PLANIFICATION");

    // Méta : pas de fichier au départ, mais étape « requise ».
    const meta0 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-deliverable/PLANIFICATION`, headers: { cookie } });
    expect(meta0.statusCode).toBe(200);
    expect(meta0.json().required).toBe(true);
    expect(meta0.json().has_file).toBe(false);

    // Validation refusée.
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("deliverable_missing");

    // Dépôt du livrable.
    const mp = multipart("file", "planning.txt", "Planning du projet.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/step-deliverable/PLANIFICATION`, headers: { cookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);

    const meta1 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-deliverable/PLANIFICATION`, headers: { cookie } });
    expect(meta1.json().has_file).toBe(true);

    // Validation possible.
    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("EXPERTISE");
  });

  it("le paramètre expose la liste des étapes verrouillées (défaut)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/workflow-deliverable-steps", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps).toContain("PLANIFICATION");
    expect((res.json().candidates as { code: string }[]).some((c) => c.code === "MISE_EN_PAGE")).toBe(true);
  });

  it("retirer une étape du paramètre lève son verrou (restauré ensuite)", async () => {
    // On enlève PLANIFICATION du verrou : la validation passe alors sans livrable.
    const put = await app.inject({ method: "PUT", url: "/api/v1/workflow-deliverable-steps", headers: { cookie }, payload: { steps: ["EXPERTISE", "REECRITURE"] } });
    expect(put.statusCode).toBe(200);
    try {
      const m = await manuscriptAt("PLANIFICATION");
      const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
      expect(ok.statusCode).toBe(200);
    } finally {
      // Restaure le défaut pour ne pas contaminer les autres suites.
      await app.inject({ method: "PUT", url: "/api/v1/workflow-deliverable-steps", headers: { cookie }, payload: { steps: ["PLANIFICATION", "EXPERTISE", "REECRITURE"] } });
    }
  });
});
