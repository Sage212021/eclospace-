import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Carnet d'imprimeurs pré-enregistrés (pôle Impression) : les deux prestataires
// fournis par l'opérateur doivent être présents (sélectionnables sur un bon de
// commande), chacun une seule fois (pré-chargement idempotent).

describe("Carnet d'imprimeurs pré-enregistrés", () => {
  beforeAll(async () => {
    await buildApp();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const expected = [
    { email: "billydjeutane92@gmail.com", name: "BILLY PRINT CONCEPT", specialty: "Sérigraphie" },
    { email: "editionsglc@gmail.com", name: "GLC Éditions (GLC SARL)", specialty: "Impression d'ouvrages" },
  ];

  for (const e of expected) {
    it(`« ${e.name} » est enregistré comme imprimeur, une seule fois, avec sa fiche Printer`, async () => {
      const partners = await prisma.partner.findMany({ where: { category: "imprimeur", email: e.email } });
      expect(partners.length).toBe(1); // idempotent : pas de doublon
      const partner = partners[0];
      expect(partner.firstName).toBe(e.name);

      const printer = await prisma.printer.findUnique({ where: { partnerId: partner.id } });
      expect(printer).not.toBeNull();
      expect(printer!.specialties).toContain(e.specialty);
      expect((printer!.paymentTerms ?? "").length).toBeGreaterThan(0);
    });
  }
});
