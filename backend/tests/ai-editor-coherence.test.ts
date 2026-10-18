import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const calls: { messages?: Array<{ role: string; content: string }> }[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { messages?: Array<{ role: string; content: string }> }) => {
        calls.push({ messages: args.messages });
        return { model: "claude-sonnet-5", stop_reason: "end_turn", content: [{ type: "text", text: "Analyse : aucune contradiction majeure, une répétition au chapitre 2." }], usage: { input_tokens: 40, output_tokens: 60 } };
      },
    };
    constructor(_o: unknown) {}
  }
  return { default: FakeAnthropic };
});

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { storeFile } = await import("../src/lib/storage.js");
const { extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

const MANUSCRIPT = [
  "Chapitre 1", "Mbalmayo s'éveillait. " + "Scène paisible. ".repeat(8) + " Terme ZEBRASCOPE ici.",
  "Chapitre 2", "Douala grondait. " + "La tension monte. ".repeat(8) + " Terme QUASIMODON ici.",
  "Chapitre 3", "Le dénouement approchait. " + "Les fils se dénouent. ".repeat(8) + " Terme FLIBUSTIER ici.",
].join("\n");

describe("SAGE — cohérence & conséquences d'une modification (Lot D)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let withFile: string;
  let withoutFile: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const mk = async (t: string) => (await prisma.manuscript.create({ data: { manuscriptNumber: `COH-${rnd()}`, title: t, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } })).id;
    withFile = await mk(`Cohérence SAGE ${rnd()}`);
    withoutFile = await mk(`Sans fichier ${rnd()}`);
    const stored = await storeFile(Buffer.from(MANUSCRIPT, "utf8"), "manuscrit.txt");
    await prisma.document.create({ data: { entityType: "manuscript", entityId: withFile, category: "manuscrit", title: "Manuscrit", createdBy: adminId, versions: { create: { versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: "text/plain", sha256Hash: stored.sha256Hash, uploadedBy: adminId } } } });
    await app.inject({ method: "PUT", url: "/api/v1/ai-editorial/config", headers: { cookie: adminCookie }, payload: { enabled: true, models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger", expertise: "intermediaire", reecriture: "intermediaire" }, allowed_confidentiality: ["public", "interne", "restreint"], api_key: "sk-ant-test-FAKE0000" } });
  });

  afterAll(async () => {
    await prisma.aiEditorialPassage.deleteMany({ where: { manuscriptId: { in: [withFile, withoutFile] } } }).catch(() => {});
    await prisma.aiEditorialMessage.deleteMany({ where: { manuscriptId: { in: [withFile, withoutFile] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const waitMessage = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const m = await prisma.aiEditorialMessage.findUniqueOrThrow({ where: { id } });
      if (m.status !== "pending") return m;
      await new Promise((res) => setTimeout(res, 50));
    }
    return prisma.aiEditorialMessage.findUniqueOrThrow({ where: { id } });
  };

  it("refuse l'analyse de cohérence sans manuscrit déposé", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withoutFile}/coherence`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("no_manuscript_file");
  });

  it("produit une analyse de cohérence", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/coherence`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(202);
    const m = await waitMessage(r.json().message_id);
    expect(m.status).toBe("done");
    expect(m.kind).toBe("coherence");
    expect(m.content.length).toBeGreaterThan(0);
  });

  it("exige une description de modification pour l'analyse de conséquences", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/impact`, headers: { cookie: adminCookie }, payload: { change: "" } });
    expect(r.statusCode).toBe(400);
  });

  it("analyse les conséquences d'une modification en ciblant les passages concernés", async () => {
    const before = calls.length;
    const change = "Le personnage présent au moment du terme QUASIMODON change d'âge : il devient plus âgé.";
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/impact`, headers: { cookie: adminCookie }, payload: { change } });
    expect(r.statusCode).toBe(202);
    const assistant = await waitMessage(r.json().assistant_message_id);
    expect(assistant.status).toBe("done");
    expect(assistant.kind).toBe("impact");
    // La modification est tracée comme message « user » de nature impact.
    const dossier = await app.inject({ method: "GET", url: `/api/v1/ai-editor/${withFile}`, headers: { cookie: adminCookie } });
    const impacts = (dossier.json().messages as Array<{ kind: string; role: string; content: string }>).filter((m) => m.kind === "impact");
    expect(impacts.some((m) => m.role === "user" && m.content.includes("QUASIMODON"))).toBe(true);
    // Le contexte transmis au modèle contient la modification ET le passage ciblé.
    const sent = (calls[calls.length - 1].messages ?? []).map((m) => m.content).join("\n");
    expect(sent).toContain("QUASIMODON");
    expect(sent).toContain("MODIFICATION");
    expect(calls.length).toBeGreaterThan(before);
  });
});
