// Garde-fou « mauvais fichier » : compare le nom d'un fichier déposé au titre de
// l'ouvrage. Best-effort (deux livres peuvent partager un thème comme
// « retraite ») : on n'alerte que si MOINS DE LA MOITIÉ des mots significatifs du
// titre se retrouvent dans le nom du fichier. Sert à attraper un fichier déposé
// sur le mauvais ouvrage, sans gêner les dépôts légitimes.

const STOP = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "d", "l", "et", "a", "au", "aux", "en", "the", "of",
  // bruits de noms de fichiers
  "pdf", "docx", "doc", "odt", "book", "cover", "gd", "final", "finale", "vcf", "bat", "bat1", "bat2",
  "couverture", "manuscrit", "version", "corrige", "corrigee", "corrigée", "copy", "copie", "def", "vf",
]);

function sigWords(s: string): Set<string> {
  const norm = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(norm.split(" ").filter((w) => w.length >= 3 && !STOP.has(w)));
}

// true = le nom du fichier ne semble PAS correspondre à l'ouvrage (→ alerter).
export function filenameLooksMismatched(title: string | null | undefined, filename: string): boolean {
  if (!title) return false;
  const tw = sigWords(title);
  const fw = sigWords(filename.replace(/\.[a-z0-9]+$/i, ""));
  if (tw.size === 0 || fw.size === 0) return false; // pas assez d'info → on n'alerte pas
  let common = 0;
  for (const w of fw) if (tw.has(w)) common += 1;
  return common / tw.size < 0.5;
}

// Confirmation à présenter avant un dépôt suspect. Retourne true si l'on peut
// poursuivre (fichier correspond, ou l'opérateur confirme quand même).
export function confirmFileBelongs(title: string | null | undefined, filename: string): boolean {
  if (!filenameLooksMismatched(title, filename)) return true;
  return window.confirm(
    `⚠ Le fichier « ${filename} » ne semble pas correspondre à l'ouvrage « ${title} ».\n\n` +
      `Vérifiez que vous ne vous êtes pas trompé de fichier. Déposer quand même ?`,
  );
}
