import sanitizeHtml from "sanitize-html";

// Assainissement du contenu enrichi des annonces (Babillard) — protection
// contre l'injection de scripts (XSS stocké). Le contenu est saisi par des
// profils habilités mais AFFICHÉ à tout le personnel : on ne fait jamais
// confiance au HTML reçu, on ne conserve qu'une liste blanche de balises de
// mise en forme (paragraphes, listes, tableaux, liens, images, titres).
//
// Choix volontairement conservateurs :
//  - aucun <script>, <style>, <iframe>, gestionnaire d'événement (onclick…) ;
//  - liens et images limités aux schémas http/https (+ mailto pour les liens) ;
//  - tout lien externe reçoit rel="noopener noreferrer nofollow".
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "strong", "b", "em", "i", "u", "s", "sub", "sup", "mark",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "a", "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "span", "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    "*": [],
  },
  // Schémas autorisés : pas de javascript:, pas de data: exécutable.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  transformTags: {
    // Sécurise l'ouverture des liens dans un nouvel onglet (protection
    // contre le détournement de fenêtre) et neutralise le tabnabbing.
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
  },
};

export function sanitizeAnnouncementHtml(html: string): string {
  return sanitizeHtml(html ?? "", OPTIONS).trim();
}

// Aperçu texte court (pour les notifications, la cloche, la bannière) : on
// retire toutes les balises puis on tronque proprement.
export function announcementPreview(html: string, maxLength = 160): string {
  const text = sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + "…";
}
