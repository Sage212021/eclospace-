import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// DIPE mensuel CNPS : le livre de paie du mois exposé aux colonnes exactes du
// formulaire officiel de télédéclaration. NB. Jrs = 30, éléments except. = 0,
// colonne IRPP = IRPP seul (hors CAC), cotisable plafonné ≤ plafond CNPS.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2032-07"; // période dédiée (base de test partagée)
const CEILING = 750000;

describe("DIPE mensuel CNPS", () => {
  let app: FastifyInstance;
  let cookie: string;
  let cnpsNumber: string;
  let matricule: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));

    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2032-01-01T00:00:00.000Z"), label: "Barème DIPE test",
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: CEILING,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });

    const suffix = Math.random().toString(36).slice(2, 7);
    cnpsNumber = `CNPS-${suffix}`;
    matricule = `MAT-${suffix}`;
    // Brut élevé pour que l'assiette CNPS dépasse le plafond (test du plafonnement).
    const e = await prisma.employee.create({ data: { firstName: "Dipe", lastName: `Test-${suffix}` } });
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${e.id}/profile`, headers: { cookie },
      payload: { gross_contractual: 1500000, base_pct: 0.6, matricule, cnps_number: cnpsNumber, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("expose le mois aux colonnes du formulaire officiel", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/dipe?period=${PERIOD}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe(PERIOD);
    expect(body.annee).toBe(2032);
    expect(body.mois).toBe(7);
    expect(body.regime).toBe("General");

    const row = (body.rows as Record<string, string | number>[]).find((r) => r.matricule_assure === cnpsNumber);
    expect(row).toBeTruthy();
    expect(row!.nb_jours).toBe(30);
    expect(row!.elements_exceptionnels).toBe(0);
    expect(row!.matricule_interne).toBe(matricule);
    expect(String(row!.nom_prenom)).toContain("Dipe");
    // Plafonnement CNPS : le cotisable plafonné ne dépasse jamais le plafond et
    // vaut le minimum entre le total et le plafond.
    expect(row!.cotisable_plafonne as number).toBeLessThanOrEqual(CEILING);
    expect(row!.cotisable_plafonne).toBe(Math.min(row!.cotisable_total as number, CEILING));
    expect(row!.irpp as number).toBeGreaterThan(0);
    // Par défaut, la colonne IRPP porte l'impôt total (IRPP + CAC).
    expect(body.irpp_mode).toBe("irpp_cac");
    expect(body.irpp_label).toBe("IRPP + CAC");
  });

  it("colonne IRPP : total IRPP+CAC par défaut, IRPP seul en option", async () => {
    const reg = (await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${PERIOD}`, headers: { cookie } })).json();
    const rRow = (reg.lines as Record<string, number | string>[]).find((l) => l.cnps_number === cnpsNumber)!;

    // Défaut : IRPP + CAC → égal à l'impôt retenu sur le bulletin.
    const def = (await app.inject({ method: "GET", url: `/api/v1/payroll/dipe?period=${PERIOD}`, headers: { cookie } })).json();
    const defRow = (def.rows as Record<string, number | string>[]).find((r) => r.matricule_assure === cnpsNumber)!;
    expect(defRow.irpp).toBe(rRow.irpp_cac);

    // Option IRPP seul : hors CAC, donc strictement inférieur.
    const seul = (await app.inject({ method: "GET", url: `/api/v1/payroll/dipe?period=${PERIOD}&irpp_mode=irpp`, headers: { cookie } })).json();
    const seulRow = (seul.rows as Record<string, number | string>[]).find((r) => r.matricule_assure === cnpsNumber)!;
    expect(seul.irpp_label).toBe("IRPP");
    expect(seulRow.irpp as number).toBeLessThan(rRow.irpp_cac as number);
    // IRPP seul ≈ (IRPP+CAC) / 1,10 (à l'arrondi près).
    expect(Math.abs((seulRow.irpp as number) - (rRow.irpp_cac as number) / 1.1)).toBeLessThan(3);
  });

  it("reprend le N° DIPE de l'employeur enregistré dans les paramètres", async () => {
    const num = `DIPE${Math.floor(Math.random() * 1e6)}`;
    const current = (await app.inject({ method: "GET", url: "/api/v1/publisher-identity", headers: { cookie } })).json();
    const put = await app.inject({ method: "PUT", url: "/api/v1/publisher-identity", headers: { cookie }, payload: { ...current, dipe: num, dipe_cle: "K", cnps_regime: "General" } });
    expect(put.statusCode).toBe(200);

    const dipe = (await app.inject({ method: "GET", url: `/api/v1/payroll/dipe?period=${PERIOD}`, headers: { cookie } })).json();
    expect(dipe.n_dipe).toBe(num);
    expect(dipe.cle).toBe("K");
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/dipe?period=${PERIOD}` });
    expect(res.statusCode).toBe(401);
  });
});
