import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Bandeau « Programme à venir » du Hall (D-029) : configuration paramétrable
// (administration) + agenda enrichi (priorité, imminence, passé retiré).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Agenda123!";
const rnd = Math.floor(Math.random() * 1e6);

async function login(app: FastifyInstance, u: string, p: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("hall — bandeau programme à venir (D-029)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;

  beforeAll(async () => {
    // Config singleton : on repart des défauts pour l'indépendance d'ordre.
    await prisma.setting.deleteMany({ where: { key: "hall_agenda_config" } });
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    await createUserWithRole(`agenda_plain_${rnd}`, "CORRECTEUR", PWD); // pas d'administration communication
    plainCookie = await login(app, `agenda_plain_${rnd}`, PWD);
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: "hall_agenda_config" } });
    await app.close();
    await prisma.$disconnect();
  });

  it("expose la configuration par défaut", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/calendar/banner-config", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const cfg = res.json();
    expect(cfg.enabled).toBe(true);
    expect(cfg.reappearMinutes).toBe(20);
    expect(cfg.capsuleSeconds).toBe(6);
    expect(cfg.horizonDays).toBe(60);
    expect(cfg.urgentMinutes).toBe(15);
  });

  it("refuse la modification de la config sans droit d'administration (403)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/calendar/banner-config",
      headers: { cookie: plainCookie },
      payload: { enabled: true, reappearMinutes: 30, capsuleSeconds: 5, horizonDays: 90, urgentMinutes: 10 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("permet à l'administration de modifier la config (et la relit)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/calendar/banner-config",
      headers: { cookie: adminCookie },
      payload: { enabled: true, reappearMinutes: 25, capsuleSeconds: 8, horizonDays: 45, urgentMinutes: 20 },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/v1/calendar/banner-config", headers: { cookie: adminCookie } });
    expect(get.json().reappearMinutes).toBe(25);
    expect(get.json().horizonDays).toBe(45);
  });

  it("le bandeau liste les événements à venir, retire le passé et repère l'urgent", async () => {
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
    const mk = async (title: string, atMs: number) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/calendar/events",
        headers: { cookie: adminCookie },
        payload: { title, type: "reunion", starts_at: iso(atMs), targets: [{ type: "tous" }] },
      });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    const soonId = await mk(`Réunion imminente ${rnd}`, 10 * 60_000); // dans 10 min → urgent (seuil 20)
    const futureId = await mk(`Réunion future ${rnd}`, 5 * 86_400_000); // dans 5 jours
    const pastId = await mk(`Réunion passée ${rnd}`, -3 * 86_400_000); // il y a 3 jours

    const res = await app.inject({ method: "GET", url: "/api/v1/calendar/agenda-banner", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { config: { urgentMinutes: number }; events: { id: string; priority: string }[] };
    const ids = body.events.map((e) => e.id);

    expect(ids).toContain(soonId);
    expect(ids).toContain(futureId);
    expect(ids).not.toContain(pastId); // le passé disparaît

    const soon = body.events.find((e) => e.id === soonId)!;
    expect(soon.priority).toBe("urgent");
    // Les urgents sont mis en tête.
    expect(body.events[0].id).toBe(soonId);
  });
});
