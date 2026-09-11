import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, realizationPayload, seedVc1 } from "./helpers.js";

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

  it("bloque la validation tant que le livrable n'est pas déposé, puis autorise (Expertise)", async () => {
    const m = await manuscriptAt("EXPERTISE");

    // Méta : pas de fichier au départ, mais étape « requise ».
    const meta0 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-deliverable/EXPERTISE`, headers: { cookie } });
    expect(meta0.statusCode).toBe(200);
    expect(meta0.json().required).toBe(true);
    expect(meta0.json().has_file).toBe(false);

    // Validation refusée.
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/EXPERTISE/validate`, headers: { cookie }, payload: realizationPayload("EXPERTISE") });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("deliverable_missing");

    // Dépôt du livrable.
    const mp = multipart("file", "expertise.txt", "Rapport d'expertise.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/step-deliverable/EXPERTISE`, headers: { cookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);

    const meta1 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-deliverable/EXPERTISE`, headers: { cookie } });
    expect(meta1.json().has_file).toBe(true);

    // Validation possible.
    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/EXPERTISE/validate`, headers: { cookie }, payload: realizationPayload("EXPERTISE") });
    expect(ok.statusCode).toBe(200);
  });

  it("PLANIFICATION n'a plus de verrou « livrable fichier » (mais exige les VC1)", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    const meta = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-deliverable/PLANIFICATION`, headers: { cookie } });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().required).toBe(false);
    // Les deux fichiers VC1 restent obligatoires ; une fois déposés, l'étape se
    // valide sans « livrable de sortie » et mène à l'Expertise.
    await seedVc1(m.id);
    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("EXPERTISE");
  });

  it("PLANIFICATION : les deux dépôts VC1 sont obligatoires pour avancer", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    // Aucun VC1 → refus.
    const none = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe("vc1_missing");

    // Un seul VC1 (manuscrit) → toujours refusé (il manque les couvertures).
    const mp = multipart("file", "manuscrit.txt", "Manuscrit à corriger.");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/vc1/manuscrit`, headers: { cookie, ...mp.headers }, payload: mp.body });
    const one = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
    expect(one.statusCode).toBe(409);
    expect(one.json().code).toBe("vc1_missing");

    // Les deux VC1 → il reste le garde-fou « aperçu du planning téléchargé ».
    const mp2 = multipart("file", "couvertures.txt", "Couvertures.");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/vc1/couvertures`, headers: { cookie, ...mp2.headers }, payload: mp2.body });
    const notGenerated = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
    expect(notGenerated.statusCode).toBe(409);
    expect(notGenerated.json().code).toBe("plan_not_generated");

    // Une fois l'aperçu du planning généré/téléchargé → validation possible.
    await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${m.id}/project-plan`, headers: { cookie }, payload: { activities: [{ label: "Lancement", priority: "haute", status: "a_faire" }] } });
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/project-plan/mark-generated`, headers: { cookie } });
    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: realizationPayload("PLANIFICATION") });
    expect(ok.statusCode).toBe(200);
  });

  it("le paramètre n'inclut plus PLANIFICATION (ni dans le défaut ni dans les choix)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/workflow-deliverable-steps", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps).not.toContain("PLANIFICATION");
    const candidates = res.json().candidates as { code: string }[];
    expect(candidates.some((c) => c.code === "PLANIFICATION")).toBe(false);
    expect(candidates.some((c) => c.code === "MISE_EN_PAGE")).toBe(true);
  });

  it("retirer une étape du paramètre lève son verrou (restauré ensuite)", async () => {
    // On enlève EXPERTISE du verrou : la validation passe alors sans livrable.
    const put = await app.inject({ method: "PUT", url: "/api/v1/workflow-deliverable-steps", headers: { cookie }, payload: { steps: ["REECRITURE"] } });
    expect(put.statusCode).toBe(200);
    try {
      const m = await manuscriptAt("EXPERTISE");
      const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/EXPERTISE/validate`, headers: { cookie }, payload: realizationPayload("EXPERTISE") });
      expect(ok.statusCode).toBe(200);
    } finally {
      // Restaure le défaut pour ne pas contaminer les autres suites.
      await app.inject({ method: "PUT", url: "/api/v1/workflow-deliverable-steps", headers: { cookie }, payload: { steps: ["EXPERTISE", "REECRITURE"] } });
    }
  });
});
