import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import documentRoutes from "./routes/documents.js";
import notificationRoutes from "./routes/notifications.js";
import manuscriptRoutes from "./routes/manuscripts.js";
import workflowRoutes from "./routes/workflow.js";
import readingCommitteeRoutes from "./routes/readingCommittee.js";
import userRoutes from "./routes/users.js";
import referenceRoutes from "./routes/reference.js";
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
import commercialRoutes from "./routes/commercial.js";
import financeRoutes from "./routes/finance.js";
import editorialQuoteRoutes from "./routes/editorialQuotes.js";
import weeklyReportRoutes from "./routes/weeklyReports.js";
import royaltiesRoutes from "./routes/royalties.js";
import hrRoutes from "./routes/hr.js";
import directionRoutes from "./routes/direction.js";
import pilotageRoutes from "./routes/pilotage.js";
import reportsRoutes from "./routes/reports.js";
import settingsRoutes from "./routes/settings.js";
import auditRoutes from "./routes/audit.js";
import dashboardRoutes from "./routes/dashboard.js";
import searchRoutes from "./routes/search.js";
import presenceRoutes from "./routes/presence.js";
import attendanceRoutes from "./routes/attendance.js";
import payrollRoutes from "./routes/payroll.js";

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  await app.register(cors, {
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });
  await app.register(authPlugin);

  app.get("/api/v1/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(documentRoutes);
  await app.register(notificationRoutes);
  await app.register(manuscriptRoutes);
  await app.register(workflowRoutes);
  await app.register(readingCommitteeRoutes);
  await app.register(userRoutes);
  await app.register(referenceRoutes);
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
  await app.register(commercialRoutes);
  await app.register(financeRoutes);
  await app.register(editorialQuoteRoutes);
  await app.register(weeklyReportRoutes);
  await app.register(royaltiesRoutes);
  await app.register(hrRoutes);
  await app.register(directionRoutes);
  await app.register(pilotageRoutes);
  await app.register(reportsRoutes);
  await app.register(settingsRoutes);
  await app.register(auditRoutes);
  await app.register(dashboardRoutes);
  await app.register(searchRoutes);
  await app.register(presenceRoutes);
  await app.register(attendanceRoutes);
  await app.register(payrollRoutes);

  // En production, le frontend compilé (frontend/dist) est copié dans backend/public
  // par le script de build racine (npm run build) : une seule application déployée,
  // pas de serveur ni d'hébergement séparé pour le frontend (docs/JOURNAL_TECHNIQUE.md).
  const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
  if (existsSync(frontendDir)) {
    await app.register(staticFiles, { root: frontendDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      reply.type("text/html").send(readFileSync(path.join(frontendDir, "index.html")));
    });
  }

  return app;
}
