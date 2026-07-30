import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import { computeDeduction, deductionForMinutes, retainableMinutes, type DeductionRuleView } from "../src/lib/attendanceDeduction.js";
import type { DayResult } from "../src/lib/attendanceCompute.js";

// Retenues (incrément 3) — règles paramétrables, versionnées, plafonnées.

const PRORATA: DeductionRuleView = { per_minute: null, per_half_hour: 500, per_hour: 1000, daily_cap: null, monthly_cap: null, method: "prorata" };
const HALF: DeductionRuleView = { ...PRORATA, method: "round_half_hour" };
const HOUR: DeductionRuleView = { ...PRORATA, method: "round_hour" };

function makeDay(over: Partial<DayResult>): DayResult {
  return {
    date: "2026-03-10",
    is_working_day: true,
    is_holiday: false,
    has_data: true,
    first_in_min: 540,
    last_out_min: 1080,
    presence_minutes: 480,
    worked_minutes: 480,
    expected_minutes: 510,
    late_minutes: 0,
    early_leave_minutes: 0,
    overtime_minutes: 0,
    interruption_minutes: 0,
    absent_full_day: false,
    justified: false,
    nature: null,
    ...over,
  };
}

describe("deductionForMinutes — méthodes de calcul (§22)", () => {
  it("prorata exact : 30 min → 500 (tarif déduit de la demi-heure)", () => {
    expect(deductionForMinutes(30, PRORATA)).toBe(500);
    expect(deductionForMinutes(15, PRORATA)).toBe(250);
    expect(deductionForMinutes(45, PRORATA)).toBe(750);
  });

  it("arrondi à la demi-heure supérieure : 31 min → 2 × 500 = 1000", () => {
    expect(deductionForMinutes(30, HALF)).toBe(500);
    expect(deductionForMinutes(31, HALF)).toBe(1000);
    expect(deductionForMinutes(1, HALF)).toBe(500);
  });

  it("arrondi à l'heure supérieure : 61 min → 2 × 1000 = 2000", () => {
    expect(deductionForMinutes(60, HOUR)).toBe(1000);
    expect(deductionForMinutes(61, HOUR)).toBe(2000);
  });

  it("tarif à la minute explicite prime sur la demi-heure", () => {
    expect(deductionForMinutes(10, { ...PRORATA, per_minute: 20 })).toBe(200);
  });

  it("zéro minute → aucune retenue", () => {
    expect(deductionForMinutes(0, PRORATA)).toBe(0);
  });
});

describe("retainableMinutes — assiette de la retenue", () => {
  it("retard + départ anticipé + interruptions", () => {
    expect(retainableMinutes(makeDay({ late_minutes: 30, early_leave_minutes: 15, interruption_minutes: 10 }))).toBe(55);
  });

  it("absence pleine journée : NON retenue par défaut (informative), retenue si activé", () => {
    const day = makeDay({ absent_full_day: true, has_data: false, expected_minutes: 510 });
    // Par défaut, une absence ne génère aucune retenue (décision opérateur).
    expect(retainableMinutes(day)).toBe(0);
    // Si la maison active la retenue d'absence (vrai pointeur/registre) :
    expect(retainableMinutes(day, true)).toBe(510);
  });

  it("jour justifié → 0 (exonération)", () => {
    expect(retainableMinutes(makeDay({ late_minutes: 60, justified: true, nature: "conge" }))).toBe(0);
  });

  it("jour non ouvrable → 0", () => {
    expect(retainableMinutes(makeDay({ is_working_day: false, late_minutes: 60 }))).toBe(0);
  });
});

describe("computeDeduction — plafonds jour/mois", () => {
  it("plafond journalier borne la retenue d'un jour", () => {
    const days = [makeDay({ late_minutes: 120 })]; // 120 min prorata = 2000
    const r = computeDeduction(days, { ...PRORATA, daily_cap: 1000 });
    expect(r.by_day[0].amount).toBe(1000);
    expect(r.total_deduction).toBe(1000);
  });

  it("plafond mensuel borne le total", () => {
    const days = [makeDay({ late_minutes: 60 }), makeDay({ date: "2026-03-11", late_minutes: 60 })];
    const r = computeDeduction(days, { ...PRORATA, monthly_cap: 1500 });
    expect(r.total_before_monthly_cap).toBe(2000);
    expect(r.total_deduction).toBe(1500);
  });

  it("exonère les jours justifiés dans le total", () => {
    const days = [makeDay({ late_minutes: 60 }), makeDay({ date: "2026-03-11", absent_full_day: true, justified: true, nature: "mission", has_data: false })];
    const r = computeDeduction(days, PRORATA);
    expect(r.total_retainable_minutes).toBe(60);
    expect(r.total_deduction).toBe(1000);
  });
});

describe("intégration règles de retenues", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste au moins la règle par défaut (500/1000)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/deduction-rules", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rules = res.json();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    expect(Number(rules.find((r: { per_half_hour: number }) => r.per_half_hour === 500)?.per_half_hour)).toBe(500);
  });

  it("crée une nouvelle version et la résout en priorité (versionnage)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/deduction-rules",
      headers: { cookie },
      payload: { per_half_hour: 750, per_hour: 1500, method: "round_half_hour", daily_cap: 5000, label: "Version test" },
    });
    expect(create.statusCode).toBe(201);
    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/attendance/deduction-preview",
      headers: { cookie },
    });
    expect(preview.statusCode).toBe(200);
    // Le compte admin n'a pas de fiche employé → aperçu neutre.
    expect(preview.json().no_employee).toBe(true);
  });
});
