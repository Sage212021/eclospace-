import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// API Claude simulée : renvoie un texte réécrit + une explication séparés par le
// délimiteur attendu, et enregistre le contenu reçu (pour vérifier le contexte).
const calls: { messages?: Array<{ role: string; content: string }> }[] = [];
// Quand vrai, le faux modèle simule une RÉÉCRITURE LONGUE coupée par la limite
// de jetons : 1ʳᵉ partie « max_tokens », puis chaque continuation (dernier
// message = assistant) ajoute la suite, jusqu'à une dernière partie « end_turn »
// portant le délimiteur + l'explication.
let longRewrite = false;
let longRewriteStep = 0;
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { messages?: Array<{ role: string; content: string }> }) => {
        calls.push({ messages: args.messages });
        if (longRewrite) {
          const msgs = args.messages ?? [];
          const last = msgs[msgs.length - 1];
          const isContinuation = !!last && last.role === "assistant";
          if (!isContinuation) {
            longRewriteStep = 0;
            return { model: "claude-sonnet-5", stop_reason: "max_tokens", usage: { input_tokens: 40, output_tokens: 200 }, content: [{ type: "text", text: "Début du chapitre réécrit. " }] };
          }
          longRewriteStep += 1;
          if (longRewriteStep === 1) {
            return { model: "claude-sonnet-5", stop_reason: "max_tokens", usage: { input_tokens: 40, output_tokens: 200 }, content: [{ type: "text", text: "Suite du chapitre réécrit. " }] };
          }
          return { model: "claude-sonnet-5", stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 80 }, content: [{ type: "text", text: "Fin du chapitre réécrit.\n---EXPLICATION---\nRédaction allégée sur l'ensemble." }] };
        }
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

  it("réécriture INTÉGRALE : poursuit après coupure de jetons (pas d'extrait tronqué)", async () => {
    longRewrite = true;
    longRewriteStep = 0;
    try {
      const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/rewrite`, headers: { cookie: adminCookie }, payload: { mode: "fidele", source_text: "Un long chapitre à réécrire intégralement." } });
      const rw = await waitRewrite(r.json().rewrite_id);
      expect(rw.status).toBe("done");
      // Les trois parties produites avant/après coupure sont présentes.
      expect(rw.proposedText).toContain("Début du chapitre réécrit.");
      expect(rw.proposedText).toContain("Suite du chapitre réécrit.");
      expect(rw.proposedText).toContain("Fin du chapitre réécrit.");
      // Le délimiteur n'est pas inclus dans le texte réécrit et l'explication est extraite.
      expect(rw.proposedText).not.toContain("EXPLICATION");
      expect(rw.explanation).toContain("Rédaction allégée");
    } finally {
      longRewrite = false;
    }
  });

  it("exporte un livrable de réécriture en Word (.docx)", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editor/${manuscriptId}/rewrite`, headers: { cookie: adminCookie }, payload: { mode: "fidele", source_text: "Le soir tombait doucement." } });
    const rw = await waitRewrite(r.json().rewrite_id);
    expect(rw.status).toBe("done");

    const dl = await app.inject({ method: "GET", url: `/api/v1/ai-editor/rewrites/${rw.id}/export.docx`, headers: { cookie: adminCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("wordprocessingml.document");
    expect(String(dl.headers["content-disposition"])).toContain(".docx");
    expect(dl.rawPayload.slice(0, 2).toString("latin1")).toBe("PK");
    expect(dl.rawPayload.length).toBeGreaterThan(1000);

    // Réservé au DG / admin (403 pour un correcteur).
    const forbidden = await app.inject({ method: "GET", url: `/api/v1/ai-editor/rewrites/${rw.id}/export.docx`, headers: { cookie: correcteurCookie } });
    expect(forbidden.statusCode).toBe(403);

    // Une réécriture encore en cours ne s'exporte pas (404).
    const pendingRow = await prisma.aiEditorialRewrite.create({ data: { manuscriptId, mode: "fidele", sourceText: "x", status: "pending", createdBy: adminId } });
    const notReady = await app.inject({ method: "GET", url: `/api/v1/ai-editor/rewrites/${pendingRow.id}/export.docx`, headers: { cookie: adminCookie } });
    expect(notReady.statusCode).toBe(404);
  });

  it("refuse une décision sur une proposition encore en cours (pending)", async () => {
    const pendingRow = await prisma.aiEditorialRewrite.create({ data: { manuscriptId, mode: "fidele", sourceText: "x", status: "pending", createdBy: adminId } });
    const dec = await app.inject({ method: "POST", url: `/api/v1/ai-editor/rewrites/${pendingRow.id}/decision`, headers: { cookie: adminCookie }, payload: { decision: "accepted" } });
    expect(dec.statusCode).toBe(409);
    expect(dec.json().code).toBe("not_decidable");
  });
});
