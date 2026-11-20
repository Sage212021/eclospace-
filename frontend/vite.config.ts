import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "node:fs";
import path from "node:path";

// Identifiant de BUILD unique, calculé à chaque compilation. Il est injecté dans
// le code (constante `__BUILD_ID__`) ET écrit dans `dist/version.json`. Le code en
// cours d'exécution peut ainsi comparer sa version à celle réellement en ligne et
// proposer un rechargement quand une nouvelle version est déployée (voir
// src/lib/versionCheck.ts) — une PWA restée en mémoire ne se recharge jamais seule.
const BUILD_ID = String(Date.now());

// Écrit dist/version.json après la compilation (fichier minuscule, servi sans
// cache via une requête anti-cache côté client).
function writeVersionJson(): Plugin {
  return {
    name: "eclospace-write-version-json",
    apply: "build",
    closeBundle() {
      try {
        writeFileSync(path.resolve(__dirname, "dist/version.json"), JSON.stringify({ build: BUILD_ID }));
      } catch {
        /* non bloquant : le détecteur de version se contentera de ne rien signaler */
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), writeVersionJson()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Un SEUL regroupement volontaire : le socle React dans son propre
        // fichier. React change très rarement d'un déploiement à l'autre, donc
        // le navigateur le garde EN CACHE : après la première visite, chaque
        // mise en ligne ne re-télécharge que le code métier, pas le socle.
        //
        // On ne touche À RIEN d'autre : Vite continue de découper chaque écran
        // en fichier séparé, chargé à la demande, et la grosse librairie PDF
        // (jsPDF / pdf-lib) reste hors du chargement initial — elle n'arrive que
        // lorsqu'un poste ouvre une page qui produit un document. Regrouper les
        // autres dépendances « à la main » réintroduirait au contraire ces
        // librairies dans le démarrage (helper d'interop partagé) : à éviter.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
});
