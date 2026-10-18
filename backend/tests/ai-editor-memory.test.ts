import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// API Claude simulée : enregistre les messages reçus (pour vérifier le contexte
// transmis) et renvoie une réponse fixe.
const calls: { system?: string; messages?: Array<{ role: string; content: string }> }[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { system?: string; messages?: Array<{ role: string; content: string }> }) => {
        calls.push({ system: args.system, messages: args.messages });
        return { model: "claude-sonnet-5", stop_reason: "end_turn", content: [{ type: "text", text: "Réponse de SAGE." }], usage: { input_tokens: 50, output_tokens: 80 } };
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
const { buildPassageIndex, retrievePassages } = await import("../src/lib/aiEditor.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

// Manuscrit à 3 chapitres, chacun avec un mot-clé UNIQUE (pour tester la
// recherche du passage exact).
const MANUSCRIPT = [
  "Chapitre 1",
  "Le village de Mbalmayo s'éveillait doucement. " + "Une scène paisible s'installe. ".repeat(10) + " Le terme singulier ZEBRASCOPE apparaît uniquement ici.",
  "",
  "Chapitre 2",
  "La ville de Douala grondait de mille bruits. " + "La tension monte peu à peu. ".repeat(10) + " Le terme singulier QUASIMODON apparaît uniquement ici.",
  "",
  "Chapitre 3",
  "Le dénouement approchait enfin. " + "Les fils se dénouent lentement. ".repeat(10) + " Le terme singulier FLIBUSTIER apparaît uniquement ici.",
].join("\n");

describe("SAGE — mémoire & recherche de passages (Lot B)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    manuscriptId = (await prisma.manuscript.create({ data: { manuscriptNumber: `MEM-${rnd()}`, title: `Mémoire SAGE ${rnd()}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } })).id;
    const stored = await storeFile(Buffer.from(MANUSCRIPT, "utf8"), "manuscrit.txt");
    await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", title: "Manuscrit", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: "text/plain", sha256Hash: stored.sha256Hash, uploadedBy: adminId } },
      },
    });
    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/config", headers: { cookie: adminCookie },
      payload: { enabled: true, models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger", expertise: "intermediaire", reecriture: "intermediaire" }, allowed_confidentiality: ["public", "interne", "restreint"], api_key: "sk-ant-test-FAKE0000" },
    });
  });

  afterAll(async () => {
    await prisma.aiEditorialPassage.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.aiEditorialMessage.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const waitMessage = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const m = await prisma.aiEditorialMessage.findUniqueOrThrow({ where: { id } });
      if (m.status !== "pending") return m;
      await new Promise((r) => setTimeout(r, 50));
    }
    return prisma.aiEditorialMessage.findUniqueOrThrow({ where: { id } });
  };

  it("découpe le manuscrit en passages étiquetés par chapitre", async () => {
    const count = await buildPassageIndex(manuscriptId);
    expect(count).toBeGreaterThanOrEqual(3);
    const passages = await prisma.aiEditorialPassage.findMany({ where: { manuscriptId }, orderBy: { ordinal: "asc" } });
    const labels = passages.map((p) => p.chapterLabel);
    expect(labels).toContain("Chapitre 1");
    expect(labels).toContain("Chapitre 2");
    expect(labels).toContain("Chapitre 3");
  });

  it("retrouve le PASSAGE EXACT contenant un mot-clé (recherche plein texte)", async () => {
    await buildPassageIndex(manuscriptId);
    const hits = await retrievePassages(manuscriptId, "QUASIMODON", 3);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].content).toContain("QUASIMODON");
    expect(hits[0].chapterLabel).toBe("Chapitre 2");
    // Le mot-clé d'un autre chapitre n'apparaît pas dans ce passage.
    expect(hits[0].content).not.toContain("ZEBRASCOPE");
  });

  it("le diagnostic construit la mémoire (passages indexés visibles dans le dossier)", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/diagnose`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(202);
    await waitMessage(r.json().message_id);
    const dossier = await app.inject({ method: "GET", url: `/api/v1/ai-editor/${manuscriptId}`, headers: { cookie: adminCookie } });
    expect(dossier.json().memory.passage_count).toBeGreaterThanOrEqual(3);
  });

  it("le dialogue transmet au modèle l'INTÉGRALITÉ du manuscrit (pas des extraits)", async () => {
    const before = calls.length;
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/message`, headers: { cookie: adminCookie }, payload: { content: "As-tu lu tout le manuscrit ?" } });
    expect(r.statusCode).toBe(202);
    await waitMessage(r.json().assistant_message_id);
    expect(calls.length).toBeGreaterThan(before);
    const sent = (calls[calls.length - 1].messages ?? []).map((m) => m.content).join("\n");
    // Les mots-clés des TROIS chapitres sont présents → tout le manuscrit est transmis,
    // même pour une question générale (plus de repli sur les seuls premiers extraits).
    expect(sent).toContain("ZEBRASCOPE");
    expect(sent).toContain("QUASIMODON");
    expect(sent).toContain("FLIBUSTIER");
    expect(sent).toContain("MANUSCRIT");
  });
});
