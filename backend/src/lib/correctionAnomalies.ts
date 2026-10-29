// Anomalies de correction (Lot 3) : extraction structurée depuis le rapport IA
// et suivi de la validation humaine. Le rapport rédigé reste le livrable ; ces
// fiches en sont la version « actionnable » (accepter / modifier / rejeter / à
// vérifier), tracée ligne par ligne.

export const ANOMALY_STATUSES = ["a_traiter", "acceptee", "modifiee", "rejetee", "a_verifier"] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];
export const ANOMALY_STATUS_LABELS: Record<AnomalyStatus, string> = {
  a_traiter: "À traiter",
  acceptee: "Acceptée",
  modifiee: "Modifiée",
  rejetee: "Rejetée",
  a_verifier: "À vérifier",
};
export function isAnomalyStatus(v: string): v is AnomalyStatus {
  return (ANOMALY_STATUSES as readonly string[]).includes(v);
}

const SEVERITIES = ["C1", "C2", "C3", "S"] as const;
export interface ParsedAnomaly {
  severity: string;
  face: string | null;
  location: string | null;
  element: string | null;
  observation: string | null;
  proposal: string | null;
  justification: string | null;
}

function normSeverity(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  const first = s.split(/[^A-Z0-9]/)[0];
  return (SEVERITIES as readonly string[]).includes(first) ? first : "C3";
}
function normFace(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/(1|première|premiere|1re|1ère|1ere)/.test(s) && /couv/.test(s)) return "1ere";
  if (s === "1ere" || s === "1re") return "1ere";
  if (/dos|tranche/.test(s)) return "dos";
  if (/(4|quatrième|quatrieme|4e|4ème|4eme)/.test(s)) return "4eme";
  return null;
}
function str(v: unknown, max = 4000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// Récupère chaque objet JSON COMPLET { … } d'un texte, même si l'ensemble
// (tableau) est tronqué ou mal clôturé. Suit la profondeur d'accolades en
// respectant les chaînes et les échappements, et tente un JSON.parse par objet
// de premier niveau ; les objets incomplets (fin de texte) sont ignorés.
export function salvageObjects(text: string): unknown[] {
  const out: unknown[] = [];
  const starts: number[] = []; // pile des indices de « { » ouverts
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { starts.push(i); }
    else if (ch === "}") {
      const start = starts.pop();
      // Objet équilibré { … } (à n'importe quelle profondeur) → on tente de le
      // lire. Capte aussi les objets d'anomalie imbriqués dans { "anomalies": [ … ] }.
      if (start !== undefined) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* objet illisible : ignoré */ }
      }
    }
    if (out.length >= 1000) break;
  }
  return out;
}

// Extrait le tableau d'anomalies d'un texte JSON (éventuellement enrobé de
// ```json … ``` ou de prose). Robuste : renvoie [] si rien d'exploitable.
export function parseAnomaliesJson(raw: string): ParsedAnomaly[] {
  if (!raw) return [];
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  // Isole le premier tableau JSON, ou l'objet { "anomalies": [...] }.
  let arr: unknown = null;
  try {
    arr = JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try { arr = JSON.parse(text.slice(start, end + 1)); } catch { arr = null; }
    }
  }
  let list: unknown[] = [];
  if (Array.isArray(arr)) list = arr;
  else if (arr && typeof arr === "object" && Array.isArray((arr as { anomalies?: unknown[] }).anomalies)) list = (arr as { anomalies: unknown[] }).anomalies;
  // Repli anti-TRONCATURE : si le JSON global n'a pas pu être lu (sortie du
  // modèle coupée à la limite de tokens pour un rapport à beaucoup d'anomalies),
  // on récupère quand même chaque objet { … } COMPLET présent dans le texte.
  // Sans ce repli, une seule fiche manquante faisait perdre TOUTES les fiches.
  if (list.length === 0) list = salvageObjects(text);
  const out: ParsedAnomaly[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const element = str(o.element ?? o.texte_original ?? o.texte ?? o.original);
    const observation = str(o.observation ?? o.constat ?? o.probleme);
    const proposal = str(o.proposal ?? o.correction ?? o.correction_proposee ?? o.recommandation);
    // On ignore une entrée totalement vide (bruit).
    if (!element && !observation && !proposal) continue;
    out.push({
      severity: normSeverity(o.severity ?? o.severite ?? o.gravite),
      face: normFace(o.face ?? o.zone),
      location: str(o.location ?? o.emplacement ?? o.page, 200),
      element,
      observation,
      proposal,
      justification: str(o.justification ?? o.explication),
    });
    if (out.length >= 400) break; // borne de sécurité
  }
  return out;
}

export const ANOMALY_EXTRACTION_SYSTEM =
  "Tu es un extracteur. On te donne un RAPPORT de correction éditoriale déjà rédigé. Tu renvoies UNIQUEMENT un JSON valide, sans aucun texte autour, de la forme {\"anomalies\":[{\"severity\":\"C1|C2|C3|S\",\"face\":\"1ere|dos|4eme|null\",\"location\":\"page/emplacement\",\"element\":\"texte original cité\",\"observation\":\"constat\",\"proposal\":\"correction proposée\",\"justification\":\"pourquoi\"}]}. Tu N'INVENTES RIEN : tu ne reprends que les anomalies réellement présentes dans le rapport. « face » n'est renseigné que pour une couverture (sinon null). Si le rapport ne contient aucune anomalie exploitable, renvoie {\"anomalies\":[]}.";

export function anomalyExtractionUser(reportText: string): string {
  // Portion large : un rapport de correction texte (tableau d'annotations
  // détaillé, citations) peut être long ; on évite de couper le tableau.
  return `RAPPORT À CONVERTIR EN LISTE D'ANOMALIES (JSON strict) :\n\n${reportText.slice(0, 120000)}`;
}
