import { prisma } from "./prisma.js";
import { encryptSecret, decryptSecret } from "./aiCrypto.js";

// Configuration de l'IA éditoriale (Lot IA-0), stockée dans la table settings
// sous une clé unique. La clé API Claude y est chiffrée (jamais en clair).

export const AI_CONFIG_KEY = "ai_editorial_config";

// Préréglages de modèle proposés à l'opérateur (il choisit un niveau, pas un
// identifiant technique). Le mappage vers l'identifiant réel vit ici, côté
// serveur, et pourra évoluer sans toucher à l'interface.
export const MODEL_PRESETS = {
  leger: { id: "claude-haiku-4-5", label: "Léger (rapide, économique)" },
  intermediaire: { id: "claude-sonnet-5", label: "Intermédiaire (équilibré)" },
  premium: { id: "claude-opus-5", label: "Haut de gamme (analyse fine)" },
} as const;

export type ModelPreset = keyof typeof MODEL_PRESETS;
export const WORK_TYPES = ["evaluation", "correction_1", "correction_2", "couverture"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const CONFIDENTIALITY_LEVELS = ["public", "interne", "restreint"] as const;

export interface AiEditorialConfig {
  enabled: boolean;
  accountLabel: string;
  models: Record<WorkType, ModelPreset>;
  allowedConfidentiality: string[];
  apiKeyCiphertext: string | null;
  apiKeyLast4: string | null;
}

function defaultConfig(): AiEditorialConfig {
  return {
    enabled: false,
    accountLabel: "",
    models: { evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger" },
    allowedConfidentiality: ["public", "interne", "restreint"],
    apiKeyCiphertext: null,
    apiKeyLast4: null,
  };
}

export async function loadConfig(): Promise<AiEditorialConfig> {
  const row = await prisma.setting.findUnique({ where: { key: AI_CONFIG_KEY } });
  if (!row) return defaultConfig();
  return { ...defaultConfig(), ...(row.value as object) } as AiEditorialConfig;
}

// Vue « publique » : jamais la clé en clair, seulement ses 4 derniers caractères
// et le fait qu'une clé est configurée ou non.
export function publicView(cfg: AiEditorialConfig) {
  return {
    enabled: cfg.enabled,
    accountLabel: cfg.accountLabel,
    models: cfg.models,
    allowedConfidentiality: cfg.allowedConfidentiality,
    apiKeyConfigured: Boolean(cfg.apiKeyCiphertext),
    apiKeyLast4: cfg.apiKeyLast4,
    modelPresets: MODEL_PRESETS,
  };
}

export async function saveConfig(cfg: AiEditorialConfig, userId?: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: AI_CONFIG_KEY },
    update: { value: cfg as object, updatedBy: userId ?? null },
    create: { key: AI_CONFIG_KEY, value: cfg as object, updatedBy: userId ?? null },
  });
}

// Applique une nouvelle clé API : chiffre, garde les 4 derniers caractères pour
// l'affichage masqué. Une chaîne vide efface la clé.
export function applyApiKey(cfg: AiEditorialConfig, apiKey: string): AiEditorialConfig {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ...cfg, apiKeyCiphertext: null, apiKeyLast4: null };
  return { ...cfg, apiKeyCiphertext: encryptSecret(trimmed), apiKeyLast4: trimmed.slice(-4) };
}

// Récupère la clé en clair pour un appel API (usage serveur uniquement).
export function readApiKey(cfg: AiEditorialConfig): string | null {
  if (!cfg.apiKeyCiphertext) return null;
  return decryptSecret(cfg.apiKeyCiphertext);
}

export function resolveModelId(preset: ModelPreset): string {
  return MODEL_PRESETS[preset]?.id ?? MODEL_PRESETS.leger.id;
}
