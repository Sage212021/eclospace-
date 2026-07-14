import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Centre de Communication Interne — Babillard d'annonces (incrément 1, socle).
// Règles critiques testées : ciblage (qui reçoit), permissions (qui publie),
// suivi de lecture, assainissement du contenu, intégration à la cloche.

const rnd = Math.floor(Math.random() * 1e6);

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

const PWD = "AnnoncePass123!";

describe("communication — babillard d'annonces (incrément 1)", () => {
  let app: FastifyInstance;
  let pubCookie: string; // publisher (RESP_RH : saisie + administration)
  let aCookie: string; // destinataire dans le département ciblé
  let bCookie: string; // hors du département ciblé
  let saisieOnlyCookie: string; // saisie sans administration (test « auteur seul »)
  let deptX: { id: string };
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    app = await buildApp();

    deptX = await prisma.department.upsert({
      where: { code: `ANNC_X_${rnd}` },
      update: {},
      create: { code: `ANNC_X_${rnd}`, name: `Département annonces X ${rnd}` },
    });
    const deptY = await prisma.department.upsert({
      where: { code: `ANNC_Y_${rnd}` },
      update: {},
      create: { code: `ANNC_Y_${rnd}`, name: `Département annonces Y ${rnd}` },
    });

    const pub = await createUserWithRole(`annc_pub_${rnd}`, "RESP_RH", PWD);
    const a = await createUserWithRole(`annc_a_${rnd}`, "CORRECTEUR", PWD);
    const b = await createUserWithRole(`annc_b_${rnd}`, "CORRECTEUR", PWD);
    userAId = a.id;
    userBId = b.id;

    const empA = await prisma.employee.create({ data: { firstName: "Alice", lastName: `A${rnd}`, departmentId: deptX.id } });
    const empB = await prisma.employee.create({ data: { firstName: "Bob", lastName: `B${rnd}`, departmentId: deptY.id } });
    await prisma.user.update({ where: { id: a.id }, data: { employeeId: empA.id } });
    await prisma.user.update({ where: { id: b.id }, data: { employeeId: empB.id } });

    // Rôle de test « saisie seule » (sans administration) pour vérifier qu'un
    // publieur ne peut pas gérer l'annonce d'un autre auteur.
    const roleCode = `TEST_PUB_SAISIE_${rnd}`;
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, label: "Test publieur (saisie)" },
    });
    for (const action of ["consultation", "saisie"] as const) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { module_action: { module: "communication", action } } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
    await createUserWithRole(`annc_saisie_${rnd}`, roleCode, PWD);

    pubCookie = await login(app, `annc_pub_${rnd}`, PWD);
    aCookie = await login(app, `annc_a_${rnd}`, PWD);
    bCookie = await login(app, `annc_b_${rnd}`, PWD);
    saisieOnlyCookie = await login(app, `annc_saisie_${rnd}`, PWD);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDraft(cookie: string, body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/v1/announcements", headers: { cookie }, payload: body });
  }

  it("refuse la création à un simple destinataire (consultation seule)", async () => {
    const res = await createDraft(aCookie, {
      title: "Interdit",
      body_html: "<p>test</p>",
      targets: [{ type: "tous" }],
    });
    expect(res.statusCode).toBe(403);
  });

  it("assainit le contenu enrichi (retire les scripts)", async () => {
    const res = await createDraft(pubCookie, {
      title: "Contenu XSS",
      body_html: `<p>Bonjour</p><script>alert('x')</script><img src="javascript:alert(1)"><a href="https://ex.com">lien</a>`,
      targets: [{ type: "departement", id: deptX.id }],
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    const detail = await app.inject({ method: "GET", url: `/api/v1/announcements/${id}`, headers: { cookie: pubCookie } });
    const body = detail.json().body_html as string;
    expect(body).not.toContain("<script");
    expect(body).not.toContain("javascript:");
    expect(body).toContain("Bonjour");
    expect(body).toContain("noopener");
  });

  it("cible un département : seul le destinataire concerné reçoit l'annonce", async () => {
    const draft = await createDraft(pubCookie, {
      title: `Réunion ${rnd}`,
      body_html: "<p>Réunion générale lundi.</p>",
      category_code: "reunion",
      priority: "importante",
      targets: [{ type: "departement", id: deptX.id }],
    });
    expect(draft.statusCode).toBe(201);
    const id = draft.json().id as string;

    const pub = await app.inject({ method: "POST", url: `/api/v1/announcements/${id}/publish`, headers: { cookie: pubCookie } });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().recipients).toBe(1); // seul userA est dans deptX

    // A voit l'annonce dans son fil (non lue).
    const feedA = await app.inject({ method: "GET", url: "/api/v1/announcements", headers: { cookie: aCookie } });
    const idsA = (feedA.json() as { id: string }[]).map((x) => x.id);
    expect(idsA).toContain(id);

    // B (autre département) ne la voit pas et ne peut pas ouvrir le détail.
    const feedB = await app.inject({ method: "GET", url: "/api/v1/announcements", headers: { cookie: bCookie } });
    const idsB = (feedB.json() as { id: string }[]).map((x) => x.id);
    expect(idsB).not.toContain(id);
    const detailB = await app.inject({ method: "GET", url: `/api/v1/announcements/${id}`, headers: { cookie: bCookie } });
    expect(detailB.statusCode).toBe(404);

    // La cloche : une notification « annonce » a été générée pour A, pointant
    // vers cette annonce.
    const notifs = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: { cookie: aCookie } });
    const list = notifs.json() as { type: string; entityType: string | null; entityId: string | null }[];
    expect(list.some((n) => n.type === "annonce" && n.entityType === "announcement" && n.entityId === id)).toBe(true);
  });

  it("enregistre la lecture puis l'accusé de réception", async () => {
    const draft = await createDraft(pubCookie, {
      title: `Lecture obligatoire ${rnd}`,
      body_html: "<p>Merci d'accuser réception.</p>",
      require_ack: true,
      targets: [{ type: "utilisateur", id: userAId }],
    });
    const id = draft.json().id as string;
    await app.inject({ method: "POST", url: `/api/v1/announcements/${id}/publish`, headers: { cookie: pubCookie } });

    // Ouvrir le détail marque « lu ».
    await app.inject({ method: "GET", url: `/api/v1/announcements/${id}`, headers: { cookie: aCookie } });
    let receipt = await prisma.announcementReceipt.findFirstOrThrow({ where: { announcementId: id, userId: userAId } });
    expect(receipt.readAt).not.toBeNull();
    expect(receipt.acknowledgedAt).toBeNull();

    // Accuser réception.
    const ack = await app.inject({ method: "POST", url: `/api/v1/announcements/${id}/ack`, headers: { cookie: aCookie } });
    expect(ack.statusCode).toBe(200);
    receipt = await prisma.announcementReceipt.findFirstOrThrow({ where: { announcementId: id, userId: userAId } });
    expect(receipt.acknowledgedAt).not.toBeNull();

    // Suivi côté auteur.
    const stats = await app.inject({ method: "GET", url: `/api/v1/announcements/${id}/receipts`, headers: { cookie: pubCookie } });
    expect(stats.statusCode).toBe(200);
    const body = stats.json();
    expect(body.total).toBe(1);
    expect(body.read).toBe(1);
    expect(body.acknowledged).toBe(1);
  });

  it("réserve la gestion à l'auteur (ou à l'administration)", async () => {
    // saisieOnly (sans administration) crée son annonce…
    const mine = await createDraft(saisieOnlyCookie, {
      title: `À moi ${rnd}`,
      body_html: "<p>x</p>",
      targets: [{ type: "departement", id: deptX.id }],
    });
    expect(mine.statusCode).toBe(201);

    // …mais ne peut pas modifier celle du publieur (autre auteur, pas admin).
    const other = await createDraft(pubCookie, {
      title: `À l'autre ${rnd}`,
      body_html: "<p>y</p>",
      targets: [{ type: "departement", id: deptX.id }],
    });
    const otherId = other.json().id as string;
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/announcements/${otherId}`,
      headers: { cookie: saisieOnlyCookie },
      payload: { title: "Détournée" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("journalise création, publication et consultation (audit append-only)", async () => {
    const draft = await createDraft(pubCookie, {
      title: `Audit ${rnd}`,
      body_html: "<p>trace</p>",
      targets: [{ type: "utilisateur", id: userBId }],
    });
    const id = draft.json().id as string;
    await app.inject({ method: "POST", url: `/api/v1/announcements/${id}/publish`, headers: { cookie: pubCookie } });
    await app.inject({ method: "GET", url: `/api/v1/announcements/${id}`, headers: { cookie: bCookie } });

    const entries = await prisma.auditLog.findMany({ where: { entityType: "announcement", entityId: id } });
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("create");
    expect(actions).toContain("status_change"); // publication
    expect(actions).toContain("view_sensitive"); // consultation par B
  });

  it("réserve les options de ciblage aux publieurs", async () => {
    const forbidden = await app.inject({ method: "GET", url: "/api/v1/announcement-targets/options", headers: { cookie: aCookie } });
    expect(forbidden.statusCode).toBe(403); // simple destinataire (consultation seule)

    const ok = await app.inject({ method: "GET", url: "/api/v1/announcement-targets/options", headers: { cookie: pubCookie } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(Array.isArray(body.departments)).toBe(true);
    expect(Array.isArray(body.roles)).toBe(true);
    expect(Array.isArray(body.users)).toBe(true);
  });

  it("expose les préférences de notification (défauts) et les met à jour", async () => {
    const get = await app.inject({ method: "GET", url: "/api/v1/me/notification-preferences", headers: { cookie: aCookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json().sound_enabled).toBe(true);
    expect(get.json().sound_volume).toBe(70);

    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/me/notification-preferences",
      headers: { cookie: aCookie },
      payload: { sound_enabled: false, sound_volume: 30, email_enabled: false },
    });
    expect(put.statusCode).toBe(200);
    const get2 = await app.inject({ method: "GET", url: "/api/v1/me/notification-preferences", headers: { cookie: aCookie } });
    expect(get2.json().sound_enabled).toBe(false);
    expect(get2.json().sound_volume).toBe(30);
    expect(get2.json().email_enabled).toBe(false);
  });
});
