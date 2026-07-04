import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
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

  return app;
}
