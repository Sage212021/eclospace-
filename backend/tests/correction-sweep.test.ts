import { describe, expect, it } from "vitest";
import { segmentText, runAnomalySweep, SEGMENT_CHARS } from "../src/lib/correctionSweep.js";

// Faux client Anthropic : enregistre chaque appel et renvoie un texte fixe.
function fakeClient(calls: string[]) {
  return {
    messages: {
      create: async (args: { messages?: { content?: unknown }[] }) => {
        const c = args.messages?.[0]?.content;
        calls.push(typeof c === "string" ? c : JSON.stringify(c));
        return { content: [{ type: "text", text: "- [Orthographe · C2] « erreur » → correction" }], usage: { input_tokens: 10, output_tokens: 5 } };
      },
    },
  } as never;
}

describe("Lecture intégrale par segments (renforcement BAT1/BAT2)", () => {
  it("segmentText conserve tout le texte dans l'ordre et borne la taille", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraphe ${i} ` + "x".repeat(5000)).join("\n\n");
    const segs = segmentText(text, 12000);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(12000 + 100);
    // Chaque paragraphe se retrouve quelque part (couverture complète).
    for (let i = 0; i < 20; i++) expect(segs.some((s) => s.includes(`Paragraphe ${i} `))).toBe(true);
  });

  it("un texte court tient en un seul segment", () => {
    expect(segmentText("Court.", SEGMENT_CHARS)).toEqual(["Court."]);
    expect(segmentText("   ", SEGMENT_CHARS)).toEqual([]);
  });

  it("runAnomalySweep lit TOUS les segments (couverture N/N) et consolide le relevé", async () => {
    const calls: string[] = [];
    const segments = ["Segment un.", "Segment deux.", "Segment trois."];
    const res = await runAnomalySweep({ client: fakeClient(calls), model: "m", segments, passLabel: "BAT2 (test)", methodBlock: "MÉTHODE" });
    expect(res.totalSegments).toBe(3);
    expect(res.coveredSegments).toBe(3); // tous les segments analysés
    expect(calls.length).toBe(3); // un appel par segment (lecture intégrale, pas d'échantillon)
    // Le relevé référence chaque segment dans l'ordre.
    expect(res.releve).toContain("SEGMENT 1/3");
    expect(res.releve).toContain("SEGMENT 3/3");
    expect(res.inputTokens).toBe(30);
    expect(res.outputTokens).toBe(15);
  });

  it("un incident PASSAGER sur un segment est rattrapé par une 2ᵉ tentative (couverture intégrale)", async () => {
    let bravo = 0;
    const transient = {
      messages: { create: async (args: { messages?: { content?: unknown }[] }) => {
        const c = String(args.messages?.[0]?.content ?? "");
        if (c.includes("Bravo")) { bravo += 1; if (bravo === 1) throw new Error("boom"); }
        return { content: [{ type: "text", text: "RAS" }], usage: { input_tokens: 1, output_tokens: 1 } };
      } },
    } as never;
    const res = await runAnomalySweep({ client: transient, model: "m", segments: ["Alpha.", "Bravo.", "Charlie."], passLabel: "BAT1", methodBlock: "M" });
    expect(res.coveredSegments).toBe(3); // le segment est rattrapé → couverture 3/3
  });

  it("un échec PERSISTANT laisse le segment non couvert SANS injecter de mention technique dans le relevé", async () => {
    const stubborn = {
      messages: { create: async (args: { messages?: { content?: unknown }[] }) => {
        const c = String(args.messages?.[0]?.content ?? "");
        if (c.includes("Bravo")) throw new Error("boom"); // échoue aux 2 tentatives
        return { content: [{ type: "text", text: "RAS" }], usage: { input_tokens: 1, output_tokens: 1 } };
      } },
    } as never;
    const res = await runAnomalySweep({ client: stubborn, model: "m", segments: ["Alpha.", "Bravo.", "Charlie."], passLabel: "BAT1", methodBlock: "M" });
    expect(res.totalSegments).toBe(3);
    expect(res.coveredSegments).toBe(2); // « Bravo » jamais couvert
    // AUCUNE formulation technique ne doit figurer dans le relevé éditorial.
    expect(res.releve).not.toMatch(/non analysé|incident technique|limitation/i);
  });
});
