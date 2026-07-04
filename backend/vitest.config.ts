import { defineConfig } from "vitest/config";

// Les tests partagent une base Postgres unique (eclospace_test). La plupart
// des fixtures utilisent des identifiants uniques par test, mais le Lot 5
// introduit un état global véritablement partagé : la période comptable du
// mois courant (accounting_periods, Ch. 18 §18.11). Un test qui la clôture
// pour vérifier le blocage des écritures entrerait en concurrence avec tout
// autre fichier de test créant une facture au même instant si les fichiers
// s'exécutaient en parallèle — d'où l'exécution séquentielle des fichiers.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
