import { describe, expect, it } from "vitest";
import { supportsThinking, withThinking } from "../src/lib/aiThinking.js";

// Réflexion approfondie des lectures de fond (BAT1/BAT2/évaluation) : on ne
// l'active QUE sur les modèles qui la gèrent, et max_tokens doit alors rester
// strictement supérieur au budget de réflexion (règle API).
describe("réflexion approfondie (extended thinking)", () => {
  it("n'est activée que pour Sonnet et Opus", () => {
    expect(supportsThinking("claude-opus-5")).toBe(true);
    expect(supportsThinking("claude-sonnet-5")).toBe(true);
    expect(supportsThinking("claude-haiku-4-5")).toBe(false);
  });

  it("sur un modèle compatible : réflexion activée, max_tokens = réponse + budget (> budget)", () => {
    const x = withThinking("claude-opus-5", 8000, 4000);
    expect(x.thinking).toEqual({ type: "enabled", budget_tokens: 4000 });
    expect(x.max_tokens).toBe(12000);
    expect(x.max_tokens).toBeGreaterThan(x.thinking!.budget_tokens);
  });

  it("sur un modèle non compatible (léger) : aucune réflexion, max_tokens = réponse", () => {
    const x = withThinking("claude-haiku-4-5", 4000, 3000);
    expect(x.thinking).toBeUndefined();
    expect(x.max_tokens).toBe(4000);
  });
});
