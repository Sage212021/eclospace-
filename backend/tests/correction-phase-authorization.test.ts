import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Habilitation PAR PHASE du relais de correction (demande opérateur 03/10) :
//   • 1re correction / 2e relecture → le CORRECTEUR ;
//   • version intégrée / version finale → le RESPONSABLE ÉDITORIAL intégrateur.
// Tout dépôt par un profil non habilité doit être REFUSÉ (403).

const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("habilitation par phase du cycle de correction", () => {
  let app: FastifyInstance;
  let correcteurCookie: string;
  let editeurCookie: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const correcteur = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Pwd123!");
    const editeur = await createUserWithRole(`edit_${rnd()}`, "ASSISTANT_EDITORIAL", "Pwd123!");

    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-HAB-${rnd()}`, title: `Habilitation ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date(), correctionIntegratorId: editeur.id },
    });
    manuscriptId = m.id;
    // Le correcteur est le responsable de l'étape Correction.
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: correcteur.id, actualStart: new Date() } });

    const login = async (u: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: "Pwd123!" } });
      return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    };
    correcteurCookie = await login(correcteur.username);
    editeurCookie = await login(editeur.username);
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const deposit = (cookie: string, phase: string) => {
    const mp = multipart(`${phase}.txt`, `contenu ${phase}`);
    return app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/${phase}`, headers: { cookie, ...mp.headers }, payload: mp.body });
  };

  it("le CORRECTEUR dépose la 1re correction (201)", async () => {
    const r = await deposit(correcteurCookie, "rapport_1");
    expect(r.statusCode).toBe(201);
  });

  it("l'ÉDITEUR ne peut PAS déposer la 1re correction (403)", async () => {
    const r = await deposit(editeurCookie, "rapport_1");
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("not_authorized_for_phase");
  });

  it("l'ÉDITEUR intégrateur dépose la version intégrée (201)", async () => {
    const r = await deposit(editeurCookie, "integration_1");
    expect(r.statusCode).toBe(201);
  });

  it("le CORRECTEUR ne peut PAS déposer la version finale (403)", async () => {
    const r = await deposit(correcteurCookie, "integration_finale");
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("not_authorized_for_phase");
  });
});
