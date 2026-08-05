import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Administration du workflow (Lot C) : lecture de la configuration des étapes
// et modification sûre (libellé, délai, notifications) par l'administration.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

interface Step {
  code: string;
  label: string;
  target_days: number | null;
  notify_on_entry: boolean;
}

describe("administration du workflow", () => {
  let app: FastifyInstance;
  let cookie: string;
  let originalLabel = "Réception du manuscrit";

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const st = await prisma.workflowStatus.findUnique({ where: { code: "RECEPTION" } });
    if (st) originalLabel = st.label;
  });

  afterAll(async () => {
    // Restaure l'étape RECEPTION pour ne pas polluer les autres suites.
    await prisma.workflowStatus.update({ where: { code: "RECEPTION" }, data: { label: originalLabel } });
    const s = await prisma.setting.findUnique({ where: { key: "workflow.step_target_days" } });
    const map = ((s?.value as Record<string, number>) ?? {});
    map.RECEPTION = 2;
    await prisma.setting.upsert({ where: { key: "workflow.step_target_days" }, update: { value: map }, create: { key: "workflow.step_target_days", value: map } });
    await prisma.setting.deleteMany({ where: { key: "workflow.step_notify_on_entry" } });
    await app.close();
  });

  it("liste les étapes avec leur configuration + les départements", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/workflow/config", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body.steps.length).toBeGreaterThan(10);
    expect(Array.isArray(body.departments)).toBe(true);
    const reception = (body.steps as Step[]).find((s) => s.code === "RECEPTION")!;
    expect(reception.notify_on_entry).toBe(true);
  });

  it("modifie libellé, délai et notifications d'une étape", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/workflow/steps/RECEPTION",
      headers: { cookie },
      payload: { label: "Réception (test)", target_days: 4, notify_on_entry: false },
    });
    expect(patch.statusCode).toBe(200);

    const body = (await app.inject({ method: "GET", url: "/api/v1/workflow/config", headers: { cookie } })).json();
    const reception = (body.steps as Step[]).find((s) => s.code === "RECEPTION")!;
    expect(reception.label).toBe("Réception (test)");
    expect(reception.target_days).toBe(4);
    expect(reception.notify_on_entry).toBe(false);
  });

  it("refuse une étape inconnue", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/workflow/steps/INCONNUE", headers: { cookie }, payload: { label: "x" } });
    expect(res.statusCode).toBe(404);
  });
});
