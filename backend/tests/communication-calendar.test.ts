import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Calendrier partagé & événements (incrément 1, socle). Règles testées :
// ciblage/visibilité (qui voit un événement), permissions (qui crée), plage de
// dates, gestion réservée à l'auteur, cohérence des dates.

const rnd = Math.floor(Math.random() * 1e6);
const PWD = "CalendarPass123!";

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("communication — calendrier & événements (incrément 1)", () => {
  let app: FastifyInstance;
  let pubCookie: string;
  let aCookie: string;
  let bCookie: string;
  let saisieOnlyCookie: string;
  let deptX: { id: string };
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    app = await buildApp();

    deptX = await prisma.department.upsert({ where: { code: `CAL_X_${rnd}` }, update: {}, create: { code: `CAL_X_${rnd}`, name: `Cal X ${rnd}` } });
    const deptY = await prisma.department.upsert({ where: { code: `CAL_Y_${rnd}` }, update: {}, create: { code: `CAL_Y_${rnd}`, name: `Cal Y ${rnd}` } });

    await createUserWithRole(`cal_pub_${rnd}`, "RESP_RH", PWD);
    const a = await createUserWithRole(`cal_a_${rnd}`, "CORRECTEUR", PWD);
    const b = await createUserWithRole(`cal_b_${rnd}`, "CORRECTEUR", PWD);
    userAId = a.id;
    userBId = b.id;
    const empA = await prisma.employee.create({ data: { firstName: "Cal", lastName: `A${rnd}`, departmentId: deptX.id } });
    const empB = await prisma.employee.create({ data: { firstName: "Cal", lastName: `B${rnd}`, departmentId: deptY.id } });
    await prisma.user.update({ where: { id: a.id }, data: { employeeId: empA.id } });
    await prisma.user.update({ where: { id: b.id }, data: { employeeId: empB.id } });

    const roleCode = `TEST_CAL_SAISIE_${rnd}`;
    const role = await prisma.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, label: "Test cal (saisie)" } });
    for (const action of ["consultation", "saisie"] as const) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { module_action: { module: "communication", action } } });
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, update: {}, create: { roleId: role.id, permissionId: perm.id } });
    }
    await createUserWithRole(`cal_saisie_${rnd}`, roleCode, PWD);

    pubCookie = await login(app, `cal_pub_${rnd}`, PWD);
    aCookie = await login(app, `cal_a_${rnd}`, PWD);
    bCookie = await login(app, `cal_b_${rnd}`, PWD);
    saisieOnlyCookie = await login(app, `cal_saisie_${rnd}`, PWD);
  });

  afterAll(async () => {
    await app.close();
  });

  const from = "2026-08-01T00:00:00.000Z";
  const to = "2026-09-01T00:00:00.000Z";

  function create(cookie: string, body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/v1/calendar/events", headers: { cookie }, payload: body });
  }
  function listRange(cookie: string, f = from, t = to) {
    return app.inject({ method: "GET", url: `/api/v1/calendar/events?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`, headers: { cookie } });
  }

  it("refuse la création à un simple consultant", async () => {
    const res = await create(aCookie, { title: "Interdit", starts_at: "2026-08-10T09:00:00.000Z", targets: [{ type: "tous" }] });
    expect(res.statusCode).toBe(403);
  });

  it("refuse une plage de dates incohérente", async () => {
    const res = await create(pubCookie, {
      title: "Mauvaise plage",
      starts_at: "2026-08-10T10:00:00.000Z",
      ends_at: "2026-08-10T09:00:00.000Z",
      targets: [{ type: "tous" }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("cible un département : seul le concerné voit l'événement", async () => {
    const res = await create(pubCookie, {
      title: `Réunion X ${rnd}`,
      type: "reunion",
      starts_at: "2026-08-12T14:00:00.000Z",
      ends_at: "2026-08-12T15:00:00.000Z",
      location: "Salle 1",
      targets: [{ type: "departement", id: deptX.id }],
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;

    const listA = await listRange(aCookie);
    expect((listA.json() as { id: string }[]).map((e) => e.id)).toContain(id);

    const listB = await listRange(bCookie);
    expect((listB.json() as { id: string }[]).map((e) => e.id)).not.toContain(id);

    // B ne peut pas ouvrir le détail (hors audience).
    const detailB = await app.inject({ method: "GET", url: `/api/v1/calendar/events/${id}`, headers: { cookie: bCookie } });
    expect(detailB.statusCode).toBe(404);
  });

  it("filtre par plage de dates", async () => {
    const res = await create(pubCookie, {
      title: `Hors plage ${rnd}`,
      starts_at: "2026-10-05T09:00:00.000Z", // octobre : hors [août, septembre[
      targets: [{ type: "tous" }],
    });
    const id = res.json().id as string;
    const list = await listRange(aCookie); // août
    expect((list.json() as { id: string }[]).map((e) => e.id)).not.toContain(id);
    // Présent si on interroge octobre.
    const listOct = await listRange(aCookie, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
    expect((listOct.json() as { id: string }[]).map((e) => e.id)).toContain(id);
  });

  it("réserve la modification à l'auteur (ou à l'administration)", async () => {
    const mine = await create(pubCookie, { title: `À l'autre ${rnd}`, starts_at: "2026-08-20T09:00:00.000Z", targets: [{ type: "tous" }] });
    const id = mine.json().id as string;
    const forbidden = await app.inject({ method: "PATCH", url: `/api/v1/calendar/events/${id}`, headers: { cookie: saisieOnlyCookie }, payload: { title: "Détourné" } });
    expect(forbidden.statusCode).toBe(403);
  });

  it("génère les anniversaires automatiques à partir des dates de naissance", async () => {
    const emp = await prisma.employee.create({
      data: { firstName: "Nour", lastName: `Anniv${rnd}`, departmentId: deptX.id, birthDate: new Date(Date.UTC(1990, 7, 15)) }, // 15 août
    });
    const list = await listRange(aCookie); // août 2026
    const rows = list.json() as { id: string; birthday?: boolean; all_day: boolean; starts_at: string; title: string; can_manage: boolean }[];
    const bday = rows.find((e) => e.id === `birthday:${emp.id}:2026`);
    expect(bday).toBeTruthy();
    expect(bday!.birthday).toBe(true);
    expect(bday!.all_day).toBe(true);
    expect(bday!.can_manage).toBe(false);
    expect(new Date(bday!.starts_at).getUTCMonth()).toBe(7);
    expect(new Date(bday!.starts_at).getUTCDate()).toBe(15);
    expect(bday!.title).toContain("Anniversaire");

    // Hors du mois : pas d'anniversaire.
    const sep = await listRange(aCookie, "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    expect((sep.json() as { id: string }[]).some((e) => e.id === `birthday:${emp.id}:2026`)).toBe(false);
  });

  it("ne fait sortir les anniversaires que le jour même (encart du tableau de bord)", async () => {
    const now = new Date();
    const todayEmp = await prisma.employee.create({
      data: { firstName: "Aujourd", lastName: `Hui${rnd}`, departmentId: deptX.id, birthDate: new Date(Date.UTC(1988, now.getUTCMonth(), now.getUTCDate())) },
    });
    // Anniversaire dans 2 jours : ne doit PAS apparaître aujourd'hui.
    await prisma.employee.create({
      data: { firstName: "Autre", lastName: `Jour${rnd}`, departmentId: deptX.id, birthDate: new Date(Date.UTC(1988, now.getUTCMonth(), now.getUTCDate() + 2)) },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/calendar/today-birthdays", headers: { cookie: aCookie } });
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { id: string; name: string }[]).map((x) => x.name);
    expect(names.some((n) => n.includes(`Hui${rnd}`))).toBe(true); // fêté aujourd'hui
    expect(names.some((n) => n.includes(`Jour${rnd}`))).toBe(false); // dans 2 jours

    // Aucune date de naissance n'est exposée par cet endpoint (nom seul).
    const raw = res.json() as Record<string, unknown>[];
    expect(raw.every((r) => !("birthDate" in r) && !("birth_date" in r))).toBe(true);
    expect(todayEmp.id).toBeTruthy();
  });

  it("notifie l'audience à la création d'un événement", async () => {
    const res = await create(pubCookie, {
      title: `Notif ${rnd}`,
      type: "reunion",
      starts_at: "2026-08-18T09:00:00.000Z",
      targets: [{ type: "departement", id: deptX.id }],
    });
    const id = res.json().id as string;
    // userA (deptX) reçoit une notification d'événement ; userB (deptY) non.
    const nA = await prisma.notification.findFirst({ where: { userId: userAId, entityType: "calendar_event", entityId: id } });
    expect(nA).toBeTruthy();
    expect(nA!.title).toContain("Nouvel événement");
    const nB = await prisma.notification.findFirst({ where: { userId: userBId, entityType: "calendar_event", entityId: id } });
    expect(nB).toBeNull();
  });

  it("permet un rappel manuel aux participants", async () => {
    const res = await create(pubCookie, {
      title: `Rappel ${rnd}`,
      starts_at: "2026-08-19T09:00:00.000Z",
      targets: [{ type: "utilisateur", id: userAId }],
    });
    const id = res.json().id as string;
    const before = await prisma.notification.count({ where: { userId: userAId, entityId: id, title: { startsWith: "Rappel :" } } });
    const remind = await app.inject({ method: "POST", url: `/api/v1/calendar/events/${id}/remind`, headers: { cookie: pubCookie } });
    expect(remind.statusCode).toBe(200);
    expect(remind.json().reminded).toBe(1);
    const after = await prisma.notification.count({ where: { userId: userAId, entityId: id, title: { startsWith: "Rappel :" } } });
    expect(after).toBe(before + 1);
  });

  it("liste les événements à venir (fenêtre courte)", async () => {
    const soonISO = new Date(Date.now() + 2 * 86_400_000).toISOString(); // dans 2 jours
    const farISO = new Date(Date.now() + 20 * 86_400_000).toISOString(); // dans 20 jours
    const soon = await create(pubCookie, { title: `Bientôt ${rnd}`, starts_at: soonISO, targets: [{ type: "utilisateur", id: userAId }] });
    const far = await create(pubCookie, { title: `Loin ${rnd}`, starts_at: farISO, targets: [{ type: "utilisateur", id: userAId }] });
    const soonId = soon.json().id as string;
    const farId = far.json().id as string;
    const up = await app.inject({ method: "GET", url: "/api/v1/calendar/upcoming?days=7", headers: { cookie: aCookie } });
    const ids = (up.json() as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(soonId); // dans 7 jours
    expect(ids).not.toContain(farId); // au-delà
  });

  it("agrège annonces et événements dans le fil d'actualités (selon la visibilité)", async () => {
    // Annonce ciblant userA.
    const ann = await app.inject({
      method: "POST",
      url: "/api/v1/announcements",
      headers: { cookie: pubCookie },
      payload: { title: `Fil annonce ${rnd}`, body_html: "<p>news</p>", targets: [{ type: "utilisateur", id: userAId }] },
    });
    const annId = ann.json().id as string;
    await app.inject({ method: "POST", url: `/api/v1/announcements/${annId}/publish`, headers: { cookie: pubCookie } });

    // Événement ciblant userA, proche (dans la fenêtre du fil).
    const ev = await create(pubCookie, { title: `Fil événement ${rnd}`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), targets: [{ type: "utilisateur", id: userAId }] });
    const evId = ev.json().id as string;

    const feedA = (await app.inject({ method: "GET", url: "/api/v1/newsfeed", headers: { cookie: aCookie } })).json() as { kind: string; id: string }[];
    expect(feedA.some((i) => i.kind === "announcement" && i.id === annId)).toBe(true);
    expect(feedA.some((i) => i.kind === "event" && i.id === evId)).toBe(true);

    // userB ne cible ni l'un ni l'autre.
    const feedB = (await app.inject({ method: "GET", url: "/api/v1/newsfeed", headers: { cookie: bCookie } })).json() as { id: string }[];
    expect(feedB.some((i) => i.id === annId)).toBe(false);
    expect(feedB.some((i) => i.id === evId)).toBe(false);
  });

  it("journalise création et suppression logique", async () => {
    const res = await create(pubCookie, { title: `Audit cal ${rnd}`, starts_at: "2026-08-25T09:00:00.000Z", targets: [{ type: "tous" }] });
    const id = res.json().id as string;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/calendar/events/${id}`, headers: { cookie: pubCookie } });
    expect(del.statusCode).toBe(200);

    const actions = (await prisma.auditLog.findMany({ where: { entityType: "calendar_event", entityId: id } })).map((e) => e.action);
    expect(actions).toContain("create");
    expect(actions).toContain("status_change");

    // L'événement supprimé n'apparaît plus.
    const list = await listRange(pubCookie);
    expect((list.json() as { id: string }[]).map((e) => e.id)).not.toContain(id);
  });
});
