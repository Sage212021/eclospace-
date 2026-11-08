import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Carnet d'imprimeurs — ajout RAPIDE depuis la fiche (crée le partenaire
// « imprimeur » + le Printer en un geste), pour débloquer l'étape Impression.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Imprimeurs — création rapide (carnet)", () => {
  let app: FastifyInstance;
  let cookie: string;
  const createdPrinterIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
  });

  it("crée en une fois le partenaire « imprimeur » et le Printer, visible dans la liste", async () => {
    const name = `Imprimerie Test ${Math.random().toString(36).slice(2, 7)}`;
    const res = await app.inject({
      method: "POST", url: "/api/v1/printers/quick", headers: { cookie },
      payload: { name, city: "Yaoundé", phone: "690000000", niu: "M099999999999Z", rccm: "RC/YAO/2026/B/999", bank_account: "CCA BANK — 0009999999", specialties: ["offset", "numérique"], payment_terms: "50 % à la commande" },
    });
    expect(res.statusCode).toBe(201);
    const printer = res.json();
    createdPrinterIds.push(printer.id);
    expect(printer.partner.firstName).toBe(name);
    expect(printer.specialties).toContain("offset");

    // Le partenaire est bien de catégorie « imprimeur », avec ses mentions légales.
    const partner = await prisma.partner.findUniqueOrThrow({ where: { id: printer.partner.id } });
    expect(partner.category).toBe("imprimeur");
    expect(partner.city).toBe("Yaoundé");
    expect(partner.niu).toBe("M099999999999Z");
    expect(partner.rccm).toBe("RC/YAO/2026/B/999");
    expect(partner.bankAccount).toContain("CCA BANK");

    // Il apparaît dans la liste des imprimeurs (utilisée pour demander un devis).
    const list = await app.inject({ method: "GET", url: "/api/v1/printers", headers: { cookie } });
    expect(list.json().some((p: { id: string }) => p.id === printer.id)).toBe(true);
  });

  it("refuse un nom trop court", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/printers/quick", headers: { cookie }, payload: { name: "X" } });
    expect(res.statusCode).toBe(400);
  });
});
