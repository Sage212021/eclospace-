import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// API Claude simulée : le faux client renvoie un texte fixe (aucun appel réseau).
const calls: { system?: string; messages?: unknown }[] = [];
// Quand non vide, le faux modèle déclenche l'outil « dossier_manuscrit » sur cette
// référence (pour tester le tool-calling), puis répond au tour suivant.
let toolRef = "";
// Quand vrai, simule une recherche web (bloc web_search_tool_result + texte).
let webRef = false;
// Quand vrai, le faux modèle ÉCHOUE si l'outil web est présent → force le repli
// SANS recherche web (test de la dégradation gracieuse).
let failWeb = false;
// Quand non vide, le faux modèle déclenche l'outil « lire_manuscrit » sur cette
// référence (pour tester la lecture du texte d'un manuscrit depuis le dialogue DG).
let readRef = "";
// Quand non vide, le faux modèle déclenche l'outil « restituer_document » sur cette
// référence (pour tester la livraison d'un document UNIQUEMENT sur demande du DG).
let docRef = "";
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { system?: string; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ name?: string }> }) => {
        calls.push({ system: args.system, messages: args.messages });
        const hasWeb = Array.isArray(args.tools) && args.tools.some((t) => t?.name === "web_search");
        if (failWeb && hasWeb) throw new Error("web search non supporté par ce modèle");
        if ((args.system ?? "").includes("AMÉLIORATION")) {
          return { model: "claude-sonnet-5", stop_reason: "end_turn", usage: { input_tokens: 80, output_tokens: 120 },
            content: [{ type: "text", text: '{"recurrent":["frais d\'étude des manuscrits"],"lacunes":["Montant exact non confirmé"],"propositions":[{"category":"procedure","title":"Frais d\'étude des manuscrits","content":"Les frais d\'étude s\'élèvent à 25 000 FCFA.","rationale":"Question posée plusieurs fois par le DG."}]}' }] };
        }
        const msgs = args.messages ?? [];
        const last = msgs[msgs.length - 1];
        const lastIsToolResult = !!last && Array.isArray(last.content) && (last.content as Array<{ type?: string }>).some((c) => c?.type === "tool_result");
        if (hasWeb && webRef && !lastIsToolResult) {
          return { model: "claude-sonnet-5", stop_reason: "end_turn", usage: { input_tokens: 80, output_tokens: 90 },
            content: [
              { type: "server_tool_use", id: "ws_1", name: "web_search", input: { query: "marché du livre" } },
              { type: "web_search_tool_result", tool_use_id: "ws_1", content: [{ type: "web_search_result", url: "https://exemple.org/etude", title: "Étude de référence" }] },
              { type: "text", text: "D'après une source consultée, voici ce qu'il en est." },
            ] };
        }
        if (args.tools && readRef && !lastIsToolResult) {
          return { model: "claude-sonnet-5", stop_reason: "tool_use", usage: { input_tokens: 80, output_tokens: 40 },
            content: [{ type: "tool_use", id: "read_1", name: "lire_manuscrit", input: { reference: readRef } }] };
        }
        if (args.tools && docRef && !lastIsToolResult) {
          return { model: "claude-sonnet-5", stop_reason: "tool_use", usage: { input_tokens: 80, output_tokens: 40 },
            content: [{ type: "tool_use", id: "doc_1", name: "restituer_document", input: { reference: docRef, document: "rapport d'évaluation" } }] };
        }
        if (args.tools && toolRef && !lastIsToolResult) {
          return { model: "claude-sonnet-5", stop_reason: "tool_use", usage: { input_tokens: 80, output_tokens: 40 },
            content: [{ type: "tool_use", id: "tool_1", name: "dossier_manuscrit", input: { reference: toolRef } }] };
        }
        return { model: "claude-sonnet-5", stop_reason: "end_turn", usage: { input_tokens: 80, output_tokens: 120 },
          content: [{ type: "text", text: lastIsToolResult ? "Voici l'état du dossier et les documents déposés." : "Je pense que cette collection mérite d'être étudiée : elle complèterait bien le catalogue." }] };
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
    // SAGE raisonne aussi en directeur éditorial (ligne, programme, acquisition, KPIs…).
    expect(system).toContain("COMPÉTENCES DE DIRECTION ÉDITORIALE");
    expect(system).toContain("LIGNE ÉDITORIALE");
    expect(system).toContain("POLITIQUE D'ACQUISITION");
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

  // ── Moteur d'apprentissage sous contrôle (Lot 4) ──
  it("l'analyse est réservée au DG / admin (403 pour un correcteur)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/sage/learning/analyze", headers: { cookie: correcteurCookie } });
    expect(r.statusCode).toBe(403);
  });

  it("SAGE analyse les échanges, PROPOSE une fiche (pending), que le DG valide", async () => {
    // Un échange préalable pour donner de la matière à l'analyse.
    const conv = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: { content: "Rappelle-moi les frais d'étude des manuscrits." } });
    await waitMessage(conv.json().assistant_message_id);

    const run = await app.inject({ method: "POST", url: "/api/v1/sage/learning/analyze", headers: { cookie: dgCookie } });
    expect(run.statusCode).toBe(202);

    // Attendre la fin de l'analyse.
    let latest: { status: string; proposal_count: number } | null = null;
    for (let i = 0; i < 100; i++) {
      latest = (await app.inject({ method: "GET", url: "/api/v1/sage/learning/latest", headers: { cookie: dgCookie } })).json().run;
      if (latest && latest.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(latest?.status).toBe("done");
    expect(latest!.proposal_count).toBeGreaterThanOrEqual(1);

    // La proposition est en attente (pending), pas encore officielle.
    const kList = await app.inject({ method: "GET", url: "/api/v1/sage/knowledge", headers: { cookie: dgCookie } });
    const proposal = (kList.json().entries as Array<{ id: string; status: string; source: string }>).find((e) => e.status === "pending" && e.source === "sage");
    expect(proposal).toBeTruthy();

    // Validation → elle devient officielle.
    const val = await app.inject({ method: "POST", url: `/api/v1/sage/knowledge/${proposal!.id}/validate`, headers: { cookie: dgCookie } });
    expect(val.statusCode).toBe(200);
    expect(val.json().status).toBe("validated");
    const after = await prisma.aiKnowledge.findUniqueOrThrow({ where: { id: proposal!.id } });
    expect(after.status).toBe("validated");
  });

  it("le dossier LISTE les documents sans les livrer, et distingue une étape traitée d'une étape passée", async () => {
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const statuses = await prisma.workflowStatus.findMany({ orderBy: { stepOrder: "asc" }, take: 2 });
    const number = `DOSS-${rnd()}`;
    const ms = await prisma.manuscript.create({ data: { manuscriptNumber: number, title: `Dossier Test ${rnd()}`, language: "fr", statusId: statuses[0].id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: ms.id, category: "rapport_lecture", title: "Rapport d'évaluation", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: "eval.pdf", fileSize: 10, mimeType: "application/pdf", sha256Hash: `h-${number}`, uploadedBy: adminId } },
      },
    });
    // Une étape validée mais PASSÉE (facultative non effectuée) avec motif.
    await prisma.manuscriptStep.create({ data: { manuscriptId: ms.id, statusId: statuses[0].id, validatedAt: new Date(), realizationMode: "passe", skipReason: "Manuscrit déjà abouti : expertise non nécessaire." } });
    // Une étape validée et RÉALISÉE.
    if (statuses[1]) await prisma.manuscriptStep.create({ data: { manuscriptId: ms.id, statusId: statuses[1].id, validatedAt: new Date(), realizationMode: "realise" } });

    toolRef = number;
    const conv = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${conv.json().id}/messages`, headers: { cookie: dgCookie }, payload: { content: `Où en est le dossier ${number} ?` } });
    await waitMessage(msg.json().assistant_message_id);
    toolRef = "";

    // Le dossier NE livre PAS les documents (pas d'attachement sans demande).
    const dossier = await app.inject({ method: "GET", url: `/api/v1/sage/conversations/${conv.json().id}`, headers: { cookie: dgCookie } });
    const messages = dossier.json().messages as Array<{ role: string; attachments: unknown }>;
    const assistant = [...messages].reverse().find((m) => m.role === "assistant");
    expect(assistant?.attachments ?? null).toBeNull();
    // Le résultat de l'outil transmis au modèle distingue étape passée / réalisée.
    const sawTreatment = calls.some((c) => { const s = JSON.stringify(c.messages ?? ""); return s.includes("passée sans traitement") && s.includes("expertise non nécessaire"); });
    expect(sawTreatment).toBe(true);
  });

  it("ne livre un document QUE sur demande explicite (outil restituer_document)", async () => {
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const number = `REST-${rnd()}`;
    const ms = await prisma.manuscript.create({ data: { manuscriptNumber: number, title: `À restituer ${rnd()}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: ms.id, category: "rapport_lecture", title: "Rapport d'évaluation", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: "eval.pdf", fileSize: 10, mimeType: "application/pdf", sha256Hash: `h-${number}`, uploadedBy: adminId } },
      },
    });

    docRef = number;
    const conv = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${conv.json().id}/messages`, headers: { cookie: dgCookie }, payload: { content: `Donne-moi le rapport d'évaluation de ${number}.` } });
    await waitMessage(msg.json().assistant_message_id);
    docRef = "";

    // Sur demande explicite, le document est proposé en téléchargement.
    const dossier = await app.inject({ method: "GET", url: `/api/v1/sage/conversations/${conv.json().id}`, headers: { cookie: dgCookie } });
    const messages = dossier.json().messages as Array<{ role: string; attachments: Array<{ label: string; download_path: string }> | null }>;
    const assistant = [...messages].reverse().find((m) => m.role === "assistant");
    expect(assistant?.attachments?.length).toBeGreaterThanOrEqual(1);
    expect(assistant!.attachments![0].download_path).toContain("/api/v1/document-versions/");
    expect(assistant!.attachments![0].label).toContain("Rapport");
  });

  // ── Audit interne du catalogue Éclospace (section 15) ──
  it("réserve l'audit du catalogue au DG / admin (403 pour un correcteur)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/sage/catalogue-audit", headers: { cookie: correcteurCookie } });
    expect(r.statusCode).toBe(403);
  });

  it("audite le catalogue réel et signale les manques (sans rien modifier)", async () => {
    // Un ouvrage volontairement incomplet : sans résumé, sans auteur, sans genre.
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const number = `AUD-${rnd()}`;
    await prisma.manuscript.create({ data: { manuscriptNumber: number, title: `Fiche incomplète ${rnd()}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });

    const r = await app.inject({ method: "GET", url: "/api/v1/sage/catalogue-audit", headers: { cookie: dgCookie } });
    expect(r.statusCode).toBe(200);
    const audit = r.json() as { total_manuscripts: number; findings: Array<{ manuscript_ref: string; category: string; field: string }>; counts: Record<string, number> };
    expect(audit.total_manuscripts).toBeGreaterThan(0);
    const mine = audit.findings.filter((f) => f.manuscript_ref === number);
    // La fiche incomplète remonte : auteur manquant (urgent) + résumé + genre.
    expect(mine.some((f) => f.field === "Auteur" && f.category === "urgentes")).toBe(true);
    expect(mine.some((f) => f.field === "Résumé")).toBe(true);
    expect(mine.some((f) => f.field === "Genre / catégorie")).toBe(true);

    // Lecture seule : l'ouvrage n'est pas modifié par l'audit.
    const after = await prisma.manuscript.findUniqueOrThrow({ where: { manuscriptNumber: number } });
    expect(after.summary).toBeNull();
  });

  // ── Lecture du texte des manuscrits depuis le dialogue DG (même SAGE que l'éditeur) ──
  it("peut LIRE le texte d'un manuscrit déposé via l'outil (connexion à SAGE — Éditeur)", async () => {
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const number = `LIRE-${rnd()}`;
    await prisma.manuscript.create({ data: { manuscriptNumber: number, title: `À lire ${rnd()}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });

    readRef = number;
    const conv = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${conv.json().id}/messages`, headers: { cookie: dgCookie }, payload: { content: `Résume-moi le manuscrit ${number}.` } });
    const assistant = await waitMessage(msg.json().assistant_message_id);
    readRef = "";
    expect(assistant.status).toBe("done");
    // L'outil lire_manuscrit a été appelé et son résultat (réf + état de lecture)
    // a bien été renvoyé au modèle au tour suivant.
    const sawRead = calls.some((c) => { const s = JSON.stringify(c.messages ?? ""); return s.includes(number) && s.includes("lire_manuscrit"); });
    expect(sawRead).toBe(true);
  });

  // ── Recherche web (accès Internet réel, section 16) ──
  it("SAGE peut rechercher sur le Web et cite ses sources (traçabilité)", async () => {
    webRef = true;
    const conv = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${conv.json().id}/messages`, headers: { cookie: dgCookie }, payload: { content: "Quelles sont les tendances du marché du livre ?" } });
    const assistant = await waitMessage(msg.json().assistant_message_id);
    webRef = false;
    expect(assistant.status).toBe("done");
    // La réponse cite la source consultée (titre + lien) → traçabilité.
    expect(assistant.content).toContain("Sources consultées sur le Web");
    expect(assistant.content).toContain("https://exemple.org/etude");
  });

  it("dégradation gracieuse : si le modèle ne supporte pas la recherche web, SAGE répond quand même", async () => {
    failWeb = true;
    const conv = await app.inject({ method: "POST", url: "/api/v1/sage/conversations", headers: { cookie: dgCookie }, payload: {} });
    const msg = await app.inject({ method: "POST", url: `/api/v1/sage/conversations/${conv.json().id}/messages`, headers: { cookie: dgCookie }, payload: { content: "Une idée de collection ?" } });
    const assistant = await waitMessage(msg.json().assistant_message_id);
    failWeb = false;
    // Malgré l'échec de l'outil web, SAGE retombe SANS recherche et répond.
    expect(assistant.status).toBe("done");
    expect(assistant.content.length).toBeGreaterThan(0);
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
