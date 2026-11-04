import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Bon de commande : consignes à l'imprimeur (éditables, reprises à l'impression)
// + fiche technique RÉCUPÉRÉE automatiquement depuis production_specs (Maquette),
// jamais ressaisie côté Impression.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Bon de commande — consignes + fiche technique auto", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let msId: string;
  let poId: string;
  let printerId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });

    // Ouvrage + fiche technique (saisie « à la Maquette »).
    const ms = await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title: `PO specs ${rnd()}`, genre_id: genre.id, language: "fr", owner_id: adminId, author: { first_name: "A", last_name: "B" } },
    });
    msId = ms.json().id;
    await app.inject({
      method: "PATCH", url: `/api/v1/manuscripts/${msId}/production-specs`, headers: { cookie },
      payload: { trim_format: "145 × 210 mm", final_pages: 240, paper_interior: "Bouffant", paper_interior_gsm: 80, binding: "Dos carré collé", lamination: "Mat" },
    });

    // Imprimeur + devis sélectionné + bon de commande (créés directement).
    const printer = await app.inject({ method: "POST", url: "/api/v1/printers/quick", headers: { cookie }, payload: { name: `Impr ${rnd()}` } });
    printerId = printer.json().id;
    const quote = await prisma.printQuote.create({
      data: { manuscriptId: msId, printerId, quantities: [500, 1000], amounts: { "500": 120000 }, status: "selected", selectedQuantity: 500 },
    });
    const po = await prisma.purchaseOrder.create({
      data: { quoteId: quote.id, printerId, poNumber: `BC-TEST-${rnd()}`, orderedQuantity: 500, amount: 120000 },
    });
    poId = po.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("la liste des bons de commande expose la fiche technique de la Maquette (sans ressaisie)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${msId}/purchase-orders`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const po = res.json().find((p: { id: string }) => p.id === poId);
    expect(po).toBeTruthy();
    expect(po.quote.manuscript.productionSpecs.trimFormat).toBe("145 × 210 mm");
    expect(po.quote.manuscript.productionSpecs.finalPages).toBe(240);
    expect(po.quote.manuscript.productionSpecs.binding).toBe("Dos carré collé");
    expect(po.printerInstructions ?? null).toBeNull();
  });

  it("enregistre et renvoie les consignes à l'imprimeur", async () => {
    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/purchase-orders/${poId}/instructions`, headers: { cookie },
      payload: { printer_instructions: "Couverture Pantone 185 C · papier recyclé · livraison en cartons de 20." },
    });
    expect(patch.statusCode).toBe(200);

    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${msId}/purchase-orders`, headers: { cookie } });
    const po = res.json().find((p: { id: string }) => p.id === poId);
    expect(po.printerInstructions).toContain("Pantone 185 C");
  });

  it("établit le bon via la route et trace qui l'a établi (nom + fonction)", async () => {
    // Un devis sélectionné, puis génération du bon au titre du « stock ».
    const quote = await prisma.printQuote.create({
      data: { manuscriptId: msId, printerId, quantities: [300], amounts: { "300": 90000 }, status: "selected", selectedQuantity: 300 },
    });
    const gen = await app.inject({
      method: "POST", url: `/api/v1/print-quotes/${quote.id}/purchase-order`, headers: { cookie },
      payload: { established_by_function: "stock" },
    });
    expect(gen.statusCode).toBe(201);

    const fresh = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: gen.json().id } });
    expect(fresh.establishedByName).toBe("admin"); // instantané du nom de l'établisseur
    expect(fresh.establishedByFunction).toBe("stock");
  });
});
