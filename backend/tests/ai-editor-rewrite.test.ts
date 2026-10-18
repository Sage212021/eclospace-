import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// API Claude simulée : renvoie un texte réécrit + une explication séparés par le
// délimiteur attendu, et enregistre le contenu reçu (pour vérifier le contexte).
const calls: { messages?: Array<{ role: string; content: string }> }[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { messages?: Array<{ role: string; content: string }> }) => {
        calls.push({ messages: args.messages });
        return {
          model: "claude-sonnet-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "LE TEXTE RÉÉCRIT PAR SAGE.\n---EXPLICATION---\nJ'ai allégé deux phrases et clarifié le dialogue." }],
          usage: { input_tokens: 40, output_tokens: 60 },
        };
      },
    };
    constructor(_o: unknown) {}
  }
  return { default: FakeAnthropic };
});

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { createUserWithRole, extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("SAGE — atelier de réécriture (Lot C)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let correcteurCookie: string;
  let adminId: string;
  let manuscriptId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const corr = await createUserWithRole(`corr_rw_${rnd()}`, "CORRECTEUR", "CorrRw123!");
    correcteurCookie = await login(corr.username, "CorrRw123!");
    const status = await prisma.workflowStatus.findFirstOrThrow();
    manuscriptId = (await prisma.manuscript.create({ data: { manuscriptNumber: `RW-${rnd()}`, title: `Réécriture SAGE ${rnd()}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } })).id;
    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/config", headers: { cookie: adminCookie },
      payload: { enabled: true, models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger", expertise: "intermediaire", reecriture: "intermediaire" }, allowed_confidentiality: ["public", "interne", "restreint"], api_key: "sk-ant-test-FAKE0000" },
    });
  });

  afterAll(async () => {
    await prisma.aiEditorialRewrite.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const waitRewrite = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const r = await prisma.aiEditorialRewrite.findUniqueOrThrow({ where: { id } });
      if (r.status !== "pending") return r;
      await new Promise((res) => setTimeout(res, 50));
    }
    return prisma.aiEditorialRewrite.findUniqueOrThrow({ where: { id } });
  };

  it("réserve l'atelier au DG / admin (403 pour un correcteur)", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/rewrite`, headers: { cookie: correcteurCookie }, payload: { mode: "fidele", source_text: "Un passage." } });
    expect(r.statusCode).toBe(403);
  });

  it("refuse un mode inconnu", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/rewrite`, headers: { cookie: adminCookie }, payload: { mode: "magique", source_text: "Un passage." } });
    expect(r.statusCode).toBe(400);
  });

  it("propose une réécriture (mode fidèle) : texte proposé + explication, original conservé", async () => {
    const source = "Il marchait, il marchait, et il marchait encore vers la maison de son enfance.";
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/rewrite`, headers: { cookie: adminCookie }, payload: { mode: "fidele", source_text: source, instruction: "Réduire les répétitions." } });
    expect(r.statusCode).toBe(202);
    const rw = await waitRewrite(r.json().rewrite_id);
    expect(rw.status).toBe("done");
    expect(rw.sourceText).toBe(source); // l'original est conservé tel quel
    expect(rw.proposedText).toContain("TEXTE RÉÉCRIT PAR SAGE");
    expect(rw.explanation).toContain("clarifié");
    // Le passage ET la consigne de mode sont bien transmis au modèle.
    const sent = (calls[calls.length - 1].messages ?? []).map((m) => m.content).join("\n");
    expect(sent).toContain(source);
    expect(sent.toUpperCase()).toContain("FIDÈLE");
  });

  it("enregistre la décision (acceptée) sans toucher au manuscrit de référence", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/rewrite`, headers: { cookie: adminCookie }, payload: { mode: "renforce", source_text: "Le soir tombait." } });
    const rw = await waitRewrite(r.json().rewrite_id);
    expect(rw.status).toBe("done");
    const dec = await app.inject({ method: "POST", url: `/api/v1/ai-editor/rewrites/${rw.id}/decision`, headers: { cookie: adminCookie }, payload: { decision: "accepted" } });
    expect(dec.statusCode).toBe(200);
    const after = await prisma.aiEditorialRewrite.findUniqueOrThrow({ where: { id: rw.id } });
    expect(after.status).toBe("accepted");
    expect(after.decidedBy).toBe(adminId);
    expect(after.decidedAt).not.toBeNull();
  });

  it("refuse une décision sur une proposition encore en cours (pending)", async () => {
    const pendingRow = await prisma.aiEditorialRewrite.create({ data: { manuscriptId, mode: "fidele", sourceText: "x", status: "pending", createdBy: adminId } });
    const dec = await app.inject({ method: "POST", url: `/api/v1/ai-editor/rewrites/${pendingRow.id}/decision`, headers: { cookie: adminCookie }, payload: { decision: "accepted" } });
    expect(dec.statusCode).toBe(409);
    expect(dec.json().code).toBe("not_decidable");
  });
});
