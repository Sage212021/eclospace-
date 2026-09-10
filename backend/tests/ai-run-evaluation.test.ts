import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// On simule l'API Claude : aucun appel réseau, aucun coût réel. Le faux client
// renvoie un rapport et un usage de tokens fixes.
// Capture le dernier « system » reçu par l'API simulée pour vérifier que la
// structure imposée du rapport est bien transmise à l'IA.
const sdkCalls: { system?: string; user?: string; maxTokens?: number; lastRole?: string }[] = [];
// Pilotage du faux client : quand `truncateNext` est vrai, le PROCHAIN appel
// simule une réponse TRONQUÉE (seulement la 1ʳᵉ rubrique, stop_reason max_tokens)
// pour vérifier que le moteur relance et complète le rapport (A→M).
const sdkCtl = { truncateNext: false, completeButCut: false };
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (args: { system?: string; max_tokens?: number; messages?: { role?: string; content?: unknown }[] }) => {
        const c = args.messages?.[0]?.content;
        const user = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b as { text?: string }).text ?? "").join(" ") : "";
        const lastRole = args.messages?.[args.messages.length - 1]?.role;
        sdkCalls.push({ system: args.system, user, maxTokens: args.max_tokens, lastRole });
        // Reprend TOUTES les rubriques imposées (## X. …) listées dans le prompt
        // système : simule une IA « bien élevée » qui rend un rapport complet.
        const sys = String(args.system ?? "");
        const heads = Array.from(sys.matchAll(/## [0-9A-Za-z]+\.[^\n]*/g)).map((m) => m[0]);
        if (sdkCtl.truncateNext) {
          sdkCtl.truncateNext = false;
          const firstHead = heads[0] ?? "## A. Rubrique";
          return {
            model: "claude-haiku-4-5",
            stop_reason: "max_tokens",
            content: [{ type: "text", text: `# Rapport d'évaluation\n${firstHead}\nContenu (rapport interrompu ici).` }],
            usage: { input_tokens: 12000, output_tokens: 8000 },
          };
        }
        const body = heads.length ? heads.map((h) => `${h}\nContenu de la rubrique.`).join("\n\n") : "Synthèse : manuscrit prometteur.";
        // Rapport COMPLET (toutes rubriques) mais dont la dernière phrase est
        // coupée (stop_reason max_tokens) : le moteur NE doit PAS relancer.
        if (sdkCtl.completeButCut) {
          sdkCtl.completeButCut = false;
          return {
            model: "claude-haiku-4-5",
            stop_reason: "max_tokens",
            content: [{ type: "text", text: `# Rapport d'évaluation\n${body}\nAvis final : le manuscrit mérite un investissement second de sa part pour clarifier son ambition. Une maison comme Éclosion pour` }],
            usage: { input_tokens: 12000, output_tokens: 8000 },
          };
        }
        return {
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: `# Rapport d'évaluation\n${body}\nAvis : Acceptation avec modifications mineures.` }],
          usage: { input_tokens: 12000, output_tokens: 1500 },
        };
      },
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
      payload: { enabled: true, models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger", expertise: "intermediaire", reecriture: "intermediaire" }, allowed_confidentiality: ["public", "interne", "restreint"], api_key: "sk-ant-test-FAKE0000" },
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
    // Fixe un gabarit connu (d'autres tests modifient ce prompt dans la base
    // partagée) : on vérifiera que CES rubrics sont transmises à l'IA.
    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/prompts/evaluation", headers: { cookie: adminCookie },
      payload: {
        label: "Évaluation (test structure)",
        system_prompt: "Système d'évaluation.",
        user_template: "Manuscrit : {{manuscrit}}",
        report_template: {
          title: "RAPPORT D'ÉVALUATION DE MANUSCRIT",
          sections: [{ key: "A", title: "Identification du manuscrit" }, { key: "M", title: "Avis final du relecteur" }],
          guidance: "Ce document est un RAPPORT D'ÉVALUATION et NON un rapport de correction : aucune annotation de type texte original.",
        },
      },
    });
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

    // La STRUCTURE IMPOSÉE (rubriques A–M) est réellement transmise à l'IA.
    const lastSystem = sdkCalls[sdkCalls.length - 1]?.system ?? "";
    expect(lastSystem).toContain("STRUCTURE IMPOSÉE");
    expect(lastSystem).toContain("A. Identification du manuscrit");
    expect(lastSystem).toContain("M. Avis final du relecteur");
    // Les consignes de forme PROPRES au gabarit d'évaluation sont transmises,
    // et l'évaluation n'est PAS poussée vers des annotations de correction.
    expect(lastSystem).toContain("NON un rapport de correction");
    expect(lastSystem).not.toContain("correction proposée");
    // La grille officielle (critères + coefficients) est transmise à l'IA.
    const lastUser = sdkCalls[sdkCalls.length - 1]?.user ?? "";
    expect(lastUser).toContain("GRILLE D'ÉVALUATION OFFICIELLE");
    expect(lastUser).toContain("Adéquation avec la ligne éditoriale d'Éclosion Édition");
    expect(lastUser).toContain("coefficient 3");
  });

  it("le type choisi par le relecteur (grid_genre_id) adapte la grille transmise à l'IA", async () => {
    // Un domaine qui possède sa PROPRE grille (critères ≠ grille par défaut).
    const own = await prisma.evaluationCriterion.findFirst({
      where: { genreId: { not: null }, isActive: true, genre: { deletedAt: null } },
      include: { genre: { select: { id: true, label: true } } },
    });
    expect(own?.genre).toBeTruthy();
    const genreId = own!.genre!.id;
    const genreLabel = own!.genre!.label;

    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "evaluation", step_code: "COMITE_LECTURE", grid_genre_id: genreId },
    });
    expect(res.statusCode).toBe(202);
    await waitJob(res.json().jobId);

    // La grille transmise annonce le TYPE choisi et reprend un critère PROPRE à ce
    // domaine (celui-ci n'existe pas tel quel dans la grille par défaut).
    const lastUser = sdkCalls[sdkCalls.length - 1]?.user ?? "";
    expect(lastUser).toContain(`adaptée au type « ${genreLabel} »`);
    expect(lastUser).toContain(own!.label);
  });

  it("le journal des jobs du manuscrit est consultable et signale un rapport téléchargeable", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs?manuscript=${manuscriptId}`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const jobs = res.json().jobs as { status: string; reportAvailable: boolean }[];
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    const done = jobs.find((j) => j.status === "termine");
    expect(done?.reportAvailable).toBe(true);
  });

  it("télécharge le rapport d'un job terminé, là où l'analyse a été lancée (.docx)", async () => {
    const run = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "evaluation", step_code: "COMITE_LECTURE" },
    });
    const jobId = run.json().jobId as string;
    await waitJob(jobId);

    // Par défaut : rapport SANS en-tête (choix par défaut).
    const dl = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs/${jobId}/report`, headers: { cookie: adminCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("wordprocessingml");
    expect(String(dl.headers["content-disposition"])).toContain("attachment");
    // Un .docx est un ZIP : commence par « PK ».
    expect(dl.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
    // Le texte source du rapport est conservé sur le job (permet la régénération).
    const stored = await prisma.aiReadingJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.reportText).toContain("Rapport d'évaluation");
  });

  it("télécharge le rapport IA AVEC en-tête maison (choix d'impression)", async () => {
    const run = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "evaluation", step_code: "COMITE_LECTURE" },
    });
    const jobId = run.json().jobId as string;
    await waitJob(jobId);
    const dl = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs/${jobId}/report?entete=1`, headers: { cookie: adminCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("wordprocessingml");
    expect(dl.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("un job inexistant renvoie 404 clair sur le téléchargement", async () => {
    const dl = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs/00000000-0000-0000-0000-000000000000/report`, headers: { cookie: adminCookie } });
    expect(dl.statusCode).toBe(404);
  });

  it("le BAT1 produit AUSSI un manuscrit corrigé (BAT1) en plus du rapport", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "correction_1", step_code: "CORRECTION" },
    });
    expect(res.statusCode).toBe(202);
    const job = await waitJob(res.json().jobId);
    // Deux documents produits : le rapport + le manuscrit corrigé.
    expect((job.producedDocumentIds as string[]).length).toBe(2);
    const corrected = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, title: { contains: "Manuscrit corrigé (IA) — BAT1" } } });
    expect(corrected).not.toBeNull();
  });

  it("la relecture de couverture est branchée et classée en pièce d'étape", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "couverture", step_code: "CORRECTION", cover_pass: "BAT1" },
    });
    expect(res.statusCode).toBe(202);
    await waitJob(res.json().jobId);
    const piece = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape" } });
    expect(piece).not.toBeNull();
    // Le passage BAT1 est transmis à l'IA.
    expect(sdkCalls[sdkCalls.length - 1]?.user ?? "").toContain("PASSAGE : BAT1");
  });

  it("la couverture BAT2 reçoit le rapport du BAT précédent (suivi des corrections)", async () => {
    // Un BAT1 a déjà été produit ci-dessus → le BAT2 doit le retrouver et le joindre.
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "couverture", step_code: "VALIDATION_BAT", cover_pass: "BAT2" },
    });
    expect(res.statusCode).toBe(202);
    await waitJob(res.json().jobId);
    const lastUser = sdkCalls[sdkCalls.length - 1]?.user ?? "";
    expect(lastUser).toContain("PASSAGE : BAT2");
    expect(lastUser).toContain("RAPPORT DU BAT PRÉCÉDENT");
  });

  it("n'appelle JAMAIS l'IA avec un max_tokens au-dessus de la limite du modèle (≤ 8192)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "evaluation", step_code: "COMITE_LECTURE" },
    });
    await waitJob(res.json().jobId);
    // Un max_tokens trop élevé (ex. 12000) est refusé par l'API (400) et fait
    // échouer tout le job : on garde la marge de sécurité universelle 8192.
    for (const call of sdkCalls) {
      expect(call.maxTokens ?? 0).toBeLessThanOrEqual(8192);
    }
  });

  it("un rapport coupé en fin de M est COMPLÉTÉ (continuation) SANS bavardage IA", async () => {
    // Gabarit A..M.
    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/prompts/evaluation", headers: { cookie: adminCookie },
      payload: {
        label: "Évaluation (test complétion sans méta)",
        system_prompt: "Système d'évaluation.",
        user_template: "Manuscrit : {{manuscrit}}",
        report_template: {
          title: "RAPPORT D'ÉVALUATION DE MANUSCRIT",
          sections: [
            { key: "A", title: "Identification" }, { key: "B", title: "Synthèse" }, { key: "C", title: "Grille" },
            { key: "D", title: "Score" }, { key: "M", title: "Avis final" },
          ],
        },
      },
    });
    const before = sdkCalls.length;
    sdkCtl.completeButCut = true; // 1ʳᵉ réponse : rapport complet mais coupé (max_tokens)
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "evaluation", step_code: "COMITE_LECTURE" },
    });
    const job = await waitJob(res.json().jobId);
    // Une continuation a bien eu lieu (≥ 2 appels) pour finir la fin coupée…
    expect(sdkCalls.length - before).toBeGreaterThanOrEqual(2);
    // …et cette continuation est un « préfixe assistant » (le dernier message est
    // le rapport partiel côté assistant, PAS une consigne interne) : c'est ce qui
    // garantit une poursuite propre du texte, sans préambule ni méta.
    const contCall = sdkCalls[before + 1];
    expect(contCall?.lastRole).toBe("assistant");
    const stored = await prisma.aiReadingJob.findUniqueOrThrow({ where: { id: job.id } });
    // Aucun bavardage révélant l'IA dans le rapport final.
    const t = stored.reportText ?? "";
    expect(t).not.toMatch(/rubriques? (suivantes|figurent|sont présentes)/i);
    expect(t).not.toMatch(/je confirme|je constate|vérification exhaustive|intelligence artificielle/i);
  });

  it("missingSectionKeys repère les rubriques absentes d'un rapport", async () => {
    const { missingSectionKeys } = await import("../src/lib/aiRunner.js");
    const rpt = "## A. Titre\ntexte\n## C. Autre\ntexte";
    expect(missingSectionKeys(rpt, ["A", "B", "C"])).toEqual(["B"]);
    expect(missingSectionKeys(rpt, ["A", "C"])).toEqual([]);
  });

  it("complète un rapport tronqué : toutes les rubriques imposées finissent présentes (A→M)", async () => {
    const { missingSectionKeys } = await import("../src/lib/aiRunner.js");
    // Gabarit multi-rubriques imposées.
    await app.inject({
      method: "PUT", url: "/api/v1/ai-editorial/prompts/evaluation", headers: { cookie: adminCookie },
      payload: {
        label: "Évaluation (test complétude)",
        system_prompt: "Système d'évaluation.",
        user_template: "Manuscrit : {{manuscrit}}",
        report_template: {
          title: "RAPPORT D'ÉVALUATION DE MANUSCRIT",
          sections: [
            { key: "A", title: "Identification" }, { key: "B", title: "Synthèse" }, { key: "C", title: "Grille" },
            { key: "D", title: "Score global" }, { key: "M", title: "Avis final" },
          ],
        },
      },
    });
    const before = sdkCalls.length;
    sdkCtl.truncateNext = true; // le 1ᵉʳ appel simulera une réponse tronquée (rubrique A seule)
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "evaluation", step_code: "COMITE_LECTURE" },
    });
    const job = await waitJob(res.json().jobId);
    const stored = await prisma.aiReadingJob.findUniqueOrThrow({ where: { id: job.id } });
    // Malgré la troncature initiale, TOUTES les rubriques sont présentes.
    expect(missingSectionKeys(stored.reportText ?? "", ["A", "B", "C", "D", "M"])).toEqual([]);
    // Au moins 2 appels IA pour ce job : la réponse tronquée + une complétion.
    expect(sdkCalls.length - before).toBeGreaterThanOrEqual(2);
  });

  it("extrait le texte d'un PDF (permet les PDF de plus de 100 pages)", async () => {
    const { extractPdfText } = await import("../src/lib/aiRunner.js");
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(new URL("./fixtures/sample-3pages.pdf", import.meta.url));
    const r = await extractPdfText(buf, 500000);
    expect(r).not.toBeNull();
    expect(r!.pages).toBe(3);
    expect(r!.text).toContain("manuscrit de test");
  });

  it("borne un manuscrit très volumineux (extrait représentatif, pas d'échec « prompt too long »)", async () => {
    const { capManuscriptText, MANUSCRIT_CHAR_BUDGET } = await import("../src/lib/aiRunner.js");
    const small = capManuscriptText("abc");
    expect(small.truncated).toBe(false);
    const huge = capManuscriptText("A".repeat(1_500_000));
    expect(huge.truncated).toBe(true);
    expect(huge.text.length).toBeLessThanOrEqual(MANUSCRIT_CHAR_BUDGET + 200);
    expect(huge.text).toContain("passage central du manuscrit");
    expect(huge.text).toContain("fin du manuscrit");
    // Marge de sécurité : le français dense tokenise à ~2 car./token, donc le
    // budget doit rester bien SOUS les 200 000 tokens de contexte (≈ 150 000 max
    // pour le manuscrit, en laissant la place au prompt). Garde anti-régression.
    expect(MANUSCRIT_CHAR_BUDGET / 2).toBeLessThanOrEqual(150_000);
  });

  it("réécriture IA : produit un rapport + une VERSION RÉÉCRITE, sans écraser l'original (modèle Sonnet par défaut)", async () => {
    // Compte des documents « manuscrit » AVANT : l'original ne doit jamais être
    // remplacé — la réécriture crée une NOUVELLE pièce, en plus.
    const originauxAvant = await prisma.document.count({
      where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null },
    });

    const res = await app.inject({
      method: "POST", url: "/api/v1/ai-editorial/run", headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscriptId, work_type: "reecriture", step_code: "REECRITURE", editor_recommendation: "Préserver la voix de l'auteur (niveau important)." },
    });
    expect(res.statusCode).toBe(202);
    const job = await waitJob(res.json().jobId);
    expect(job.status).toBe("termine");
    expect(job.workType).toBe("reecriture");
    // Modèle par défaut des analyses lourdes = « intermédiaire » → Sonnet.
    expect(job.model).toBe("claude-sonnet-5");

    // Une VERSION RÉÉCRITE (IA) a été produite comme pièce d'étape distincte.
    const reecrit = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", title: { startsWith: "Version réécrite (IA)" }, deletedAt: null },
      include: { versions: true },
    });
    expect(reecrit).not.toBeNull();
    expect(reecrit!.versions[0].mimeType).toContain("wordprocessingml");

    // L'ORIGINAL est intact : aucun document « manuscrit » supprimé ni remplacé.
    const originauxApres = await prisma.document.count({
      where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null },
    });
    expect(originauxApres).toBe(originauxAvant);

    // Le prompt de réécriture impose bien la préservation de la voix de l'auteur.
    const lastSystem = sdkCalls[sdkCalls.length - 1]?.system ?? "";
    expect(lastSystem.toUpperCase()).toContain("VOIX DE L'AUTEUR");
  });
});
