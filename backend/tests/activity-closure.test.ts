import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import {
  activityClosureStatus,
  getClosureDay,
  sweepClosureReminders,
  setClosureDay,
} from "../src/lib/activityClosure.js";

// Signalement de clôture d'activité mensuelle. Règles testées : jour de clôture
// paramétrable (défaut 10), rappels toujours 1 et 2 jours avant, idempotence
// (jamais deux fois le même rappel), pas de rappel si la période est déjà
// clôturée, et permissions des endpoints.

const rnd = Math.floor(Math.random() * 1e6);
const PWD = "ClosurePass123!";

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

// Période de test isolée (année lointaine) pour ne pas heurter les données réelles.
const YEAR = 2031;
async function cleanupPeriod(periodKey: string) {
  await prisma.payrollClosureReminder.deleteMany({ where: { periodKey } });
  await prisma.payrollClosure.deleteMany({ where: { periodKey } });
  await prisma.notification.deleteMany({ where: { entityType: "payroll_closure", entityId: periodKey } });
}

describe("RH — signalement de clôture d'activité", () => {
  let app: FastifyInstance;
  let rhUserId: string;
  let rhCookie: string;
  let adminCookie: string;
  let readerCookie: string;

  beforeAll(async () => {
    app = await buildApp();

    // Responsable RH (destinataire + peut administrer la rubrique).
    const rh = await createUserWithRole(`clos_rh_${rnd}`, "RESP_RH", PWD);
    rhUserId = rh.id;
    // Administrateur général (rh:administration) et un simple lecteur (correcteur).
    await createUserWithRole(`clos_admin_${rnd}`, "ADMIN_GENERAL", PWD);
    await createUserWithRole(`clos_reader_${rnd}`, "CORRECTEUR", PWD);

    rhCookie = await login(app, `clos_rh_${rnd}`, PWD);
    adminCookie = await login(app, `clos_admin_${rnd}`, PWD);
    readerCookie = await login(app, `clos_reader_${rnd}`, PWD);
  });

  afterAll(async () => {
    // Restaure le jour de clôture par défaut (suppression du paramètre) et nettoie.
    await prisma.setting.deleteMany({ where: { key: "activity_closure_day" } });
    await app.close();
  });

  it("jour de clôture : 10 par défaut, puis paramétrable", async () => {
    await prisma.setting.deleteMany({ where: { key: "activity_closure_day" } });
    expect(await getClosureDay()).toBe(10);
    await setClosureDay(6, { id: rhUserId });
    expect(await getClosureDay()).toBe(6);
    // Bornes refusées.
    await expect(setClosureDay(30, { id: rhUserId })).rejects.toThrow();
    await expect(setClosureDay(1, { id: rhUserId })).rejects.toThrow();
  });

  it("envoie le rappel 1 et 2 jours avant l'échéance, pas le jour même", async () => {
    await setClosureDay(6, { id: rhUserId }); // rappels attendus le 4 et le 5
    const periodKey = `${YEAR}-06`; // clôturé le 6 juillet -> concerne juin
    await cleanupPeriod(periodKey);

    // Le jour de clôture lui-même (6) : hors fenêtre de rappel.
    expect((await sweepClosureReminders(new Date(YEAR, 6, 6))).reason).toBe("hors_fenetre");

    // Deux jours avant (le 4) : envoi.
    const r1 = await sweepClosureReminders(new Date(YEAR, 6, 4));
    expect(r1.sent).toBe(true);
    expect(r1.periodKey).toBe(periodKey);

    // Le destinataire RH a bien reçu une notification d'échéance.
    const notif = await prisma.notification.findFirst({
      where: { userId: rhUserId, entityType: "payroll_closure", entityId: periodKey },
    });
    expect(notif).not.toBeNull();
    expect(notif?.type).toBe("echeance");

    // Rejoué le même jour : idempotent (aucun second envoi).
    const r2 = await sweepClosureReminders(new Date(YEAR, 6, 4));
    expect(r2.sent).toBe(false);
    expect(r2.reason).toBe("deja_envoye");
    const count = await prisma.notification.count({
      where: { userId: rhUserId, entityType: "payroll_closure", entityId: periodKey },
    });
    expect(count).toBe(1);

    // La veille (le 5) : nouvel envoi (deuxième rappel autorisé).
    const r3 = await sweepClosureReminders(new Date(YEAR, 6, 5));
    expect(r3.sent).toBe(true);
  });

  it("n'envoie aucun rappel si la période est déjà clôturée", async () => {
    await setClosureDay(10, { id: rhUserId }); // rappels le 8 et le 9
    const periodKey = `${YEAR}-08`; // clôturé le 10 septembre
    await cleanupPeriod(periodKey);
    await prisma.payrollClosure.create({
      data: { periodKey, employees: 1, rateEffectiveFrom: new Date(`${YEAR}-08-01`) },
    });
    const r = await sweepClosureReminders(new Date(YEAR, 8, 8)); // 8 septembre
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("deja_cloturee");
    await cleanupPeriod(periodKey);
  });

  it("l'état de la rubrique reflète le jour de clôture et la période concernée", async () => {
    await setClosureDay(10, { id: rhUserId });
    const status = await activityClosureStatus(new Date(YEAR, 6, 3)); // 3 juillet
    expect(status.closure_day).toBe(10);
    expect(status.reminder_days).toEqual([8, 9]);
    expect(status.period_key).toBe(`${YEAR}-06`); // avant le 10 -> concerne juin
    expect(status.days_until_closure).toBe(7);
  });

  it("permissions : lecture réservée au RH, modification à l'administration", async () => {
    // Un correcteur (pas de rh:consultation) ne voit pas la rubrique.
    const denied = await app.inject({ method: "GET", url: "/api/v1/hr/activity-closure", headers: { cookie: readerCookie } });
    expect(denied.statusCode).toBe(403);

    // Le RH consulte.
    const ok = await app.inject({ method: "GET", url: "/api/v1/hr/activity-closure", headers: { cookie: rhCookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("closure_day");

    // Modifier le jour : réservé à l'administration (l'admin passe).
    const set = await app.inject({
      method: "PUT",
      url: "/api/v1/hr/activity-closure/day",
      headers: { cookie: adminCookie },
      payload: { closure_day: 8 },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().closure_day).toBe(8);

    // Valeur hors bornes rejetée.
    const bad = await app.inject({
      method: "PUT",
      url: "/api/v1/hr/activity-closure/day",
      headers: { cookie: adminCookie },
      payload: { closure_day: 40 },
    });
    expect(bad.statusCode).toBe(400);
  });
});
