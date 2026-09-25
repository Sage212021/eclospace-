import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// PAIEMENTS AUTEURS & REÇUS — le reçu est l'opération centrale unique, numérotée,
// tracée (initiateur figé). Auteur auto-dérivé du manuscrit ; validations métier.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Paiements auteurs & Reçus", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let manuscriptId: string;
  let partnerId: string;
  const s = rnd();

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const partner = await prisma.partner.create({ data: { firstName: "Awa", lastName: `Ndiaye ${s}`, phone: "690000000" } });
    partnerId = partner.id;
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-REC-${s}`, title: `Rêver ${s}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    await prisma.workContributor.create({ data: { manuscriptId, partnerId, role: "author", displayOrder: 0 } });
  });

  afterAll(async () => {
    await prisma.authorReceipt.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.workContributor.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.partner.deleteMany({ where: { id: partnerId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const create = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/author-receipts", headers: { cookie }, payload: { manuscript_id: manuscriptId, amount: 10000, method: "cash", paid_at: "2026-09-25", ...body } });

  it("la recherche de manuscrit renvoie l'auteur auto-dérivé", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author-receipts/form/manuscripts?q=MS-REC-${s}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as Array<{ id: string; author: { id: string } | null }>).find((m) => m.id === manuscriptId);
    expect(row?.author?.id).toBe(partnerId);
  });

  it("enregistre un frais de dépôt → reçu numéroté REC-AAAA-NNNNNN, auteur auto, initiateur tracé", async () => {
    const res = await create({ type: "frais_depot" });
    expect(res.statusCode).toBe(201);
    const { id, receipt_number } = res.json() as { id: string; receipt_number: string };
    expect(receipt_number).toMatch(/^REC-\d{4}-\d{6}$/);

    const detail = (await app.inject({ method: "GET", url: `/api/v1/author-receipts/${id}`, headers: { cookie } })).json();
    expect(detail.type).toBe("frais_depot");
    expect(detail.author.id).toBe(partnerId);
    expect(detail.amount).toBe(10000);
    expect(detail.status).toBe("enregistre");
    expect(detail.traceability.initiated.name).toBe("admin");
    expect(detail.traceability.generated.name).toBe("admin");
  });

  it("deux reçus ont des numéros différents et séquentiels", async () => {
    const a = (await create({ type: "frais_depot", amount: 5000 })).json() as { receipt_number: string };
    const b = (await create({ type: "frais_depot", amount: 5000 })).json() as { receipt_number: string };
    expect(a.receipt_number).not.toBe(b.receipt_number);
    const na = Number(a.receipt_number.split("-")[2]);
    const nb = Number(b.receipt_number.split("-")[2]);
    expect(nb).toBe(na + 1);
  });

  it("prestation éditoriale sans libellé → 400 ; mode de paiement inconnu → 400", async () => {
    const noService = await create({ type: "prestation_editoriale" });
    expect(noService.statusCode).toBe(400);
    expect(noService.json().code).toBe("service_required");

    const badMethod = await create({ type: "frais_depot", method: "carte_inexistante" });
    expect(badMethod.statusCode).toBe(400);
    expect(badMethod.json().code).toBe("invalid_method");
  });

  it("la liste (Éditorial/Finance, même donnée) affiche le reçu et le montant", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author-receipts?q=MS-REC-${s}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ manuscript_number: string; amount: number; registered_by: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.registered_by === "admin")).toBe(true);
  });

  // CIRCUIT FINANCE (incrément 2) : contrôle → comptabilisation, chaque étape tracée,
  // impossible de comptabiliser sans contrôle préalable.
  it("comptabiliser sans contrôle → 409 ; contrôle puis intégration comptable tracés", async () => {
    const { id } = (await create({ type: "frais_depot", amount: 7000 })).json() as { id: string };

    // On ne peut pas comptabiliser un reçu qui n'a pas été contrôlé.
    const tooSoon = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/account`, headers: { cookie }, payload: {} });
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.json().code).toBe("not_controlled");

    // Contrôle.
    const ctrl = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/control`, headers: { cookie }, payload: {} });
    expect(ctrl.statusCode).toBe(200);
    expect(ctrl.json().status).toBe("controle");

    // Intégration comptable avec référence.
    const acc = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/account`, headers: { cookie }, payload: { accounting_ref: "PIECE-2026-42" } });
    expect(acc.statusCode).toBe(200);
    expect(acc.json().status).toBe("comptabilise");

    const detail = (await app.inject({ method: "GET", url: `/api/v1/author-receipts/${id}`, headers: { cookie } })).json();
    expect(detail.status).toBe("comptabilise");
    expect(detail.accounting_ref).toBe("PIECE-2026-42");
    expect(detail.traceability.controlled.name).toBe("admin");
    expect(detail.traceability.accounted.name).toBe("admin");

    // Reçu déjà comptabilisé → ne se re-contrôle plus.
    const reCtrl = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/control`, headers: { cookie }, payload: {} });
    expect(reCtrl.statusCode).toBe(409);
    expect(reCtrl.json().code).toBe("already_accounted");
  });

  it("les statistiques agrègent le périmètre filtré (total, nombre, par type)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author-receipts/stats?type=frais_depot`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const stats = res.json() as { total_amount: number; count: number; by_type: Array<{ key: string; amount: number; count: number }> };
    expect(stats.count).toBeGreaterThanOrEqual(1);
    expect(stats.total_amount).toBeGreaterThan(0);
    expect(stats.by_type.some((t) => t.key === "frais_depot")).toBe(true);
  });

  // ANNULATION TRACÉE + REÇU DE REMPLACEMENT (incrément 3) : jamais de suppression ;
  // motif obligatoire ; le remplaçant reprend les données et est relié à l'annulé.
  it("annule un reçu avec remplacement : motif tracé, nouveau reçu relié, ancien figé", async () => {
    const { id, receipt_number } = (await create({ type: "prestation_editoriale", service_label: "Correction éditoriale", amount: 12000 })).json() as { id: string; receipt_number: string };

    // Motif absent → 400.
    const noReason = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/cancel`, headers: { cookie }, payload: { reason: "x" } });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().code).toBe("reason_required");

    // Annulation avec remplacement.
    const res = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/cancel`, headers: { cookie }, payload: { reason: "Montant erroné", issue_replacement: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; replacement: { id: string; receipt_number: string } | null };
    expect(body.status).toBe("annule");
    expect(body.replacement).not.toBeNull();
    expect(body.replacement!.receipt_number).toMatch(/^REC-\d{4}-\d{6}$/);
    expect(body.replacement!.receipt_number).not.toBe(receipt_number);

    // Ancien reçu : annulé, motif tracé, relié au remplaçant.
    const old = (await app.inject({ method: "GET", url: `/api/v1/author-receipts/${id}`, headers: { cookie } })).json();
    expect(old.status).toBe("annule");
    expect(old.traceability.cancelled.name).toBe("admin");
    expect(old.traceability.cancel_reason).toBe("Montant erroné");
    expect(old.replaced_by.receipt_number).toBe(body.replacement!.receipt_number);

    // Remplaçant : reprend les données et pointe vers l'ancien.
    const rep = (await app.inject({ method: "GET", url: `/api/v1/author-receipts/${body.replacement!.id}`, headers: { cookie } })).json();
    expect(rep.status).toBe("enregistre");
    expect(rep.amount).toBe(12000);
    expect(rep.service_label).toBe("Correction éditoriale");
    expect(rep.replaces.receipt_number).toBe(receipt_number);

    // Un reçu déjà annulé ne se ré-annule pas.
    const again = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/cancel`, headers: { cookie }, payload: { reason: "encore" } });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_cancelled");
  });

  it("un reçu comptabilisé ne s'annule pas (régularisation comptable requise)", async () => {
    const { id } = (await create({ type: "frais_depot", amount: 4000 })).json() as { id: string };
    await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/control`, headers: { cookie }, payload: {} });
    await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/account`, headers: { cookie }, payload: {} });
    const res = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${id}/cancel`, headers: { cookie }, payload: { reason: "trop tard" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("accounted_no_cancel");
  });

  it("les contrôles de cohérence signalent les frais de dépôt en double sur un manuscrit", async () => {
    // Deux frais de dépôt distincts sur le même manuscrit (via beforeAll) → doit être signalé.
    await create({ type: "frais_depot", amount: 3100 });
    await create({ type: "frais_depot", amount: 3200 });
    const res = await app.inject({ method: "GET", url: `/api/v1/author-receipts/alerts`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { count: number; alerts: Array<{ code: string; receipt_numbers: string[] }> };
    expect(body.alerts.some((a) => a.code === "multiple_deposit_fees")).toBe(true);
  });

  it("la recherche universelle retrouve un reçu par sa prestation", async () => {
    await create({ type: "prestation_editoriale", service_label: `Expertise ${s}`, amount: 8000 });
    const res = await app.inject({ method: "GET", url: `/api/v1/author-receipts?q=${encodeURIComponent(`Expertise ${s}`)}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ service_label: string | null }>;
    expect(rows.some((r) => r.service_label === `Expertise ${s}`)).toBe(true);
  });
});
