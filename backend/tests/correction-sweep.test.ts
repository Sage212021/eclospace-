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

  it("un incident sur un segment n'interrompt pas le balayage (couverture partielle signalée)", async () => {
    const calls: string[] = [];
    let n = 0;
    const flaky = {
      messages: { create: async () => { n += 1; if (n === 2) throw new Error("boom"); calls.push("ok"); return { content: [{ type: "text", text: "RAS" }], usage: { input_tokens: 1, output_tokens: 1 } }; } },
    } as never;
    const res = await runAnomalySweep({ client: flaky, model: "m", segments: ["a", "b", "c"], passLabel: "BAT1", methodBlock: "M" });
    expect(res.totalSegments).toBe(3);
    expect(res.coveredSegments).toBe(2); // le segment en échec est compté comme non couvert
    expect(res.releve).toContain("Segment non analysé");
  });
});
