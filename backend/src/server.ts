import { buildApp } from "./app.js";
import { attachPresence } from "./lib/presence.js";

const port = Number(process.env.PORT ?? 3000);

buildApp()
  .then(async (app) => {
    await app.listen({ port, host: "0.0.0.0" });
    // Socket.IO s'attache au serveur HTTP de Fastify (même port), une fois
    // l'écoute démarrée — présence temps réel (Ch. 5).
    attachPresence(app.server);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
