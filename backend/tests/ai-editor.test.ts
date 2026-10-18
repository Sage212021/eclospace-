import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// API Claude simulée : le faux client renvoie un texte fixe (aucun appel réseau).
const calls: { system?: string; messages?: unknown }[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { system?: string; messages?: unknown }) => {
        calls.push({ system: args.system, messages: args.messages });
        return {
          model: "claude-sonnet-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Diagnostic éditorial : structure solide ; le dénouement mérite d'être renforcé." }],
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      },
    };
    constructor(_o: unknown) {}
  }
  return { default: FakeAnthropic };
});

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { storeFile } = await import("../src/lib/storage.js");
const { createUserWithRole, extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Éclosion Éditorial IA — Lot A (lecture + diagnostic + dialogue)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let correcteurCookie: string;
  let adminId: string;
  let withFile: string;
  let withoutFile: string;
  let correcteurUsername = "";

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const corr = await createUserWithRole(`corr_ed_${rnd()}`, "CORRECTEUR", "CorrEd123!");
    correcteurUsername = corr.username;
    correcteurCookie = await login(correcteurUsername, "CorrEd123!");

    const status = await prisma.workflowStatus.findFirstOrThrow();
    const mk = async (title: string) =>
      (await prisma.manuscript.create({ data: { manuscriptNumber: `ED-${rnd()}`, title, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } })).id;
    withFile = await mk(`Éditeur IA avec fichier ${rnd()}`);
    withoutFile = await mk(`Éditeur IA sans fichier ${rnd()}`);

    // Manuscrit déposé (texte) pour le premier ouvrage uniquement.
    const stored = await storeFile(Buffer.from("Chapitre 1. Le village s'éveillait doucement sous la brume. ".repeat(20), "utf8"), "manuscrit.txt");
    await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: withFile, category: "manuscrit", title: "Manuscrit", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: "text/plain", sha256Hash: stored.sha256Hash, uploadedBy: adminId } },
      },
    });

    // Active l'IA + clé fictive (client simulé).
    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/config", headers: { cookie: adminCookie },
      payload: { enabled: true, models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger", expertise: "intermediaire", reecriture: "intermediaire" }, allowed_confidentiality: ["public", "interne", "restreint"], api_key: "sk-ant-test-FAKE0000" },
    });
  });

  afterAll(async () => {
    await prisma.aiEditorialMessage.deleteMany({ where: { manuscriptId: { in: [withFile, withoutFile] } } }).catch(() => {});
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

  it("réserve l'accès à la Direction générale / administrateur (403 pour un correcteur)", async () => {
    const r = await app.inject({ method: "GET", url: `/api/v1/ai-editor/${withFile}`, headers: { cookie: correcteurCookie } });
    expect(r.statusCode).toBe(403);
  });

  it("ne travaille que sur un ouvrage enregistré (404 sinon)", async () => {
    const r = await app.inject({ method: "GET", url: `/api/v1/ai-editor/00000000-0000-0000-0000-000000000000`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(404);
  });

  it("expose l'état du dossier (sources + historique vide au départ)", async () => {
    const r = await app.inject({ method: "GET", url: `/api/v1/ai-editor/${withFile}`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.sources.has_manuscript_file).toBe(true);
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("refuse le diagnostic sans manuscrit déposé", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withoutFile}/diagnose`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("no_manuscript_file");
  });

  it("établit un diagnostic en arrière-plan à partir du manuscrit déposé", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/diagnose`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(202);
    const msg = await waitMessage(r.json().message_id);
    expect(msg.status).toBe("done");
    expect(msg.kind).toBe("diagnostic");
    expect(msg.content).toContain("Diagnostic éditorial");
  });

  it("répond à une question en dialogue et conserve l'échange (historique)", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${withFile}/message`, headers: { cookie: adminCookie }, payload: { content: "Le dénouement est-il assez préparé ?" } });
    expect(r.statusCode).toBe(202);
    const assistant = await waitMessage(r.json().assistant_message_id);
    expect(assistant.status).toBe("done");
    expect(assistant.role).toBe("assistant");

    // La question de l'opérateur ET la réponse sont persistées (historique).
    const listed = await app.inject({ method: "GET", url: `/api/v1/ai-editor/${withFile}`, headers: { cookie: adminCookie } });
    const chat = (listed.json().messages as Array<{ kind: string; role: string; content: string }>).filter((m) => m.kind === "chat");
    expect(chat.some((m) => m.role === "user" && m.content.includes("dénouement"))).toBe(true);
    expect(chat.some((m) => m.role === "assistant")).toBe(true);
    // Le manuscrit et le rapport sont bien transmis au modèle (contexte).
    const lastUser = calls[calls.length - 1]?.messages as Array<{ role: string; content: string }> | undefined;
    const sent = lastUser?.map((x) => x.content).join(" ") ?? "";
    expect(sent).toContain("MANUSCRIT");
  });
});
