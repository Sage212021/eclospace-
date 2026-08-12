import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Module Paie natif (D-007) — incrément 1 : barème versionné + interrupteur.

const RATE_BODY = {
  effective_from: "2027-01-01",
  label: "Barème test 2027",
  cnps: { vid_sal_pct: 0.042, vid_pat_pct: 0.042, pf_pct: 0.07, at_pct: 0.03, ceiling: 750000 },
  fiscal: { abat_pct: 0.3, abat_fixe: 500000, cac_pct: 0.1, cfc_sal_pct: 0.01, cfc_pat_pct: 0.015, fne_pct: 0.01 },
  misc: { coef_assiette: 0.8, heures_mois: 173.33, anc_def_pct: 0.05 },
  irpp: { t1_ceiling: 2000000, t1_pct: 0.1, t2_ceiling: 3000000, t2_pct: 0.15, t3_ceiling: 5000000, t3_pct: 0.25, t4_pct: 0.35 },
  tc_rav: { seuil1: 110000, tc1: 0, rav1: 1950, seuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250 },
};

describe("module Paie — paramètres versionnés & interrupteur", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const resA = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    adminCookie = extractSessionCookie(resA.cookies.map((c) => `${c.name}=${c.value}`));
    await createUserWithRole("paie_simple", "CORRECTEUR", "PaiePass123!");
    const resP = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "paie_simple", password: "PaiePass123!" } });
    plainCookie = extractSessionCookie(resP.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse l'accès aux paramètres de paie à un profil non habilité (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payroll/config", headers: { cookie: plainCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("l'internalisation est désactivée par défaut (D-007) et commutable", async () => {
    const get = await app.inject({ method: "GET", url: "/api/v1/payroll/config", headers: { cookie: adminCookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json().internal_enabled).toBe(false);
    const put = await app.inject({ method: "PUT", url: "/api/v1/payroll/config", headers: { cookie: adminCookie }, payload: { internal_enabled: true } });
    expect(put.json().internal_enabled).toBe(true);
    // On remet à false pour ne pas influencer d'autres exécutions.
    await app.inject({ method: "PUT", url: "/api/v1/payroll/config", headers: { cookie: adminCookie }, payload: { internal_enabled: false } });
  });

  it("expose le barème 2019 repris du classeur", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payroll/rate-set?date=2020-06-01", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.cnps.ceiling).toBe(750000);
    expect(b.cnps.vid_sal_pct).toBe(0.042);
    expect(b.irpp.t1_pct).toBe(0.1);
    expect(b.irpp.t4_pct).toBe(0.35);
    expect(b.fiscal.cac_pct).toBe(0.1);
  });

  it("crée une nouvelle version et la résout en priorité (versionnage)", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/payroll/rate-sets", headers: { cookie: adminCookie }, payload: RATE_BODY });
    expect(create.statusCode).toBe(201);
    const resolved = await app.inject({ method: "GET", url: "/api/v1/payroll/rate-set?date=2027-06-01", headers: { cookie: adminCookie } });
    expect(resolved.json().cnps.at_pct).toBe(0.03); // valeur propre à la version 2027
    expect(resolved.json().effective_from).toBe("2027-01-01");
  });

  it("enregistre et restitue le MOTIF d'une version du barème (Lot 4)", async () => {
    const reason = `Loi de finances test ${Date.now()}`;
    const create = await app.inject({
      method: "POST", url: "/api/v1/payroll/rate-sets", headers: { cookie: adminCookie },
      payload: { ...RATE_BODY, effective_from: "2029-01-01", label: "Barème 2029", change_reason: reason },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().change_reason).toBe(reason);
    // Restitué dans l'historique des versions — on retrouve NOTRE version par son
    // motif unique (la base de test partagée accumule des versions « 2029-01-01 »
    // au fil des runs ; chercher par date renverrait une ancienne).
    const list = (await app.inject({ method: "GET", url: "/api/v1/payroll/rate-sets", headers: { cookie: adminCookie } })).json();
    const row = list.find((r: { change_reason: string | null }) => r.change_reason === reason);
    expect(row).toBeTruthy();
    expect(row.effective_from).toBe("2029-01-01");
    expect(row.created_at).toBeTruthy();
  });

  it("refuse un taux hors bornes (validation)", async () => {
    const bad = { ...RATE_BODY, cnps: { ...RATE_BODY.cnps, vid_sal_pct: 1.5 } };
    const res = await app.inject({ method: "POST", url: "/api/v1/payroll/rate-sets", headers: { cookie: adminCookie }, payload: bad });
    expect(res.statusCode).toBe(400);
  });
});
