import { buildApp } from "./app.js";
import { attachPresence } from "./lib/presence.js";
import { runSubscriptionWatch } from "./lib/digitalServicesWatch.js";
import { runEditorialDeadlineWatch } from "./lib/editorialDeadlineWatch.js";
import { syncAutoUsage } from "./lib/digitalServicesUsageSync.js";

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
    const tick = () => {
      // 1) Rafraîchir la consommation lue automatiquement (API Anthropic) si une
      //    clé est configurée, PUIS 2) vérifier les échéances et seuils. Les deux
      //    sont best-effort : une panne ne doit jamais faire tomber le serveur.
      void syncAutoUsage()
        .catch((e) => console.error("[usage-sync] erreur:", e))
        .finally(() => {
          void runSubscriptionWatch().catch((e) => console.error("[subscription-watch] erreur:", e));
          // Surveillance proactive des échéances éditoriales (SAGE) : alerte le
          // DG et le responsable des tâches dont l'échéance approche/est dépassée.
          void runEditorialDeadlineWatch().catch((e) => console.error("[editorial-deadline-watch] erreur:", e));
        });
    };
    tick();
    setInterval(tick, WATCH_INTERVAL_MS).unref();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
