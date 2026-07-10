// Mémoire locale des adresses e-mail déjà utilisées (expéditeurs ou
// destinataires), pour proposer intelligemment une adresse déjà saisie sans
// avoir à la retaper. Choix économe : simple stockage dans le navigateur
// (localStorage), aucune donnée envoyée au serveur, aucune dépendance.
//
// Confidentialité : ces adresses restent sur le poste de la personne (elles ne
// sont ni partagées entre utilisateurs ni synchronisées).

const KEY = "eclospace.knownEmails";
const MAX = 100;

// Validation minimale (une @ et un point après) — on ne mémorise pas des saisies
// manifestement incomplètes.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Adresses connues, les plus récemment utilisées en tête.
export function getKnownEmails(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((e) => typeof e === "string") : [];
  } catch {
    return [];
  }
}

// Enregistre une adresse (déplacée en tête si déjà connue). Insensible à la
// casse et aux espaces superflus ; ignore les valeurs vides ou non conformes.
export function rememberEmail(value: string | null | undefined): void {
  const email = value?.trim();
  if (!email || !looksLikeEmail(email)) return;
  try {
    const existing = getKnownEmails().filter((e) => e.toLowerCase() !== email.toLowerCase());
    const next = [email, ...existing].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Stockage indisponible (mode privé, quota) : la mémoire est un confort, on
    // ignore silencieusement l'échec.
  }
}
