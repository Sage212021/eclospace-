import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Jimp } from "jimp";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Planning annuel des événements : lecture par tout le personnel (babillard),
// gestion réservée au RH et à la Direction générale (rh:administration). Statut
// et champs modulables ; affiche image optimisée, affichée directement.

const rnd = Math.floor(Math.random() * 1e6);
const PWD = "Events123!";

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

function multipart(fieldName: string, filename: string, contentType: string, content: Buffer) {
  const boundary = "----ecl" + rnd;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("planning annuel des événements", () => {
  let app: FastifyInstance;
  let rhCookie: string;
  let dgCookie: string;
  let readerCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    await createUserWithRole(`ev_rh_${rnd}`, "RESP_RH", PWD);
    await createUserWithRole(`ev_dg_${rnd}`, "DIR_GENERAL", PWD);
    await createUserWithRole(`ev_reader_${rnd}`, "CORRECTEUR", PWD);
    rhCookie = await login(app, `ev_rh_${rnd}`, PWD);
    dgCookie = await login(app, `ev_dg_${rnd}`, PWD);
    readerCookie = await login(app, `ev_reader_${rnd}`, PWD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("tout le personnel peut consulter le planning (babillard)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/annual-events", headers: { cookie: readerCookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("un correcteur ne peut PAS créer d'événement (403)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/annual-events", headers: { cookie: readerCookie }, payload: { title: "X", start_date: "2026-08-12" } });
    expect(res.statusCode).toBe(403);
  });

  it("le RH crée un événement (BINGUEL), la DG modifie son statut", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/annual-events",
      headers: { cookie: rhCookie },
      payload: { title: `Festival BINGUEL ${rnd}`, description: "atelier de lecture pour enfants", start_date: "2026-08-12", end_date: "2026-08-15", location: "à préciser", dg_present: false },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;
    expect(create.json().status).toBe("a_venir");
    expect(create.json().has_affiche).toBe(false);

    // La Direction générale (a rh:administration) peut marquer « tenu ».
    const patch = await app.inject({ method: "PATCH", url: `/api/v1/annual-events/${id}`, headers: { cookie: dgCookie }, payload: { status: "tenu" } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().status).toBe("tenu");

    // Modulable : on change la date (le RH), tout reste éditable dans l'ERP.
    const patch2 = await app.inject({ method: "PATCH", url: `/api/v1/annual-events/${id}`, headers: { cookie: rhCookie }, payload: { start_date: "2026-08-13" } });
    expect(patch2.statusCode).toBe(200);
    expect(new Date(patch2.json().start_date).getUTCDate()).toBe(13);
  });

  it("dépose une affiche (image optimisée) et l'affiche directement", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/annual-events", headers: { cookie: rhCookie }, payload: { title: `Salon ${rnd}`, start_date: "2026-05-29" } });
    const id = create.json().id;

    // Grande image « photo » (dégradé, poids réaliste) → JPG optimisé plus léger.
    const w = 2000, h = 2600, data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = (x * 255 / w) | 0; data[i + 1] = (y * 255 / h) | 0; data[i + 2] = ((x + y) * 255 / (w + h)) | 0; data[i + 3] = 255; }
    const big = await new Jimp({ width: w, height: h, data }).getBuffer("image/png");
    const mp = multipart("file", "affiche.png", "image/png", big);
    const up = await app.inject({ method: "POST", url: `/api/v1/annual-events/${id}/affiche`, headers: { cookie: rhCookie, "content-type": mp.contentType }, payload: mp.body });
    expect(up.statusCode).toBe(200);
    expect(up.json().has_affiche).toBe(true);

    // L'affiche est servie comme image, directement (pas un téléchargement forcé).
    const img = await app.inject({ method: "GET", url: `/api/v1/annual-events/${id}/affiche`, headers: { cookie: readerCookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toContain("image/");
    expect(img.headers["content-disposition"]).toBeUndefined(); // affichage direct, pas "attachment"
    expect(img.rawPayload.length).toBeLessThan(big.length); // plus léger que l'original
  }, 30000);

  it("le dépôt d'affiche est réservé au RH/Direction (correcteur refusé)", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/annual-events", headers: { cookie: rhCookie }, payload: { title: `Aff ${rnd}`, start_date: "2026-01-09" } });
    const id = create.json().id;
    const mp = multipart("file", "x.png", "image/png", Buffer.from("not-an-image"));
    const up = await app.inject({ method: "POST", url: `/api/v1/annual-events/${id}/affiche`, headers: { cookie: readerCookie, "content-type": mp.contentType }, payload: mp.body });
    expect(up.statusCode).toBe(403);
  });

  it("supprime un événement (logique) — réservé au RH/Direction", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/annual-events", headers: { cookie: rhCookie }, payload: { title: `Temp ${rnd}`, start_date: "2026-02-10" } });
    const id = create.json().id;
    const denied = await app.inject({ method: "DELETE", url: `/api/v1/annual-events/${id}`, headers: { cookie: readerCookie } });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: "DELETE", url: `/api/v1/annual-events/${id}`, headers: { cookie: rhCookie } });
    expect(ok.statusCode).toBe(200);
    const row = await prisma.annualEvent.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });
});
