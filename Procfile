web: node backend/dist/server.js
# postdeploy : les MIGRATIONS de schéma restent STRICTES (si elles échouent, le
# déploiement échoue — le schéma doit être juste). Le SEED (données de référence
# + diffusion des notes de version) est rendu NON BLOQUANT : s'il échoue ou
# dépasse le temps/mémoire du hook en production, le déploiement est tout de même
# conservé et la nouvelle version passe en ligne (le seed, idempotent, peut être
# relancé à la main : `scalingo run npm --prefix backend run seed:deploy`).
postdeploy: npm --prefix backend run prisma:deploy && { npm --prefix backend run seed:deploy || echo "[postdeploy] Seed en echec — deploiement conserve ; relancer seed:deploy manuellement si besoin."; }
