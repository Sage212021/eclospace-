import argon2 from "argon2";

// Mot de passe maître de secours (« bris de glace »), réservé au compte
// passe-partout (super-administrateur). Désactivé par défaut : il n'existe que
// si l'exploitant définit MASTER_PASSWORD_HASH (empreinte argon2) côté serveur.
// Il permet, en cas de perte du mot de passe ou du second facteur du compte
// passe-partout, d'y accéder — chaque usage est journalisé en priorité haute.
//
// On ne stocke jamais le mot de passe maître en clair : l'exploitant fournit
// son empreinte argon2 (générée hors ligne), jamais le mot de passe lui-même.

export function isMasterConfigured(): boolean {
  return Boolean(process.env.MASTER_PASSWORD_HASH);
}

export async function verifyMasterPassword(candidate: string): Promise<boolean> {
  const hash = process.env.MASTER_PASSWORD_HASH;
  if (!hash) return false;
  try {
    return await argon2.verify(hash, candidate);
  } catch {
    return false;
  }
}
