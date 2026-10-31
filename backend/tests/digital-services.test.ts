import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { computeServiceView } from "../src/lib/digitalServices.js";

// Module « Veille des abonnements & paiements numériques » (Phase A).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe("Veille des abonnements (digital services)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let correcteurCookie: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    const corr = await createUserWithRole(`corr_abo_${rnd()}`, "CORRECTEUR", "CorrAbo123!");
    correcteurCookie = await login(corr.username, "CorrAbo123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("calcule le statut (échéance et consommation) — unité", () => {
    expect(computeServiceView({ nextDueDate: new Date(Date.now() + 30 * 86_400_000), kind: "subscription_monthly", monthlyBudget: null, currentUsage: null }).status).toBe("a_jour");
    expect(computeServiceView({ nextDueDate: new Date(Date.now() + 5 * 86_400_000), kind: "subscription_monthly", monthlyBudget: null, currentUsage: null }).status).toBe("a_surveiller");
    expect(computeServiceView({ nextDueDate: new Date(Date.now() - 2 * 86_400_000), kind: "subscription_monthly", monthlyBudget: null, currentUsage: null }).status).toBe("en_retard");
    // Forfait à l'usage : 80 % → à surveiller ; 96 % → en retard.
    expect(computeServiceView({ nextDueDate: null, kind: "usage_based", monthlyBudget: 100 as never, currentUsage: 80 as never }).status).toBe("a_surveiller");
    expect(computeServiceView({ nextDueDate: null, kind: "usage_based", monthlyBudget: 100 as never, currentUsage: 96 as never }).status).toBe("en_retard");
  });

  it("réserve le module à l'administrateur (403 pour un correcteur)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/digital-services", headers: { cookie: correcteurCookie } });
    expect(r.statusCode).toBe(403);
  });

  it("liste les services semés avec des compteurs", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/digital-services", headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services.some((s: { key: string }) => s.key === "api_ia")).toBe(true);
    expect(body.summary).toHaveProperty("to_watch");
    expect(body.summary).toHaveProperty("late");
  });

  it("crée un service, calcule son statut, et un paiement confirmé avance l'échéance", async () => {
    const key = `svc_${rnd()}`;
    // Échéance dans 5 jours → « à surveiller ».
    const create = await app.inject({
      method: "POST", url: "/api/v1/digital-services", headers: { cookie: adminCookie },
      payload: { key, name: "Service test", kind: "subscription_monthly", next_due_date: inDays(5), billing_url: "https://exemple.org/billing" },
    });
    expect(create.statusCode).toBe(201);
    const svc = create.json();
    expect(svc.status).toBe("a_surveiller");

    // Paiement CONFIRMÉ avec nouvelle échéance à +30 j → le service repasse « à jour ».
    const pay = await app.inject({
      method: "POST", url: `/api/v1/digital-services/${svc.id}/payments`, headers: { cookie: adminCookie },
      payload: { amount: 12000, paid_at: new Date().toISOString(), reference: "TX-1", new_due_date: inDays(30), status: "confirmed" },
    });
    expect(pay.statusCode).toBe(201);

    const after = await app.inject({ method: "GET", url: "/api/v1/digital-services", headers: { cookie: adminCookie } });
    const updated = (after.json().services as { id: string; status: string }[]).find((s) => s.id === svc.id)!;
    expect(updated.status).toBe("a_jour");

    // L'historique contient le paiement.
    const hist = await app.inject({ method: "GET", url: `/api/v1/digital-services/${svc.id}/payments`, headers: { cookie: adminCookie } });
    expect((hist.json() as unknown[]).length).toBe(1);
    expect((hist.json() as { reference: string }[])[0].reference).toBe("TX-1");
  });

  it("un paiement EN ATTENTE n'avance pas l'échéance", async () => {
    const key = `svc_${rnd()}`;
    const create = await app.inject({
      method: "POST", url: "/api/v1/digital-services", headers: { cookie: adminCookie },
      payload: { key, name: "Service test 2", next_due_date: inDays(-1) },
    });
    const svc = create.json();
    expect(svc.status).toBe("en_retard");
    await app.inject({
      method: "POST", url: `/api/v1/digital-services/${svc.id}/payments`, headers: { cookie: adminCookie },
      payload: { amount: 5000, paid_at: new Date().toISOString(), new_due_date: inDays(30), status: "pending" },
    });
    const after = await app.inject({ method: "GET", url: "/api/v1/digital-services", headers: { cookie: adminCookie } });
    const updated = (after.json().services as { id: string; status: string }[]).find((s) => s.id === svc.id)!;
    expect(updated.status).toBe("en_retard"); // toujours en retard : paiement non confirmé
  });

  it("refuse une clé en doublon (409)", async () => {
    const key = `svc_${rnd()}`;
    await app.inject({ method: "POST", url: "/api/v1/digital-services", headers: { cookie: adminCookie }, payload: { key, name: "Service A" } });
    const dup = await app.inject({ method: "POST", url: "/api/v1/digital-services", headers: { cookie: adminCookie }, payload: { key, name: "Service B" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("duplicate_key");
  });
});
