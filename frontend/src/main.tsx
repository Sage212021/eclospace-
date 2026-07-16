import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import "./styles/tokens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

// Enregistrement du service worker : rend Eclospace installable (« Ajouter à
// l'écran d'accueil ») avec le logo, et fournit une coquille de secours hors
// ligne. Au meilleur effort — un échec n'empêche jamais l'application de
// fonctionner. Ignoré en développement (Vite ne sert pas /sw.js de la même
// façon), actif une fois l'application déployée.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installation impossible : l'application reste pleinement utilisable */
    });
  });
}
