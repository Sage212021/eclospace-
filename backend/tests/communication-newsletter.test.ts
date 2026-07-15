import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Bulletin d'actualités (« newsletter »). Règles testées : permissions (qui
// compose/envoie), compilation « maison » (seules les actualités destinées à
// « tous » entrent — les contenus ciblés sur un pôle restent privés), plage de
// dates, cycle de vie (brouillon → envoyé, non modifiable/renvoyable ensuite),
// visibilité (les consultants ne voient que les bulletins envoyés).

const rnd = Math.floor(Math.random() * 1e6);
const PWD = "NewsletterPass123!";

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("communication — bulletin d'actualités (newsletter)", () => {
  let app: FastifyInstance;
  let editorCookie: string;
  let readerCookie: string;
  let editorId: string;
  let deptId: string;

  // Fenêtre de la période testée.
  const periodStart = "2026-06-01T00:00:00.000Z";
  const periodEnd = "2026-06-30T23:59:59.000Z";
  const inPeriod = "2026-06-15T10:00:00.000Z";
  const outPeriod = "2026-05-01T10:00:00.000Z";

  let allAnnId: string;
  let deptAnnId: string;

  beforeAll(async () => {
    app = await buildApp();

    const dept = await prisma.department.upsert({
      where: { code: `NL_D_${rnd}` },
      update: {},
      create: { code: `NL_D_${rnd}`, name: `NL Dept ${rnd}` },
    });
    deptId = dept.id;

    // Éditeur : consultation + saisie sur « communication ».
    const roleCode = `TEST_NL_SAISIE_${rnd}`;
    const role = await prisma.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, label: "Test NL (saisie)" } });
    for (const action of ["consultation", "saisie"] as const) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { module_action: { module: "communication", action } } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
    const editor = await createUserWithRole(`nl_editor_${rnd}`, roleCode, PWD);
    editorId = editor.id;

    // Lecteur : consultation seule (CORRECTEUR a communication:consultation).
    await createUserWithRole(`nl_reader_${rnd}`, "CORRECTEUR", PWD);

    // ── Actualités de la période ─────────────────────────────────────────────
    // Annonce « tous » publiée dans la période → doit entrer.
    const allAnn = await prisma.announcement.create({
      data: {
        title: `NL Annonce tous ${rnd}`,
        bodyHtml: "<p>Actualité générale de la maison.</p>",
        priority: "normale",
        status: "publiee",
        publishedAt: new Date(inPeriod),
        authorId: editorId,
        targets: { create: [{ targetType: "tous", targetId: null }] },
      },
    });
    allAnnId = allAnn.id;

    // Annonce ciblée sur un département → ne doit PAS entrer (confidentialité).
    const deptAnn = await prisma.announcement.create({
      data: {
        title: `NL Annonce dept ${rnd}`,
        bodyHtml: "<p>Réservé au pôle.</p>",
        priority: "normale",
        status: "publiee",
        publishedAt: new Date(inPeriod),
        authorId: editorId,
        targets: { create: [{ targetType: "departement", targetId: deptId }] },
      },
    });
    deptAnnId = deptAnn.id;

    // Annonce « tous » publiée HORS période → ne doit pas entrer.
    await prisma.announcement.create({
      data: {
        title: `NL Annonce hors période ${rnd}`,
        bodyHtml: "<p>Trop ancienne.</p>",
        priority: "normale",
        status: "publiee",
        publishedAt: new Date(outPeriod),
        authorId: editorId,
        targets: { create: [{ targetType: "tous", targetId: null }] },
      },
    });

    // Événement « tous » dans la période → doit entrer.
    await prisma.calendarEvent.create({
      data: {
        title: `NL Événement tous ${rnd}`,
        type: "reunion",
        startsAt: new Date(inPeriod),
        authorId: editorId,
        targets: { create: [{ targetType: "tous", targetId: null }] },
      },
    });

    // Événement ciblé sur un département → ne doit PAS entrer.
    await prisma.calendarEvent.create({
      data: {
        title: `NL Événement dept ${rnd}`,
        type: "reunion",
        startsAt: new Date(inPeriod),
        authorId: editorId,
        targets: { create: [{ targetType: "departement", targetId: deptId }] },
      },
    });

    editorCookie = await login(app, `nl_editor_${rnd}`, PWD);
    readerCookie = await login(app, `nl_reader_${rnd}`, PWD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuse la création d'un bulletin à un simple consultant", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/newsletters",
      headers: { cookie: readerCookie },
      payload: { title: "Interdit", period_start: periodStart, period_end: periodEnd },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuse une plage de dates incohérente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/newsletters",
      headers: { cookie: editorCookie },
      payload: { title: "Mauvaise plage", period_start: periodEnd, period_end: periodStart },
    });
    expect(res.statusCode).toBe(400);
  });

  it("prévisualise une période en ne retenant que les actualités « maison »", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/newsletters/preview?period_start=${encodeURIComponent(periodStart)}&period_end=${encodeURIComponent(periodEnd)}`,
      headers: { cookie: editorCookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ kind: string; id: string; title: string }>;
    const ids = items.map((i) => i.id);
    const titles = items.map((i) => i.title);
    // L'annonce et l'événement « tous » sont présents.
    expect(ids).toContain(allAnnId);
    expect(titles).toContain(`NL Événement tous ${rnd}`);
    // Les contenus ciblés sur un pôle et hors période sont exclus.
    expect(ids).not.toContain(deptAnnId);
    expect(titles).not.toContain(`NL Annonce dept ${rnd}`);
    expect(titles).not.toContain(`NL Événement dept ${rnd}`);
    expect(titles).not.toContain(`NL Annonce hors période ${rnd}`);
  });

  it("crée un brouillon, l'envoie, puis le fige (non modifiable / non renvoyable)", async () => {
    // Création du brouillon.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/newsletters",
      headers: { cookie: editorCookie },
      payload: { title: `Bulletin ${rnd}`, intro: "Les nouvelles du mois.", period_start: periodStart, period_end: periodEnd },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    // Un consultant ne voit pas encore ce brouillon (404).
    const readerDraft = await app.inject({ method: "GET", url: `/api/v1/newsletters/${id}`, headers: { cookie: readerCookie } });
    expect(readerDraft.statusCode).toBe(404);

    // L'éditeur voit le brouillon, avec l'aperçu compilé.
    const draft = await app.inject({ method: "GET", url: `/api/v1/newsletters/${id}`, headers: { cookie: editorCookie } });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().status).toBe("brouillon");
    expect((draft.json().items as unknown[]).length).toBeGreaterThanOrEqual(2);

    // Envoi.
    const sent = await app.inject({ method: "POST", url: `/api/v1/newsletters/${id}/send`, headers: { cookie: editorCookie } });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().recipients).toBeGreaterThanOrEqual(1);
    expect(sent.json().items).toBeGreaterThanOrEqual(2);

    // Le bulletin est désormais figé : renvoi et modification refusés (409).
    const resend = await app.inject({ method: "POST", url: `/api/v1/newsletters/${id}/send`, headers: { cookie: editorCookie } });
    expect(resend.statusCode).toBe(409);
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/newsletters/${id}`,
      headers: { cookie: editorCookie },
      payload: { title: "Changé" },
    });
    expect(edit.statusCode).toBe(409);

    // Un consultant voit maintenant le bulletin envoyé, avec l'instantané figé.
    const readerSent = await app.inject({ method: "GET", url: `/api/v1/newsletters/${id}`, headers: { cookie: readerCookie } });
    expect(readerSent.statusCode).toBe(200);
    expect(readerSent.json().status).toBe("envoyee");
    expect((readerSent.json().items as unknown[]).length).toBeGreaterThanOrEqual(2);

    // Il apparaît dans la liste du consultant (bulletins envoyés).
    const list = await app.inject({ method: "GET", url: "/api/v1/newsletters", headers: { cookie: readerCookie } });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ id: string }>).some((n) => n.id === id)).toBe(true);
  });
});
