// Réflexion approfondie (« extended thinking ») pour les LECTURES de fond.
//
// C'est le réglage qui rapproche la relecture automatique de la profondeur
// observée en conversation : avant de répondre, le modèle raisonne longuement
// (blocs « thinking »), puis rend sa réponse. On l'active UNIQUEMENT :
//   • sur les appels de LECTURE/ANALYSE (balayage d'anomalies, rédaction du
//     rapport d'évaluation) — là où le raisonnement compte ;
//   • sur les modèles qui la gèrent réellement (Sonnet, Opus). Sur un modèle
//     qui ne la gère pas (ex. « léger »), on n'active rien → aucun risque d'erreur.
//
// On ne l'active JAMAIS sur un appel qui PRÉFIXE la réponse de l'assistant
// (continuations du rapport : incompatible avec la réflexion), ni sur
// l'extraction JSON des anomalies, ni sur la réécriture par tranches (coût/temps).

export function supportsThinking(modelId: string): boolean {
  return /opus|sonnet/i.test(modelId);
}

export interface ThinkingExtras {
  thinking?: { type: "enabled"; budget_tokens: number };
  max_tokens: number;
}

// Paramètres à fusionner dans `messages.create`. Si le modèle gère la réflexion,
// on l'active avec `budget` jetons de raisonnement et on élargit `max_tokens`
// (il DOIT être > budget) pour garder `answerTokens` jetons à la réponse visible.
// Sinon, on renvoie simplement `max_tokens: answerTokens` sans réflexion.
export function withThinking(modelId: string, answerTokens: number, budget: number): ThinkingExtras {
  if (!supportsThinking(modelId)) return { max_tokens: answerTokens };
  return { thinking: { type: "enabled", budget_tokens: budget }, max_tokens: answerTokens + budget };
}
