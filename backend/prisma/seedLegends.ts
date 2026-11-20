// Petit script DÉDIÉ à l'installation des légendes du catalogue, exécuté
// SÉPARÉMENT au déploiement (voir Procfile). But : garantir que les légendes
// (synopsis FR/EN, collection, genre, pages, ISBN, auteur de couverture, prix)
// s'installent même quand le seed complet échoue ou dépasse le temps/mémoire du
// hook postdeploy en production — le bloc légendes se trouvant tout à la fin du
// seed, il ne s'exécutait jamais là-bas. Rapide et idempotent : il ne touche
// qu'aux ouvrages visés par les légendes déjà transmises.
import { PrismaClient } from "@prisma/client";
import { applyCatalogueLegends } from "./catalogueLegends.js";

const prisma = new PrismaClient();

applyCatalogueLegends(prisma)
  .then(({ legends, records }) => {
    console.log(`Légendes catalogue (script dédié) : ${legends} ouvrage(s) (${records} fiche(s) rattachée(s)).`);
  })
  .catch((e) => {
    console.error("Installation des légendes catalogue en échec :", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
