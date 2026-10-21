import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Prisma } from "@prisma/client";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { prisma } from "./lib/prisma.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import documentRoutes from "./routes/documents.js";
import notificationRoutes from "./routes/notifications.js";
import pushRoutes from "./routes/push.js";
import manuscriptRoutes from "./routes/manuscripts.js";
import workflowRoutes from "./routes/workflow.js";
import readingCommitteeRoutes from "./routes/readingCommittee.js";
import projectPlanRoutes from "./routes/projectPlan.js";
import userRoutes from "./routes/users.js";
import referenceRoutes from "./routes/reference.js";
import aiEditorialRoutes from "./routes/aiEditorial.js";
import aiEditorRoutes from "./routes/aiEditor.js";
import aiAssistantRoutes from "./routes/aiAssistant.js";
import maintenanceRoutes from "./routes/maintenance.js";
import contractRoutes from "./routes/contracts.js";
import partnerRoutes from "./routes/partners.js";
import taskRoutes from "./routes/tasks.js";
import taskCommentRoutes from "./routes/taskComments.js";
import comparatorRoutes from "./routes/comparator.js";
import productionRoutes from "./routes/production.js";
import isbnRoutes from "./routes/isbn.js";
import batRoutes from "./routes/bat.js";
import printingRoutes from "./routes/printing.js";
import stockRoutes from "./routes/stock.js";
import stockVoucherRoutes from "./routes/stockVouchers.js";
import authorCopyRoutes from "./routes/authorCopies.js";
import commercialRoutes from "./routes/commercial.js";
import catalogueRoutes from "./routes/catalogue.js";
import marketingRoutes from "./routes/marketing.js";
import financeRoutes from "./routes/finance.js";
import financeRequestRoutes from "./routes/financeRequests.js";
import editorialQuoteRoutes from "./routes/editorialQuotes.js";
import authorReceiptRoutes from "./routes/authorReceipts.js";
import weeklyReportRoutes from "./routes/weeklyReports.js";
import royaltiesRoutes from "./routes/royalties.js";
import hrRoutes from "./routes/hr.js";
import directionRoutes from "./routes/direction.js";
import pilotageRoutes from "./routes/pilotage.js";
import reportsRoutes from "./routes/reports.js";
import settingsRoutes from "./routes/settings.js";
import auditRoutes from "./routes/audit.js";
import dashboardRoutes from "./routes/dashboard.js";
import editorialDashboardRoutes from "./routes/editorialDashboards.js";
import searchRoutes from "./routes/search.js";
import presenceRoutes from "./routes/presence.js";
import attendanceRoutes from "./routes/attendance.js";
import erpConnectionsRoutes from "./routes/erpConnections.js";
import payrollRoutes from "./routes/payroll.js";
import primeRoutes from "./routes/primes.js";
import announcementRoutes from "./routes/announcements.js";
import calendarRoutes from "./routes/calendar.js";
import newsfeedRoutes from "./routes/newsfeed.js";
import newsletterRoutes from "./routes/newsletters.js";
import annualEventsRoutes from "./routes/annualEvents.js";
import chatRoutes from "./routes/chat.js";
import authorRoutes from "./routes/author.js";
import serviceDeskRoutes from "./routes/serviceDesk.js";
import billingOrderRoutes from "./routes/billingOrders.js";

export async function buildApp() {
  // trustProxy : derrière l'hébergeur (Scalingo), l'adresse réelle du visiteur
  // arrive dans l'en-tête « X-Forwarded-For ». Sans cela, tout le monde
  // partagerait la même adresse et la limite de tentatives ci-dessous
  // bloquerait tous les utilisateurs d'un coup.
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

  // En-têtes de sécurité standard du navigateur (anti-« clickjacking »,
  // anti-reniflage de type, HSTS…) + une politique de sécurité du contenu (CSP)
  // taillée pour cette application : tout se charge depuis la même origine.
  //  - scriptSrc 'self' : les scripts ne viennent que de nous (aucun script en
  //    ligne dans la page — vérifié au build), ce qui coupe l'essentiel des
  //    injections (XSS) ;
  //  - styleSrc 'unsafe-inline' : React applique des styles en ligne (attribut
  //    style=…) — sans risque notable, contrairement aux scripts ;
  //  - imgSrc data:/blob: : aperçus d'images et affiches ; workerSrc : le
  //    service worker de la PWA ; connectSrc 'self' : l'API et la socket temps
  //    réel, toutes deux sur la même origine.
  // `upgrade-insecure-requests` n'est posé qu'en production (HTTPS) : en local
  // (http://localhost) il casserait le chargement des fichiers.
  const isProd = process.env.NODE_ENV === "production";
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        ...(isProd ? {} : { upgradeInsecureRequests: null }),
      },
    },
  });

  await app.register(cors, {
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });
  await app.register(authPlugin);

  // Verrou d'archivage définitif (« scellé ») : un dossier manuscrit scellé est en
  // LECTURE SEULE. Toute écriture sous /api/v1/manuscripts/:id/… est refusée (409),
  // quel que soit le rôle — SEULE la réouverture (…/unseal) reste permise (réservée
  // à l'administrateur). Les lectures (GET/HEAD) et téléchargements restent ouverts.
  app.addHook("preHandler", async (request, reply) => {
    const method = request.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const path = request.url.split("?")[0];
    const m = /^\/api\/v1\/manuscripts\/([0-9a-fA-F-]{36})(\/.*)?$/.exec(path);
    if (!m) return;
    const sub = m[2] ?? "";
    if (/\/unseal$/.test(sub)) return; // la réouverture par l'administrateur reste possible
    const ms = await prisma.manuscript.findUnique({ where: { id: m[1] }, select: { sealedAt: true } });
    if (ms?.sealedAt) {
      return reply.code(409).send({
        code: "manuscript_sealed",
        message: "Dossier scellé (archivé définitivement) : verrouillé en lecture seule. Un administrateur doit le rouvrir pour le modifier.",
      });
    }
  });

  // Les réponses de l'API portent des données vivantes : on interdit tout cache
  // (navigateur ET proxy intermédiaire). Sans cela, une lecture juste après une
  // saisie peut renvoyer l'ancienne valeur pendant 1 à 2 minutes (voire jusqu'à
  // une reconnexion) — l'opérateur croit alors que « ça n'a pas enregistré ».
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
    }
    return payload;
  });

  // Filet de sécurité global : toute erreur non rattrapée par une route est
  // convertie ici en message clair, en français — jamais de détail technique
  // (ex. « Unique constraint failed ») renvoyé au navigateur.
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    // Erreurs de validation (schéma Fastify) : requête mal formée.
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({ code: "validation_error", message: "Requête invalide." });
    }

    // Erreurs connues de la base de données, traduites sans jargon.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return reply.code(409).send({ code: "conflict", message: "Cette valeur est déjà utilisée." });
      }
      if (error.code === "P2025") {
        return reply.code(404).send({ code: "not_found", message: "Élément introuvable." });
      }
      return reply.code(409).send({ code: "data_conflict", message: "Opération impossible en l'état des données." });
    }

    // Erreurs déjà porteuses d'un code HTTP explicite (4xx) : on garde leur
    // message métier, il est destiné à l'utilisateur.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (error as { code?: string }).code ?? "error", message: (error as Error).message });
    }

    // Cas imprévu (bug) : message générique, aucun détail interne exposé.
    return reply.code(500).send({
      code: "internal_error",
      message: "Le serveur a rencontré un problème inattendu. Réessayez ; si cela persiste, contactez l'administrateur.",
    });
  });

  app.get("/api/v1/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(documentRoutes);
  await app.register(notificationRoutes);
  await app.register(pushRoutes);
  await app.register(manuscriptRoutes);
  await app.register(workflowRoutes);
  await app.register(readingCommitteeRoutes);
  await app.register(projectPlanRoutes);
  await app.register(userRoutes);
  await app.register(referenceRoutes);
  await app.register(aiEditorialRoutes);
  await app.register(aiEditorRoutes);
  await app.register(aiAssistantRoutes);
  await app.register(maintenanceRoutes);
  await app.register(contractRoutes);
  await app.register(partnerRoutes);
  await app.register(taskRoutes);
  await app.register(taskCommentRoutes);
  await app.register(comparatorRoutes);
  await app.register(productionRoutes);
  await app.register(isbnRoutes);
  await app.register(batRoutes);
  await app.register(printingRoutes);
  await app.register(stockRoutes);
  await app.register(stockVoucherRoutes);
  await app.register(authorCopyRoutes);
  await app.register(commercialRoutes);
  await app.register(catalogueRoutes);
  await app.register(marketingRoutes);
  await app.register(financeRoutes);
  await app.register(financeRequestRoutes);
  await app.register(editorialQuoteRoutes);
  await app.register(authorReceiptRoutes);
  await app.register(weeklyReportRoutes);
  await app.register(royaltiesRoutes);
  await app.register(hrRoutes);
  await app.register(directionRoutes);
  await app.register(pilotageRoutes);
  await app.register(reportsRoutes);
  await app.register(settingsRoutes);
  await app.register(auditRoutes);
  await app.register(dashboardRoutes);
  await app.register(editorialDashboardRoutes);
  await app.register(searchRoutes);
  await app.register(presenceRoutes);
  await app.register(attendanceRoutes);
  await app.register(erpConnectionsRoutes);
  await app.register(payrollRoutes);
  await app.register(primeRoutes);
  await app.register(announcementRoutes);
  await app.register(calendarRoutes);
  await app.register(newsfeedRoutes);
  await app.register(newsletterRoutes);
  await app.register(annualEventsRoutes);
  await app.register(chatRoutes);
  await app.register(authorRoutes);
  await app.register(serviceDeskRoutes);
  await app.register(billingOrderRoutes);

  // En production, le frontend compilé (frontend/dist) est copié dans backend/public
  // par le script de build racine (npm run build) : une seule application déployée,
  // pas de serveur ni d'hébergement séparé pour le frontend (docs/JOURNAL_TECHNIQUE.md).
  const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
  if (existsSync(frontendDir)) {
    await app.register(staticFiles, {
      root: frontendDir,
      // Sert directement les fichiers pré-compressés (.br/.gz) générés au build
      // quand le navigateur les accepte : téléchargement plus léger, sans coût
      // processeur à chaque requête (scripts/precompress.mjs).
      preCompressed: true,
      // On pilote nous-mêmes l'en-tête Cache-Control (voir setHeaders) : sans
      // cela, @fastify/static impose « max-age=0 » et annule notre réglage.
      cacheControl: false,
      setHeaders(res, filePath) {
        // Le chemin peut se terminer par .br/.gz (variante compressée) : on
        // raisonne sur le fichier d'origine.
        const original = filePath.replace(/\.(br|gz)$/, "");
        res.setHeader("Vary", "Accept-Encoding");
        if (original.endsWith(".html")) {
          // index.html référence les fichiers hachés : ne jamais le figer en
          // cache, sinon une nouvelle version ne serait pas prise en compte.
          res.setHeader("Cache-Control", "no-cache");
        } else if (original.includes(`${path.sep}assets${path.sep}`)) {
          // Fichiers au nom haché par Vite (leur contenu ne change jamais pour
          // un nom donné) : cache long et immuable → visites suivantes instantanées.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      reply.header("Cache-Control", "no-cache").type("text/html").send(readFileSync(path.join(frontendDir, "index.html")));
    });
  }

  return app;
}
