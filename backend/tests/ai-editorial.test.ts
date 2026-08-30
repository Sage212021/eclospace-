import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// IA éditoriale — Lot IA-0 (fondations) : configuration (compte/clé/modèles,
// clé masquée) et bibliothèque de prompts. Aucun manuscrit n'est analysé ici.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("IA éditoriale — configuration & prompts (Lot IA-0)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let outsiderCookie: string;
  const s = Math.random().toString(36).slice(2, 6);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    await createUserWithRole(`com_${s}`, "COMMERCIAL", "Com1pass!");
    outsiderCookie = await login(`com_${s}`, "Com1pass!");
    // La config IA est un singleton partagé : on repart d'un état vierge pour que
    // les assertions « par défaut » soient indépendantes de l'ordre des fichiers.
    await prisma.setting.deleteMany({ where: { key: "ai_editorial_config" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("la config par défaut n'expose aucune clé et l'IA est désactivée", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ai-editorial/config", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.apiKeyConfigured).toBe(false);
    expect(body).not.toHaveProperty("apiKeyCiphertext");
  });

  it("un rôle non admin n'accède pas à la configuration (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ai-editorial/config", headers: { cookie: outsiderCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("enregistre une clé API : masquée (4 derniers), jamais renvoyée en clair", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/ai-editorial/config",
      headers: { cookie: adminCookie },
      payload: {
        enabled: true,
        account_label: "Compte Éclosion API",
        models: { evaluation: "leger", correction_1: "leger", correction_2: "intermediaire", couverture: "leger" },
        allowed_confidentiality: ["public", "interne", "restreint"],
        api_key: "sk-ant-secret-ABCD9876",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.apiKeyConfigured).toBe(true);
    expect(body.apiKeyLast4).toBe("9876");
    expect(body.models.correction_2).toBe("intermediaire");
    // La clé en clair ne doit jamais transiter par l'API.
    expect(JSON.stringify(body)).not.toContain("sk-ant-secret-ABCD9876");
  });

  it("la clé est chiffrée au repos (jamais en clair dans settings)", async () => {
    const row = await prisma.setting.findUnique({ where: { key: "ai_editorial_config" } });
    expect(row).not.toBeNull();
    expect(JSON.stringify(row!.value)).not.toContain("sk-ant-secret-ABCD9876");
  });

  it("le test de connexion sans clé renvoie une erreur claire", async () => {
    // On efface la clé (chaîne vide), puis on teste.
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai-editorial/config",
      headers: { cookie: adminCookie },
      payload: {
        enabled: false,
        models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger" },
        allowed_confidentiality: ["interne"],
        api_key: "",
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/v1/ai-editorial/test-connection", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("no_api_key");
  });

  it("la bibliothèque contient les 4 prompts par défaut, éditables et versionnés", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ai-editorial/prompts", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const prompts = res.json().prompts as Array<{ workType: string; version: number }>;
    const types = prompts.map((p) => p.workType).sort();
    expect(types).toEqual(["correction_1", "correction_2", "couverture", "evaluation"]);

    const before = prompts.find((p) => p.workType === "evaluation")!;
    const upd = await app.inject({
      method: "PUT",
      url: "/api/v1/ai-editorial/prompts/evaluation",
      headers: { cookie: adminCookie },
      payload: {
        label: "Rapport d'évaluation (modifié)",
        system_prompt: "Tu es le relecteur d'Éclosion Édition.",
        user_template: "Manuscrit : {{manuscrit}}",
        report_template: { title: "RAPPORT", sections: [{ key: "A", title: "Identification" }] },
      },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().version).toBe(before.version + 1);
  });

  it("un rôle non admin ne peut pas éditer les prompts (403)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/ai-editorial/prompts/evaluation",
      headers: { cookie: outsiderCookie },
      payload: { label: "x", system_prompt: "x", user_template: "x", report_template: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});
