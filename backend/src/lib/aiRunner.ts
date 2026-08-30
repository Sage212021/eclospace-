import zlib from "node:zlib";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma.js";
import { storeFile } from "./storage.js";
import { writeAuditLog } from "./audit.js";
import { loadConfig, readApiKey, resolveModelId, MODEL_PRESETS, type WorkType } from "./aiConfig.js";

// Moteur de relecture assistée (Lot IA-1). Orchestration : préparer le manuscrit,
// appeler Claude AU NOM du relecteur d'Éclosion, générer le rapport .docx, le
// classer dans la GED et historiser le tout (AiReadingJob). L'IA ne décide rien.

// Tarifs API (USD / million de tokens) pour l'estimation de coût affichée.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-opus-5": { in: 5, out: 25 },
};

export class AiRunError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Texte d'un .docx : on dézippe word/document.xml et on retire le balisage.
function docxToText(buffer: Buffer): string {
  // Un .docx est un ZIP ; on lit l'entrée word/document.xml sans dépendance ZIP
  // en cherchant l'en-tête local — mais plus simple et robuste : on tente une
  // décompression des flux DEFLATE. Ici on s'appuie sur la présence du XML en
  // clair après inflation de chaque entrée.
  const text = extractDocxXml(buffer);
  if (!text) return "";
  const paras = text.split(/<\/w:p>/).map((p) => {
    const runs = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    return runs
      .join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8217;/g, "’").replace(/&#8230;/g, "…");
  });
  return paras.filter((l) => l.trim()).join("\n");
}

// Extraction de word/document.xml d'un ZIP .docx (entrées DEFLATE ou STORE).
function extractDocxXml(buffer: Buffer): string | null {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break; // signature d'entrée locale
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    if (name === "word/document.xml") {
      try {
        return method === 0 ? data.toString("utf8") : zlib.inflateRawSync(data).toString("utf8");
      } catch {
        return null;
      }
    }
    offset = dataStart + compSize;
  }
  return null;
}

type ManuscriptInput = { kind: "text"; text: string } | { kind: "pdf"; base64: string };

function prepareManuscript(mime: string, name: string, buffer: Buffer): ManuscriptInput {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    return { kind: "pdf", base64: buffer.toString("base64") };
  }
  if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) {
    return { kind: "text", text: docxToText(buffer) };
  }
  return { kind: "text", text: buffer.toString("utf8") };
}

async function domainesCollectionsText(): Promise<string> {
  const [genres, collections] = await Promise.all([
    prisma.genre.findMany({ where: { deletedAt: null }, orderBy: { label: "asc" } }),
    prisma.collection.findMany({ where: { deletedAt: null }, orderBy: { label: "asc" } }),
  ]);
  const g = genres.map((x) => `- ${x.label}`).join("\n") || "- (aucun)";
  const c = collections.map((x) => `- ${x.label}`).join("\n") || "- (aucune)";
  return `Domaines : \n${g}\nCollections : \n${c}`;
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
}

// Rendu .docx du rapport : chaque ligne devient un paragraphe ; « # » = titre.
async function renderReportDocx(reportTitle: string, body: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: "ÉCLOSION ÉDITION", heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: reportTitle, bold: true, size: 28 })] }),
    new Paragraph({ text: "" }),
  ];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { children.push(new Paragraph({ text: "" })); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      children.push(new Paragraph({ text: h[2], heading: h[1].length === 1 ? HeadingLevel.HEADING_1 : h[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 }));
    } else {
      children.push(new Paragraph({ text: line.replace(/^[*#]+\s*/, "") }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// Point d'entrée : exécute une relecture IA et retourne le job à jour.
export async function runAiReading(params: {
  manuscriptId: string;
  workType: WorkType;
  editorRecommendation?: string;
  stepCode?: string;
  userId: string;
  ip?: string;
}): Promise<{ jobId: string; documentId: string; costEstimate: number }> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new AiRunError("ai_disabled", "L'IA éditoriale est désactivée. Activez-la dans Paramètres.");
  const apiKey = readApiKey(cfg);
  if (!apiKey) throw new AiRunError("no_api_key", "Aucune clé API configurée.");

  const manuscript = await prisma.manuscript.findFirst({
    where: { id: params.manuscriptId, deletedAt: null },
    include: { genre: true, collection: true, workContributors: { include: { partner: true }, orderBy: { displayOrder: "asc" } } },
  });
  if (!manuscript) throw new AiRunError("not_found", "Manuscrit introuvable.");

  const prompt = await prisma.aiPrompt.findUnique({ where: { workType: params.workType } });
  if (!prompt) throw new AiRunError("no_prompt", "Aucun prompt configuré pour ce type de travail.");

  const modelId = resolveModelId(cfg.models[params.workType]);

  // Journal : on ouvre le job « en cours » avant l'appel (traçabilité même en cas d'échec).
  const job = await prisma.aiReadingJob.create({
    data: {
      manuscriptId: manuscript.id,
      workType: params.workType,
      stepCode: params.stepCode ?? null,
      promptKey: params.workType,
      promptVersion: prompt.version,
      model: modelId,
      editorRecommendation: params.editorRecommendation ?? null,
      status: "en_cours",
      launchedBy: params.userId,
    },
  });

  try {
    // Récupère le fichier manuscrit (dernière version déposée).
    const doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: manuscript.id, category: "manuscrit", deletedAt: null },
      select: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const version = doc?.versions[0];
    if (!version) throw new AiRunError("no_manuscript_file", "Aucun fichier manuscrit n'a été déposé pour cet ouvrage.");
    const { readStoredFile } = await import("./storage.js");
    const buffer = await readStoredFile(version.filePath);
    const prepared = prepareManuscript(version.mimeType, `f${version.versionNumber}`, buffer);

    const author = manuscript.workContributors.find((c) => c.role === "author")?.partner;
    const authorName = author ? `${author.firstName} ${author.lastName}`.trim() : "—";
    const domaine = [manuscript.genre?.label, manuscript.collection?.label].filter(Boolean).join(" / ") || "(non renseigné)";

    const userText = fillTemplate(prompt.userTemplate, {
      manuscrit: prepared.kind === "text" ? prepared.text : "(le manuscrit est joint en PDF ci-dessous)",
      domaines_collections: await domainesCollectionsText(),
      titre: manuscript.title,
      auteur: authorName,
      domaine,
      recommandation_editeur: params.editorRecommendation?.trim() || "(aucune)",
    });

    const content: Anthropic.MessageParam["content"] =
      prepared.kind === "pdf"
        ? [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: prepared.base64 } },
            { type: "text", text: userText },
          ]
        : userText;

    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: modelId,
      max_tokens: 8000,
      system: prompt.systemPrompt,
      messages: [{ role: "user", content }],
    });
    const reportText = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim()
      || "Le relecteur n'a produit aucun texte.";

    const price = PRICES[modelId] ?? PRICES["claude-haiku-4-5"];
    const usage = res.usage;
    const costUsd = (usage.input_tokens * price.in + usage.output_tokens * price.out) / 1_000_000;
    const costEstimate = Math.round(costUsd * 600 * 100) / 100; // ≈ FCFA (1 USD ≈ 600 XAF)

    const title = `${MODEL_PRESETS[cfg.models[params.workType]] ? "" : ""}Rapport — ${manuscript.title}`;
    const docxBuffer = await renderReportDocx(String((prompt.reportTemplate as { title?: string })?.title ?? "RAPPORT"), reportText);
    const stored = await storeFile(docxBuffer, `${params.workType}_${manuscript.manuscriptNumber}.docx`);

    const created = await prisma.document.create({
      data: {
        entityType: "manuscript",
        entityId: manuscript.id,
        category: "rapport_lecture",
        title,
        createdBy: params.userId,
        versions: {
          create: {
            versionNumber: 1,
            filePath: stored.filePath,
            fileSize: stored.fileSize,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sha256Hash: stored.sha256Hash,
            status: "draft",
            changeSummary: "Généré par le service de relecture Éclosion.",
            uploadedBy: params.userId,
          },
        },
      },
    });

    await prisma.aiReadingJob.update({
      where: { id: job.id },
      data: { status: "termine", finishedAt: new Date(), producedDocumentIds: [created.id], reportVersion: 1, costEstimate },
    });
    await writeAuditLog({
      userId: params.userId,
      action: "create",
      entityType: "ai_reading_job",
      entityId: job.id,
      newValues: { workType: params.workType, manuscriptId: manuscript.id, documentId: created.id, model: modelId, costEstimate },
      ipAddress: params.ip ?? null,
    });
    return { jobId: job.id, documentId: created.id, costEstimate };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de la relecture IA.";
    await prisma.aiReadingJob.update({ where: { id: job.id }, data: { status: "erreur", finishedAt: new Date(), errorMessage: message } });
    if (e instanceof AiRunError) throw e;
    throw new AiRunError("run_failed", message);
  }
}
