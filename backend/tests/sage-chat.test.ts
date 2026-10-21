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
          content: [{ type: "text", text: "Je pense que cette collection mérite d'être étudiée : elle complèterait bien le catalogue." }],
          usage: { input_tokens: 80, output_tokens: 120 },
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

describe("Échanger avec SAGE — espace de dialogue privé du DG (Lot 1)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let dgCookie: string;
  let correcteurCookie: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    const dg = await createUserWithRole(`dg_sage_${rnd()}`, "DIR_GENERAL", "DgSage123!");
    dgCookie = await login(dg.username, "DgSage123!");
    const corr = await createUserWithRole(`corr_sage_${rnd()}`, "CORRECTEUR", "CorrSage123!");
    correcteurCookie = await login(corr.username, "CorrSage123!");

    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/config", headers: { cookie: adminCookie },
      payload: { enabled: true, models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger", expertise: "intermediaire", reecriture: "intermediaire" }, allowed_confidentiality: ["public", "interne", "restreint"], api_key: "sk-ant-test-FAKE0000" },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const waitMessage = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const m = await prisma.aiConversationMessage.findUniqueOrThrow({ where: { id } });
      if (m.status !== "pending") return m;
      await new Promise((r) => setTimeout(r, 50));
    }
    return prisma.aiConversationMessage.findUniqueOrThrow({ where: { id } });
  };

  it("réserve l'accès au DG / administrateur (403 pour un correcteur)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/sage/conversations", headers: { cookie: correcteurCookie } });
    expect(r.statusCode).toBe(403);
    const c = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: correcteurCookie }, payload: { content: "Bonjour" } });
    expect(c.statusCode).toBe(403);
  });

  it("le DG ouvre une conversation libre, envoie un message et SAGE répond (en arrière-plan)", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    expect(created.statusCode).toBe(201);
    const convId = created.json().id as string;

    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${convId}/messages`, headers: { cookie: dgCookie }, payload: { content: "Que penses-tu d'une collection d'essais économiques africains ?" } });
    expect(msg.statusCode).toBe(202);
    const assistant = await waitMessage(msg.json().assistant_message_id);
    expect(assistant.status).toBe("done");
    expect(assistant.role).toBe("assistant");
    expect(assistant.content.length).toBeGreaterThan(0);

    // L'historique (question + réponse) est conservé.
    const dossier = await app.inject({ method: "GET", url: `/api/v1/sage/conversations/${convId}`, headers: { cookie: dgCookie } });
    const roles = (dossier.json().messages as Array<{ role: string }>).map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");

    // La consigne de comportement (espace privé, pas d'invention) est transmise au modèle.
    const system = calls[calls.length - 1]?.system ?? "";
    expect(system).toContain("DIRECTEUR GÉNÉRAL");
    expect(system).toContain("Tu n'inventes JAMAIS");
  });

  it("le premier message peut être envoyé dès la création, et sert de titre par défaut", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: { content: "Réflexion sur une collection jeunesse illustrée" } });
    expect(created.statusCode).toBe(201);
    expect(created.json().title).toContain("collection jeunesse");
    await waitMessage(created.json().assistant_message_id);
    // La conversation apparaît dans la liste du DG.
    const list = await app.inject({ method: "GET", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie } });
    expect((list.json().conversations as Array<{ id: string }>).some((c) => c.id === created.json().id)).toBe(true);
  });

  it("renomme une conversation", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const convId = created.json().id as string;
    const r = await app.inject({ method: "PATCH", url: `/api/v1/sage/conversations/${convId}`, headers: { cookie: dgCookie }, payload: { title: "Projet collection économie" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().title).toBe("Projet collection économie");
  });

  it("les conversations sont privées : un autre DG ne voit pas celles d'un collègue", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const convId = created.json().id as string;

    const other = await createUserWithRole(`dg_sage2_${rnd()}`, "DIR_GENERAL", "DgSage223!");
    const otherCookie = await login(other.username, "DgSage223!");

    const get = await app.inject({ method: "GET", url: `/api/v1/sage/conversations/${convId}`, headers: { cookie: otherCookie } });
    expect(get.statusCode).toBe(404);
    const list = await app.inject({ method: "GET", url: "/api/v1/sage/conversations", headers: { cookie: otherCookie } });
    expect((list.json().conversations as Array<{ id: string }>).some((c) => c.id === convId)).toBe(false);
  });

  it("s'appuie sur le CATALOGUE réel de l'ERP pour les questions sur les ouvrages enregistrés", async () => {
    // Un ouvrage réel dans Eclospace.
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const number = `DG-${rnd()}`;
    await prisma.manuscript.create({ data: { manuscriptNumber: number, title: `Catalogue Test ${rnd()}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });

    const created = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const convId = created.json().id as string;
    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${convId}/messages`, headers: { cookie: dgCookie }, payload: { content: "Quels sont les manuscrits enregistrés ?" } });
    await waitMessage(msg.json().assistant_message_id);

    // Les données RÉELLES du catalogue sont injectées dans le contexte du modèle.
    const system = calls[calls.length - 1]?.system ?? "";
    expect(system).toContain("CATALOGUE ECLOSPACE");
    expect(system).toContain(number);
  });

  // ── Mémoire institutionnelle & éditoriale validée (Lot 3) ──
  it("la mémoire de connaissances est réservée au DG / admin (403 pour un correcteur)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/sage/knowledge", headers: { cookie: correcteurCookie } });
    expect(r.statusCode).toBe(403);
    const c = await app.inject({ method: "POST", url: "/api/v1/sage/knowledge", headers: { cookie: correcteurCookie }, payload: { category: "institution", title: "X", content: "Y" } });
    expect(c.statusCode).toBe(403);
  });

  it("le DG ajoute une connaissance validée ; SAGE s'en sert et elle est partagée/persistante", async () => {
    const marker = `Frais d'étude ${rnd()}`;
    const created = await app.inject({ method: "POST", url: "/api/v1/sage/knowledge", headers: { cookie: dgCookie }, payload: { category: "procedure", title: marker, content: `Les frais d'étude d'un manuscrit sont de 25 000 FCFA (${marker}).` } });
    expect(created.statusCode).toBe(201);
    const kid = created.json().id as string;

    // Partagée : un AUTRE compte habilité (admin) la voit aussi.
    const list = await app.inject({ method: "GET", url: "/api/v1/sage/knowledge", headers: { cookie: adminCookie } });
    expect((list.json().entries as Array<{ id: string }>).some((e) => e.id === kid)).toBe(true);

    // SAGE reçoit la mémoire validée dans son contexte.
    const conv = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${conv.json().id}/messages`, headers: { cookie: dgCookie }, payload: { content: "Quels sont les frais d'étude d'un manuscrit ?" } });
    await waitMessage(msg.json().assistant_message_id);
    const system = calls[calls.length - 1]?.system ?? "";
    expect(system).toContain("CONNAISSANCES VALIDÉES");
    expect(system).toContain(marker);

    // Supprimée → retirée de la liste et du contexte.
    await app.inject({ method: "DELETE", url: `/api/v1/sage/knowledge/${kid}`, headers: { cookie: dgCookie } });
    const list2 = await app.inject({ method: "GET", url: "/api/v1/sage/knowledge", headers: { cookie: dgCookie } });
    expect((list2.json().entries as Array<{ id: string }>).some((e) => e.id === kid)).toBe(false);
  });

  it("archive une conversation : elle quitte la liste", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const convId = created.json().id as string;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/sage/conversations/${convId}`, headers: { cookie: dgCookie } });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie } });
    expect((list.json().conversations as Array<{ id: string }>).some((c) => c.id === convId)).toBe(false);
  });
});
