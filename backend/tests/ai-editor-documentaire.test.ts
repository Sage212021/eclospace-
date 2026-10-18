import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const calls: { messages?: Array<{ role: string; content: string }> }[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { messages?: Array<{ role: string; content: string }> }) => {
        calls.push({ messages: args.messages });
        return { model: "claude-sonnet-5", stop_reason: "end_turn", content: [{ type: "text", text: "Résultat de SAGE." }], usage: { input_tokens: 30, output_tokens: 50 } };
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

describe("SAGE — vérification documentaire & traduction (Lot E)", () => {
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
    const mk = async (t: string) => (await prisma.manuscript.create({ data: { manuscriptNumber: `DOC-${rnd()}`, title: t, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } })).id;
    withFile = await mk(`Documentaire SAGE ${rnd()}`);
    withoutFile = await mk(`Sans fichier ${rnd()}`);
    const stored = await storeFile(Buffer.from("Selon une étude récente, 70 % des lecteurs préfèrent le papier. Le village grandit. ".repeat(10), "utf8"), "manuscrit.txt");
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

  it("refuse la vérification documentaire sans manuscrit déposé", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withoutFile}/documentaire`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("no_manuscript_file");
  });

  it("produit une vérification documentaire", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/documentaire`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(202);
    const m = await waitMessage(r.json().message_id);
    expect(m.status).toBe("done");
    expect(m.kind).toBe("documentaire");
    expect(m.content.length).toBeGreaterThan(0);
  });

  it("exige un passage et une langue valides pour la traduction", async () => {
    const r1 = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/translate`, headers: { cookie: adminCookie }, payload: { source_text: "", target_lang: "en" } });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/translate`, headers: { cookie: adminCookie }, payload: { source_text: "Bonjour", target_lang: "de" } });
    expect(r2.statusCode).toBe(400);
  });

  it("traduit un passage (langue cible transmise au modèle) et conserve l'échange", async () => {
    const source = "Le village s'éveillait doucement sous la brume du matin.";
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/translate`, headers: { cookie: adminCookie }, payload: { source_text: source, target_lang: "en" } });
    expect(r.statusCode).toBe(202);
    const assistant = await waitMessage(r.json().assistant_message_id);
    expect(assistant.status).toBe("done");
    expect(assistant.kind).toBe("traduction");
    // Le passage ET la langue cible sont transmis au modèle.
    const sent = (calls[calls.length - 1].messages ?? []).map((m) => m.content).join("\n");
    expect(sent).toContain(source);
    expect(sent.toLowerCase()).toContain("anglais");
    // L'échange est conservé (le passage source est tracé côté « user »).
    const dossier = await app.inject({ method: "GET", url: `/api/v1/ai-editor/${withFile}`, headers: { cookie: adminCookie } });
    const tr = (dossier.json().messages as Array<{ kind: string; role: string; content: string }>).filter((m) => m.kind === "traduction");
    expect(tr.some((m) => m.role === "user" && m.content.includes(source))).toBe(true);
  });
});
