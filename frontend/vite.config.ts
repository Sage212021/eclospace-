import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
