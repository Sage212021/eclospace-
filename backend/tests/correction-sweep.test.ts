import { describe, expect, it } from "vitest";
import { segmentText, segmentForReview, runAnomalySweep, SEGMENT_CHARS } from "../src/lib/correctionSweep.js";

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

  it("segmentText coupe sur des frontières PROPRES (jamais au milieu d'un mot)", () => {
    // Un seul « gros » paragraphe fait de mots séparés par des espaces : l'ancien
    // découpage le tranchait tous les maxChars (en plein mot). Le nouveau coupe
    // sur les espaces → aucun segment ne se termine par un mot coupé.
    const text = Array.from({ length: 400 }, (_, i) => `mot${i}`).join(" ") + ".";
    const segs = segmentText(text, 500);
    expect(segs.length).toBeGreaterThan(1);
    const rejoined = segs.join(" ").replace(/\s+/g, " ").trim();
    expect(rejoined).toBe(text.replace(/\s+/g, " ").trim()); // tout le texte conservé
    for (const s of segs) {
      // Chaque segment commence et finit sur un mot entier (pas de « mo » / « t12 »).
      expect(s.trim()).toMatch(/^mot\d/);
      expect(s.trim()).toMatch(/(mot\d+|\.)$/);
    }
  });
});

describe("Découpage conscient des chapitres (correctif BAT2)", () => {
  it("ne fait JAMAIS chevaucher deux chapitres et étiquette le chapitre réel", () => {
    const text = [
      "Chapitre 11",
      "La plupart des tensions familiales se dénouèrent ce soir-là.",
      "Il referma la porte doucement.",
      "",
      "Chapitre 12",
      "Le lendemain, tout avait changé.",
    ].join("\n");
    const segs = segmentForReview(text, SEGMENT_CHARS);
    const ch11 = segs.find((s) => s.text.includes("tensions familiales"));
    const ch12 = segs.find((s) => s.text.includes("tout avait changé"));
    // La phrase du chapitre 11 est bien étiquetée chapitre 11 (pas 12).
    expect(ch11?.chapter).toBe("Chapitre 11");
    expect(ch12?.chapter).toBe("Chapitre 12");
    // Aucun segment ne contient à la fois du chapitre 11 et du chapitre 12.
    for (const s of segs) {
      expect(s.text.includes("tensions familiales") && s.text.includes("tout avait changé")).toBe(false);
    }
  });

  it("un chapitre volumineux est découpé en portions PROPRES, étiquetées et marquées « continues »", () => {
    const body = Array.from({ length: 300 }, (_, i) => `Phrase numéro ${i} du chapitre.`).join(" ");
    const text = `Chapitre 4\n${body}`;
    const segs = segmentForReview(text, 800);
    expect(segs.length).toBeGreaterThan(1);
    // Toutes les portions appartiennent au même chapitre, étiquetées « partie k/m ».
    for (const s of segs) expect(s.chapter).toBe("Chapitre 4");
    expect(segs[0].label).toMatch(/Chapitre 4 \(partie 1\/\d+\)/);
    // Toutes sauf la dernière signalent que le chapitre se poursuit.
    expect(segs.slice(0, -1).every((s) => s.continues)).toBe(true);
    expect(segs[segs.length - 1].continues).toBe(false);
    // Couverture complète, sans mot coupé (tout recollé = texte d'origine, aux espaces près).
    const rejoined = segs.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    expect(rejoined).toBe(text.replace(/\s+/g, " ").trim());
  });

  it("runAnomalySweep lit TOUS les segments (couverture N/N) et consolide le relevé", async () => {
    const calls: string[] = [];
    const segments = [
      { label: "Chapitre 1", chapter: "Chapitre 1", text: "Segment un.", continues: false },
      { label: "Chapitre 2 (partie 1/2)", chapter: "Chapitre 2", text: "Segment deux.", continues: true },
      { label: "Chapitre 2 (partie 2/2)", chapter: "Chapitre 2", text: "Segment trois.", continues: false },
    ];
    const res = await runAnomalySweep({ client: fakeClient(calls), model: "m", segments, passLabel: "BAT2 (test)", methodBlock: "MÉTHODE" });
    expect(res.totalSegments).toBe(3);
    expect(res.coveredSegments).toBe(3); // tous les segments analysés
    expect(calls.length).toBe(3); // un appel par segment (lecture intégrale, pas d'échantillon)
    // Le relevé référence chaque segment dans l'ordre, étiqueté par son chapitre réel.
    expect(res.releve).toContain("SEGMENT 1/3");
    expect(res.releve).toContain("SEGMENT 3/3");
    expect(res.releve).toContain("Chapitre 1");
    expect(res.releve).toContain("Chapitre 2 (partie 2/2)");
    // La portion non finale prévient le relecteur que le chapitre se poursuit
    // (fin des fausses « phrases inachevées »).
    expect(calls[1]).toContain("coupe technique");
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
    const segs = [
      { label: "Chapitre 1", chapter: "Chapitre 1", text: "Alpha.", continues: false },
      { label: "Chapitre 2", chapter: "Chapitre 2", text: "Bravo.", continues: false },
      { label: "Chapitre 3", chapter: "Chapitre 3", text: "Charlie.", continues: false },
    ];
    const res = await runAnomalySweep({ client: transient, model: "m", segments: segs, passLabel: "BAT1", methodBlock: "M" });
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
    const segs = [
      { label: "Chapitre 1", chapter: "Chapitre 1", text: "Alpha.", continues: false },
      { label: "Chapitre 2", chapter: "Chapitre 2", text: "Bravo.", continues: false },
      { label: "Chapitre 3", chapter: "Chapitre 3", text: "Charlie.", continues: false },
    ];
    const res = await runAnomalySweep({ client: stubborn, model: "m", segments: segs, passLabel: "BAT1", methodBlock: "M" });
    expect(res.totalSegments).toBe(3);
    expect(res.coveredSegments).toBe(2); // « Bravo » jamais couvert
    // AUCUNE formulation technique ne doit figurer dans le relevé éditorial.
    expect(res.releve).not.toMatch(/non analysé|incident technique|limitation/i);
  });
});
