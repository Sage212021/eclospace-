import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { buildConnectionRecord, monthBoundsUtc, type ConnectionEvent } from "../src/lib/erpConnections.js";

// Relevé des connexions ERP (spec 12/08/2026) — outil indicatif d'arbitrage RH,
// SANS aucun impact sur la paie.

describe("agrégation du relevé (fonction pure)", () => {
  it("regroupe par jour local (Cameroun UTC+1) : 1re connexion, dernière déconnexion, compteurs", () => {
    // 07:30 et 12:10 UTC le 05/03 → 08:30 et 13:10 heure Cameroun.
    const events: ConnectionEvent[] = [
      { occurredAt: new Date("2030-03-05T07:30:00.000Z"), kind: "login" },
      { occurredAt: new Date("2030-03-05T11:00:00.000Z"), kind: "logout" },
      { occurredAt: new Date("2030-03-05T12:10:00.000Z"), kind: "login" },
      { occurredAt: new Date("2030-03-05T16:45:00.000Z"), kind: "logout" },
    ];
    const rec = buildConnectionRecord("2030-03", events);
    expect(rec.days.length).toBe(31); // tous les jours du mois
    const d5 = rec.days.find((d) => d.date === "2030-03-05")!;
    expect(d5.has_connection).toBe(true);
    expect(d5.first_login).toBe("08:30"); // 07:30 UTC + 1 h
    expect(d5.last_logout).toBe("17:45"); // 16:45 UTC + 1 h
    expect(d5.nb_logins).toBe(2);
    expect(d5.nb_logouts).toBe(2);
    // Récap mensuel.
    expect(rec.recap.days_with_connection).toBe(1);
    expect(rec.recap.total_logins).toBe(2);
    expect(rec.recap.total_logouts).toBe(2);
  });

  it("un jour sans connexion est présent mais vide (identification jours avec/sans)", () => {
    const rec = buildConnectionRecord("2030-03", [{ occurredAt: new Date("2030-03-10T09:00:00.000Z"), kind: "login" }]);
    const d1 = rec.days.find((d) => d.date === "2030-03-01")!;
    expect(d1.has_connection).toBe(false);
    expect(d1.first_login).toBeNull();
    expect(d1.nb_logins).toBe(0);
  });

  it("un évènement de fin de journée UTC bascule au bon jour local", () => {
    // 23:30 UTC le 05 → 00:30 heure Cameroun le 06.
    const rec = buildConnectionRecord("2030-03", [{ occurredAt: new Date("2030-03-05T23:30:00.000Z"), kind: "login" }]);
    expect(rec.days.find((d) => d.date === "2030-03-05")!.has_connection).toBe(false);
    expect(rec.days.find((d) => d.date === "2030-03-06")!.has_connection).toBe(true);
  });

  it("les bornes du mois local couvrent le mois entier", () => {
    const { start, end } = monthBoundsUtc("2030-03");
    // 1er mars 00:00 WAT = 28 févr. 23:00 UTC.
    expect(start.toISOString()).toBe("2030-02-28T23:00:00.000Z");
    expect(end.toISOString()).toBe("2030-03-31T23:00:00.000Z");
  });
});

describe("API /hr/erp-connections", () => {
  let app: FastifyInstance;
  let rhCookie: string;
  let plainCookie: string;
  let employeeId: string;
  let userId: string;
  const MONTH = "2031-05";

  beforeAll(async () => {
    app = await buildApp();
    // RESP_RH supervise la présence (presences:validation).
    await createUserWithRole("rh_releve", "RESP_RH", "RhReleve123!");
    const rh = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "rh_releve", password: "RhReleve123!" } });
    rhCookie = extractSessionCookie(rh.cookies.map((c) => `${c.name}=${c.value}`));
    // Profil non habilité présence.
    await createUserWithRole("releve_simple", "CORRECTEUR", "Releve123!");
    const p = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "releve_simple", password: "Releve123!" } });
    plainCookie = extractSessionCookie(p.cookies.map((c) => `${c.name}=${c.value}`));

    // Employé relié à un compte ERP, avec quelques connexions dans le mois.
    const emp = await prisma.employee.create({ data: { firstName: "Relevé", lastName: "Connexion" } });
    employeeId = emp.id;
    const u = await prisma.user.create({ data: { username: `erp_${Date.now()}`, email: `erp_${Date.now()}@eclospace.local`, passwordHash: "x", status: "active", employeeId: emp.id } });
    userId = u.id;
    await prisma.auditLog.createMany({
      data: [
        { userId, action: "login", entityType: "user", entityId: userId, occurredAt: new Date("2031-05-06T06:00:00.000Z") },
        { userId, action: "logout", entityType: "user", entityId: userId, occurredAt: new Date("2031-05-06T15:30:00.000Z") },
        { userId, action: "login", entityType: "user", entityId: userId, occurredAt: new Date("2031-05-07T07:15:00.000Z") },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse la consultation à un profil non habilité (403)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/hr/erp-connections?employee_id=${employeeId}&month=${MONTH}`, headers: { cookie: plainCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("restitue le relevé journalier + récap pour le RH", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/hr/erp-connections?employee_id=${employeeId}&month=${MONTH}`, headers: { cookie: rhCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.employee.has_erp_account).toBe(true);
    const d6 = b.days.find((d: { date: string }) => d.date === "2031-05-06");
    expect(d6.first_login).toBe("07:00"); // 06:00 UTC + 1 h
    expect(d6.last_logout).toBe("16:30");
    expect(d6.nb_logins).toBe(1);
    expect(d6.nb_logouts).toBe(1);
    expect(b.recap.days_with_connection).toBe(2);
    expect(b.recap.total_logins).toBe(2);
    // Rappel : aucun impact paie.
    expect(b.notice).toMatch(/aucun effet sur la paie/i);
  });

  it("employé sans compte ERP : relevé vide, jamais une erreur", async () => {
    const solo = await prisma.employee.create({ data: { firstName: "Sans", lastName: "Compte" } });
    const res = await app.inject({ method: "GET", url: `/api/v1/hr/erp-connections?employee_id=${solo.id}&month=${MONTH}`, headers: { cookie: rhCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee.has_erp_account).toBe(false);
    expect(res.json().recap.days_with_connection).toBe(0);
  });
});
