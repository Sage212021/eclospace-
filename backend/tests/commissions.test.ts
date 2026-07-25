import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { commissions, getCommissionRate } from "../src/lib/commissions.js";

// Commissions commerciales : 10 % par défaut du montant vendu, par commercial,
// avec réglage du taux réservé à la DAF (finance:administration). Fenêtre de
// dates lointaine et isolée pour ne pas heurter les autres données.

function rndIsbn(): string {
  let s = "97";
  for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10);
  return s;
}
const PWD = "Commission123!";
const FROM = new Date("2040-02-01");
const TO = new Date("2040-02-28");

describe("commissions commerciales", () => {
  let app: FastifyInstance;
  let isbnId: string;
  let agentA: string;
  let agentB: string;

  beforeAll(async () => {
    app = await buildApp();
    await prisma.setting.deleteMany({ where: { key: "commission_rate" } }); // taux par défaut 10 %

    const isbn = await prisma.isbn.create({ data: { isbn13: rndIsbn(), format: "print" } });
    isbnId = isbn.id;
    const a = await createUserWithRole("comm_agentA", "RESP_COMMERCIAL", PWD);
    const b = await createUserWithRole("comm_agentB", "MAGASINIER", PWD);
    agentA = a.id;
    agentB = b.id;
    await createUserWithRole("comm_daf", "RESP_FINANCE", PWD);

    // Agent A : 5 × 2 000 = 10 000. Agent B : 3 × 1 000 = 3 000.
    const d = new Date("2040-02-10T10:00:00.000Z");
    await prisma.posSale.createMany({
      data: [
        { isbnId, quantity: 5, unitPrice: "2000.00", paymentMethod: "cash", soldBy: agentA, soldAt: d },
        { isbnId, quantity: 3, unitPrice: "1000.00", paymentMethod: "cash", soldBy: agentB, soldAt: d },
      ],
    });
  });

  afterAll(async () => {
    await prisma.posSale.deleteMany({ where: { isbnId } });
    await prisma.isbn.delete({ where: { id: isbnId } });
    await prisma.setting.deleteMany({ where: { key: "commission_rate" } });
    await app.close();
  });

  it("calcule 10 % du montant vendu, par commercial", async () => {
    const res = await commissions({ from: FROM, to: TO, granularity: "month" });
    expect(res.rate).toBe(0.1);
    const a = res.by_agent.find((r) => r.agent_id === agentA);
    const b = res.by_agent.find((r) => r.agent_id === agentB);
    expect(a).toMatchObject({ units: 5, amount: 10000, commission: 1000 });
    expect(b).toMatchObject({ units: 3, amount: 3000, commission: 300 });
    expect(res.totals).toMatchObject({ units: 8, amount: 13000, commission: 1300 });
  });

  it("réglage du taux : lecture par défaut, écriture réservée à la DAF", async () => {
    const login = async (u: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
      return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    };
    const daf = await login("comm_daf");
    const commercial = await login("comm_agentA");

    // Lecture (commercial) : 200, valeur par défaut 0.10.
    const read = await app.inject({ method: "GET", url: "/api/v1/commercial/commission-rate", headers: { cookie: commercial } });
    expect(read.statusCode).toBe(200);
    expect(read.json().rate).toBe(0.1);

    // Écriture par un commercial (pas finance:administration) : refusée.
    const denied = await app.inject({ method: "PUT", url: "/api/v1/commercial/commission-rate", headers: { cookie: commercial }, payload: { rate: 0.12 } });
    expect(denied.statusCode).toBe(403);

    // Écriture par la DAF : acceptée.
    const set = await app.inject({ method: "PUT", url: "/api/v1/commercial/commission-rate", headers: { cookie: daf }, payload: { rate: 0.12 } });
    expect(set.statusCode).toBe(200);
    expect(await getCommissionRate()).toBe(0.12);

    // Valeur hors bornes rejetée.
    const bad = await app.inject({ method: "PUT", url: "/api/v1/commercial/commission-rate", headers: { cookie: daf }, payload: { rate: 1.5 } });
    expect(bad.statusCode).toBe(400);

    await prisma.setting.deleteMany({ where: { key: "commission_rate" } });
  });

  it("permissions : commercial 200, magasinier 403 sur la vue commissions", async () => {
    const login = async (u: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
      return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    };
    const ok = await app.inject({ method: "GET", url: "/api/v1/commercial/commissions?granularity=month", headers: { cookie: await login("comm_agentA") } });
    expect(ok.statusCode).toBe(200);
    const denied = await app.inject({ method: "GET", url: "/api/v1/commercial/commissions", headers: { cookie: await login("comm_agentB") } });
    expect(denied.statusCode).toBe(403);
  });
});
