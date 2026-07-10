import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { notifyRole } from "../src/lib/notify.js";
import { buildNotificationEmail } from "../src/lib/documentEmail.js";
import { createUserWithRole } from "./helpers.js";

// Phase A — alertes par e-mail. En environnement de test, aucun SMTP n'est
// configuré : l'envoi est donc silencieusement ignoré (« meilleur effort »),
// et la notification in-app reste la source de vérité. On vérifie surtout que
// le contenu de l'e-mail est correct et que le branchement ne casse ni ne
// bloque la création des notifications.

describe("contenu de l'e-mail d'alerte", () => {
  it("préfixe le sujet selon la priorité et reprend titre + corps", () => {
    const critique = buildNotificationEmail({ title: "Stock critique : Le Livre", body: "Il reste 3 exemplaires.", priority: "critical" });
    expect(critique.subject).toContain("Alerte critique —");
    expect(critique.subject).toContain("Stock critique");
    expect(critique.html).toContain("Critique");
    expect(critique.text).toContain("Il reste 3 exemplaires.");

    const info = buildNotificationEmail({ title: "Affectation", body: "Nouvelle tâche.", priority: "medium" });
    expect(info.subject).not.toContain("Alerte");
  });
});

describe("branchement e-mail des notifications de rôle", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("crée toujours la notification in-app, sans SMTP l'envoi est ignoré", async () => {
    const dest = await createUserWithRole(`notif_mail_${Math.random().toString(36).slice(2, 7)}`, "CORRECTEUR", "Dest123!");
    const before = await prisma.notification.count({ where: { userId: dest.id } });

    await notifyRole({
      roleCode: "CORRECTEUR",
      type: "alerte_stock",
      priority: "critical",
      title: "Test alerte critique",
      body: "Corps de l'alerte de test.",
      entityType: "test",
      entityId: "00000000-0000-0000-0000-000000000000",
    });

    const created = await prisma.notification.findFirst({
      where: { userId: dest.id, title: "Test alerte critique" },
      orderBy: { createdAt: "desc" },
    });
    expect(await prisma.notification.count({ where: { userId: dest.id } })).toBe(before + 1);
    expect(created).not.toBeNull();
    // SMTP non configuré en test : le canal reste in_app (pas de faux « email »).
    expect(created!.channel).toBe("in_app");
    expect(created!.sentAt).toBeNull();
  });
});
