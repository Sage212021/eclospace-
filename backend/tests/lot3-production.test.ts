import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("maquette et infographie (Lot 3)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createManuscript(title: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Auteur", last_name: title },
      },
    });
    return response.json();
  }

  it("calcule le dos et signale un recalcul quand le nombre de pages ou le papier change (Ch. 12 §12.3)", async () => {
    const manuscript = await createManuscript("Manuscrit Fabrication");

    const first = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { final_pages: 200, paper_interior_gsm: 80 },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.spineWidthMm).toBeCloseTo(200 * 80 * 0.0012, 2);
    expect(firstBody.spineNeedsRecalc).toBe(true);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { trim_format: "14x21" },
    });
    expect(cleared.json().spineNeedsRecalc).toBe(false);

    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { final_pages: 240 },
    });
    const changedBody = changed.json();
    expect(changedBody.spineNeedsRecalc).toBe(true);
    expect(changedBody.spineWidthMm).toBeCloseTo(240 * 80 * 0.0012, 2);
  });

  it("enregistre les caractéristiques d'écriture (typographie) et les laisse modifiables (Ch. 11 §11.4)", async () => {
    const manuscript = await createManuscript("Manuscrit Typographie");

    // Saisie initiale de la composition sur la fiche technique (étape 9).
    const first = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { paper_interior: "Bouffant", typeface: "Garamond", font_size_pt: "11", leading: "14 pt", margins: "H20/B20", layout_name: "Roman — Éclats" },
    });
    expect(first.statusCode).toBe(200);
    const a = first.json();
    expect(a.typeface).toBe("Garamond");
    expect(a.fontSizePt).toBe("11");
    expect(a.leading).toBe("14 pt");
    expect(a.layoutName).toBe("Roman — Éclats");

    // Règle d'or : une information mal saisie reste corrigeable. On modifie la
    // police et le corps sans toucher au papier déjà renseigné.
    const fixed = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { typeface: "Sabon", font_size_pt: "10,5" },
    });
    const b = fixed.json();
    expect(b.typeface).toBe("Sabon");
    expect(b.fontSizePt).toBe("10,5");
    expect(b.paperInterior).toBe("Bouffant"); // fabrication préservée
    expect(b.leading).toBe("14 pt"); // typographie non modifiée préservée
  });

  it("détecte un visuel non conforme (résolution/mode couleur, Ch. 11 §11.7, Ch. 12 §12.5) et notifie", async () => {
    const manuscript = await createManuscript("Manuscrit Visuels");

    const nonConforme = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/image-assets`,
      headers: { cookie: adminCookie },
      payload: { type: "couverture_1", resolution_dpi: 150, color_mode: "RVB" },
    });
    expect(nonConforme.statusCode).toBe(201);
    expect(nonConforme.json().technicalOk).toBe(false);

    const notification = await prisma.notification.findFirst({
      where: { entityId: manuscript.id, title: "Visuel non conforme" },
    });
    expect(notification).not.toBeNull();

    const conforme = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/image-assets`,
      headers: { cookie: adminCookie },
      payload: { type: "couverture_1", resolution_dpi: 300, color_mode: "cmjn" },
    });
    expect(conforme.json().technicalOk).toBe(true);
  });

  it("un rôle sans permission production:saisie ne peut pas modifier la fiche de fabrication", async () => {
    const manuscript = await createManuscript("Manuscrit Sans Droits");
    await createUserWithRole("correcteur_production_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_production_test", "Correcteur123!");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie },
      payload: { final_pages: 100 },
    });
    expect(response.statusCode).toBe(403);
  });

  it("gère les gabarits de mise en page et les chartes graphiques", async () => {
    const template = await app.inject({
      method: "POST",
      url: "/api/v1/layout-templates",
      headers: { cookie: adminCookie },
      payload: { name: "Gabarit Roman 14x21", format: "14x21", specs: { marges_mm: 20 } },
    });
    expect(template.statusCode).toBe(201);

    const charter = await app.inject({
      method: "POST",
      url: "/api/v1/graphic-charters",
      headers: { cookie: adminCookie },
      payload: { scope: "maison", description: "Charte graphique maison" },
    });
    expect(charter.statusCode).toBe(201);

    const templates = await app.inject({ method: "GET", url: "/api/v1/layout-templates", headers: { cookie: adminCookie } });
    expect(templates.json().some((t: { id: string }) => t.id === template.json().id)).toBe(true);
  });
});
