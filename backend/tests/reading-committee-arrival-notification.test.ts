import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, seedManuscriptSourceFile } from "./helpers.js";

// Phénomène signalé : un membre du comité voyait des notifications « à traiter »
// pour des manuscrits qu'il ne retrouvait pas dans « Mes lectures » — car
// « Mes lectures » ne liste que les manuscrits qui lui sont personnellement
// affectés, tandis qu'à l'arrivée au comité aucun relecteur n'est encore désigné
// (le manuscrit est « à répartir »). Le message d'arrivée au comité doit donc le
// dire clairement, et non laisser croire à une lecture personnelle.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("notification d'arrivée au comité de lecture (à répartir, pas à lire)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let genreId: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("notifie le comité avec un libellé « à répartir » renvoyant vers Comité de lecture", async () => {
    // Un membre du comité de lecture (département COMLEC) : destinataire de
    // l'alerte d'arrivée.
    const member = await createUserWithRole(`lec_${rnd()}`, "MEMBRE_COMITE_LECTURE", "Lec123!");

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/manuscripts",
        headers: { cookie: adminCookie },
        payload: { title: `Arrivée ${rnd()}`, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais", author: { first_name: "Au", last_name: "Teur", email: "a@example.com", id_type: "CNI", id_number: "1" } },
      })
    ).json();
    await seedManuscriptSourceFile(created.id);

    const validate = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${created.id}/steps/VERIF_ADMIN/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(validate.statusCode).toBe(200);
    expect(validate.json().status).toBe("COMITE_LECTURE");

    const notif = await prisma.notification.findFirst({
      where: { userId: member.id, entityType: "manuscript", entityId: created.id },
    });
    expect(notif).toBeTruthy();
    // Le message dit clairement que c'est une affectation à faire, pas une lecture
    // personnelle, et pointe vers la bonne rubrique.
    expect(notif!.title).toBe("Manuscrit à répartir au comité de lecture");
    expect(notif!.body).toContain("Comité de lecture");
    expect(notif!.body).toContain("Mes lectures");
    // On ne réutilise plus le libellé générique « à traiter » à cette étape.
    expect(notif!.title).not.toContain("Nouveau dossier à traiter");
  });
});
