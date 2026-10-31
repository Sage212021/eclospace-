import { buildApp } from "./app.js";
import { attachPresence } from "./lib/presence.js";
import { runSubscriptionWatch } from "./lib/digitalServicesWatch.js";

const port = Number(process.env.PORT ?? 3000);

buildApp()
  .then(async (app) => {
    await app.listen({ port, host: "0.0.0.0" });
    // Socket.IO s'attache au serveur HTTP de Fastify (même port), une fois
    // l'écoute démarrée — présence temps réel (Ch. 5).
    attachPresence(app.server);

    // Veille AUTOMATIQUE des abonnements numériques, INDÉPENDANTE de toute
    // connexion : au démarrage puis toutes les 12 h. L'anti-doublon évite les
    // alertes répétées ; une panne ne doit jamais faire tomber le serveur.
    const WATCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
    const tick = () => { void runSubscriptionWatch().catch((e) => console.error("[subscription-watch] erreur:", e)); };
    tick();
    setInterval(tick, WATCH_INTERVAL_MS).unref();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
