// Règles de complexité du mot de passe (Ch. 2, sécurité du compte) :
// au moins 8 caractères, une majuscule et un chiffre. Renvoie un message
// d'erreur explicite (guide de style §4.7) ou null si le mot de passe convient.
export function validatePasswordComplexity(password: string): string | null {
  if (password.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (!/[A-Z]/.test(password)) return "Le mot de passe doit contenir au moins une majuscule.";
  if (!/[0-9]/.test(password)) return "Le mot de passe doit contenir au moins un chiffre.";
  return null;
}
