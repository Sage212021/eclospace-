import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// On simule l'API Claude : aucun appel réseau, aucun coût réel. Le faux client
// renvoie un rapport et un usage de tokens fixes.
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async () => ({
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: "# Rapport d'évaluation\nSynthèse : manuscrit prometteur.\nAvis : Acceptation avec modifications mineures." }],
        usage: { input_tokens: 12000, output_tokens: 1500 },
      }),
    };
    constructor(_opts: unknown) {}
  }
  return { default: FakeAnthropic };
});

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { storeFile } = await import("../src/lib/storage.js");
const { extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("IA éditoriale — exécution d'un rapport d'évaluation (Lot IA-1)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let manuscriptId: string;
  const s = Math.random().toString(36).slice(2, 6);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();

    // Manuscrit + fichier manuscrit déposé dans la GED (texte simple).
    const ms = await prisma.manuscript.create({
      data: { manuscriptNumber: `AI-${s}`, title: `Ouvrage IA ${s}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date() },
    });
    manuscriptId = ms.id;
    const stored = await storeFile(Buffer.from("Contenu du manuscrit de test.", "utf8"), "manuscrit.txt");
    await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: ms.id, category: "manuscrit", title: "Manuscrit", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: "text/plain", sha256Hash: stored.sha256Hash, uploadedBy: adminId } },
      },
    });

    // Active l'IA + pose une clé (fictive : le client est simulé).
    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/config", headers: { cookie: adminCookie },
      payload: { enabled: true, models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger" }, allowed_confidentiality: ["public", "interne", "restreint"], api_key: "sk-ant-test-FAKE0000" },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // L'analyse est lancée EN ARRIÈRE-PLAN : la requête répond 202 tout de suite,
  // puis le job passe à « terminé » (attendu par sondage).
  const waitJob = async (jobId: string, want: "termine" | "erreur" = "termine") => {
    for (let i = 0; i < 100; i++) {
      const j = await prisma.aiReadingJob.findUniqueOrThrow({ where: { id: jobId } });
      if (j.status === want || j.status === "erreur") return j;
      await new Promise((r) => setTimeout(r, 50));
    }
    return prisma.aiReadingJob.findUniqueOrThrow({ where: { id: jobId } });
  };

  it("lance une évaluation : job terminé, rapport classé dans la GED, coût estimé", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "evaluation", step_code: "COMITE_LECTURE", editor_recommendation: "Insister sur la cohérence." },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeTruthy();
    expect(body.started).toBe(true);

    // Le job aboutit (en arrière-plan) et est tracé.
    const job = await waitJob(body.jobId);
    expect(job.status).toBe("termine");
    expect(job.workType).toBe("evaluation");
    expect(job.model).toBe("claude-haiku-4-5");
    expect(job.editorRecommendation).toBe("Insister sur la cohérence.");
    expect(Number(job.costEstimate)).toBeGreaterThan(0);

    // Un rapport de lecture (.docx) a été classé sur le manuscrit.
    const report = await prisma.document.findFirstOrThrow({ where: { entityType: "manuscript", entityId: manuscriptId, category: "rapport_lecture" }, include: { versions: true } });
    expect(report.versions[0].mimeType).toContain("wordprocessingml");
  });

  it("le journal des jobs du manuscrit est consultable", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs?manuscript=${manuscriptId}`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json().jobs as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("la 1ʳᵉ correction produit AUSSI un manuscrit corrigé (V1) en plus du rapport", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "correction_1", step_code: "CORRECTION" },
    });
    expect(res.statusCode).toBe(202);
    const job = await waitJob(res.json().jobId);
    // Deux documents produits : le rapport + le manuscrit corrigé.
    expect((job.producedDocumentIds as string[]).length).toBe(2);
    const corrected = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, title: { contains: "Manuscrit corrigé (IA) — V1" } } });
    expect(corrected).not.toBeNull();
  });

  it("la relecture de couverture est branchée et classée en pièce d'étape", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "couverture", step_code: "CORRECTION" },
    });
    expect(res.statusCode).toBe(202);
    await waitJob(res.json().jobId);
    const piece = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape" } });
    expect(piece).not.toBeNull();
  });
});
