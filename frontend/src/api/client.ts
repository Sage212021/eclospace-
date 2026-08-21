// En production, le frontend compilé est servi par le backend sur la MÊME
// origine : on utilise donc des URL relatives ("") pour que les appels partent
// vers le bon hôte quel que soit le domaine de déploiement (Scalingo…).
// En développement, le frontend (Vite, port 5173) doit viser le backend sur le
// port 3000. VITE_API_BASE reste surchargeable si besoin.
// Auparavant, le repli sur "http://localhost:3000" en production faisait échouer
// silencieusement la connexion (requête bloquée pour contenu mixte sur une page
// HTTPS) — le bouton « Se connecter » semblait alors ne rien faire.
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

export interface EffectiveUser {
  id: string;
  username: string;
  email: string;
  mfa_enabled: boolean;
  language?: "fr" | "en";
  account_type?: "internal" | "external";
  roles: string[];
  permissions: string[];
  impersonating?: boolean;
  impersonator?: { id: string; username: string } | null;
}

interface ApiError {
  code: string;
  message: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    // Toujours interroger le réseau (jamais le cache HTTP du navigateur/proxy) :
    // sinon une lecture juste après une saisie peut renvoyer l'ancienne donnée
    // — d'où l'impression que « ça met 1–2 min à s'actualiser » voire qu'il faut
    // se reconnecter. Les données de l'ERP doivent toujours être fraîches.
    cache: "no-store",
    // Ne déclarer le type JSON que s'il y a un corps : sinon Fastify rejette une
    // requête POST sans corps (FST_ERR_CTP_EMPTY_JSON_BODY).
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(error?.message ?? `Erreur ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchMe(): Promise<EffectiveUser> {
  return request<EffectiveUser>("/api/v1/me");
}

// Grands indicateurs du tableau de bord. Chaque valeur est null si l'utilisateur
// n'a pas la permission de consultation correspondante (l'indicateur est alors masqué).
export interface PipelineStage {
  code: string;
  label: string;
  step_order: number;
  count: number;
}

export interface DashboardStats {
  ouvrages: number | null;
  ouvrages_en_cours: number | null;
  utilisateurs: number | null;
  ventes: number | null;
  chiffre_affaires: number | null;
  // "company" = CA global entreprise ; "team" = total de tous les commerciaux ;
  // "own" = CA du commercial connecté.
  chiffre_affaires_scope?: "company" | "team" | "own" | null;
  stock: number | null;
  ruptures: number | null;
  taches_en_retard: number | null;
  pipeline: PipelineStage[] | null;
  // Nombre total d'étapes du circuit (pour l'avancement réel de chaque étape).
  pipeline_steps_total: number | null;
}

export function getDashboardStats() {
  return request<DashboardStats>("/api/v1/dashboard/stats");
}

// Chiffre d'affaires ventilé par famille (facturé / encaissé / créances).
export interface RevenueFamily {
  key: "livre_scolaire" | "livre_general" | "communication" | "prestations";
  label: string;
  factureHt: number;
  facture: number;
  encaisse: number;
  creances: number;
}
export interface RevenueByFamily {
  families: RevenueFamily[];
  total: { factureHt: number; facture: number; encaisse: number; creances: number };
}
export function getRevenueByFamily() {
  return request<RevenueByFamily>("/api/v1/dashboard/revenue-by-family");
}

// Bilan par année : grands indicateurs déclinés par année + mouvement global.
export interface AnnualSummary {
  years: number[];
  year: number;
  ca: RevenueByFamily;
  ouvrages_parus: number;
  exemplaires: { scolaire: number; simple: number };
  droits_verses: number;
  global: {
    per_year: { year: number; ca_facture: number; ca_encaisse: number; ouvrages_parus: number }[];
    total: {
      ca_facture: number;
      ca_encaisse: number;
      ouvrages_parus: number;
      exemplaires_scolaire: number;
      exemplaires_simple: number;
      droits_verses: number;
    };
  };
}
export function getAnnualSummary(year?: number) {
  const qs = year ? `?year=${encodeURIComponent(String(year))}` : "";
  return request<AnnualSummary>(`/api/v1/dashboard/annual-summary${qs}`);
}

// Recherche rapide de la barre supérieure : un aperçu léger et cliquable par
// ouvrage (titre, auteur, ISBN). Filtrée côté serveur selon les droits.
export interface QuickSearchResult {
  id: string;
  manuscriptNumber: string;
  title: string;
  author: string | null;
  isbn: string | null;
}

export function quickSearch(q: string) {
  return request<{ results: QuickSearchResult[] }>(`/api/v1/quick-search?q=${encodeURIComponent(q)}`);
}

// Noms des personnes connectées, regroupés par grand pôle. Réservé aux profils
// habilités : Direction générale et super-administrateur (tous les pôles), ou
// chef de département (son seul grand pôle). 403 sinon.
export interface PolePresence {
  pole: string;
  users: string[];
}

export function getPresenceNames() {
  return request<{ total: number; poles: PolePresence[] }>("/api/v1/presence/names");
}

export function login(username: string, password: string) {
  return request<{ requires_2fa: boolean; challenge_id?: string }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function verifyTwoFactor(challengeId: string, code: string) {
  return request<{ requires_2fa: false }>("/api/v1/auth/2fa", {
    method: "POST",
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
}

// Sécurité du compte (Ch. 2)
export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ ok: true }>("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export function requestIdentifierChange(input: { current_password: string; new_username?: string; new_email?: string }) {
  return request<{ ok: true; email_sent: boolean; confirmation_url?: string }>("/api/v1/auth/request-identifier-change", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmIdentifierChange(token: string) {
  return request<{ ok: true }>("/api/v1/auth/confirm-identifier-change", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: "low" | "medium" | "high" | "critical";
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export function listUnreadNotifications() {
  return request<Notification[]>("/api/v1/notifications?unread=true");
}

export function listNotifications() {
  return request<Notification[]>("/api/v1/notifications");
}

export function markNotificationRead(id: string, read = true) {
  return request<Notification>(`/api/v1/notifications/${id}`, { method: "PATCH", body: JSON.stringify({ read }) });
}

export function markAllNotificationsRead() {
  return request<{ ok: true; updated: number }>("/api/v1/notifications/read-all", { method: "POST" });
}

export function logout() {
  return request<{ ok: true }>("/api/v1/auth/logout", { method: "POST" });
}

// --- Lot 1 : secrétariat éditorial, comité de lecture, décision éditoriale ---

export interface Genre {
  id: string;
  code: string;
  label: string;
}

export interface UserSummary {
  id: string;
  username: string;
  email: string;
}

export interface Manuscript {
  id: string;
  manuscriptNumber: string;
  title: string;
  subtitle: string | null;
  language: string;
  origin: "soumission" | "commande";
  priorityScore: string;
  priorityOverride: string | null;
  receivedAt: string;
  publicationDate: string | null;
  isBackCatalogue: boolean;
  status: { code: string; label: string; stepOrder: number };
  genre: Genre | null;
  collection: { id: string; label: string } | null;
  fundingMode?: "publisher" | "author";
  quoteDecision?: "pending" | "requested" | "deferred" | "skipped";
  quoteDecisionNote?: string | null;
  // Segment éditorial (base de la ventilation du CA livre). Null = non classé.
  editorialSegment?: EditorialSegment | null;
}

export type EditorialSegment = "scolaire" | "general";
// Classe un ouvrage dans un segment éditorial (scolaire & parascolaire, ou
// général & littérature) — renseigné par l'éditorial.
export function setManuscriptSegment(id: string, segment: EditorialSegment) {
  return request<Manuscript>(`/api/v1/manuscripts/${id}`, { method: "PATCH", body: JSON.stringify({ editorial_segment: segment }) });
}

export type FundingMode = "publisher" | "author";
export type QuoteDecision = "pending" | "requested" | "deferred" | "skipped";
export function setManuscriptFunding(id: string, input: { funding_mode?: FundingMode; decision?: QuoteDecision; note?: string }) {
  return request<{ funding_mode: FundingMode; quote_decision: QuoteDecision; quote_decision_note: string | null }>(`/api/v1/manuscripts/${id}/funding`, { method: "PATCH", body: JSON.stringify(input) });
}
export interface PendingQuoteRow {
  id: string;
  reference: string;
  title: string;
  author_name: string;
  decision: QuoteDecision;
  has_draft: boolean;
}
export function getPendingQuotes() {
  return request<PendingQuoteRow[]>("/api/v1/finance/pending-quotes");
}

export interface TimelineStep {
  status_code: string;
  label: string;
  step_order: number;
  is_conditional: boolean;
  validated_at: string | null;
  planned_end: string | null;
  actual_end: string | null;
  late: boolean;
}

export function listGenres() {
  return request<Genre[]>("/api/v1/genres");
}

export function listUsers() {
  return request<UserSummary[]>("/api/v1/users");
}

export interface CatalogueFilters {
  status?: string;
  genre?: string;
  collection?: string;
  language?: string;
  back_catalogue?: "true" | "false";
  published_from?: string;
  published_to?: string;
  q?: string;
  sort?: "priority" | "received_at" | "publication_date" | "title";
  order?: "asc" | "desc";
}

export function listManuscripts(filters?: CatalogueFilters) {
  const params = new URLSearchParams();
  params.set("sort", filters?.sort ?? "priority");
  for (const key of ["status", "genre", "collection", "language", "back_catalogue", "published_from", "published_to", "q", "order"] as const) {
    const value = filters?.[key];
    if (value) params.set(key, value);
  }
  return request<Manuscript[]>(`/api/v1/manuscripts?${params.toString()}`);
}

// Historique des manuscrits reçus / inscrits, groupés par jour (accordéon).
export interface ManuscriptHistoryItem {
  id: string;
  manuscript_number: string;
  title: string;
  origin: string | null;
  status_label: string;
  status_code: string;
  at: string;
}
export interface ManuscriptHistoryDay {
  date: string;
  count: number;
  items: ManuscriptHistoryItem[];
}
export function getManuscriptsHistoryByDay() {
  return request<ManuscriptHistoryDay[]>("/api/v1/manuscripts/history-by-day");
}

// --- Domaines & collections (gestion du catalogue, spéc. fonctionnelle §6) ---

export interface Collection {
  id: string;
  code: string;
  label: string;
}

export function listCollections() {
  return request<Collection[]>("/api/v1/collections");
}

export function createGenre(label: string, code?: string) {
  return request<Genre>("/api/v1/genres", { method: "POST", body: JSON.stringify({ label, ...(code ? { code } : {}) }) });
}

export function deleteGenre(id: string) {
  return request<{ ok: true }>(`/api/v1/genres/${id}`, { method: "DELETE" });
}

export function createCollection(label: string, code?: string) {
  return request<Collection>("/api/v1/collections", { method: "POST", body: JSON.stringify({ label, ...(code ? { code } : {}) }) });
}

export function deleteCollection(id: string) {
  return request<{ ok: true }>(`/api/v1/collections/${id}`, { method: "DELETE" });
}

// Auteur complet (partenaire) tel que renvoyé sur la fiche détaillée, pour
// pré-remplir l'édition de la fiche d'enregistrement.
export interface ManuscriptAuthorPartner extends AuthorIdentity {
  id: string;
  firstName: string;
  lastName: string;
  penName?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  idType?: string | null;
  country?: string | null;
  city?: string | null;
  quartier?: string | null;
  postalBox?: string | null;
  otherContact?: string | null;
  niu?: string | null;
}
export type ManuscriptDetail = Manuscript & {
  genreId?: string | null;
  evaluationFeeChoice?: "non_defini" | "a_payer" | "sans_frais";
  authorResponseDelayDays?: number | null;
  registrationLocked?: boolean;
  workContributors: { role?: string; partner: ManuscriptAuthorPartner }[];
  owner: UserSummary;
};
export function getManuscript(id: string) {
  return request<ManuscriptDetail>(`/api/v1/manuscripts/${id}`);
}

// Correction de la fiche d'enregistrement (ouvrage + auteur + frais/délai) tant
// que le contrat n'est pas signé. Motif obligatoire ; tout est tracé au journal.
export interface EditRegistrationInput {
  modification_reason: string;
  title?: string;
  subtitle?: string;
  language?: string;
  genre_id?: string;
  owner_id?: string;
  evaluation_fee_choice?: "non_defini" | "a_payer" | "sans_frais";
  author_response_delay_days?: number | null;
  author?: NewAuthorInput;
}
export function updateManuscriptRegistration(id: string, input: EditRegistrationInput) {
  return request<Manuscript>(`/api/v1/manuscripts/${id}/registration`, { method: "PATCH", body: JSON.stringify(input) });
}

export function getManuscriptTimeline(id: string) {
  return request<TimelineStep[]>(`/api/v1/manuscripts/${id}/timeline`);
}

// Identité de l'auteur saisie à l'enregistrement du manuscrit (facultative,
// hors nom/prénom) : reprise en tête du contrat d'édition.
export interface NewAuthorInput {
  first_name: string;
  last_name: string;
  pen_name?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  birth_date?: string;
  birth_place?: string;
  nationality?: string;
  profession?: string;
  id_type?: string;
  id_number?: string;
  id_issued_date?: string;
  id_issued_place?: string;
  country?: string;
  city?: string;
  quartier?: string;
  postal_box?: string;
  other_contact?: string;
  niu?: string;
}

export function createManuscript(input: {
  title: string;
  genre_id: string;
  language: string;
  owner_id: string;
  evaluation_fee_choice?: "non_defini" | "a_payer" | "sans_frais";
  author_response_delay_days?: number;
  author: NewAuthorInput;
}) {
  return request<Manuscript>("/api/v1/manuscripts", { method: "POST", body: JSON.stringify(input) });
}

// Import d'un ouvrage déjà paru (spéc. fonctionnelle §8) : saisie directe dans
// le catalogue avec sa date de parution historique.
export function importManuscript(input: {
  title: string;
  genre_id: string;
  language: string;
  owner_id: string;
  author: { first_name: string; last_name: string };
  publication_date: string;
}) {
  return request<Manuscript>("/api/v1/manuscripts/import", { method: "POST", body: JSON.stringify(input) });
}

// Renseigner / corriger la date de parution d'un ouvrage (antidatage tracé, §8).
export function setPublicationDate(manuscriptId: string, publicationDate: string, note?: string) {
  return request<Manuscript>(`/api/v1/manuscripts/${manuscriptId}/publication-date`, {
    method: "POST",
    body: JSON.stringify({ publication_date: publicationDate, ...(note ? { note } : {}) }),
  });
}

export function validateStep(
  manuscriptId: string,
  step: string,
  options?: {
    observations?: string;
    outcome?: "conforme" | "incomplet";
    requires_rewrite?: boolean;
    assignee_id?: string;
    // Étapes « à option » (Expertise, Réécriture, Projet) : décision de l'opérateur.
    step_decision?: "realise" | "passe";
    skip_reason?: string;
    realization?: Record<string, string | number>;
  },
) {
  return request<{ advanced: boolean; status: string | null; realization_mode?: string | null }>(`/api/v1/manuscripts/${manuscriptId}/steps/${step}/validate`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

// Étape « à option » (Expertise, Réécriture, Projet) : méta pour piloter le
// panneau « Réaliser / Passer » et les éléments à renseigner quand on réalise.
export interface OptionalStepField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  required: boolean;
  options?: { value: string; label: string }[];
}
export type OptionalStepMeta =
  | { step_code: string; is_optional: false }
  | {
      step_code: string;
      is_optional: true;
      mode: "facultative" | "obligatoire";
      label: string;
      fields: OptionalStepField[];
      decided_mode: "realise" | "passe" | null;
      skip_reason: string | null;
      data: Record<string, unknown> | null;
    };
export function getOptionalStep(manuscriptId: string, code: string) {
  return request<OptionalStepMeta>(`/api/v1/manuscripts/${manuscriptId}/optional-step/${code}`);
}

// Paramètre : mode (facultative / obligatoire) des étapes « à option ».
export interface WorkflowStepModesConfig {
  modes: Record<"EXPERTISE" | "REECRITURE" | "PLANIFICATION", "facultative" | "obligatoire">;
  steps: { code: string; label: string }[];
}
export function getWorkflowStepModes() {
  return request<WorkflowStepModesConfig>("/api/v1/workflow-step-modes");
}
export function updateWorkflowStepModes(modes: WorkflowStepModesConfig["modes"]) {
  return request<WorkflowStepModesConfig>("/api/v1/workflow-step-modes", { method: "PUT", body: JSON.stringify({ modes }) });
}

// Candidats à l'affectation nominative de l'étape suivante (maquettiste,
// infographe, correcteur…). Liste vide quand l'affectation ne s'applique pas.
export interface NextAssignee {
  id: string;
  username: string;
  role: string | null;
}
export function getNextAssignees(manuscriptId: string) {
  return request<{ next_step: { code: string; label: string } | null; assignees: NextAssignee[] }>(
    `/api/v1/manuscripts/${manuscriptId}/next-assignees`,
  );
}

// « Mes dossiers à traiter » : les manuscrits dont l'étape courante m'est
// personnellement confiée (équivalent de « Mes lectures » pour toute la chaîne).
export interface MyDossier {
  manuscript_id: string;
  manuscript_number: string;
  title: string;
  step_code: string;
  step_label: string;
  since: string;
}
export function getMyDossiers() {
  return request<MyDossier[]>("/api/v1/my-dossiers");
}

// Retour à l'étape précédente (correction d'une validation faite par erreur).
export function revertManuscriptStep(manuscriptId: string, reason?: string) {
  return request<{ reverted: boolean; status: string | null; statusLabel: string }>(
    `/api/v1/manuscripts/${manuscriptId}/steps/revert`,
    { method: "POST", body: JSON.stringify(reason ? { reason } : {}) },
  );
}

// Suppression logique d'un manuscrit (réservée au niveau administration).
export function deleteManuscript(manuscriptId: string) {
  return request<{ deleted: boolean }>(`/api/v1/manuscripts/${manuscriptId}/delete`, { method: "POST" });
}

// Nettoyage : fiches catalogue incomplètes (à compléter) et essais à épurer.
export interface CatalogueIncompleteRow {
  id: string;
  manuscript_number: string;
  title: string;
  missing: string[];
}
export function getCatalogueIncomplete() {
  return request<CatalogueIncompleteRow[]>("/api/v1/manuscripts/catalogue-incomplete");
}
export interface PurgeCandidateRow {
  id: string;
  manuscript_number: string;
  title: string;
  stage: string | null;
  step_order: number | null;
  safe: boolean;
  blockers: string[];
}
export function getPurgeCandidates() {
  return request<PurgeCandidateRow[]>("/api/v1/manuscripts/purge-candidates");
}
export function purgeManuscripts(ids: string[]) {
  return request<{ archived_count: number; archived: string[]; skipped: { id: string; reason: string }[] }>("/api/v1/manuscripts/purge", { method: "POST", body: JSON.stringify({ ids }) });
}

// Fichier source du manuscrit (dépôt à la réception → entrée du circuit).
export function getManuscriptSourceFileMeta(manuscriptId: string) {
  return request<{ has_file: boolean; mime_type: string | null }>(`/api/v1/manuscripts/${manuscriptId}/source-file/meta`);
}
export function manuscriptSourceFileUrl(manuscriptId: string): string {
  return `${API_BASE}/api/v1/manuscripts/${manuscriptId}/source-file`;
}
export async function uploadManuscriptSourceFile(manuscriptId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/manuscripts/${manuscriptId}/source-file`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "Dépôt impossible.");
  return response.json() as Promise<{ has_file: boolean; version_number: number }>;
}

// Pièces jointes d'étape : dépôt libre de fichiers / scans par l'acteur de l'étape.
export interface StepAttachment {
  id: string;
  title: string;
  created_at: string;
  version_id: string | null;
  file_size: number | null;
  mime_type: string | null;
  can_correct?: boolean;
}

// Retrait d'un fichier d'étape déposé par erreur (livrable, pièce, maquette,
// BAT, manuscrit corrigé). Suppression logique côté serveur (auteur/direction).
export function deleteStepDocument(manuscriptId: string, docId: string) {
  return request<{ removed: boolean }>(`/api/v1/manuscripts/${manuscriptId}/step-documents/${docId}`, { method: "DELETE" });
}
export function listStepAttachments(manuscriptId: string) {
  return request<StepAttachment[]>(`/api/v1/manuscripts/${manuscriptId}/step-attachments`);
}
export async function uploadStepAttachment(manuscriptId: string, file: File, stepLabel: string) {
  const form = new FormData();
  form.append("file", file);
  const url = `${API_BASE}/api/v1/manuscripts/${manuscriptId}/step-attachments?step_label=${encodeURIComponent(stepLabel)}`;
  const response = await fetch(url, { method: "POST", credentials: "include", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "Dépôt impossible.");
  return response.json() as Promise<{ id: string; version_id: string; title: string }>;
}
export function stepAttachmentDownloadUrl(manuscriptId: string, versionId: string): string {
  return `${API_BASE}/api/v1/manuscripts/${manuscriptId}/step-attachments/${versionId}/download`;
}

// Correction éditoriale en deux temps (rapport → intégration → 2e relecture →
// intégration finale). Chaque phase = un dépôt de fichier ; les livrables se
// téléchargent via la route step-attachments.
export interface CorrectionPhaseState {
  key: string;
  label: string;
  required: boolean;
  has_file: boolean;
  doc_id?: string | null;
  can_correct?: boolean;
  version_id: string | null;
  filename: string | null;
  created_at: string | null;
}
export function getCorrectionCycle(manuscriptId: string) {
  return request<CorrectionPhaseState[]>(`/api/v1/manuscripts/${manuscriptId}/correction-cycle`);
}
export async function uploadCorrectionPhase(manuscriptId: string, phase: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/manuscripts/${manuscriptId}/correction-cycle/${phase}`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "Dépôt impossible.");
  return response.json() as Promise<{ version_id: string; phase: string; label: string }>;
}

// Livrable de sortie d'une étape (verrou « pas d'avancement sans le fichier »).
export interface StepDeliverableMeta {
  step_code: string;
  required: boolean;
  label: string;
  has_file: boolean;
  doc_id?: string | null;
  can_correct?: boolean;
  version_id: string | null;
  filename: string | null;
  created_at: string | null;
}
export function getStepDeliverable(manuscriptId: string, code: string) {
  return request<StepDeliverableMeta>(`/api/v1/manuscripts/${manuscriptId}/step-deliverable/${code}`);
}
export async function uploadStepDeliverable(manuscriptId: string, code: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/manuscripts/${manuscriptId}/step-deliverable/${code}`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "Dépôt impossible.");
  return response.json() as Promise<{ version_id: string; step_code: string }>;
}

// Paramètre : étapes soumises au verrou « livrable de sortie ».
export interface WorkflowDeliverableConfig {
  steps: string[];
  candidates: { code: string; label: string }[];
}
export function getWorkflowDeliverableSteps() {
  return request<WorkflowDeliverableConfig>("/api/v1/workflow-deliverable-steps");
}
export function updateWorkflowDeliverableSteps(steps: string[]) {
  return request<WorkflowDeliverableConfig>("/api/v1/workflow-deliverable-steps", { method: "PUT", body: JSON.stringify({ steps }) });
}

// Étape Maquette : entrée = manuscrit corrigé, sortie = maquette mise en page.
export function getManuscriptLayoutMeta(manuscriptId: string) {
  return request<{ corrected_has_file: boolean; layout_has_file: boolean; corrected_doc_id: string | null; corrected_can_correct: boolean; layout_doc_id: string | null; layout_can_correct: boolean }>(`/api/v1/manuscripts/${manuscriptId}/layout-file/meta`);
}
export function manuscriptCorrectedFileUrl(manuscriptId: string): string {
  return `${API_BASE}/api/v1/manuscripts/${manuscriptId}/corrected-file`;
}
export function manuscriptLayoutFileUrl(manuscriptId: string): string {
  return `${API_BASE}/api/v1/manuscripts/${manuscriptId}/layout-file`;
}
export async function uploadManuscriptLayoutFile(manuscriptId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/manuscripts/${manuscriptId}/layout-file`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "Dépôt impossible.");
  return response.json() as Promise<{ has_file: boolean; version_number: number }>;
}

// Étape BAT : entrée = maquette, sortie = BAT signé (reçu par l'impression).
export function getManuscriptBatMeta(manuscriptId: string) {
  return request<{ layout_has_file: boolean; bat_has_file: boolean; bat_doc_id: string | null; bat_can_correct: boolean }>(`/api/v1/manuscripts/${manuscriptId}/bat-file/meta`);
}
export function manuscriptBatFileUrl(manuscriptId: string): string {
  return `${API_BASE}/api/v1/manuscripts/${manuscriptId}/bat-file`;
}
export async function uploadManuscriptBatFile(manuscriptId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/manuscripts/${manuscriptId}/bat-file`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "Dépôt impossible.");
  return response.json() as Promise<{ has_file: boolean; version_number: number }>;
}

export interface ReadingEvaluationScore {
  score: string | number;
  comment: string | null;
  criterion: { id: string; label: string; coefficient: string | number };
}
export interface ReadingEvaluation {
  recommendation: string;
  globalScore: string | number;
  rating: string;
  overallComment: string | null;
  submittedAt: string;
  scores: ReadingEvaluationScore[];
}
export interface ReadingAssignment {
  id: string;
  manuscriptId: string;
  readerId: string;
  dueAt: string;
  submittedAt: string | null;
  status: "pending" | "submitted" | "late" | "cancelled";
  manuscript?: { id: string; manuscriptNumber: string; title: string };
  reader?: { username: string };
  evaluation?: ReadingEvaluation | null;
  hasReportFile?: boolean;
  reportFileName?: string | null;
  // Entrée de la mission : le fichier manuscrit confié au relecteur, s'il est
  // déposé sur l'ouvrage (téléchargeable via readingManuscriptFileUrl).
  manuscriptHasFile?: boolean;
  manuscriptFileTitle?: string | null;
}

// Candidats à l'affectation d'une lecture/correction : comptes internes
// habilités (correcteur, comité, assistant/directeur éditorial, DG) et
// relecteurs externes (comptes externes dédiés), marqués `external`.
export interface ReadingCandidate {
  id: string;
  username: string;
  external: boolean;
}
export function listReadingCandidates() {
  return request<ReadingCandidate[]>("/api/v1/reading-candidates");
}

// Crée un relecteur externe (compte externe dédié + rôle comité de lecture).
export function createExternalReviewer(input: { username: string; email: string; password: string }) {
  return request<ReadingCandidate>("/api/v1/reading-candidates/external", { method: "POST", body: JSON.stringify(input) });
}

export function assignReader(manuscriptId: string, readerId: string, dueAt: string) {
  return request<ReadingAssignment>(`/api/v1/manuscripts/${manuscriptId}/reading-assignments`, {
    method: "POST",
    body: JSON.stringify({ reader_id: readerId, due_at: dueAt }),
  });
}

export function listMyReadingAssignments() {
  return request<ReadingAssignment[]>("/api/v1/reading-assignments?reader=me");
}

export interface EvaluationCriterion {
  id: string;
  label: string;
  coefficient: string;
}

export function listEvaluationCriteria() {
  return request<EvaluationCriterion[]>("/api/v1/evaluation-criteria");
}

export interface WorkflowStatusRef {
  code: string;
  label: string;
  stepOrder: number;
  isConditional: boolean;
}
export function listWorkflowStatuses() {
  return request<WorkflowStatusRef[]>("/api/v1/workflow-statuses");
}

export interface ProductionTrackingItem {
  id: string;
  title: string;
  manuscriptNumber: string;
  author: string | null;
  statusCode: string;
  statusLabel: string;
  stepOrder: number;
}
export function listProductionTracking() {
  return request<ProductionTrackingItem[]>("/api/v1/production-tracking");
}

export function submitEvaluation(
  assignmentId: string,
  input: {
    scores: { criterion_id: string; score: number; comment?: string }[];
    overall_comment?: string;
    recommendation: "accept" | "accept_minor" | "accept_major" | "rewrite" | "new_expertise" | "reject";
  },
) {
  return request(`/api/v1/reading-assignments/${assignmentId}/evaluation`, { method: "POST", body: JSON.stringify(input) });
}

// Missions de lecture d'un manuscrit (comité / direction) — avec évaluations.
export function listManuscriptReadingAssignments(manuscriptId: string) {
  return request<ReadingAssignment[]>(`/api/v1/reading-assignments?manuscript=${manuscriptId}`);
}

// Retire (annule) une mission de lecture erronée ou en doublon. Renvoie
// advanced=true si ce retrait a permis de transmettre le dossier à la décision.
export function cancelReadingAssignment(assignmentId: string) {
  return request<{ ok: boolean; advanced: boolean }>(`/api/v1/reading-assignments/${assignmentId}/cancel`, { method: "POST" });
}

// Clôt le comité de lecture (responsable éditorial) : annule les missions en
// attente et transmet le manuscrit à la décision éditoriale.
export function closeReadingCommittee(manuscriptId: string) {
  return request<{ ok: boolean; advanced: boolean }>(`/api/v1/manuscripts/${manuscriptId}/close-reading-committee`, { method: "POST" });
}

// Tableau de bord du sous-module « Comité de lecture » (refonte éditoriale) :
// manuscrits au comité regroupés par sous-état + indicateurs. Réservé côté
// serveur aux rôles éditorial/direction (403 sinon).
export type CommitteeSubState = "a_affecter" | "en_lecture" | "rapports_remis";
export interface CommitteeManuscript {
  id: string;
  manuscript_number: string;
  title: string;
  received_at: string;
  sub_state: CommitteeSubState;
  assigned: number;
  submitted: number;
  pending: number;
  late: number;
}
export interface ReadingCommitteeDashboard {
  en_comite: number;
  a_affecter: number;
  en_lecture: number;
  rapports_remis: number;
  en_retard: number;
  rapports_en_attente: number;
  relecteurs_actifs: number;
  manuscripts: CommitteeManuscript[];
}
export function getReadingCommitteeDashboard() {
  return request<ReadingCommitteeDashboard>("/api/v1/editorial/reading-committee/dashboard");
}

// Tableau de bord du sous-module « Direction éditoriale » (refonte éditoriale) :
// file « à décider » (avec synthèse des avis), historique des décisions +
// indicateurs. Réservé côté serveur aux rôles éditorial/direction (403 sinon).
export interface PendingDecision {
  id: string;
  manuscript_number: string;
  title: string;
  received_at: string;
  jours_attente: number;
  evaluations: number;
  score_moyen: number | null;
  ecart_avis: boolean;
  en_retard: boolean;
}
export interface DecisionHistoryItem {
  id: string;
  manuscript_number: string;
  title: string;
  decision: string;
  decided_at: string;
  motivation: string;
}
export interface EditorialDecisionDashboard {
  en_attente: number;
  avis_divergents: number;
  en_retard: number;
  taux_acceptation: number | null;
  delai_moyen_decision_jours: number | null;
  pending: PendingDecision[];
  historique: DecisionHistoryItem[];
}
export function getEditorialDecisionDashboard() {
  return request<EditorialDecisionDashboard>("/api/v1/editorial/decisions/dashboard");
}

// Tableau de bord du sous-module « Correction éditoriale » (refonte éditoriale) :
// manuscrits en correction regroupés par sous-état + indicateurs. Réservé côté
// serveur aux rôles éditorial/direction (403 sinon).
export type CorrectionSubState = "points_bloquants" | "a_demarrer" | "en_cours" | "prets_a_valider";
export interface CorrectionManuscript {
  id: string;
  manuscript_number: string;
  title: string;
  received_at: string;
  sub_state: CorrectionSubState;
  tasks_total: number;
  tasks_done: number;
  blocking: number;
  progress_pct: number;
  en_retard: boolean;
}
export interface CorrectionDashboard {
  en_correction: number;
  a_demarrer: number;
  en_cours: number;
  points_bloquants: number;
  prets_a_valider: number;
  points_bloquants_total: number;
  en_retard: number;
  manuscripts: CorrectionManuscript[];
}
export function getCorrectionDashboard() {
  return request<CorrectionDashboard>("/api/v1/editorial/correction/dashboard");
}

// Fichier externe de rapport de relecture : dépôt (relecteur) et téléchargement.
export async function uploadReadingReportFile(assignmentId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/reading-assignments/${assignmentId}/report-file`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? `Erreur ${response.status}`);
  }
  return response.json() as Promise<{ has_report_file: boolean; report_file_name: string }>;
}

export function readingReportFileUrl(assignmentId: string): string {
  return `${API_BASE}/api/v1/reading-assignments/${assignmentId}/report-file`;
}

// Entrée du relecteur : téléchargement du manuscrit confié, depuis sa mission.
export function readingManuscriptFileUrl(assignmentId: string): string {
  return `${API_BASE}/api/v1/reading-assignments/${assignmentId}/manuscript-file`;
}

// « Joindre à l'ouvrage » : verse le rapport (fichier déposé) comme pièce
// officielle de l'ouvrage (reçue par la Direction éditoriale).
export function attachReadingReport(assignmentId: string) {
  return request<{ attached: boolean; document_id: string }>(`/api/v1/reading-assignments/${assignmentId}/attach-report`, { method: "POST" });
}

// Envoi par e-mail de la version finale du rapport (PDF fusionné, en base64).
export function emailReadingReport(assignmentId: string, input: { to: string; subject?: string; message?: string; pdf_base64: string; file_name?: string }) {
  return request<{ sent: boolean }>(`/api/v1/reading-assignments/${assignmentId}/email-report`, { method: "POST", body: JSON.stringify(input) });
}

export function submitEditorialDecision(
  manuscriptId: string,
  decision: "acceptation" | "acceptation_conditions" | "revision" | "attente" | "refus",
  motivation: string,
) {
  return request(`/api/v1/manuscripts/${manuscriptId}/editorial-decision`, {
    method: "POST",
    body: JSON.stringify({ decision, motivation }),
  });
}

// --- Lot 2 : contrats, tâches/Gantt, correction et comparateur ---

export type ContractStatus = "preparation" | "legal_review" | "direction_approval" | "awaiting_signature" | "active" | "expired" | "terminated";

// Fiche Partenaire unique (décision opérateur du 04/07/2026) : couvre
// l'auteur et tous les prestataires externes (correcteur, traducteur,
// illustrateur, maquettiste, graphiste, imprimeur, consultant, autre).
export type PartnerCategory =
  | "auteur"
  | "correcteur"
  | "traducteur"
  | "illustrateur"
  | "maquettiste"
  | "graphiste"
  | "imprimeur"
  | "consultant"
  | "autre";

// Identité civile de l'auteur reprise en tête du contrat d'édition (facultative).
export interface AuthorIdentity {
  address?: string | null;
  birthDate?: string | null;
  birthPlace?: string | null;
  nationality?: string | null;
  profession?: string | null;
  idNumber?: string | null;
  idIssuedDate?: string | null;
  idIssuedPlace?: string | null;
}

export interface Partner extends AuthorIdentity {
  id: string;
  category: PartnerCategory;
  firstName: string;
  lastName: string;
  penName?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}

export function listPartners(category?: PartnerCategory) {
  const query = category ? `?category=${category}` : "";
  return request<Partner[]>(`/api/v1/partners${query}`);
}

export function createPartner(input: {
  category: PartnerCategory;
  first_name: string;
  last_name: string;
  pen_name?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
}) {
  return request<Partner>("/api/v1/partners", { method: "POST", body: JSON.stringify(input) });
}

// Modification des coordonnées d'un partenaire (e-mail, téléphone, WhatsApp…).
export function updatePartner(
  id: string,
  input: {
    pen_name?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    address?: string;
    birth_date?: string;
    birth_place?: string;
    nationality?: string;
    profession?: string;
    id_number?: string;
    id_issued_date?: string;
    id_issued_place?: string;
  },
) {
  return request<Partner>(`/api/v1/partners/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export interface Contract {
  id: string;
  contractNumber: string;
  type: string;
  status: ContractStatus;
  signedAt: string | null;
  partner: { id: string; firstName: string; lastName: string; email?: string | null; phone?: string | null; whatsapp?: string | null } & AuthorIdentity;
  manuscript: { id: string; manuscriptNumber: string; title: string } | null;
  // Traçabilité : noms lisibles du saisisseur et du dernier modificateur.
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function listContracts(manuscriptId?: string) {
  const query = manuscriptId ? `?manuscript=${manuscriptId}` : "";
  return request<Contract[]>(`/api/v1/contracts${query}`);
}

// Fiche contractuelle détaillée (pour l'impression) : portée et clauses de droits.
export interface RoyaltyTier {
  up_to: number | null;
  rate: number;
}

export type SignatureParty = "author" | "publisher";

export interface ContractSignature {
  id: string;
  party: SignatureParty;
  signerName: string;
  signedAt: string;
  termsHash: string;
  note: string | null;
}

export interface ContractClause {
  title: string;
  body: string;
}

export interface ContractDetail extends Contract {
  effectiveAt?: string | null;
  durationMonths?: number | null;
  customClauses?: ContractClause[] | null;
  territories: string[];
  languages: string[];
  formats: string[];
  royaltyTerms?: {
    base: string;
    tiers: RoyaltyTier[];
    advanceAmount: string | null;
    taxWithholdingPct: string | null;
    statementPeriodicity: string | null;
  } | null;
  signatures?: ContractSignature[];
}

export function getContract(id: string) {
  return request<ContractDetail>(`/api/v1/contracts/${id}`);
}

// Signature « simple / interne » d'une partie (Phase B) : accord horodaté, lié à
// une empreinte des clauses, tracé au journal. Renvoie le contrat rafraîchi.
export function signContract(
  id: string,
  input: { party: SignatureParty; signer_name: string; consent: boolean; note?: string },
) {
  return request<ContractDetail>(`/api/v1/contracts/${id}/sign`, { method: "POST", body: JSON.stringify(input) });
}

// Modifier les termes d'un contrat non signé (type, taux, avance, durée).
export function updateContractTerms(id: string, input: { type?: string; duration_months?: number | null; rate?: number; advance_amount?: number }) {
  return request<ContractDetail>(`/api/v1/contracts/${id}/terms`, { method: "PATCH", body: JSON.stringify(input) });
}

// Ajouter un article (clause) à un contrat non signé.
export function addContractClause(id: string, input: { title: string; body: string }) {
  return request<ContractDetail>(`/api/v1/contracts/${id}/clauses`, { method: "POST", body: JSON.stringify(input) });
}

export function createContract(input: {
  type: string;
  manuscript_id?: string;
  partner_id: string;
  parent_contract_id?: string;
  duration_months?: number;
  financial_terms: Record<string, unknown>;
}) {
  return request<Contract>("/api/v1/contracts", { method: "POST", body: JSON.stringify(input) });
}

export function updateContractStatus(id: string, status: ContractStatus) {
  return request<Contract>(`/api/v1/contracts/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}

// Tableau de bord des contrats (refonte CLM, phase 1) : répartition par statut,
// avenants, avances, échéances à venir + retards, contrats restaurables.
export interface ContractsDashboard {
  total: number;
  by_status: Record<ContractStatus, number>;
  with_amendments: number;
  advances_total: number;
  expiring: ContractDeadline[];
  deleted: { id: string; contract_number: string; title: string | null; partner_name: string; deleted_at: string | null }[];
}
export interface ContractDeadline {
  id: string;
  contract_number: string;
  title: string | null;
  partner_name: string;
  status: ContractStatus;
  expiry: string;
  renewal_notice_deadline: string;
  days_left: number;
  notice_days_left: number;
  overdue: boolean;
  notice_passed: boolean;
  level: "critique" | "attention";
}
export function getContractsDashboard() {
  return request<ContractsDashboard>("/api/v1/contracts/dashboard");
}
export function restoreContract(id: string) {
  return request<{ restored: boolean }>(`/api/v1/contracts/${id}/restore`, { method: "POST" });
}
// Déclenche l'envoi des alertes d'échéance en attente à la Direction (bouton
// « Vérifier maintenant »). Renvoie le nombre d'alertes nouvellement émises.
export function runContractAlerts() {
  return request<{ created: number }>("/api/v1/contracts/alerts/run", { method: "POST" });
}

// --- Pièces numérisées d'un contrat (contrat signé scanné, annexes) --------
export type ContractDocumentKind = "signed_scan" | "annexe";
export interface ContractDocument {
  id: string;
  kind: ContractDocumentKind;
  label: string;
  name: string;
  mime: string;
  size: number;
  uploaded_by: string | null;
  created_at: string;
}

export function listContractDocuments(contractId: string) {
  return request<ContractDocument[]>(`/api/v1/contracts/${contractId}/documents`);
}

export async function uploadContractDocument(
  contractId: string,
  input: { label: string; kind: ContractDocumentKind; file: File },
): Promise<ContractDocument> {
  const form = new FormData();
  if (input.label) form.append("label", input.label);
  form.append("kind", input.kind);
  form.append("file", input.file);
  const res = await fetch(`${API_BASE}/api/v1/contracts/${contractId}/documents`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Erreur ${res.status}`);
  return res.json() as Promise<ContractDocument>;
}

export function contractDocumentDownloadUrl(contractId: string, docId: string): string {
  return `${API_BASE}/api/v1/contracts/${contractId}/documents/${docId}/download`;
}

export function deleteContractDocument(contractId: string, docId: string) {
  return request<{ ok: true }>(`/api/v1/contracts/${contractId}/documents/${docId}`, { method: "DELETE" });
}

// Journal d'envoi du contrat — preuve de transmission à l'auteur (messagerie
// interne ou WhatsApp). Append-only : chaque envoi est un nouvel enregistrement.
export type ContractDispatchChannel = "messagerie_interne" | "whatsapp";
export interface ContractDispatch {
  id: string;
  contract_id: string;
  channel: ContractDispatchChannel;
  document_label: string;
  recipient: string;
  note: string;
  sent_at: string;
  sent_by_name: string | null;
}

export function listContractDispatches(contractId: string) {
  return request<ContractDispatch[]>(`/api/v1/contracts/${contractId}/dispatches`);
}

export function recordContractDispatch(
  contractId: string,
  input: { channel: ContractDispatchChannel; document_label?: string; recipient?: string; note?: string },
) {
  return request<ContractDispatch>(`/api/v1/contracts/${contractId}/dispatches`, { method: "POST", body: JSON.stringify(input) });
}

// Suppression logique d'un contrat non signé (contrat de test, brouillon…).
// Refusée côté serveur dès qu'une signature existe (409 contract_signed).
export function deleteContract(id: string) {
  return request<{ deleted: true }>(`/api/v1/contracts/${id}`, { method: "DELETE" });
}

// --- Devis de prestation (éditoriale / impression / communication) --------
export type EditorialQuoteStatus = "draft" | "sent" | "accepted" | "refused" | "expired" | "invoiced";
export type QuoteAcceptanceMethod = "online_link" | "internal" | "paper";
export type ServiceType = "editorial" | "impression" | "communication";

export interface EditorialQuoteLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
}

export interface EditorialQuote {
  id: string;
  quoteNumber: string;
  serviceType: ServiceType;
  status: EditorialQuoteStatus;
  currency: string;
  totalHt: string;
  totalTax: string;
  totalTtc: string;
  validUntil: string | null;
  notes: string | null;
  exclusionsNote: string | null;
  acceptedAt: string | null;
  acceptanceMethod: QuoteAcceptanceMethod | null;
  signerName: string | null;
  invoiceId: string | null;
  partner: { id: string; firstName: string; lastName: string; email: string | null } | null;
  customer: { id: string; name: string; email: string | null } | null;
  manuscript: { id: string; manuscriptNumber: string; title: string } | null;
  lines: EditorialQuoteLine[];
}

export function listEditorialQuotes(manuscriptId?: string) {
  const q = manuscriptId ? `?manuscript=${manuscriptId}` : "";
  return request<EditorialQuote[]>(`/api/v1/editorial-quotes${q}`);
}

export function getEditorialQuote(id: string) {
  return request<EditorialQuote>(`/api/v1/editorial-quotes/${id}`);
}

export function createEditorialQuote(input: {
  service_type?: ServiceType;
  partner_id?: string;
  customer_id?: string;
  manuscript_id?: string;
  currency?: string;
  valid_until?: string;
  notes?: string;
  lines: { description: string; quantity: number; unit_price: number; tax_rate?: number }[];
}) {
  return request<EditorialQuote>("/api/v1/editorial-quotes", { method: "POST", body: JSON.stringify(input) });
}

// Prépare l'envoi pour signature en ligne : renvoie le lien (et l'envoie par
// e-mail à l'auteur si une adresse est connue).
export function deleteEditorialQuote(id: string) {
  return request<{ ok: true }>(`/api/v1/editorial-quotes/${id}`, { method: "DELETE" });
}
export function resetEditorialQuoteChain(id: string) {
  return request<{ ok: true; purged: { quoteNumber: string; invoiceNumber?: string } }>(`/api/v1/editorial-quotes/${id}/reset`, { method: "DELETE" });
}
export function sendEditorialQuote(id: string) {
  return request<{ quote: EditorialQuote; sign_path: string; sign_url: string | null; email_sent: boolean }>(
    `/api/v1/editorial-quotes/${id}/send`,
    { method: "POST" },
  );
}

// Enregistre l'accord de l'auteur en interne (①) ou par devis papier scanné (②).
export function acceptEditorialQuote(id: string, input: { method: "internal" | "paper"; signer_name: string; consent: boolean; note?: string }) {
  return request<EditorialQuote>(`/api/v1/editorial-quotes/${id}/accept`, { method: "POST", body: JSON.stringify(input) });
}

export function invoiceEditorialQuote(id: string) {
  return request<InvoiceDetail>(`/api/v1/editorial-quotes/${id}/invoice`, { method: "POST" });
}

// Circuit devis → Éditorial → client → facture.
export function handQuoteToEditorial(id: string) {
  return request<EditorialQuote>(`/api/v1/editorial-quotes/${id}/hand-to-editorial`, { method: "POST" });
}
export interface EditorialQuoteInboxRow {
  id: string;
  quote_number: string;
  status: string;
  total_ttc: string;
  currency: string;
  manuscript: { id: string; title: string } | null;
  client: string | null;
  client_email: string | null;
  client_whatsapp: string | null;
  initiated_by: string | null;
  handed_at: string | null;
  accepted_at: string | null;
}
export function getEditorialQuotesInbox(manuscriptId?: string) {
  return request<EditorialQuoteInboxRow[]>(`/api/v1/editorial/quotes${manuscriptId ? `?manuscript=${manuscriptId}` : ""}`);
}

// --- Signature en ligne par l'auteur (page publique, sans compte) ----------
export interface PublicQuote {
  quote_number: string;
  status: EditorialQuoteStatus;
  author: string;
  manuscript_title: string | null;
  currency: string;
  exclusions_note: string | null;
  valid_until: string | null;
  total_ht: string;
  total_tax: string;
  total_ttc: string;
  accepted_at: string | null;
  lines: { description: string; quantity: number; unit_price: string; tax_rate: string; line_total: string }[];
}

export function getPublicQuote(token: string) {
  return request<PublicQuote>(`/api/v1/public/editorial-quotes/${token}`);
}

export function signPublicQuote(token: string, input: { signer_name: string; consent: boolean }) {
  return request<{ ok: boolean; quote_number: string }>(`/api/v1/public/editorial-quotes/${token}/sign`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- Rapports hebdomadaires + objectifs (Demande 3) -----------------------
export interface Objective {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  targetValue: string | null;
  unit: string | null;
  periodStart: string;
  periodEnd: string;
  weight: number;
  status: "active" | "achieved" | "archived";
  user?: { id: string; username: string };
}

export function listObjectives(userId?: string) {
  const q = userId ? `?user_id=${userId}` : "";
  return request<Objective[]>(`/api/v1/objectives${q}`);
}

export function createObjective(input: {
  user_id: string;
  title: string;
  description?: string;
  target_value?: number;
  unit?: string;
  period_start: string;
  period_end: string;
  weight?: number;
}) {
  return request<Objective>("/api/v1/objectives", { method: "POST", body: JSON.stringify(input) });
}

export type WeeklyReportStatus = "draft" | "submitted" | "validated" | "returned";

export interface WeeklyReportObjectiveLine {
  id: string;
  objectiveId: string | null;
  label: string | null;
  progressPct: number;
  comment: string | null;
  objective?: { id: string; title: string; targetValue: string | null; unit: string | null } | null;
}

export interface WeeklyReport {
  id: string;
  userId: string;
  pole: string;
  periodStart: string;
  periodEnd: string;
  status: WeeklyReportStatus;
  achievements: string | null;
  research: string | null;
  difficulties: string | null;
  nextPlan: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  validationComment: string | null;
  user?: { id: string; username: string };
  validatedBy?: { id: string; username: string } | null;
  objectives: WeeklyReportObjectiveLine[];
}

// Récupère (ou crée) le rapport de l'agent pour la période courante.
export function currentWeeklyReport() {
  return request<WeeklyReport>("/api/v1/weekly-reports", { method: "POST" });
}

export function listWeeklyReports(params?: { status?: string; user_id?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<WeeklyReport[]>(`/api/v1/weekly-reports${qs ? `?${qs}` : ""}`);
}

export function getWeeklyReport(id: string) {
  return request<WeeklyReport>(`/api/v1/weekly-reports/${id}`);
}

export function patchWeeklyReport(
  id: string,
  input: {
    achievements?: string;
    research?: string;
    difficulties?: string;
    next_plan?: string;
    objectives?: { objective_id?: string; label?: string; progress_pct: number; comment?: string }[];
  },
) {
  return request<WeeklyReport>(`/api/v1/weekly-reports/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function submitWeeklyReport(id: string) {
  return request<WeeklyReport>(`/api/v1/weekly-reports/${id}/submit`, { method: "POST" });
}

export function validateWeeklyReport(id: string, input: { decision: "validate" | "return"; comment?: string }) {
  return request<WeeklyReport>(`/api/v1/weekly-reports/${id}/validate`, { method: "POST", body: JSON.stringify(input) });
}

export type TaskStatus = "non_commencee" | "en_cours" | "suspendue" | "terminee" | "validee";

export interface Task {
  id: string;
  title: string;
  type: string;
  status: TaskStatus;
  progressPct: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  dependsOnTaskId: string | null;
  assignee: { id: string; username: string } | null;
}

export function listTasks(manuscriptId: string) {
  return request<Task[]>(`/api/v1/tasks?manuscript=${manuscriptId}`);
}

export function createTask(
  manuscriptId: string,
  input: { title: string; type: string; assignee_id?: string; planned_start?: string; planned_end?: string; depends_on_task_id?: string },
) {
  return request<Task>(`/api/v1/manuscripts/${manuscriptId}/tasks`, { method: "POST", body: JSON.stringify(input) });
}

export function patchTask(id: string, input: { status?: TaskStatus; progress_pct?: number }) {
  return request<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export interface TaskComment {
  id: string;
  body: string;
  isBlocking: boolean;
  resolvedAt: string | null;
  author: { id: string; username: string };
}

export function listTaskComments(taskId: string) {
  return request<TaskComment[]>(`/api/v1/tasks/${taskId}/comments`);
}

export function addTaskComment(taskId: string, body: string, isBlocking: boolean) {
  return request<TaskComment>(`/api/v1/tasks/${taskId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, is_blocking: isBlocking }),
  });
}

export function resolveTaskComment(id: string) {
  return request<TaskComment>(`/api/v1/task-comments/${id}/resolve`, { method: "PATCH" });
}

// « Mes corrections » : boîte de travail du correcteur — ses tâches de
// correction, avec l'entrée (manuscrit à corriger) et la sortie (version
// corrigée à déposer, reçue par la Maquette).
export interface MyCorrectionTask {
  id: string;
  title: string;
  type: string;
  status: TaskStatus;
  progressPct: number;
  plannedEnd: string | null;
  manuscript: { id: string; manuscriptNumber: string; title: string } | null;
  manuscriptHasFile: boolean;
  correctedHasFile: boolean;
}
export function listMyCorrections() {
  return request<MyCorrectionTask[]>("/api/v1/my-corrections");
}
// Entrée : téléchargement du manuscrit à corriger, depuis la tâche.
export function taskManuscriptFileUrl(taskId: string): string {
  return `${API_BASE}/api/v1/tasks/${taskId}/manuscript-file`;
}
// Sortie : dépôt de la version corrigée (multipart).
export async function uploadCorrectedFile(taskId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/tasks/${taskId}/corrected-file`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? "Dépôt impossible.");
  return response.json() as Promise<{ corrected_has_file: boolean; version_number: number }>;
}

export interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  confidentiality: string;
}

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  mimeType: string;
  changeSummary: string | null;
  uploadedAt: string;
}

export function createDocument(input: {
  entity_type: string;
  entity_id: string;
  category: string;
  title: string;
  confidentiality?: string;
}) {
  return request<DocumentSummary>("/api/v1/documents", { method: "POST", body: JSON.stringify(input) });
}

// Lien de téléchargement d'une version (le navigateur envoie le cookie de
// session sur la même origine ; l'accès est contrôlé côté serveur).
export function documentVersionDownloadUrl(versionId: string): string {
  return `${API_BASE}/api/v1/document-versions/${versionId}/download`;
}

// ── Planning annuel des événements ──────────────────────────────────────────
export type AnnualEventStatus = "a_venir" | "a_confirmer" | "tenu" | "non_tenu";
export interface AnnualEvent {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  location: string | null;
  dg_present: boolean;
  status: AnnualEventStatus;
  has_affiche: boolean;
  updated_at: string;
}
export interface AnnualEventInput {
  title: string;
  description?: string;
  start_date: string;
  end_date?: string;
  location?: string;
  dg_present?: boolean;
  status?: AnnualEventStatus;
}

export function listAnnualEvents() {
  return request<AnnualEvent[]>("/api/v1/annual-events");
}
export function createAnnualEvent(input: AnnualEventInput) {
  return request<AnnualEvent>("/api/v1/annual-events", { method: "POST", body: JSON.stringify(input) });
}
export function updateAnnualEvent(id: string, input: Partial<AnnualEventInput>) {
  return request<AnnualEvent>(`/api/v1/annual-events/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}
export function deleteAnnualEvent(id: string) {
  return request<{ ok: true }>(`/api/v1/annual-events/${id}`, { method: "DELETE" });
}
// Lien direct de l'affiche (image affichée telle quelle, sans téléchargement).
// Le paramètre `v` casse le cache après une mise à jour de l'affiche.
export function annualEventAfficheUrl(id: string, version?: string, thumb?: boolean): string {
  const q = new URLSearchParams();
  if (version) q.set("v", version);
  if (thumb) q.set("size", "thumb"); // miniature légère pour les aperçus/listes
  const s = q.toString();
  return `${API_BASE}/api/v1/annual-events/${id}/affiche${s ? `?${s}` : ""}`;
}
export async function uploadAnnualEventAffiche(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/v1/annual-events/${id}/affiche`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? `Erreur ${response.status}`);
  }
  return response.json() as Promise<AnnualEvent>;
}

// Couverture « prête pour le web » : version légère (JPG de très bonne qualité)
// transformée à la volée depuis la couverture d'impression. C'est ce lien que le
// maquettiste utilise pour joindre l'image à la fiche du site.
export function siteCoverDownloadUrl(manuscriptId: string, thumb?: boolean): string {
  return `${API_BASE}/api/v1/manuscripts/${manuscriptId}/site-cover${thumb ? "?size=thumb" : ""}`;
}

// « Signaler au pôle » : notifier les titulaires d'un rôle qu'une pièce est
// disponible (la pièce ne bouge pas).
export function notifyDocument(documentId: string, roleCode: string) {
  return request<{ ok: true }>(`/api/v1/documents/${documentId}/notify`, {
    method: "POST",
    body: JSON.stringify({ role_code: roleCode }),
  });
}

export function listDocuments(entityType: string, entityId: string) {
  return request<DocumentSummary[]>(`/api/v1/documents?entity_type=${entityType}&entity_id=${entityId}`);
}

export function listDocumentVersions(documentId: string) {
  return request<DocumentVersionSummary[]>(`/api/v1/documents/${documentId}/versions`);
}

export async function uploadDocumentVersion(documentId: string, file: File, changeSummary?: string) {
  const form = new FormData();
  form.append("file", file);
  if (changeSummary) form.append("change_summary", changeSummary);
  const response = await fetch(`${API_BASE}/api/v1/documents/${documentId}/versions`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? `Erreur ${response.status}`);
  }
  return response.json() as Promise<DocumentVersionSummary>;
}

export interface ComparisonChange {
  type: "added" | "removed" | "unchanged";
  value: string;
}

export interface ComparisonReport {
  left_version: number;
  right_version: number;
  additions: number;
  deletions: number;
  modifications: number;
  changes: ComparisonChange[];
}

export function compareVersions(leftId: string, rightId: string) {
  return request<ComparisonReport>("/api/v1/document-versions/compare", {
    method: "POST",
    body: JSON.stringify({ left_id: leftId, right_id: rightId }),
  });
}

// --- Lot 3 : Maquette, Infographie, ISBN/dépôt légal/métadonnées, BAT, Impression ---

export interface ProductionSpecs {
  trimFormat: string | null;
  finalPages: number | null;
  paperInterior: string | null;
  paperInteriorGsm: number | null;
  paperCover: string | null;
  binding: string | null;
  lamination: string | null;
  spineWidthMm: string | null;
  spineNeedsRecalc: boolean;
}

export function getProductionSpecs(manuscriptId: string) {
  return request<ProductionSpecs | null>(`/api/v1/manuscripts/${manuscriptId}/production-specs`);
}

export function updateProductionSpecs(manuscriptId: string, input: Partial<{
  trim_format: string;
  final_pages: number;
  paper_interior: string;
  paper_interior_gsm: number;
  paper_cover: string;
  binding: string;
  lamination: string;
}>) {
  return request<ProductionSpecs>(`/api/v1/manuscripts/${manuscriptId}/production-specs`, { method: "PATCH", body: JSON.stringify(input) });
}

export type ImageAssetType = "couverture_1" | "couverture_4" | "dos" | "rabat" | "illustration_interieure" | "visuel_marketing";
export type RightsOrigin = "creation_interne" | "banque_images" | "fourni_par_auteur";

export interface ImageAsset {
  id: string;
  type: ImageAssetType;
  resolutionDpi: number | null;
  colorMode: string | null;
  technicalOk: boolean;
  rightsOrigin: RightsOrigin | null;
  can_correct?: boolean;
}

export function listImageAssets(manuscriptId: string) {
  return request<ImageAsset[]>(`/api/v1/manuscripts/${manuscriptId}/image-assets`);
}

// Retrait d'un visuel déposé par erreur (suppression logique ; auteur/direction).
export function deleteImageAsset(manuscriptId: string, assetId: string) {
  return request<{ removed: boolean }>(`/api/v1/manuscripts/${manuscriptId}/image-assets/${assetId}`, { method: "DELETE" });
}

export function createImageAsset(
  manuscriptId: string,
  input: { type: ImageAssetType; resolution_dpi?: number; color_mode?: string; rights_origin?: RightsOrigin },
) {
  return request<ImageAsset>(`/api/v1/manuscripts/${manuscriptId}/image-assets`, { method: "POST", body: JSON.stringify(input) });
}

export interface IsbnPoolSummary {
  id: string;
  prefix: string;
  digitWidth: number;
  available: number;
}

export function listIsbnPools() {
  return request<{ pools: IsbnPoolSummary[]; total_available: number; alert_threshold: number; low_stock: boolean }>("/api/v1/isbn-pools");
}

export function createIsbnPool(input: { prefix: string; digit_width: number; range_start: number; range_end: number }) {
  return request<IsbnPoolSummary>("/api/v1/isbn-pools", { method: "POST", body: JSON.stringify(input) });
}

export type IsbnFormat = "print" | "epub" | "pdf" | "audio";

export interface Isbn {
  id: string;
  isbn13: string;
  format: IsbnFormat;
  status: string;
}

export function listIsbns(manuscriptId: string) {
  return request<Isbn[]>(`/api/v1/manuscripts/${manuscriptId}/isbn`);
}

// Compte auteur (§14) : exemplaires dus (contrat) vs effectivement remis.
export type AuthorCopyCategory = "contractuel" | "gratuit" | "promotionnel" | "evenement" | "achete" | "autre";
export interface AuthorAccount {
  author_free_copies: number | null;
  encore_dus: number | null;
  remis_total: number;
  remis_contractuel: number;
  by_category: Record<AuthorCopyCategory, number>;
  entries: { id: string; category: AuthorCopyCategory; category_label: string; quantity: number; note: string | null; delivered_at: string }[];
}
export function getAuthorAccount(contractId: string) {
  return request<AuthorAccount>(`/api/v1/author-copies/account?contract_id=${encodeURIComponent(contractId)}`);
}
export function setAuthorFreeCopies(contractId: string, value: number | null) {
  return request<{ author_free_copies: number | null }>(`/api/v1/contracts/${contractId}/author-free-copies`, { method: "PATCH", body: JSON.stringify({ author_free_copies: value }) });
}
export function recordAuthorCopy(input: { partner_id: string; isbn_id: string; contract_id?: string; category: AuthorCopyCategory; quantity: number; from_location_id: string; note?: string }) {
  return request(`/api/v1/author-copies`, { method: "POST", body: JSON.stringify(input) });
}

// Catalogue global des ISBN (avec le titre de l'ouvrage) — sélecteur des lignes
// « livre scolaire » à facturer.
export interface IsbnCatalogueItem {
  id: string;
  isbn13: string;
  format: IsbnFormat;
  status: string;
  manuscript: { title: string; subtitle?: string | null; editorialSegment?: EditorialSegment | null } | null;
  // Prix courant HT (dernier tarif), pour pré-remplir le prix unitaire à la sélection.
  price_ht?: number | null;
}
export function listIsbnCatalogue(format?: IsbnFormat) {
  return request<IsbnCatalogueItem[]>(`/api/v1/isbns${format ? `?format=${format}` : ""}`);
}

export function assignIsbn(manuscriptId: string, format: IsbnFormat, poolId?: string) {
  return request<Isbn>(`/api/v1/manuscripts/${manuscriptId}/isbn`, {
    method: "POST",
    body: JSON.stringify({ format, pool_id: poolId }),
  });
}

export function isbnBarcodeUrl(isbnId: string) {
  return `${API_BASE}/api/v1/isbn/${isbnId}/barcode`;
}

export interface LegalDeposit {
  id: string;
  country: string;
  depository: string;
  copiesRequired: number;
  status: string;
  depositedAt: string | null;
}

export function listLegalDeposits(manuscriptId: string) {
  return request<LegalDeposit[]>(`/api/v1/manuscripts/${manuscriptId}/legal-deposits`);
}

export function createLegalDeposit(manuscriptId: string, input: { country: string; depository: string; copies_required: number }) {
  return request<LegalDeposit>(`/api/v1/manuscripts/${manuscriptId}/legal-deposits`, { method: "POST", body: JSON.stringify(input) });
}

export type EditionType = "compte_editeur" | "compte_auteur" | "coedition" | "coproduction" | "partenariat" | "autre";
export type CommercializationStatus = "a_paraitre" | "disponible" | "epuise" | "arret_commercialisation";

export interface WorkMetadata {
  version: number;
  summary: string | null;
  weightGrams: number | null;
  themaCodes: string[];
  editionType: EditionType | null;
  pricePublic: string | null;
  pricePro: string | null;
  priceEditeur: string | null;
  unitProductionCost: string | null;
  commercializationStatus: CommercializationStatus | null;
  isSchoolBook: boolean;
  schoolLevel: string | null;
  schoolSubject: string | null;
  schoolYear: string | null;
}

export function getWorkMetadata(manuscriptId: string) {
  return request<WorkMetadata | null>(`/api/v1/manuscripts/${manuscriptId}/metadata`);
}

export type WorkMetadataInput = Partial<{
  summary: string;
  weight_grams: number;
  thema_codes: string[];
  edition_type: EditionType | null;
  price_public: number | null;
  price_pro: number | null;
  price_editeur: number | null;
  unit_production_cost: number | null;
  commercialization_status: CommercializationStatus | null;
  is_school_book: boolean;
  school_level: string | null;
  school_subject: string | null;
  school_year: string | null;
}>;

export function updateWorkMetadata(manuscriptId: string, input: WorkMetadataInput) {
  return request<WorkMetadata>(`/api/v1/manuscripts/${manuscriptId}/metadata`, { method: "PATCH", body: JSON.stringify(input) });
}

export function getIsbnCompleteness(manuscriptId: string) {
  return request<{ complete: boolean; missing: string[] }>(`/api/v1/manuscripts/${manuscriptId}/isbn-completeness`);
}

export interface ChecklistItem {
  id: string;
  label: string;
  isBlocking: boolean;
  notApplicable: boolean;
  checkedAt: string | null;
  observation: string | null;
}

export interface BatRecord {
  id: string;
  cycleNumber: number;
  status: "in_control" | "corrections_requested" | "awaiting_signature" | "signed" | "cancelled";
  checklist: { items: ChecklistItem[] } | null;
  anomalies: { id: string; description: string; severity: "minor" | "major" | "blocking"; resolvedAt: string | null }[];
}

export function listBatRecords(manuscriptId: string) {
  return request<BatRecord[]>(`/api/v1/manuscripts/${manuscriptId}/bat`);
}

export function openBat(manuscriptId: string, interiorVersionId: string, coverVersionId: string) {
  return request<BatRecord>(`/api/v1/manuscripts/${manuscriptId}/bat`, {
    method: "POST",
    body: JSON.stringify({ interior_version_id: interiorVersionId, cover_version_id: coverVersionId }),
  });
}

export function toggleChecklistItem(itemId: string, checked: boolean) {
  return request<ChecklistItem>(`/api/v1/checklist-items/${itemId}`, { method: "PATCH", body: JSON.stringify({ checked }) });
}

export function addBatAnomaly(batId: string, description: string, severity: "minor" | "major" | "blocking") {
  return request(`/api/v1/bat/${batId}/anomalies`, { method: "POST", body: JSON.stringify({ description, severity }) });
}

export function updateBatStatus(batId: string, status: "corrections_requested" | "awaiting_signature") {
  return request<BatRecord>(`/api/v1/bat/${batId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function signBat(batId: string, authorApproval?: boolean) {
  return request(`/api/v1/bat/${batId}/sign`, { method: "POST", body: JSON.stringify({ author_approval: authorApproval ?? false }) });
}

export interface Printer {
  id: string;
  specialties: string[];
  partner: { id: string; firstName: string; lastName: string };
}

export function listPrinters() {
  return request<Printer[]>("/api/v1/printers");
}

export interface PrintQuote {
  id: string;
  status: "requested" | "received" | "selected" | "declined";
  quantities: number[];
  amounts: Record<string, number> | null;
  leadTimeDays: number | null;
  printer: { id: string; partner: { firstName: string; lastName: string } };
}

export function listPrintQuotes(manuscriptId: string) {
  return request<{ quotes: PrintQuote[]; comparison: { quote_id: string; unit_costs: Record<string, number> }[] }>(
    `/api/v1/manuscripts/${manuscriptId}/print-quotes`,
  );
}

export function requestPrintQuote(manuscriptId: string, printerId: string, quantities: number[]) {
  return request<PrintQuote>(`/api/v1/manuscripts/${manuscriptId}/print-quotes`, {
    method: "POST",
    body: JSON.stringify({ printer_id: printerId, quantities }),
  });
}

export function recordPrintQuoteAmounts(quoteId: string, amounts: Record<string, number>, leadTimeDays?: number) {
  return request<PrintQuote>(`/api/v1/print-quotes/${quoteId}`, {
    method: "PATCH",
    body: JSON.stringify({ amounts, lead_time_days: leadTimeDays }),
  });
}

export function selectPrintQuote(quoteId: string, selectionMotive: string, chosenQuantity: number) {
  return request<PrintQuote>(`/api/v1/print-quotes/${quoteId}/select`, {
    method: "POST",
    body: JSON.stringify({ selection_motive: selectionMotive, chosen_quantity: chosenQuantity }),
  });
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  amount: string;
  orderedQuantity: number;
  currency?: string;
  deliveryDue?: string | null;
  quantityTolerancePct?: string | null;
  printer?: { partner: { firstName: string; lastName: string } };
  quote?: { manuscript?: { title: string; manuscriptNumber: string } | null };
  deliveryLocation?: { label: string } | null;
}

export function createPurchaseOrder(quoteId: string, input: { delivery_due?: string; delivery_location_id?: string; quantity_tolerance_pct?: number }) {
  return request<PurchaseOrder>(`/api/v1/print-quotes/${quoteId}/purchase-order`, { method: "POST", body: JSON.stringify(input) });
}

export function listPurchaseOrders(manuscriptId: string) {
  return request<PurchaseOrder[]>(`/api/v1/manuscripts/${manuscriptId}/purchase-orders`);
}

export function updatePurchaseOrderStatus(poId: string, status: string) {
  return request<PurchaseOrder>(`/api/v1/purchase-orders/${poId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function recordGoodsReceipt(poId: string, quantityReceived: number) {
  return request<{ id: string; variance: number; within_tolerance: boolean }>(`/api/v1/purchase-orders/${poId}/goods-receipts`, {
    method: "POST",
    body: JSON.stringify({ quantity_received: quantityReceived }),
  });
}

// --- Lot 4 : Stock et magasin (Ch. 16), Commercial (Ch. 17) ---

export interface IsbnRef {
  id: string;
  isbn13: string;
  format: IsbnFormat;
  manuscript: { title: string } | null;
}

export function listIsbnRefs(format?: IsbnFormat) {
  const query = format ? `?format=${format}` : "";
  return request<IsbnRef[]>(`/api/v1/isbns${query}`);
}

export type StockLocationType = "entrepot" | "depot" | "depot_vente" | "emplacement" | "stock_commercial";

export interface StockLocation {
  id: string;
  type: StockLocationType;
  label: string;
}

export function listStockLocations() {
  return request<StockLocation[]>("/api/v1/stock-locations");
}

export function createStockLocation(input: { type: StockLocationType; label: string; parent_id?: string; customer_id?: string }) {
  return request<StockLocation>("/api/v1/stock-locations", { method: "POST", body: JSON.stringify(input) });
}

export type StockItemCondition = "vendable" | "declasse";

export interface StockItem {
  id: string;
  isbnId: string;
  locationId: string;
  printRun: number;
  condition: StockItemCondition;
  quantityPhysical: number;
  quantityReserved: number;
  quantityAvailable: number;
  alertThreshold: number | null;
  outOfStockThreshold: number;
  isbn: { isbn13: string };
  location: { label: string };
}

export function listStockItems(filters?: { isbn_id?: string; location_id?: string }) {
  const params = new URLSearchParams();
  if (filters?.isbn_id) params.set("isbn_id", filters.isbn_id);
  if (filters?.location_id) params.set("location_id", filters.location_id);
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<StockItem[]>(`/api/v1/stock-items${query}`);
}

export function listStockAlerts() {
  return request<(StockItem & { severity: "alerte" | "rupture" })[]>("/api/v1/stock-alerts");
}

// Stock consolidé « toutes zones » — stock réel total par ouvrage (vendable vs
// déclassé), avec le détail par lieu.
export interface StockConsolidatedLocation {
  location_id: string;
  location_label: string;
  vendable: number;
  declasse: number;
  perdu: number;
  detruit: number;
}
export interface StockConsolidatedRow {
  isbn_id: string;
  isbn13: string;
  title: string | null;
  author: string | null;
  vendable: number;
  declasse: number;
  perdu: number;
  detruit: number;
  total: number;
  initial_loaded: number;
  by_location: StockConsolidatedLocation[];
}
export interface StockConsolidated {
  rows: StockConsolidatedRow[];
  totals: { vendable: number; declasse: number; perdu: number; detruit: number; total: number };
}
export function getStockConsolidated() {
  return request<StockConsolidated>("/api/v1/stock-consolidated");
}

// Stock d'un ouvrage (par manuscrit) — agrégé par ISBN et par lieu.
export interface ManuscriptStockIsbn {
  isbn_id: string;
  isbn13: string;
  format: string;
  vendable: number;
  declasse: number;
  total: number;
  by_location: { location_id: string; location_label: string; vendable: number; declasse: number }[];
}
export interface ManuscriptStock {
  has_isbn: boolean;
  isbns: ManuscriptStockIsbn[];
}
export function getManuscriptStock(manuscriptId: string) {
  return request<ManuscriptStock>(`/api/v1/manuscripts/${manuscriptId}/stock`);
}

// Rapprochement automatique « titre + quantité » ↔ ouvrages existants.
export interface StockMatchResult {
  label: string;
  quantity: number;
  damaged: number;
  isbn_id: string | null;
  isbn13: string | null;
  matched_title: string | null;
  score: number;
}
export function matchStockInitial(lines: { label: string; quantity: number; damaged?: number }[]) {
  return request<{ results: StockMatchResult[] }>("/api/v1/stock-initial/match", { method: "POST", body: JSON.stringify({ lines }) });
}

// ── Inventaire physique (Ch. 16 §16.8) — campagnes, comptage, écarts ──────────
export type InventoryType = "full" | "rotating";
export type InventoryStatus = "open" | "closed";
export interface InventorySummary {
  id: string;
  type: InventoryType;
  blind: boolean;
  status: InventoryStatus;
  location_label: string | null;
  opened_at: string;
  closed_at: string | null;
  total_lines: number;
  counted_lines: number;
  variance_lines: number;
  damaged_lines: number;
  recount_lines: number;
  pending_adjust: number;
}
export interface InventoryLine {
  id: string;
  isbnId: string;
  title: string | null;
  isbn13: string;
  theoreticalQty?: number; // masqué à l'aveugle tant que non compté
  countedQty: number | null;
  countedDamaged: number | null;
  variance: number | null;
  recountRequired: boolean;
  adjustmentMovementId: string | null;
}
export interface InventoryDetail {
  id: string;
  type: InventoryType;
  blind: boolean;
  status: InventoryStatus;
  location_label: string | null;
  opened_at: string;
  closed_at: string | null;
  lines: InventoryLine[];
}
export function listInventories() {
  return request<InventorySummary[]>("/api/v1/inventories");
}
export function getInventory(id: string) {
  return request<InventoryDetail>(`/api/v1/inventories/${id}`);
}
export function createInventory(input: { location_id: string; type: InventoryType; blind: boolean }) {
  return request<InventoryDetail>("/api/v1/inventories", { method: "POST", body: JSON.stringify(input) });
}
export function countInventoryLine(lineId: string, countedQty: number, countedDamaged = 0) {
  return request<InventoryLine>(`/api/v1/inventory-lines/${lineId}`, { method: "PATCH", body: JSON.stringify({ counted_qty: countedQty, counted_damaged: countedDamaged }) });
}
export function adjustInventoryLine(lineId: string) {
  return request<InventoryLine>(`/api/v1/inventory-lines/${lineId}/adjust`, { method: "POST" });
}
export function closeInventory(id: string) {
  return request<{ id: string; status: InventoryStatus; closed_at: string | null }>(`/api/v1/inventories/${id}/close`, { method: "PATCH" });
}

export type StockMovementType =
  | "production_in"
  | "supplier_in"
  | "sale_out"
  | "consignment_out"
  | "consignment_return"
  | "customer_return"
  | "commercial_return"
  | "transfer"
  | "press_copy"
  | "author_copy"
  | "promotional_out"
  | "institutional_out"
  | "event_out"
  | "free_out"
  | "event_return"
  | "promotional_return"
  | "other_return"
  | "loss"
  | "damage"
  | "destruction"
  | "pulping"
  | "inventory_adjustment";

export function createStockMovement(input: {
  type: StockMovementType;
  isbn_id: string;
  print_run?: number;
  from_location_id?: string;
  to_location_id?: string;
  quantity: number;
  reason: string;
  condition?: "vendable" | "declasse";
}) {
  return request(`/api/v1/stock-movements`, { method: "POST", body: JSON.stringify(input) });
}

export type StockMovementStatus = "pending" | "in_transit" | "completed" | "cancelled";
export interface StockMovement {
  id: string;
  type: StockMovementType;
  isbnId: string;
  isbn13: string | null;
  printRun: number;
  quantity: number;
  reason: string | null;
  condition: "vendable" | "declasse";
  status: StockMovementStatus;
  from_location_label: string | null;
  to_location_label: string | null;
  referenceType: string | null;
  movedAt: string;
  moved_by_name: string | null;
  cancelledAt: string | null;
  cancelled_by_name: string | null;
  cancelReason: string | null;
  editable: boolean;
}

export function listStockMovements(isbnId?: string) {
  const qs = isbnId ? `?isbn_id=${encodeURIComponent(isbnId)}` : "";
  return request<StockMovement[]>(`/api/v1/stock-movements${qs}`);
}

// Corriger une saisie de mouvement (quantité, motif, état) — le stock est
// recalculé automatiquement côté serveur.
export function updateStockMovement(id: string, input: { quantity?: number; reason?: string; condition?: "vendable" | "declasse" }) {
  return request<StockMovement>(`/api/v1/stock-movements/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

// Annuler un mouvement saisi par erreur (contre-passation : l'effet sur le stock
// est neutralisé, l'écriture reste tracée au statut « annulé »).
export function cancelStockMovement(id: string, reason?: string) {
  return request<StockMovement>(`/api/v1/stock-movements/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

// Stock commercial individuel (§10).
export interface CommercialStockReport {
  recus: number;
  vendus: number;
  retournes: number;
  offerts: number;
  pertes: number;
  detenus: number;
  a_justifier: number;
}
export interface CommercialStockRow extends CommercialStockReport {
  user_id: string | null;
  commercial_name: string | null;
  location_id: string;
}
export interface CommercialPick { id: string; name: string; }

export function listStockCommercials() {
  return request<CommercialPick[]>("/api/v1/commercial-stock/commercials");
}
export function getCommercialStockAll() {
  return request<{ reps: CommercialStockRow[]; total: CommercialStockReport }>("/api/v1/commercial-stock");
}
export function getMyCommercialStock() {
  return request<CommercialStockReport & { location_id: string | null }>("/api/v1/commercial-stock/mine");
}
export function handoverToCommercial(userId: string, input: { isbn_id: string; quantity: number; location_id: string; print_run?: number; reason?: string }) {
  return request(`/api/v1/commercial-stock/${userId}/handover`, { method: "POST", body: JSON.stringify(input) });
}
export function returnFromCommercial(userId: string, input: { isbn_id: string; quantity: number; location_id: string; print_run?: number; reason?: string }) {
  return request(`/api/v1/commercial-stock/${userId}/return`, { method: "POST", body: JSON.stringify(input) });
}

export type CustomerCategory = "librairie" | "distributeur" | "institution" | "particulier" | "plateforme" | "auteur";

export interface Customer {
  id: string;
  category: CustomerCategory;
  name: string;
  creditLimit: string | null;
  // Coordonnées déjà renvoyées par l'API (fiche client) — optionnelles ici pour
  // ne pas casser les usages qui n'en ont pas besoin.
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  relationMode?: string | null;
  paymentTerms?: string | null;
  taxId?: string | null;
  shippingZone?: string | null;
}

export function listCustomers(category?: CustomerCategory) {
  const query = category ? `?category=${category}` : "";
  return request<Customer[]>(`/api/v1/customers${query}`);
}

export function createCustomer(input: { category: CustomerCategory; name: string; contact_name?: string; email?: string; phone?: string; address?: string; credit_limit?: number; shipping_zone?: string }) {
  return request<Customer>("/api/v1/customers", { method: "POST", body: JSON.stringify(input) });
}

export function getCustomer(id: string) {
  return request<Customer & { outstandingBalance: number }>(`/api/v1/customers/${id}`);
}

// Suppression logique d'un client (fiches de test / doublons). Bloquée côté
// serveur si le client a un historique comptable.
export function deleteCustomer(id: string) {
  return request<{ deleted: true }>(`/api/v1/customers/${id}`, { method: "DELETE" });
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  status: string;
  channel: string;
  blockReason: string | null;
  customer: { name: string };
  lines: { isbnId: string; quantity: number; unitPrice: string; discountPct: string }[];
}

export function listSalesOrders(filters?: { customer_id?: string }) {
  const query = filters?.customer_id ? `?customer_id=${filters.customer_id}` : "";
  return request<SalesOrder[]>(`/api/v1/sales-orders${query}`);
}

export function createSalesOrder(input: {
  customer_id: string;
  channel: string;
  location_id: string;
  lines: { isbn_id: string; quantity: number; unit_price: number }[];
}) {
  return request<SalesOrder>("/api/v1/sales-orders", { method: "POST", body: JSON.stringify(input) });
}

export function approveSalesOrder(id: string) {
  return request<SalesOrder>(`/api/v1/sales-orders/${id}/approve`, { method: "POST", body: "{}" });
}

export function createPosSale(input: {
  isbn_id?: string;
  location_id?: string;
  off_catalogue_title?: string;
  off_catalogue_author?: string;
  off_catalogue_isbn?: string;
  quantity: number;
  unit_price: number;
  payment_method: "cash" | "card" | "mobile_money";
  event_label?: string;
  customer_id?: string;
  point_of_sale_id?: string;
}) {
  return request(`/api/v1/pos-sales`, { method: "POST", body: JSON.stringify(input) });
}

// Ligne de vente au comptoir enrichie (registre des ventes).
export interface PosSaleRow {
  id: string;
  sold_at: string;
  is_catalogue: boolean;
  isbn13: string | null;
  title: string | null;
  author: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  payment_method: "cash" | "card" | "mobile_money";
  event_label: string | null;
  customer_name: string | null;
  point_of_sale: string | null;
  sold_by: string | null;
  // Annulation (suppression logique) : la vente reste affichée, barrée.
  cancelled: boolean;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
}
// Ventes provisoires « hors catalogue » à rattacher à un ouvrage officiel.
export function listProvisionalPosSales() {
  return request<PosSaleRow[]>("/api/v1/pos-sales?provisional=true");
}
// Registre des ventes du commercial courant (visible dès l'enregistrement).
export function listMyPosSales() {
  return request<PosSaleRow[]>("/api/v1/pos-sales?mine=true");
}

// Récapitulatif annuel des ventes au comptoir, par ouvrage et par auteur.
export interface SalesAnnualRow { key: string; label: string; sublabel: string | null; quantity: number; revenue: number }
export interface SalesAnnual {
  year: number;
  by_book: SalesAnnualRow[];
  by_author: SalesAnnualRow[];
  totals: { quantity: number; revenue: number; sales_count: number };
}
export function getSalesAnnual(year: number) {
  return request<SalesAnnual>(`/api/v1/commercial/sales-annual?year=${year}`);
}

// Tableau de bord individuel de performance commerciale (« Mes performances »).
export interface MyPerformance {
  scope: "individual" | "consolidated";
  can_see_others: boolean;
  objective: { year: number; target_revenue: number; ytd_revenue: number; realization_pct: number } | null;
  revenue: number;
  sales_count: number;
  orders_count: number;
  avg_sale: number;
  transformation_rate: number;
  orders_delivered: number;
  orders_cancelled: number;
  orders_pending: number;
  new_customers: number;
  active_customers: number;
  top_customers: { name: string; revenue: number }[];
  top_books: { title: string; units: number }[];
  by_period: { today: number; week: number; month: number; year: number };
  series: { month: string; revenue: number }[];
  payments: { received: number; pending: number; overdue: number; unpaid_count: number };
}
export interface SalesTargetRow { user_id: string; username: string; year: number; target_revenue: number }
export function getSalesTargets(year?: number) {
  return request<{ year: number; can_manage: boolean; targets: SalesTargetRow[]; candidates: { id: string; username: string }[] }>(`/api/v1/commercial/targets${year ? `?year=${year}` : ""}`);
}
export function setSalesTarget(input: { user_id: string; year: number; target_revenue: number }) {
  return request<{ user_id: string; year: number; target_revenue: number }>("/api/v1/commercial/targets", { method: "PUT", body: JSON.stringify(input) });
}
export function getMyPerformance(params?: { from?: string; to?: string; rep?: string }) {
  const p = new URLSearchParams();
  if (params?.from) p.set("from", params.from);
  if (params?.to) p.set("to", params.to);
  if (params?.rep) p.set("rep", params.rep);
  const qs = p.toString();
  return request<MyPerformance>(`/api/v1/commercial/my-performance${qs ? "?" + qs : ""}`);
}

// Performance PAR commercial + total de l'équipe (responsable commercial / DG).
export interface TeamPerformanceRep {
  user_id: string | null;
  username: string;
  revenue: number;
  pos_count: number;
  orders_count: number;
}
export interface TeamPerformance {
  reps: TeamPerformanceRep[];
  total: { revenue: number; pos_count: number; orders_count: number };
}
export function getTeamPerformance(params?: { from?: string; to?: string }) {
  const p = new URLSearchParams();
  if (params?.from) p.set("from", params.from);
  if (params?.to) p.set("to", params.to);
  const qs = p.toString();
  return request<TeamPerformance>(`/api/v1/commercial/team-performance${qs ? "?" + qs : ""}`);
}
export function reconcilePosSale(id: string, isbnId: string) {
  return request<{ reconciled: true; invoice_id: string }>(`/api/v1/pos-sales/${id}/reconcile`, { method: "POST", body: JSON.stringify({ isbn_id: isbnId }) });
}
// Annuler une vente au comptoir saisie par erreur (motif obligatoire). La vente
// n'est jamais effacée : elle passe « annulée ». Une vente au catalogue déclenche
// un avoir + contre-passation des droits d'auteur + notification à la Finance.
export function cancelPosSale(id: string, reason: string) {
  return request<{ id: string; cancelled_at: string; cancellation_reason: string; credit_note_id: string | null }>(
    `/api/v1/pos-sales/${id}/cancel`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

// Points de vente (librairie, salon, boutique en ligne…) — dimension des rapports.
export type PointOfSaleType = "librairie" | "salon" | "en_ligne" | "autre";
export interface PointOfSale {
  id: string;
  name: string;
  type: PointOfSaleType;
  active: boolean;
}
export function listPointsOfSale() {
  return request<PointOfSale[]>(`/api/v1/points-of-sale`);
}
export function createPointOfSale(input: { name: string; type: PointOfSaleType }) {
  return request<PointOfSale>(`/api/v1/points-of-sale`, { method: "POST", body: JSON.stringify(input) });
}
export function updatePointOfSale(id: string, input: { name?: string; type?: PointOfSaleType; active?: boolean }) {
  return request<PointOfSale>(`/api/v1/points-of-sale/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

// Rapport d'encaissements (par mode, compte, point de vente), filtrable période.
export interface PaymentReport {
  from: string | null;
  to: string | null;
  total_in: number;
  by_method: { method: string; label: string; total: number; count: number }[];
  by_account: { account_id: string | null; label: string; total: number; count: number }[];
  by_point_of_sale: { point_of_sale_id: string | null; name: string; total: number; count: number }[];
}
export function getPaymentReport(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<PaymentReport>(`/api/v1/finance/payment-report${qs ? `?${qs}` : ""}`);
}

// Échéancier de crédit d'une facture.
export interface InvoiceSchedule {
  invoice_id: string;
  total_ttc: number;
  settled: number;
  planned: number;
  installments: { id: string; due_date: string; amount: number; note: string | null; status: "paid" | "partial" | "pending" | "overdue" }[];
}
export function getInvoiceSchedule(id: string) {
  return request<InvoiceSchedule>(`/api/v1/invoices/${id}/schedule`);
}
export function setInvoiceSchedule(id: string, installments: { due_date: string; amount: number; note?: string }[]) {
  return request<InvoiceSchedule>(`/api/v1/invoices/${id}/schedule`, { method: "POST", body: JSON.stringify({ installments }) });
}

// Export comptable normalisé (Ch. 18 §18.10, Option B) : les écritures d'un mois
// (factures, encaissements, dépenses) avec comptes SYSCOHADA, pour le comptable
// externe. Le CSV est renvoyé prêt à enregistrer, avec un contrôle d'exhaustivité
// (nombre de lignes + empreinte). Les numéros de compte sont INDICATIFS.
export interface AccountingExport {
  id: string;
  periodKey: string;
  format: string;
  lineCount: number;
  checksum: string;
  createdBy: string | null;
  createdAt: string;
}
export interface AccountingExportResult extends AccountingExport {
  csv: string;
  chart_of_accounts_status: string;
}
export function listAccountingExports() {
  return request<AccountingExport[]>(`/api/v1/accounting/exports`);
}
export function createAccountingExport(periodKey: string) {
  return request<AccountingExportResult>(`/api/v1/accounting/exports`, { method: "POST", body: JSON.stringify({ period_key: periodKey }) });
}

// Ch. 18 : Finance et comptabilité (Lot 5).
export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: "invoice" | "credit_note" | "proforma";
  status: string;
  totalHt: string;
  totalTax: string;
  // Remise commerciale globale (0–100 %) : totalTtc est le NET à payer après remise.
  discountPct?: string;
  totalTtc: string;
  dueDate: string | null;
  createdAt: string;
  customer: { name: string };
  // Date de première impression : une fois « tirée », la facture n'est plus annulable.
  printedAt?: string | null;
}
export function markInvoicePrinted(id: string) {
  return request<{ ok: true; printed_at: string | null }>(`/api/v1/invoices/${id}/mark-printed`, { method: "POST" });
}

export function listInvoices(filters?: { customer_id?: string; type?: string }) {
  const params = new URLSearchParams();
  if (filters?.customer_id) params.set("customer_id", filters.customer_id);
  if (filters?.type) params.set("type", filters.type);
  const query = params.toString() ? `?${params}` : "";
  return request<Invoice[]>(`/api/v1/invoices${query}`);
}

// Facture détaillée (pour l'impression / export PDF) : lignes, totaux et devise.
export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
}

export interface InvoiceDetail extends Invoice {
  currency: string;
  lines: InvoiceLine[];
  customer: { name: string; category?: CustomerCategory };
}

export function getInvoice(id: string) {
  return request<InvoiceDetail>(`/api/v1/invoices/${id}`);
}

// Envoi d'une facture par e-mail (le corps de l'e-mail est le document).
// `previewInvoiceEmail` renvoie l'aperçu sans envoyer ; `sendInvoiceEmail` envoie.
export function previewInvoiceEmail(id: string, message: string) {
  return request<{ subject: string; html: string; default_to: string | null }>(`/api/v1/invoices/${id}/email`, {
    method: "POST",
    body: JSON.stringify({ message, preview: true }),
  });
}

export function sendInvoiceEmail(id: string, to: string, message: string) {
  return request<{ sent: boolean; to: string }>(`/api/v1/invoices/${id}/email`, {
    method: "POST",
    body: JSON.stringify({ to, message }),
  });
}

// Taux de TVA paramétrables (Ch. 18 §18.9), par pays × type de produit.
export interface TaxRate {
  id: string;
  country: string;
  productType: string;
  rate: string;
}

export function listTaxRates() {
  return request<TaxRate[]>("/api/v1/tax-rates");
}

export function setTaxRate(input: { country: string; product_type: string; rate: number }) {
  return request<TaxRate>("/api/v1/tax-rates", { method: "POST", body: JSON.stringify(input) });
}

export interface AgingBalance {
  not_due: number;
  d30: number;
  d60: number;
  d90_plus: number;
}

export function getCustomerAging(customerId: string) {
  return request<AgingBalance>(`/api/v1/customers/${customerId}/aging`);
}

export function createPayment(input: {
  method: string;
  reference?: string;
  bank_account_id?: string;
  amount: number;
  allocations: { invoice_id: string; amount: number }[];
}) {
  return request(`/api/v1/payments`, { method: "POST", body: JSON.stringify(input) });
}

// Modes de paiement configurables (paramétrables par l'administrateur).
export type PaymentMethodKind = "especes" | "virement" | "cheque" | "carte" | "mobile_money" | "autre";

export interface PaymentMethodDef {
  id: string;
  code: string;
  label: string;
  kind: PaymentMethodKind;
  active: boolean;
  sortOrder: number;
  defaultAccountId: string | null;
}

export function listPaymentMethods() {
  return request<PaymentMethodDef[]>(`/api/v1/payment-methods`);
}

export function createPaymentMethod(input: { code: string; label: string; kind: PaymentMethodKind; default_account_id?: string | null; sort_order?: number }) {
  return request<PaymentMethodDef>(`/api/v1/payment-methods`, { method: "POST", body: JSON.stringify(input) });
}

export function updatePaymentMethod(
  id: string,
  input: { label?: string; kind?: PaymentMethodKind; active?: boolean; default_account_id?: string | null; sort_order?: number },
) {
  return request<PaymentMethodDef>(`/api/v1/payment-methods/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export interface Dunning {
  id: string;
  level: "rappel" | "mise_en_demeure";
  outstandingAmount: string;
  sentAt: string;
}

export function nextDunning(customerId: string) {
  return request<Dunning>(`/api/v1/dunning/${customerId}/next`, { method: "POST", body: "{}" });
}

export function listCustomerDunnings(customerId: string) {
  return request<Dunning[]>(`/api/v1/customers/${customerId}/dunning`);
}

export type ExpenseCategory = "loyer" | "salaire" | "prestation" | "transport" | "communication" | "abonnement" | "autre";

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: string;
  status: "a_valider" | "validee" | "payee" | "rejetee";
  supplier: string | null;
  description: string | null;
  createdBy: string | null;
}

export function listExpenses(manuscriptId?: string) {
  const query = manuscriptId ? `?manuscript_id=${manuscriptId}` : "";
  return request<Expense[]>(`/api/v1/expenses${query}`);
}

export function createExpense(input: { category: ExpenseCategory; amount: number; supplier?: string; manuscript_id?: string; description?: string }) {
  return request<Expense>(`/api/v1/expenses`, { method: "POST", body: JSON.stringify(input) });
}

export function validateExpense(id: string) {
  return request<Expense>(`/api/v1/expenses/${id}/validate`, { method: "PATCH", body: "{}" });
}

export interface ManuscriptProfitability {
  total_cost: number;
  net_sales: number;
  margin: number;
  coverage_ratio: number | null;
  units_to_break_even: number | null;
}

export function getManuscriptProfitability(manuscriptId: string) {
  return request<ManuscriptProfitability>(`/api/v1/manuscripts/${manuscriptId}/profitability`);
}

export interface TreasuryForecastWindow {
  from: string;
  to: string;
  expected_inflow: number;
  expected_outflow: number;
  projected_balance: number;
}

export function getTreasuryForecast(horizonDays = 90) {
  return request<{ current_position: number; horizon_days: number; windows: TreasuryForecastWindow[]; alert: boolean }>(
    `/api/v1/treasury/forecast?horizon=${horizonDays}d`,
  );
}

// Ch. 9 §9.5, Ch. 18 §18.7 : moteur de droits d'auteur — exécution financière.
export interface RoyaltyStatement {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalEarned: string;
  advanceRecouped: string;
  balanceDue: string;
  status: "draft" | "issued" | "paid";
  contract: { contractNumber: string; partner: { firstName: string; lastName: string } };
  remaining_balance?: number;
}

export function listRoyaltyStatements(contractId?: string) {
  const query = contractId ? `?contract_id=${contractId}` : "";
  return request<RoyaltyStatement[]>(`/api/v1/royalty-statements${query}`);
}

// État annuel des droits d'auteur PAR AUTEUR : tous les ouvrages d'un auteur sur
// une année, avec le taux par livre (droits acquis) + récapitulatif fiscal
// (versé brut, retenue à la source, net). Alimente l'impression de l'état annuel.
export interface AuthorRoyaltyBook {
  contract_id: string;
  contract_number: string;
  title: string;
  units: number;
  base: number;
  rate: number;
  earned: number;
}
export interface AuthorRoyaltyRow {
  partner_id: string;
  author_name: string;
  books: AuthorRoyaltyBook[];
  earned: number;
  paid_gross: number;
  tax_withheld: number;
  paid_net: number;
  remaining: number;
}
export interface AuthorRoyaltyResult {
  year: number;
  by_author: AuthorRoyaltyRow[];
  totals: { earned: number; paid_gross: number; tax_withheld: number; paid_net: number; remaining: number };
}
export function getAuthorRoyalties(params: { year?: number; partner_id?: string }) {
  const q = new URLSearchParams();
  if (params.year) q.set("year", String(params.year));
  if (params.partner_id) q.set("partner_id", params.partner_id);
  const query = q.toString() ? `?${q}` : "";
  return request<AuthorRoyaltyResult>(`/api/v1/royalties/by-author${query}`);
}

// Retenue à la source sur les droits d'auteur : option activable/désactivable
// (réglage DAF). Décochée, aucune retenue par défaut n'entre dans les documents.
export function getRoyaltyWithholdingEnabled() {
  return request<{ enabled: boolean }>(`/api/v1/royalties/withholding-enabled`);
}
export function setRoyaltyWithholdingEnabled(enabled: boolean) {
  return request<{ enabled: boolean }>(`/api/v1/royalties/withholding-enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

// Droits d'auteur du LIVRE SCOLAIRE : taux maison (12 % par défaut, modulable)
// et relevé segmenté par ouvrage (auteur, co-auteurs, ISBN, prix unitaire).
export function getSchoolRoyaltyRate() {
  return request<{ rate: number }>(`/api/v1/royalties/school-rate`);
}
export function setSchoolRoyaltyRate(rate: number) {
  return request<{ rate: number }>(`/api/v1/royalties/school-rate`, { method: "PUT", body: JSON.stringify({ rate }) });
}
export interface SchoolRoyaltyBook {
  manuscript_id: string | null;
  isbn_code: string | null;
  book_title: string;
  author_name: string | null;
  co_authors: string[];
  unit_price_ht: number;
  units: number;
  base: number;
  earned: number;
  rate: number | null;
}
export interface SchoolRoyaltyReport {
  total: { units: number; base: number; earned: number };
  by_book: SchoolRoyaltyBook[];
}
export function getSchoolRoyalties(params: { year?: number; manuscript_id?: string } = {}) {
  const q = new URLSearchParams();
  if (params.year) q.set("year", String(params.year));
  if (params.manuscript_id) q.set("manuscript_id", params.manuscript_id);
  const query = q.toString() ? `?${q}` : "";
  return request<SchoolRoyaltyReport>(`/api/v1/royalties/school${query}`);
}

// Génération de fin d'année des états de droits d'auteur : état d'avancement
// (échéance au dernier jour ouvrable, déjà généré ou non, récapitulatif) et
// déclenchement manuel d'une année.
export interface RoyaltyYearEndStatus {
  year: number;
  closure_date: string;
  days_until_closure: number;
  is_generated: boolean;
  generated_at: string | null;
  statements_created: number | null;
  authors: number;
  total_earned: number;
  total_paid_gross: number;
  total_remaining: number;
}
export function getRoyaltyYearEndStatus() {
  return request<RoyaltyYearEndStatus>(`/api/v1/royalties/year-end`);
}
export function generateRoyaltyYearEnd(year: number) {
  return request<{ year: number; statements_created: number }>(`/api/v1/royalties/year-end/generate`, { method: "POST", body: JSON.stringify({ year }) });
}

// Relevé détaillé (pour l'impression) : lignes de calcul des droits.
export interface RoyaltyEntry {
  id: string;
  sourceType: string;
  quantity: number;
  unitBaseAmount: string;
  rateApplied: string;
  amount: string;
}

export interface RoyaltyStatementDetail extends RoyaltyStatement {
  entries: RoyaltyEntry[];
}

export function getRoyaltyStatement(statementId: string) {
  return request<RoyaltyStatementDetail>(`/api/v1/royalty-statements/${statementId}`);
}

export function previewRoyaltyStatementEmail(id: string, message: string) {
  return request<{ subject: string; html: string; default_to: string | null }>(`/api/v1/royalty-statements/${id}/email`, {
    method: "POST",
    body: JSON.stringify({ message, preview: true }),
  });
}

export function sendRoyaltyStatementEmail(id: string, to: string, message: string) {
  return request<{ sent: boolean; to: string }>(`/api/v1/royalty-statements/${id}/email`, {
    method: "POST",
    body: JSON.stringify({ to, message }),
  });
}

export function generateRoyaltyStatement(contractId: string, input: { period_start: string; period_end: string }) {
  return request<RoyaltyStatement>(`/api/v1/contracts/${contractId}/royalty-statements`, { method: "POST", body: JSON.stringify(input) });
}

export function payRoyaltyStatement(
  statementId: string,
  input: { method: string; bank_account_id?: string; tax_withheld?: number; amount?: number },
) {
  return request(`/api/v1/royalty-statements/${statementId}/payments`, { method: "POST", body: JSON.stringify(input) });
}

// Répartition des droits entre plusieurs bénéficiaires d'un même contrat
// (revue opérateur du 04/07/2026 : auteur + illustrateur, coauteurs...).
export interface ContractBeneficiary {
  id: string;
  partnerId: string;
  sharePct: string;
  partner: { firstName: string; lastName: string };
}

export function listContractBeneficiaries(contractId: string) {
  return request<ContractBeneficiary[]>(`/api/v1/contracts/${contractId}/beneficiaries`);
}

export function setContractBeneficiaries(contractId: string, beneficiaries: { partner_id: string; share_pct: number }[]) {
  return request<ContractBeneficiary[]>(`/api/v1/contracts/${contractId}/beneficiaries`, {
    method: "POST",
    body: JSON.stringify({ beneficiaries }),
  });
}

// Frais de port (Ch. 17 §17.5, ajouté hors cahier des charges initial).
export type ShippingZone = "yaounde" | "douala" | "autres_villes_cameroun" | "international";

export interface ShippingRate {
  id: string;
  zone: ShippingZone;
  flatAmount: string | null;
  perKgAmount: string | null;
  freeAboveAmount: string | null;
}

export function listShippingRates() {
  return request<ShippingRate[]>(`/api/v1/shipping-rates`);
}

export function setShippingRate(input: { zone: ShippingZone; flat_amount?: number; per_kg_amount?: number; free_above_amount?: number }) {
  return request<ShippingRate>(`/api/v1/shipping-rates`, { method: "POST", body: JSON.stringify(input) });
}

// Trésorerie : comptes/caisses, virements internes, rapprochement bancaire (Ch. 18 §18.8).
export type BankAccountType = "banque" | "caisse" | "mobile_money";

export interface BankAccount {
  id: string;
  label: string;
  type: BankAccountType;
  currency: string;
}

export function listBankAccounts() {
  return request<BankAccount[]>(`/api/v1/bank-accounts`);
}

export function createBankAccount(input: { label: string; type: BankAccountType; currency?: string }) {
  return request<BankAccount>(`/api/v1/bank-accounts`, { method: "POST", body: JSON.stringify(input) });
}

export function getBankAccountBalance(id: string) {
  return request<{ account_id: string; balance: number }>(`/api/v1/bank-accounts/${id}/balance`);
}

export function createAccountTransfer(input: { from_account_id: string; to_account_id: string; amount: number; reason?: string }) {
  return request(`/api/v1/account-transfers`, { method: "POST", body: JSON.stringify(input) });
}

// --- Lot 6 : RH (Ch. 19), Direction générale (Ch. 5), Rapports (Ch. 20) ---

export type EmployeeStatus = "salarie" | "prestataire_externe" | "stagiaire" | "benevole";

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  status: EmployeeStatus;
  position: string | null;
  hireDate: string | null;
  birthDate: string | null;
  maritalStatus: string | null;
  childrenCount: number | null;
  phone: string | null;
  emergencyContact: string | null;
  niu: string | null;
  leaveTakenDays: string | null;
  departureDate: string | null;
  leaveBalanceDays: string;
  department: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  user?: { id: string; username: string; status: string } | null;
}

export function listEmployees(filters?: { department_id?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.department_id) params.set("department_id", filters.department_id);
  if (filters?.status) params.set("status", filters.status);
  const query = params.toString() ? `?${params}` : "";
  return request<Employee[]>(`/api/v1/employees${query}`);
}

// Alertes d'expiration des contrats de travail (refonte RH — Étape 3).
export interface ContractAlert {
  contract_id: string;
  employee: string;
  position: string | null;
  type: string;
  end_date: string;
  status: "expiring" | "expired";
  days_left: number | null;
}
export function getContractAlerts(days?: number) {
  return request<{ horizon_days: number; alerts: ContractAlert[] }>(`/api/v1/hr/contract-alerts${days ? `?days=${days}` : ""}`);
}

// Tableau de bord RH (remplace l'ancien tableau de présence) : effectif,
// contrats à échéance, congés, recrutement & formation.
export interface HrDashboard {
  effectif: {
    total: number;
    by_department: { name: string; count: number }[];
    by_contract_type: { type: string; count: number }[];
    by_status: { status: string; count: number }[];
  };
  contracts: {
    ending_soon: { employee: string; position: string | null; type: string; end_date: string; days_left: number | null }[];
  };
  leaves: {
    balance_total_days: number;
    pending_count: number;
    ongoing_count: number;
    upcoming_count: number;
    pending: { employee: string; from: string; to: string }[];
  };
  recruitment_training: {
    open_positions: number;
    applications_active: number;
    trainings_planned: number;
    training_requests_pending: number;
  };
}
export function getHrDashboard() {
  return request<HrDashboard>("/api/v1/hr/dashboard");
}

// Détection des doublons d'employés (même nom/prénom, insensible casse/accents).
export interface DuplicateRecord {
  employee_id: string;
  name: string;
  matricule: string | null;
  phone: string | null;
  hire_date: string | null;
  created_at: string;
  linked_total: number;
  linked: { contrats: number; absences: number; bulletins: number; variables_paie: number; evaluations: number; formations: number };
}
export interface DuplicateGroup { key: string; records: DuplicateRecord[] }
export function getDuplicateEmployees() {
  return request<{ groups: DuplicateGroup[]; total_groups: number }>("/api/v1/hr/duplicates");
}
export function deleteEmployee(id: string) {
  return request<{ deleted: true; name: string }>(`/api/v1/employees/${id}`, { method: "DELETE" });
}

// Corbeille RH : fiches supprimées (logiquement) + restauration.
export interface DeletedEmployee {
  employee_id: string;
  name: string;
  matricule: string | null;
  department: string | null;
  deleted_at: string;
  has_payslips: boolean;
}
export function getDeletedEmployees() {
  return request<{ deleted: DeletedEmployee[] }>("/api/v1/employees/deleted");
}
export function restoreEmployee(id: string) {
  return request<{ restored: true; name: string }>(`/api/v1/employees/${id}/restore`, { method: "POST" });
}

// Contrats de travail & avenants (refonte RH — Étape 3).
export interface HrContractAmendment {
  id: string;
  effectiveDate: string;
  subject: string;
  description: string | null;
  createdAt: string;
}
export interface HrContractRow {
  id: string;
  type: "cdi" | "cdd" | "stage" | "prestation";
  startDate: string;
  endDate: string | null;
  amendments: HrContractAmendment[];
}
export function getEmployeeContracts(employeeId: string) {
  return request<HrContractRow[]>(`/api/v1/employees/${employeeId}/contracts`);
}
export function createEmployeeContract(employeeId: string, input: { type: string; start_date: string; end_date?: string }) {
  return request<HrContractRow>(`/api/v1/employees/${employeeId}/contracts`, { method: "POST", body: JSON.stringify(input) });
}
export function addContractAmendment(employeeId: string, contractId: string, input: { effective_date: string; subject: string; description?: string }) {
  return request<HrContractAmendment>(`/api/v1/employees/${employeeId}/contracts/${contractId}/amendments`, { method: "POST", body: JSON.stringify(input) });
}

// Évaluation annuelle du collaborateur (note + objectifs individuels).
export interface EmployeeEvaluation {
  id: string;
  year: number;
  rating: number;
  strengths: string | null;
  areasToImprove: string | null;
  objectives: string | null;
  createdAt: string;
}
export function getEmployeeEvaluations(employeeId: string) {
  return request<EmployeeEvaluation[]>(`/api/v1/employees/${employeeId}/evaluations`);
}
export function saveEmployeeEvaluation(employeeId: string, input: { year: number; rating: number; strengths?: string; areas_to_improve?: string; objectives?: string }) {
  return request<EmployeeEvaluation>(`/api/v1/employees/${employeeId}/evaluations`, { method: "PUT", body: JSON.stringify(input) });
}

// Demandes Finance depuis la fiche manuscrit : devis / facture frais de dépôt.
export type FinanceRequestType = "devis" | "frais_depot";
export type FinanceRequestStatus = "requested" | "processed" | "rejected";
export interface ManuscriptFinanceRequest {
  id: string;
  type: FinanceRequestType;
  status: FinanceRequestStatus;
  note: string | null;
  requestedAt: string;
  processedAt: string | null;
  resolution: string | null;
}
export interface FinanceRequestQueueRow {
  id: string;
  type: FinanceRequestType;
  status: FinanceRequestStatus;
  note: string | null;
  requested_at: string;
  initiated_by: string | null;
  manuscript_id: string;
  manuscript_number: string;
  title: string;
  funding_mode: string;
  author: string | null;
}
export function getManuscriptFinanceRequests(manuscriptId: string) {
  return request<ManuscriptFinanceRequest[]>(`/api/v1/manuscripts/${manuscriptId}/finance-requests`);
}
export function createFinanceRequest(manuscriptId: string, type: FinanceRequestType, note?: string) {
  return request<ManuscriptFinanceRequest>(`/api/v1/manuscripts/${manuscriptId}/finance-requests`, { method: "POST", body: JSON.stringify({ type, note }) });
}
export function getFinanceRequests(status?: FinanceRequestStatus) {
  return request<FinanceRequestQueueRow[]>(`/api/v1/finance-requests${status ? `?status=${status}` : ""}`);
}
export function resolveFinanceRequest(id: string, status: "processed" | "rejected", resolution?: string) {
  return request<ManuscriptFinanceRequest>(`/api/v1/finance-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status, resolution }) });
}

// Recrutement — postes à pourvoir & candidatures.
export type JobOpeningStatus = "ouvert" | "pourvu" | "annule";
export type JobApplicationStatus = "recue" | "entretien" | "retenue" | "refusee";
export interface JobOpening {
  id: string;
  title: string;
  department: string | null;
  contract_type: string | null;
  description: string | null;
  status: JobOpeningStatus;
  opened_at: string;
  closed_at: string | null;
  applications_total: number;
  applications_by_status: Record<JobApplicationStatus, number>;
}
export interface JobApplication {
  id: string;
  jobOpeningId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: JobApplicationStatus;
  notes: string | null;
  appliedAt: string;
  decidedAt: string | null;
}
export function getJobOpenings(status?: JobOpeningStatus) {
  return request<JobOpening[]>(`/api/v1/job-openings${status ? `?status=${status}` : ""}`);
}
export function createJobOpening(input: { title: string; department_id?: string; contract_type?: string; description?: string }) {
  return request<JobOpening>(`/api/v1/job-openings`, { method: "POST", body: JSON.stringify(input) });
}
export function setJobOpeningStatus(id: string, status: JobOpeningStatus) {
  return request<JobOpening>(`/api/v1/job-openings/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}
export function getJobApplications(openingId: string) {
  return request<JobApplication[]>(`/api/v1/job-openings/${openingId}/applications`);
}
export function createJobApplication(openingId: string, input: { first_name: string; last_name: string; email?: string; phone?: string; source?: string; notes?: string }) {
  return request<JobApplication>(`/api/v1/job-openings/${openingId}/applications`, { method: "POST", body: JSON.stringify(input) });
}
export function setJobApplicationStatus(id: string, status: JobApplicationStatus, notes?: string) {
  return request<JobApplication>(`/api/v1/job-applications/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, notes }) });
}

// Formation — demandes, sessions & suivi de participation.
export type TrainingRequestStatus = "demandee" | "approuvee" | "refusee" | "planifiee";
export type TrainingSessionStatus = "planifiee" | "realisee" | "annulee";
export type TrainingSessionMode = "presentiel" | "distanciel";
export type TrainingParticipationStatus = "inscrit" | "present" | "absent";
export interface TrainingRequest {
  id: string;
  employee_id: string;
  employee: string;
  topic: string;
  motivation: string | null;
  status: TrainingRequestStatus;
  decided_at: string | null;
  created_at: string;
}
export interface TrainingSession {
  id: string;
  title: string;
  provider: string | null;
  theme: string | null;
  mode: TrainingSessionMode;
  session_date: string | null;
  status: TrainingSessionStatus;
  cost: string | null;
  participants_total: number;
  participants_by_status: Record<TrainingParticipationStatus, number>;
}
export interface TrainingParticipant {
  id: string;
  employee_id: string;
  employee: string;
  status: TrainingParticipationStatus;
}
export function getTrainingRequests(status?: TrainingRequestStatus) {
  return request<TrainingRequest[]>(`/api/v1/training-requests${status ? `?status=${status}` : ""}`);
}
export function createTrainingRequest(input: { employee_id: string; topic: string; motivation?: string }) {
  return request<TrainingRequest>(`/api/v1/training-requests`, { method: "POST", body: JSON.stringify(input) });
}
export function setTrainingRequestStatus(id: string, status: TrainingRequestStatus) {
  return request<TrainingRequest>(`/api/v1/training-requests/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}
export function getTrainingSessions(status?: TrainingSessionStatus) {
  return request<TrainingSession[]>(`/api/v1/training-sessions${status ? `?status=${status}` : ""}`);
}
export function createTrainingSession(input: { title: string; provider?: string; theme?: string; mode?: TrainingSessionMode; session_date?: string; cost?: number }) {
  return request<TrainingSession>(`/api/v1/training-sessions`, { method: "POST", body: JSON.stringify(input) });
}
export function setTrainingSessionStatus(id: string, status: TrainingSessionStatus) {
  return request<TrainingSession>(`/api/v1/training-sessions/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}
export function getTrainingParticipants(sessionId: string) {
  return request<TrainingParticipant[]>(`/api/v1/training-sessions/${sessionId}/participants`);
}
export function enrollTrainingParticipant(sessionId: string, employeeId: string) {
  return request<TrainingParticipant>(`/api/v1/training-sessions/${sessionId}/participants`, { method: "POST", body: JSON.stringify({ employee_id: employeeId }) });
}
export function setTrainingParticipantStatus(id: string, status: TrainingParticipationStatus) {
  return request<TrainingParticipant>(`/api/v1/training-participations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function getEmployee(id: string) {
  return request<Employee & { hrContracts: unknown[]; reports: Employee[]; employeeSkills: unknown[] }>(`/api/v1/employees/${id}`);
}

export function createEmployee(input: {
  first_name: string;
  last_name: string;
  department_id?: string;
  status?: EmployeeStatus;
  position?: string;
  manager_id?: string;
  hire_date?: string;
  birth_date?: string;
  marital_status?: string;
  children_count?: number;
  phone?: string;
  emergency_contact?: string;
  niu?: string;
  leave_taken_days?: number;
  account?: { username: string; email: string; password: string; role_code: string };
  // Rattachement à un compte déjà ouvert par l'administrateur (exclusif avec account).
  link_user_id?: string;
}) {
  return request<Employee>("/api/v1/employees", { method: "POST", body: JSON.stringify(input) });
}

export function updateEmployee(id: string, input: Partial<{ first_name: string; last_name: string; hire_date: string | null; department_id: string | null; status: EmployeeStatus; position: string; manager_id: string | null; birth_date: string | null; marital_status: string | null; children_count: number | null; phone: string | null; emergency_contact: string | null; niu: string | null; leave_taken_days: number | null }>) {
  return request<Employee>(`/api/v1/employees/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function setEmployeeDeparture(id: string, date: string) {
  return request<Employee>(`/api/v1/employees/${id}/departure`, { method: "PATCH", body: JSON.stringify({ date }) });
}

export function suspendEmployee(id: string) {
  return request(`/api/v1/employees/${id}/suspend`, { method: "PATCH", body: "{}" });
}

export function reinstateEmployee(id: string) {
  return request(`/api/v1/employees/${id}/reinstate`, { method: "PATCH", body: "{}" });
}

export function getEmployeeConfidential(id: string) {
  return request<{ baseSalary?: string; notes?: string }>(`/api/v1/employees/${id}/confidential`);
}

export function updateEmployeeConfidential(id: string, input: { base_salary?: number; notes?: string }) {
  return request(`/api/v1/employees/${id}/confidential`, { method: "PATCH", body: JSON.stringify(input) });
}

export function grantRole(userId: string, roleCode: string, justification: string) {
  return request(`/api/v1/users/${userId}/roles`, { method: "POST", body: JSON.stringify({ role_code: roleCode, justification }) });
}

export function revokeRole(userRoleId: string, justification: string) {
  return request(`/api/v1/user-roles/${userRoleId}/revoke`, { method: "PATCH", body: JSON.stringify({ justification }) });
}

// Réinitialisation du mot de passe d'un compte par un administrateur (spéc.
// fonctionnelle §1) — réservé au niveau « administration ».
export function resetUserPassword(userId: string, newPassword: string) {
  return request<{ ok: true }>(`/api/v1/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword }),
  });
}

// Utilisateurs & rôles (Ch. 2) — écran dédié de gestion des habilitations.
export interface RoleSummary {
  id: string;
  code: string;
  label: string;
  department: string | null;
}

export interface UserWithRoles {
  id: string;
  username: string;
  email: string;
  status: string;
  roles: { userRoleId: string; code: string; label: string }[];
}

export function listRoles() {
  return request<RoleSummary[]>("/api/v1/roles");
}

export function listUsersWithRoles() {
  return request<UserWithRoles[]>("/api/v1/users-with-roles");
}

// Audit des accès : qui détient une permission sensible, et via quels rôles.
export interface AccessAuditHolder {
  id: string;
  username: string;
  email: string;
  via_roles: { code: string; label: string }[];
}
export function auditAccess(permission: string) {
  return request<{ permission: string; holders: AccessAuditHolder[] }>(
    `/api/v1/access-audit?permission=${encodeURIComponent(permission)}`,
  );
}

// Profil d'accès d'un compte : ses permissions effectives et le rôle qui donne
// chacune (pour comprendre « pourquoi ce compte a tel accès »).
export interface UserAccessPermission {
  key: string;
  via_roles: { code: string; label: string }[];
}
export function getUserAccess(userId: string) {
  return request<{ id: string; username: string; permissions: UserAccessPermission[] }>(
    `/api/v1/users/${userId}/access`,
  );
}

// --- Gouvernance : comptes, matrice des droits, pôles (spéc. fonctionnelle §2/§3) ---

export function createUser(input: { username: string; email: string; password: string; role_codes?: string[] }) {
  return request<{ id: string; username: string; email: string; status: string }>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUser(id: string, patch: { username?: string; email?: string; status?: "active" | "suspended" }) {
  return request<{ id: string; username: string; email: string; status: string }>(`/api/v1/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteUser(id: string) {
  return request<{ ok: true }>(`/api/v1/users/${id}`, { method: "DELETE" });
}

// Se connecter en tant qu'un utilisateur (usurpation d'identité, §4).
export function impersonateUser(id: string) {
  return request<{ ok: true; impersonating: string }>(`/api/v1/users/${id}/impersonate`, { method: "POST" });
}

export function stopImpersonation() {
  return request<{ ok: true }>("/api/v1/auth/stop-impersonation", { method: "POST" });
}

// Réglage d'un droit pour tout un pôle en une opération (§3).
export function setDepartmentPermission(departmentId: string, module: string, action: string, granted: boolean) {
  return request<{ ok: true; roles_affected: number }>(`/api/v1/departments/${departmentId}/permissions`, {
    method: "POST",
    body: JSON.stringify({ module, action, granted }),
  });
}

export interface PermissionRef {
  id: string;
  module: string;
  action: string;
}

export interface RolePermissions {
  role: { id: string; code: string; label: string };
  editable: boolean;
  permissions: string[];
}

export function listPermissions() {
  return request<PermissionRef[]>("/api/v1/permissions");
}

export function getRolePermissions(roleId: string) {
  return request<RolePermissions>(`/api/v1/roles/${roleId}/permissions`);
}

export function setRolePermission(roleId: string, module: string, action: string, granted: boolean) {
  return request<{ ok: true }>(`/api/v1/roles/${roleId}/permissions`, {
    method: "POST",
    body: JSON.stringify({ module, action, granted }),
  });
}

export interface Department {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export function listDepartments() {
  return request<Department[]>("/api/v1/departments");
}

export function createDepartment(name: string, code?: string) {
  return request<Department>("/api/v1/departments", { method: "POST", body: JSON.stringify({ name, ...(code ? { code } : {}) }) });
}

export function deleteDepartment(id: string) {
  return request<{ ok: true }>(`/api/v1/departments/${id}`, { method: "DELETE" });
}

// --- Archivage hiérarchique (spéc. fonctionnelle §7) ---

export interface ArchiveItem {
  id: string;
  manuscriptNumber: string;
  title: string;
  publicationDate: string | null;
  isBackCatalogue: boolean;
  genre: string | null;
  collection: string | null;
  author: string | null;
  status: { code: string; label: string };
}

export function listArchives() {
  return request<ArchiveItem[]>("/api/v1/archives");
}

export interface AccessAnomaly {
  type: string;
  user_id: string;
  username: string;
  detail: string;
}

export function listAccessAnomalies() {
  return request<AccessAnomaly[]>("/api/v1/access-anomalies");
}

export interface AccessReview {
  id: string;
  label: string;
  launchedAt: string;
}

export function createAccessReview(label: string) {
  return request<AccessReview>("/api/v1/access-reviews", { method: "POST", body: JSON.stringify({ label }) });
}

export function listAccessReviews() {
  return request<AccessReview[]>("/api/v1/access-reviews");
}

export type AccessReviewDecision = "confirme" | "anomalie_signalee";

export interface AccessReviewItem {
  id: string;
  decision: AccessReviewDecision | null;
  comment: string | null;
  employee: { firstName: string; lastName: string };
  reviewer: { firstName: string; lastName: string };
}

export function listAccessReviewItems(reviewId: string, reviewer?: "me") {
  const query = reviewer ? "?reviewer=me" : "";
  return request<AccessReviewItem[]>(`/api/v1/access-reviews/${reviewId}/items${query}`);
}

export function decideAccessReviewItem(itemId: string, decision: AccessReviewDecision, comment?: string) {
  return request<AccessReviewItem>(`/api/v1/access-review-items/${itemId}`, { method: "PATCH", body: JSON.stringify({ decision, comment }) });
}

export type AbsenceType = "conge" | "maladie" | "mission" | "teletravail" | "permission" | "suspension" | "injustifiee";
export type AbsenceStatus = "en_attente" | "validee" | "refusee";

// Motif d'absence (catalogue paramétrable) — porte les règles.
export interface AbsenceReason {
  code: string;
  label: string;
  category: AbsenceType;
  paid: boolean;
  requiresJustification: boolean;
  justificationDeadlineDays: number | null;
  indicativeDaysMin: number | null;
  indicativeDaysMax: number | null;
  decrementsLeave: boolean;
  payrollDeductible: boolean;
  isFault: boolean;
  sortOrder: number;
  active: boolean;
}

export interface Absence {
  id: string;
  employeeId: string;
  type: AbsenceType;
  reasonCode: string | null;
  reasonRef?: AbsenceReason | null;
  fromDate: string;
  toDate: string;
  status: AbsenceStatus;
  reason: string | null;
}

export function createAbsence(input: { employee_id: string; type: AbsenceType; reason_code?: string; from_date: string; to_date: string; reason?: string }) {
  return request<Absence>("/api/v1/absences", { method: "POST", body: JSON.stringify(input) });
}

export function listAbsenceReasons(all = false) {
  return request<AbsenceReason[]>(`/api/v1/absence-reasons${all ? "?all=1" : ""}`);
}

export function updateAbsenceReason(code: string, patch: Partial<{
  label: string; paid: boolean; requires_justification: boolean; justification_deadline_days: number | null;
  indicative_days_min: number | null; indicative_days_max: number | null; decrements_leave: boolean;
  payroll_deductible: boolean; is_fault: boolean; active: boolean;
}>) {
  return request<AbsenceReason>(`/api/v1/absence-reasons/${code}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function listAbsences(filters?: { employee_id?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.employee_id) params.set("employee_id", filters.employee_id);
  if (filters?.status) params.set("status", filters.status);
  const query = params.toString() ? `?${params}` : "";
  return request<Absence[]>(`/api/v1/absences${query}`);
}

export function decideAbsence(id: string, decision: "validee" | "refusee") {
  return request<Absence>(`/api/v1/absences/${id}/decide`, { method: "PATCH", body: JSON.stringify({ decision }) });
}

export interface Workload {
  employee_id: string;
  name: string;
  tasks_in_progress: number;
  tasks_done: number;
  tasks_late: number;
  tasks_upcoming: number;
}

export function getWorkload(filters?: { department_id?: string; person_id?: string }) {
  const params = new URLSearchParams();
  if (filters?.department_id) params.set("department_id", filters.department_id);
  if (filters?.person_id) params.set("person_id", filters.person_id);
  const query = params.toString() ? `?${params}` : "";
  return request<Workload[]>(`/api/v1/workload${query}`);
}

// Ch. 5 : Direction générale — tableau de bord, recherche, alertes.
export interface DirectionDashboard {
  editorial: {
    total: number;
    by_status: { code: string; label: string; step_order: number; count: number }[];
  };
  production: {
    projects_in_progress: number;
    tasks_done: number;
    tasks_late: number;
    on_time_rate_pct: number | null;
    open_tasks_by_step: number;
  };
  commercial: {
    units_sold: number;
    revenue_total: number;
    best_sellers: { title: string; units: number; revenue: number }[];
    stock_outs: number;
  };
  financial: {
    production_cost_total: number;
    expenses_engaged: number;
    royalties_due: number;
    invoices_pending: number;
    treasury_position: number;
  } | null;
}

export function getDirectionDashboard() {
  return request<DirectionDashboard>("/api/v1/dashboards/direction");
}

export function searchGlobal(q: string) {
  return request<Manuscript[]>(`/api/v1/search?q=${encodeURIComponent(q)}`);
}

export interface Alert {
  type: string;
  priority: "faible" | "moyenne" | "elevee" | "critique";
  message: string;
  entity_type: string;
  entity_id: string;
}

export function listAlerts() {
  return request<Alert[]>("/api/v1/alerts");
}

// Ch. 5 §5.9, Ch. 20 §20.6 : centre de pilotage intelligent.
export interface Recommendation {
  id: string;
  message: string;
  priority: "faible" | "moyenne" | "elevee" | "critique";
  status: "open" | "treated" | "ignored" | "postponed";
  rule: { label: string };
  createdAt: string;
}

export function generateRecommendations() {
  return request<{ created: number }>("/api/v1/recommendations/generate", { method: "POST", body: "{}" });
}

export function listRecommendations(filters?: { status?: string; priority?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.priority) params.set("priority", filters.priority);
  const query = params.toString() ? `?${params}` : "";
  return request<Recommendation[]>(`/api/v1/recommendations${query}`);
}

export function decideRecommendation(id: string, status: "treated" | "ignored" | "postponed", comment?: string) {
  return request<Recommendation>(`/api/v1/recommendations/${id}`, { method: "PATCH", body: JSON.stringify({ status, comment }) });
}

// Ch. 20 : Rapports, dictionnaire d'indicateurs, explorateur.
export interface KpiDefinition {
  code: string;
  label: string;
  definition: string;
  formula: string;
  value?: unknown;
}

export function listKpis() {
  return request<KpiDefinition[]>("/api/v1/kpi");
}

export function getKpi(code: string) {
  return request<KpiDefinition>(`/api/v1/kpi/${code}`);
}

export type ReportDomain = "editorial" | "production" | "commercial" | "financier" | "rh";

export interface Report {
  id: string;
  key: string;
  label: string;
  domain: ReportDomain;
  description: string | null;
}

export function listReports() {
  return request<Report[]>("/api/v1/reports");
}

export function runReport(id: string, input?: { period_start?: string; period_end?: string }) {
  return request<{ run: { id: string; rowCount: number }; rows: unknown[] }>(`/api/v1/reports/${id}/run`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

export function listReportRuns(id: string) {
  return request<{ id: string; generatedAt: string; rowCount: number }[]>(`/api/v1/reports/${id}/runs`);
}

export interface SavedAnalysis {
  id: string;
  label: string;
  definition: { metric: string };
}

export function createAnalysis(input: { label: string; definition: { metric: string }; shared_with?: string[] }) {
  return request<SavedAnalysis>("/api/v1/analyses", { method: "POST", body: JSON.stringify(input) });
}

export function listAnalyses() {
  return request<SavedAnalysis[]>("/api/v1/analyses");
}

export function runAnalysis(id: string) {
  return request<{ metric: string; value: unknown }>(`/api/v1/analyses/${id}/run`, { method: "POST", body: "{}" });
}

export function promoteAnalysis(id: string, key: string, domain: ReportDomain) {
  return request<Report>(`/api/v1/analyses/${id}/promote`, { method: "POST", body: JSON.stringify({ key, domain }) });
}

export function simulatePrintRun(manuscriptId: string, quantities: number[]) {
  return request<{
    manuscript_id: string;
    daily_sale_rate: number;
    simulations: { quantity: number; total_cost: number | null; unit_cost: number | null; estimated_days_to_sell_out: number | null }[];
  }>("/api/v1/simulations/print-run", { method: "POST", body: JSON.stringify({ manuscript_id: manuscriptId, quantities }) });
}

// Paramètres (table settings) : seuils, pondérations et calendriers ajustables
// sans redéploiement (Ch. 21 §21.5).
export interface AppSetting {
  key: string;
  value: unknown;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export function listSettings() {
  return request<AppSetting[]>("/api/v1/settings");
}

// Diagnostic de persistance : confirme que la base est joignable, à jour et
// durable (nombre réel d'enregistrements). Sert à vérifier qu'une donnée est
// bien persistée, et à détecter une base non partagée (l'identifiant d'instance
// changerait d'un rafraîchissement à l'autre).
export interface SystemDiagnostic {
  instance_id: string;
  uptime_seconds: number;
  database: { connected: boolean; server_time: string | null; latency_ms: number };
  migrations: { applied: number | null; last: string | null };
  records: { users: number; employees: number; weekly_reports: number; invoices: number; billing_orders: number; manuscripts: number };
}
export function getSystemDiagnostic() {
  return request<SystemDiagnostic>("/api/v1/system/diagnostic");
}

// Journal d'activité inviolable (Ch. 5 §5.8) — lecture seule.
export interface AuditEntry {
  id: string;
  occurredAt: string;
  username: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: string | null;
}

export function listAuditLog(filters?: { entity_type?: string; action?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (filters?.entity_type) params.set("entity_type", filters.entity_type);
  if (filters?.action) params.set("action", filters.action);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<{ total: number; limit: number; offset: number; entries: AuditEntry[] }>(`/api/v1/audit-log${query}`);
}

export function updateSetting(key: string, value: unknown) {
  return request<AppSetting>(`/api/v1/settings/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
}

// Identité légale de l'éditeur (imprimée sur les contrats), modifiable dans les
// Paramètres. Lecture ouverte à tout utilisateur authentifié.
export interface PublisherIdentity {
  name: string;
  desc: string;
  rc: string;
  niu: string;
  siege: string;
  tel: string;
  email: string;
  web: string;
  rep: string;
  ville: string;
  dipe?: string;
  dipe_cle?: string;
  cnps_regime?: string;
}
export function getPublisherIdentity() {
  return request<PublisherIdentity>("/api/v1/publisher-identity");
}
export function updatePublisherIdentity(identity: PublisherIdentity) {
  return request<PublisherIdentity>("/api/v1/publisher-identity", { method: "PUT", body: JSON.stringify(identity) });
}

// --- Module « Présences & Temps de travail » (évolution, incrément 1) --------
export type WorkScheduleScope = "company" | "department" | "employee";

export interface WorkSchedule {
  id: string;
  scope: WorkScheduleScope;
  department_id: string | null;
  employee_id: string | null;
  day_start: string;
  lunch_start: string;
  lunch_end: string;
  day_end: string;
  working_days: string;
  effective_from: string;
  active: boolean;
  label: string | null;
}

export interface ResolvedSchedule {
  day_start: string;
  lunch_start: string;
  lunch_end: string;
  day_end: string;
  working_days: string;
  source: "employee" | "department" | "company" | "default";
}

export interface PublicHoliday {
  id: string;
  day: string;
  label: string;
}

export interface AttendanceEvent {
  id: string;
  kind: "in" | "out";
  source: string;
  occurred_at: string;
  ip_address: string | null;
  device: string | null;
}

export function getResolvedSchedule(employeeId?: string) {
  const qs = employeeId ? `?employee_id=${employeeId}` : "";
  return request<ResolvedSchedule>(`/api/v1/attendance/work-schedule${qs}`);
}

export function listWorkSchedules() {
  return request<WorkSchedule[]>(`/api/v1/attendance/work-schedules`);
}

export function createWorkSchedule(input: {
  scope: WorkScheduleScope;
  department_id?: string;
  employee_id?: string;
  day_start: string;
  lunch_start: string;
  lunch_end: string;
  day_end: string;
  working_days: string;
  label?: string;
}) {
  return request<WorkSchedule>(`/api/v1/attendance/work-schedules`, { method: "POST", body: JSON.stringify(input) });
}

export function updateWorkSchedule(
  id: string,
  input: Partial<{ day_start: string; lunch_start: string; lunch_end: string; day_end: string; working_days: string; active: boolean; label: string }>,
) {
  return request<WorkSchedule>(`/api/v1/attendance/work-schedules/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function listHolidays() {
  return request<PublicHoliday[]>(`/api/v1/attendance/holidays`);
}

export function createHoliday(input: { day: string; label: string }) {
  return request<PublicHoliday>(`/api/v1/attendance/holidays`, { method: "POST", body: JSON.stringify(input) });
}

export function listAttendanceEvents(params?: { employee_id?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<AttendanceEvent[]>(`/api/v1/attendance/events${qs ? `?${qs}` : ""}`);
}

// Calculs de présence (incrément 2) — journée et synthèse de période.
export interface DayResult {
  date: string;
  is_working_day: boolean;
  is_holiday: boolean;
  has_data: boolean;
  first_in_min: number | null;
  last_out_min: number | null;
  presence_minutes: number;
  worked_minutes: number;
  expected_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  interruption_minutes: number;
  absent_full_day: boolean;
  justified: boolean;
  nature: string | null;
}

export interface AttendanceSummary {
  from: string;
  to: string;
  days: DayResult[];
  // Vrai si le compte connecté n'est rattaché à aucune fiche employé.
  no_employee?: boolean;
  totals: {
    worked_minutes: number;
    expected_minutes: number;
    late_minutes: number;
    early_leave_minutes: number;
    overtime_minutes: number;
    interruption_minutes: number;
    days_worked: number;
    days_absent_unjustified: number;
    days_absent_justified: number;
  };
}

export function getAttendanceDaily(params?: { employee_id?: string; date?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<DayResult | null>(`/api/v1/attendance/daily${qs ? `?${qs}` : ""}`);
}

export function getAttendanceSummary(params?: { employee_id?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<AttendanceSummary>(`/api/v1/attendance/summary${qs ? `?${qs}` : ""}`);
}

// Règles de retenues (incrément 3) — paramétrables et versionnées.
export type DeductionMethod = "prorata" | "round_half_hour" | "round_hour" | "custom";
export interface DeductionRule {
  id: string;
  per_minute: number | null;
  per_half_hour: number;
  per_hour: number;
  daily_cap: number | null;
  monthly_cap: number | null;
  method: DeductionMethod;
  effective_from: string;
  active: boolean;
  label: string | null;
}

export function listDeductionRules() {
  return request<DeductionRule[]>(`/api/v1/attendance/deduction-rules`);
}
export function createDeductionRule(input: {
  per_minute?: number;
  per_half_hour: number;
  per_hour: number;
  daily_cap?: number;
  monthly_cap?: number;
  method: DeductionMethod;
  label?: string;
}) {
  return request<DeductionRule>(`/api/v1/attendance/deduction-rules`, { method: "POST", body: JSON.stringify(input) });
}
export function updateDeductionRule(id: string, input: { active?: boolean; label?: string }) {
  return request<DeductionRule>(`/api/v1/attendance/deduction-rules/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

// Anomalies & workflow de validation (incrément 4).
export type AnomalyStatus = "en_attente" | "en_analyse" | "validee" | "rejetee" | "corrigee" | "annulee";
export type AnomalyType = "retard" | "depart_anticipe" | "absence" | "incoherence" | "absence_connexion" | "absence_deconnexion" | "duree_anormale";
export type AnomalyAction = "analyser" | "valider" | "rejeter" | "corriger" | "annuler" | "demander_correction";

export interface AttendanceAnomaly {
  id: string;
  employee_id: string;
  employee_name?: string;
  day: string;
  type: AnomalyType;
  minutes: number | null;
  detail: string | null;
  status: AnomalyStatus;
  justification_motif: string | null;
  justification_comment: string | null;
  resolved_at: string | null;
}

export interface ValidationLevel {
  code: string;
  label: string;
  position: number;
  mode: "obligatoire" | "facultatif" | "desactive";
}

export function listAnomalies(params?: { status?: string; employee_id?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<AttendanceAnomaly[]>(`/api/v1/attendance/anomalies${qs ? `?${qs}` : ""}`);
}
export function scanAnomalies(params: { employee_id: string; from?: string; to?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<{ from: string; to: string; detected: number; created: number }>(`/api/v1/attendance/anomalies/scan?${qs}`, { method: "POST" });
}
export function justifyAnomaly(id: string, input: { motif: string; comment?: string; document_id?: string }) {
  return request<AttendanceAnomaly>(`/api/v1/attendance/anomalies/${id}/justify`, { method: "POST", body: JSON.stringify(input) });
}
export function decideAnomaly(id: string, input: { action: AnomalyAction; comment?: string }) {
  return request<AttendanceAnomaly>(`/api/v1/attendance/anomalies/${id}/decision`, { method: "POST", body: JSON.stringify(input) });
}
export function listValidationLevels() {
  return request<ValidationLevel[]>(`/api/v1/attendance/validation-levels`);
}
export function updateValidationLevel(code: string, input: { mode?: string; position?: number; label?: string }) {
  return request<ValidationLevel>(`/api/v1/attendance/validation-levels/${code}`, { method: "PUT", body: JSON.stringify(input) });
}

// Rapports & tableau de bord de présence (incrément 5).
export interface AttendanceDashboard {
  date: string;
  headcount: number;
  present_today: number;
  absent_today: number;
  late_today: number;
  early_leave_today: number;
  overtime_minutes_today: number;
  presence_rate_pct: number | null;
  absenteeism_rate_pct: number | null;
  deduction_month_total: number;
  overtime_minutes_month: number;
}

export interface ReportRow {
  employee_id: string;
  employee_name: string;
  department: string | null;
  worked_minutes: number;
  expected_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  days_worked: number;
  days_absent_unjustified: number;
  days_absent_justified: number;
  deduction_proposed: number;
}

export interface MonthlyReport {
  from: string;
  to: string;
  headcount: number;
  rows: ReportRow[];
  totals: {
    worked_minutes: number;
    late_minutes: number;
    early_leave_minutes: number;
    overtime_minutes: number;
    days_absent_unjustified: number;
    deduction_total: number;
  };
}

export function getAttendanceDashboard(date?: string) {
  return request<AttendanceDashboard>(`/api/v1/attendance/dashboard${date ? `?date=${date}` : ""}`);
}
export function getMonthlyReport(params?: { from?: string; to?: string; department_id?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return request<MonthlyReport>(`/api/v1/attendance/report/monthly${qs ? `?${qs}` : ""}`);
}

// Consolidation vers la paie (incrément 6).
export interface PayrollRubric { code: string; label: string; enabled: boolean }
export interface PayrollLine {
  employee_id: string;
  employee_name: string;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  days_worked: number;
  days_absent_unjustified: number;
  deduction_proposed: number;
}
export interface PayrollPeriod {
  period_key: string;
  from: string;
  to: string;
  status: "brouillon" | "valide" | "gele" | "transmis";
  mode: string;
  validated_at: string | null;
  frozen_at: string | null;
  transmitted_at: string | null;
  rubrics: PayrollRubric[];
  totals: { worked_minutes: number; overtime_minutes: number; days_absent_unjustified: number; deduction_total: number };
  lines: PayrollLine[];
}

export function getPayrollRubrics() {
  return request<PayrollRubric[]>(`/api/v1/attendance/payroll/rubrics`);
}
export function setPayrollRubric(code: string, enabled: boolean) {
  return request<PayrollRubric>(`/api/v1/attendance/payroll/rubrics/${code}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}
export function getPayrollMode() {
  return request<{ mode: string }>(`/api/v1/attendance/payroll/mode`);
}
export function setPayrollMode(mode: "auto" | "manuel") {
  return request<{ mode: string }>(`/api/v1/attendance/payroll/mode`, { method: "PUT", body: JSON.stringify({ mode }) });
}
export function preparePayroll(periodKey: string) {
  return request<{ period_key: string; status: string; lines: number }>(`/api/v1/attendance/payroll/${periodKey}/prepare`, { method: "POST" });
}
export function getPayrollPeriod(periodKey: string) {
  return request<PayrollPeriod>(`/api/v1/attendance/payroll/${periodKey}`);
}
export function validatePayroll(periodKey: string) {
  return request<{ status: string }>(`/api/v1/attendance/payroll/${periodKey}/validate`, { method: "POST" });
}
export function freezePayroll(periodKey: string) {
  return request<{ status: string }>(`/api/v1/attendance/payroll/${periodKey}/freeze`, { method: "POST" });
}
export function transmitPayroll(periodKey: string) {
  return request<{ status: string; transmitted: number }>(`/api/v1/attendance/payroll/${periodKey}/transmit`, { method: "POST" });
}

// Module Paie natif (D-007) — paramètres versionnés + interrupteur.
export interface PayrollRateSet {
  id: string;
  effective_from: string;
  label: string | null;
  active: boolean;
  change_reason?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  cnps: { vid_sal_pct: number; vid_pat_pct: number; pf_pct: number; at_pct: number; ceiling: number };
  fiscal: { abat_pct: number; abat_fixe: number; cac_pct: number; cfc_sal_pct: number; cfc_pat_pct: number; fne_pct: number };
  misc: { coef_assiette: number; heures_mois: number; anc_def_pct: number };
  irpp: { t1_ceiling: number; t1_pct: number; t2_ceiling: number; t2_pct: number; t3_ceiling: number; t3_pct: number; t4_pct: number };
  tc_rav: { seuil1: number; tc1: number; rav1: number; seuil2: number; tc2: number; rav2: number; tc3: number; rav3: number };
  // Barème des avantages en nature (CGI art. 33), en fraction du brut taxable.
  avantages_nature?: { logement: number; electricite: number; eau: number; domestique: number; vehicule: number; nourriture: number };
}
export type PayrollRateSetInput = Omit<PayrollRateSet, "id" | "active" | "created_at" | "created_by">;

// Catalogue des éléments de salaire (traitement fiscal / CNPS) — guide + réglage.
export interface SalaryElement {
  code: string;
  label: string;
  category: string;
  category_label: string;
  fiscal_status: "taxable" | "non_taxable" | "partiel";
  fiscal_label: string;
  cnps_status: "cotisable" | "non_cotisable" | "partiel";
  cnps_label: string;
  legal_ref: string | null;
  active: boolean;
}
export interface SalaryElementsConfig {
  elements: SalaryElement[];
  fiscal_statuses: { value: string; label: string }[];
  cnps_statuses: { value: string; label: string }[];
}
export function getSalaryElements(all = false) {
  return request<SalaryElementsConfig>(`/api/v1/payroll/salary-elements${all ? "?all=1" : ""}`);
}
export function updateSalaryElement(code: string, patch: Partial<{ label: string; fiscal_status: string; cnps_status: string; legal_ref: string | null; active: boolean }>) {
  return request<{ code: string; fiscal_status: string; cnps_status: string; active: boolean }>(`/api/v1/payroll/salary-elements/${code}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getPayrollConfig() {
  return request<{ internal_enabled: boolean }>(`/api/v1/payroll/config`);
}
export function setPayrollConfig(internal_enabled: boolean) {
  return request<{ internal_enabled: boolean }>(`/api/v1/payroll/config`, { method: "PUT", body: JSON.stringify({ internal_enabled }) });
}
export function listPayrollRateSets() {
  return request<PayrollRateSet[]>(`/api/v1/payroll/rate-sets`);
}
export function getPayrollRateSet(date?: string) {
  return request<PayrollRateSet>(`/api/v1/payroll/rate-set${date ? `?date=${date}` : ""}`);
}
export function createPayrollRateSet(body: PayrollRateSetInput) {
  return request<PayrollRateSet>(`/api/v1/payroll/rate-sets`, { method: "POST", body: JSON.stringify(body) });
}

// Formules de calcul modifiables par le RH (D-007).
export interface PayrollFormula {
  code: string;
  label: string;
  description: string;
  variables: string[];
  expression: string;
  default_expression: string;
  custom: boolean;
  change_reason: string | null;
  updated_at: string | null;
  updated_by: string | null;
}
export function listPayrollFormulas() {
  return request<PayrollFormula[]>(`/api/v1/payroll/formulas`);
}
export function testPayrollFormula(code: string, expression: string) {
  return request<{ ok: boolean; sample: Record<string, number>; default_result: number; result?: number; error?: string }>(
    `/api/v1/payroll/formulas/${code}/test`,
    { method: "POST", body: JSON.stringify({ expression }) },
  );
}
export function updatePayrollFormula(code: string, body: { custom: boolean; expression?: string; change_reason: string }) {
  return request<PayrollFormula>(`/api/v1/payroll/formulas/${code}`, { method: "PUT", body: JSON.stringify(body) });
}

// Relevé des connexions ERP (outil indicatif d'arbitrage RH, sans impact paie).
export interface ErpConnectionDay {
  date: string;
  weekday: number;
  has_connection: boolean;
  first_login: string | null;
  last_logout: string | null;
  nb_logins: number;
  nb_logouts: number;
}
export interface ErpConnectionRecord {
  employee: { id: string; name: string; has_erp_account: boolean };
  month: string;
  days: ErpConnectionDay[];
  recap: { days_in_month: number; days_with_connection: number; total_logins: number; total_logouts: number };
  notice: string;
}
export function getErpConnections(employeeId: string, month: string) {
  return request<ErpConnectionRecord>(`/api/v1/hr/erp-connections?employee_id=${employeeId}&month=${month}`);
}

// i18n : langue d'interface mémorisée sur le profil (fr|en).
export function setMyLanguage(language: "fr" | "en") {
  return request<{ language: string }>(`/api/v1/me/language`, { method: "PATCH", body: JSON.stringify({ language }) });
}

// Fiche paie de l'employé (D-007, incrément 2).
export interface PayrollProfile {
  matricule: string | null;
  email: string | null;
  cnps_number: string | null;
  niu: string | null;
  category: string | null;
  payment_mode: string | null;
  account_number: string | null;
  gross_contractual: number;
  base_pct: number;
  base_salary: number;
  complements: number;
  fiscal_base: number | null;
  fiscal_parts: number;
  apply_fiscal_parts: boolean;
  seniority_years: number;
  seniority_rate: number | null;
  seniority_threshold: number | null;
  apply_seniority: boolean;
}
export type PayrollProfileInput = Omit<PayrollProfile, "base_salary" | "complements">;

export function getPayrollProfile(employeeId: string) {
  return request<{ employee: { id: string; name: string }; profile: PayrollProfile | null }>(`/api/v1/payroll/employees/${employeeId}/profile`);
}
export function savePayrollProfile(employeeId: string, input: PayrollProfileInput, modificationReason?: string) {
  return request<PayrollProfile>(`/api/v1/payroll/employees/${employeeId}/profile`, {
    method: "PUT",
    body: JSON.stringify({ ...input, modification_reason: modificationReason || undefined }),
  });
}

// Calcul du bulletin (D-007, incrément 3).
export interface Payslip {
  base: number; complements: number; prime_anciennete: number; retenue_absence: number;
  salaire_brut: number; assiette_fiscale: number; cnps_cotisable_total: number; assiette_cnps: number;
  pvid_salarie: number; pvid_patronal: number; prestations_familiales: number; accidents_travail: number;
  cfc_salarie: number; cfc_patronal: number; fne: number; taxe_communale: number; rav: number;
  base_irpp_annuelle: number; irpp: number; irpp_cac: number;
  total_retenues_internes: number; total_retenues_salariales: number; total_charges_patronales: number;
  net_a_payer: number; cout_employeur: number;
}
// Taux d'affichage du bulletin (colonne « Taux » du modèle moteur), en fractions.
export interface PayslipRates {
  vid_sal: number; vid_pat: number; pf: number; at: number;
  cfc_sal: number; cfc_pat: number; fne: number; cac: number;
}
export interface PayslipResult {
  employee: { id: string; name: string };
  period: string;
  rate_set_effective_from: string;
  rates: PayslipRates;
  payslip: Payslip;
  // Témoin indicatif du cahier de présence — n'est PAS appliqué au net.
  attendance_witness: number;
}
export function getPayslip(
  employeeId: string,
  period: string,
  deductions?: { retenue_absence?: number; avance?: number; pret?: number; retard?: number; autres?: number },
) {
  const qs = new URLSearchParams({ period });
  if (deductions) {
    for (const [k, v] of Object.entries(deductions)) {
      if (v != null && v > 0) qs.set(k, String(v));
    }
  }
  return request<PayslipResult>(`/api/v1/payroll/employees/${employeeId}/payslip?${qs.toString()}`);
}

// Retenues du mois mémorisées par employé et par mois (bulletin unitaire).
export interface MonthlyDeductions {
  period: string;
  primes: number; // gain imposable du mois
  heures_sup: number; // gain imposable du mois
  retenue_absence: number;
  avance: number;
  pret: number;
  retard: number;
  autres: number;
  sanction: number; // saisie uniquement dans la grille mensuelle (lecture seule ici)
  extra_lines: PayrollExtraLine[]; // lignes libres (gérées dans la grille)
  status: "brouillon" | "soumis_dg" | "valide" | null;
  locked: boolean; // true dès que le mois est soumis/validé
  saved: boolean;
  // Retenue automatique des absences non payées (temps 2) : interrupteur + suggestion.
  auto_absence_enabled: boolean;
  suggested_retenue_absence: number;
  unpaid_absence_days: number;
}

export function getMonthlyDeductions(employeeId: string, period: string) {
  return request<MonthlyDeductions>(`/api/v1/payroll/employees/${employeeId}/deductions?period=${period}`);
}

// Interrupteur RH « retenue automatique des absences non payées ».
export function getAbsenceAutoDeduction() {
  return request<{ enabled: boolean }>("/api/v1/payroll/absence-auto-deduction");
}
export function setAbsenceAutoDeduction(enabled: boolean) {
  return request<{ enabled: boolean }>("/api/v1/payroll/absence-auto-deduction", { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function saveMonthlyDeductions(
  employeeId: string,
  period: string,
  amounts: { primes: number; heures_sup: number; retenue_absence: number; avance: number; pret: number; retard: number; autres: number },
) {
  return request<MonthlyDeductions>(`/api/v1/payroll/employees/${employeeId}/deductions`, {
    method: "PUT",
    body: JSON.stringify({ period, ...amounts }),
  });
}

// Cycle mensuel de paie (grille éditable → validation DG). Étape 1 : préparer le
// mois, saisir les éléments variables par salarié, net recalculé automatiquement.
export interface PayrollMonthElements {
  primes: number; heures_sup: number; retenue_absence: number;
  retard: number; avance: number; pret: number; sanction: number; autres: number;
}
// Ligne libre ajoutée par le RH au bulletin (gain imposable ou retenue nette).
export interface PayrollExtraLine {
  label: string;
  kind: "gain" | "retenue";
  amount: number;
}
export interface PayrollMonthLine {
  employee_id: string;
  employee_name: string;
  matricule: string | null;
  cnps_number: string | null;
  niu: string | null;
  fiscal_parts: number;
  department: string | null;
  position: string | null;
  hire_date: string | null;
  birth_date: string | null;
  marital_status: string | null;
  children_count: number | null;
  phone: string | null;
  emergency_contact: string | null;
  leave_taken: number | null;
  contract_type: string | null;
  category: string | null;
  email: string | null;
  extra_lines?: PayrollExtraLine[];
  payment_mode: string | null;
  account_number: string | null;
  leave_balance: number;
  elements: PayrollMonthElements;
  note: string | null;
  net_a_payer: number;
  salaire_brut: number;
  total_retenues_salariales: number;
  total_charges_patronales: number;
  cout_employeur: number;
  payslip: Payslip;
}
export type PayrollMonthStatus = "brouillon" | "soumis_dg" | "valide";
export interface PayrollMonth {
  exists: boolean;
  period: string;
  status?: PayrollMonthStatus;
  validated_at?: string | null;
  submitted_at?: string | null;
  return_reason?: string | null;
  returned_at?: string | null;
  rate_effective_from?: string;
  rates?: PayslipRates;
  lines?: PayrollMonthLine[];
  totals?: { brut: number; net: number; cout: number };
  // Employés sans fiche paie (exclus de la grille tant que leur fiche n'existe pas).
  missing_profiles?: { employee_id: string; name: string; department: string | null }[];
}
export function preparePayrollMonth(period: string) {
  return request<{ period: string; status: PayrollMonthStatus }>(`/api/v1/payroll/monthly/${period}/prepare`, { method: "POST" });
}
// Soumission de la paie au Directeur général (RH) : brouillon → soumis_dg.
export function submitPayrollMonth(period: string) {
  return request<{ period: string; status: "soumis_dg" }>(`/api/v1/payroll/monthly/${period}/submit`, { method: "POST" });
}
// Retour de la paie au RH pour correction (DG), motif obligatoire.
export function returnPayrollMonth(period: string, reason: string) {
  return request<{ period: string; status: "brouillon"; return_reason: string }>(`/api/v1/payroll/monthly/${period}/return`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function getPayrollMonth(period: string) {
  return request<PayrollMonth>(`/api/v1/payroll/monthly/${period}`);
}

// DIPE mensuel CNPS : colonnes exactes du formulaire de télédéclaration.
export interface DipeRow {
  matricule_assure: string;
  nb_jours: number;
  salaire_brut: number;
  elements_exceptionnels: number;
  salaire_taxable: number;
  cotisable_total: number;
  cotisable_plafonne: number;
  irpp: number;
  matricule_interne: string;
  nom_prenom: string;
}
export type DipeIrppMode = "irpp_cac" | "irpp";
export interface DipeMonth {
  period: string;
  annee: number;
  mois: number;
  n_dipe: string;
  cle: string;
  regime: string;
  irpp_mode: DipeIrppMode;
  irpp_label: string;
  effectif: number;
  rows: DipeRow[];
  totals: { salaire_brut: number; salaire_taxable: number; cotisable_total: number; cotisable_plafonne: number; irpp: number };
  closed: boolean;
}
export function getPayrollDipe(period: string, irppMode: DipeIrppMode = "irpp_cac") {
  return request<DipeMonth>(`/api/v1/payroll/dipe?period=${encodeURIComponent(period)}&irpp_mode=${irppMode}`);
}
export function savePayrollMonthLine(period: string, employeeId: string, elements: PayrollMonthElements, note?: string | null, extraLines?: PayrollExtraLine[]) {
  return request<{ ok: boolean }>(`/api/v1/payroll/monthly/${period}/lines/${employeeId}`, { method: "PATCH", body: JSON.stringify({ ...elements, note: note ?? null, extra_lines: extraLines ?? [] }) });
}
// Validation définitive du mois par le Directeur général (obligatoire avant impression).
export function validatePayrollMonth(period: string) {
  return request<{ period: string; status: "valide" }>(`/api/v1/payroll/monthly/${period}/validate`, { method: "POST" });
}
export function reopenPayrollMonth(period: string) {
  return request<{ period: string; status: "brouillon" }>(`/api/v1/payroll/monthly/${period}/reopen`, { method: "POST" });
}

// Réouverture EXCEPTIONNELLE d'une paie verrouillée (ch. 23) : demande RH → décision DG.
export interface ReopenRequest {
  id: string;
  status: "en_attente" | "autorisee" | "refusee";
  element: string;
  old_value: string | null;
  requested_correction: string;
  reason: string;
  employee_id: string | null;
  employee_name: string | null;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
}
export function requestPayrollReopen(period: string, body: { employee_id?: string | null; element: string; old_value?: string | null; requested_correction: string; reason: string }) {
  return request<{ id: string; status: string }>(`/api/v1/payroll/monthly/${period}/reopen-request`, { method: "POST", body: JSON.stringify(body) });
}
export function listPayrollReopenRequests(period: string) {
  return request<ReopenRequest[]>(`/api/v1/payroll/monthly/${period}/reopen-requests`);
}
export function decidePayrollReopen(id: string, decision: "autorisee" | "refusee", decisionReason?: string) {
  return request<{ id: string; status: string }>(`/api/v1/payroll/reopen-requests/${id}/decide`, { method: "POST", body: JSON.stringify({ decision, decision_reason: decisionReason }) });
}
export function previewPayslipEmail(employeeId: string, period: string, message: string, retenueAbsence = 0) {
  return request<{ subject: string; html: string; default_to: string | null }>(`/api/v1/payroll/employees/${employeeId}/payslip/email`, { method: "POST", body: JSON.stringify({ period, message, preview: true, retenue_absence: retenueAbsence }) });
}
export function sendPayslipEmail(employeeId: string, period: string, message: string, to: string, pdfBase64?: string, retenueAbsence = 0) {
  return request<{ sent: boolean; to: string; dispatch_id?: string; status?: string }>(`/api/v1/payroll/employees/${employeeId}/payslip/email`, { method: "POST", body: JSON.stringify({ period, message, to, pdf_base64: pdfBase64, retenue_absence: retenueAbsence }) });
}
export interface PayslipDispatch {
  id: string;
  period: string;
  recipient: string;
  status: "pending" | "sent" | "failed";
  error: string | null;
  has_pdf: boolean;
  created_at: string;
}
export function getPayslipDispatches(employeeId: string, period?: string) {
  return request<PayslipDispatch[]>(`/api/v1/payroll/employees/${employeeId}/payslip/dispatches${period ? `?period=${period}` : ""}`);
}

// Livre de paie & clôture (D-007, incrément 5).
export interface RegisterLine {
  employee_id: string; employee_name: string; matricule: string | null; cnps_number: string | null; niu: string | null;
  salaire_brut: number; assiette_cnps: number; pvid_salarie: number; pvid_patronal: number;
  prestations_familiales: number; accidents_travail: number; cfc_salarie: number; cfc_patronal: number;
  fne: number; taxe_communale: number; rav: number; irpp_cac: number;
  total_retenues_salariales: number; total_charges_patronales: number; net_a_payer: number; cout_employeur: number;
}
export interface PayrollRegister {
  period: string; rate_effective_from: string; closed: boolean; closed_at: string | null;
  lines: RegisterLine[]; totals: { brut: number; net: number; charges_pat: number };
  // Source des montants : le mois préparé (grille) s'il existe, sinon les fiches.
  monthly_status: PayrollMonthStatus | null;
}
export function getPayrollRegister(period: string) {
  return request<PayrollRegister>(`/api/v1/payroll/register?period=${period}`);
}
export function closePayrollPeriod(period: string) {
  return request<{ period: string; employees: number; total_net: number; closed_at: string }>(`/api/v1/payroll/register/${period}/close`, { method: "POST" });
}

// Journal de paie archivé d'une période clôturée (instantané figé par salarié).
export interface JournalLine {
  employee_id: string; employee_name: string; matricule: string | null; cnps_number: string | null; niu: string | null;
  salaire_brut: number; assiette_cnps: number; pvid_salarie: number; pvid_patronal: number;
  prestations_familiales: number; accidents_travail: number; cfc_salarie: number; cfc_patronal: number;
  fne: number; taxe_communale: number; rav: number; irpp_cac: number;
  total_retenues_salariales: number; total_charges_patronales: number; net_a_payer: number; cout_employeur: number;
}
export interface PayrollJournal {
  period: string; closed_at: string; employees: number;
  totals: { brut: number; net: number; charges_pat: number };
  lines: JournalLine[];
}
export function getPayrollJournal(period: string) {
  return request<PayrollJournal>(`/api/v1/payroll/journal/${period}`);
}

// Contrôles & anomalies d'un mois de paie (§18).
export interface PayrollAnomaly { employee_id: string | null; employee_name: string; message: string; }
export interface PayrollAnomalies { period: string; blocking: PayrollAnomaly[]; warnings: PayrollAnomaly[]; can_submit: boolean; }
export function getMonthlyAnomalies(period: string) {
  return request<PayrollAnomalies>(`/api/v1/payroll/monthly/${period}/anomalies`);
}

// ── Centre de Communication Interne — Babillard d'annonces ────────────────────
export type AnnouncementPriority = "normale" | "importante" | "urgente" | "critique";
export type AnnouncementStatus = "brouillon" | "publiee" | "archivee";
export type AnnouncementTargetType = "tous" | "departement" | "role" | "utilisateur";

export interface AnnouncementCategory {
  code: string;
  label: string;
}

export interface AnnouncementFeedItem {
  id: string;
  title: string;
  body_html: string;
  preview: string;
  priority: AnnouncementPriority;
  status: AnnouncementStatus;
  require_ack: boolean;
  pinned: boolean;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  category: AnnouncementCategory | null;
  author: { id: string; username: string } | null;
  read_at: string | null;
  acknowledged_at: string | null;
}

export interface AnnouncementManageItem extends Omit<AnnouncementFeedItem, "preview" | "read_at" | "acknowledged_at"> {
  recipients: number;
  read: number;
}

export interface AnnouncementTargetRef {
  type: AnnouncementTargetType;
  id: string | null;
}

export interface AnnouncementDetail extends AnnouncementFeedItem {
  targets?: AnnouncementTargetRef[];
}

export interface AnnouncementInput {
  title: string;
  body_html: string;
  category_code?: string | null;
  priority?: AnnouncementPriority;
  require_ack?: boolean;
  pinned?: boolean;
  expires_at?: string | null;
  targets: { type: AnnouncementTargetType; id?: string }[];
}

export interface AnnouncementReceiptsReport {
  total: number;
  read: number;
  acknowledged: number;
  require_ack: boolean;
  rows: { user_id: string; username: string; name: string; read_at: string | null; acknowledged_at: string | null }[];
}

export interface TargetOptions {
  departments: { id: string; name: string }[];
  roles: { id: string; label: string }[];
  users: { id: string; username: string; name: string }[];
}

export interface NotificationPreferences {
  sound_enabled: boolean;
  sound_volume: number;
  visual_enabled: boolean;
  email_enabled: boolean;
  categories: string[] | null;
}

export function listAnnouncementCategories() {
  return request<AnnouncementCategory[]>("/api/v1/announcement-categories");
}

export function listAnnouncementFeed(filters?: { unread?: boolean; category?: string; priority?: AnnouncementPriority; status?: "publiee" | "archivee" }) {
  const p = new URLSearchParams();
  if (filters?.unread) p.set("unread", "true");
  if (filters?.category) p.set("category", filters.category);
  if (filters?.priority) p.set("priority", filters.priority);
  if (filters?.status) p.set("status", filters.status);
  const q = p.toString();
  return request<AnnouncementFeedItem[]>(`/api/v1/announcements${q ? `?${q}` : ""}`);
}

export function getAnnouncementsUnreadCount() {
  return request<{ count: number }>("/api/v1/announcements/unread-count");
}

export interface AnnouncementBannerItem {
  id: string;
  title: string;
  priority: "urgente" | "critique";
  preview: string;
  acknowledged: boolean;
}

export function getAnnouncementBanner() {
  return request<AnnouncementBannerItem[]>("/api/v1/announcements/banner");
}

export function listAnnouncementsManage() {
  return request<AnnouncementManageItem[]>("/api/v1/announcements/manage");
}

export function getAnnouncement(id: string) {
  return request<AnnouncementDetail>(`/api/v1/announcements/${id}`);
}

export function createAnnouncement(input: AnnouncementInput) {
  return request<{ id: string }>("/api/v1/announcements", { method: "POST", body: JSON.stringify(input) });
}

export function updateAnnouncement(id: string, input: Partial<AnnouncementInput>) {
  return request<{ ok: true }>(`/api/v1/announcements/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function publishAnnouncement(id: string) {
  return request<{ ok: true; recipients: number }>(`/api/v1/announcements/${id}/publish`, { method: "POST" });
}

export function archiveAnnouncement(id: string) {
  return request<{ ok: true }>(`/api/v1/announcements/${id}/archive`, { method: "POST" });
}

export function deleteAnnouncement(id: string) {
  return request<{ ok: true }>(`/api/v1/announcements/${id}`, { method: "DELETE" });
}

export function markAnnouncementRead(id: string) {
  return request<{ ok: true }>(`/api/v1/announcements/${id}/read`, { method: "POST" });
}

export function ackAnnouncement(id: string) {
  return request<{ ok: true }>(`/api/v1/announcements/${id}/ack`, { method: "POST" });
}

export function getAnnouncementReceipts(id: string) {
  return request<AnnouncementReceiptsReport>(`/api/v1/announcements/${id}/receipts`);
}

export function remindAnnouncement(id: string) {
  return request<{ ok: true; reminded: number }>(`/api/v1/announcements/${id}/remind`, { method: "POST" });
}

export function getAnnouncementTargetOptions() {
  return request<TargetOptions>("/api/v1/announcement-targets/options");
}

export function getNotificationPreferences() {
  return request<NotificationPreferences>("/api/v1/me/notification-preferences");
}

export function setNotificationPreferences(input: Partial<NotificationPreferences>) {
  return request<{ ok: true }>("/api/v1/me/notification-preferences", { method: "PUT", body: JSON.stringify(input) });
}

// ── Calendrier partagé & événements ──────────────────────────────────────────
export type CalendarEventType = "reunion" | "echeance" | "formation" | "sortie" | "ceremonie" | "autre";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  type: CalendarEventType;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  author: { id: string; username: string } | null;
  can_manage: boolean;
  birthday?: boolean;
}

export interface CalendarEventDetail extends CalendarEvent {
  targets?: AnnouncementTargetRef[];
}

export interface CalendarEventInput {
  title: string;
  description?: string | null;
  type: CalendarEventType;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  targets: { type: AnnouncementTargetType; id?: string }[];
}

// Fil d'actualités : items agrégés (annonces + événements).
export interface NewsfeedItem {
  kind: "announcement" | "event";
  id: string;
  title: string;
  date: string | null;
  preview: string | null;
  author: string | null;
  // annonce
  priority?: AnnouncementPriority;
  category?: string | null;
  read?: boolean;
  // événement
  event_type?: CalendarEventType;
  all_day?: boolean;
}

export function getNewsfeed() {
  return request<NewsfeedItem[]>("/api/v1/newsfeed");
}

export function getTodayBirthdays() {
  return request<{ id: string; name: string }[]>("/api/v1/calendar/today-birthdays");
}

export function listCalendarEvents(from: string, to: string) {
  return request<CalendarEvent[]>(`/api/v1/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export function getCalendarEvent(id: string) {
  return request<CalendarEventDetail>(`/api/v1/calendar/events/${id}`);
}

export function createCalendarEvent(input: CalendarEventInput) {
  return request<{ id: string }>("/api/v1/calendar/events", { method: "POST", body: JSON.stringify(input) });
}

export function updateCalendarEvent(id: string, input: Partial<CalendarEventInput>) {
  return request<{ ok: true }>(`/api/v1/calendar/events/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteCalendarEvent(id: string) {
  return request<{ ok: true }>(`/api/v1/calendar/events/${id}`, { method: "DELETE" });
}

export function remindCalendarEvent(id: string) {
  return request<{ ok: true; reminded: number }>(`/api/v1/calendar/events/${id}/remind`, { method: "POST" });
}

export function getUpcomingEvents(days = 7) {
  return request<CalendarEvent[]>(`/api/v1/calendar/upcoming?days=${days}`);
}

// ── Bulletin d'actualités (Newsletter) ───────────────────────────────────────
export type NewsletterStatus = "brouillon" | "envoyee";

export interface NewsletterSummary {
  id: string;
  title: string;
  status: NewsletterStatus;
  period_start: string;
  period_end: string;
  sent_at: string | null;
  recipients: number | null;
  author: string | null;
  created_at: string;
}

export interface NewsletterItem {
  kind: "announcement" | "event";
  id: string;
  title: string;
  date: string | null;
  preview: string | null;
}

export interface NewsletterDetail {
  id: string;
  title: string;
  intro: string | null;
  status: NewsletterStatus;
  period_start: string;
  period_end: string;
  sent_at: string | null;
  recipients: number | null;
  author: string | null;
  items: NewsletterItem[];
}

export interface NewsletterInput {
  title: string;
  intro?: string | null;
  period_start: string;
  period_end: string;
}

export function listNewsletters() {
  return request<NewsletterSummary[]>("/api/v1/newsletters");
}

export function previewNewsletter(periodStart: string, periodEnd: string) {
  const qs = `period_start=${encodeURIComponent(periodStart)}&period_end=${encodeURIComponent(periodEnd)}`;
  return request<{ items: NewsletterItem[] }>(`/api/v1/newsletters/preview?${qs}`);
}

export function getNewsletter(id: string) {
  return request<NewsletterDetail>(`/api/v1/newsletters/${id}`);
}

export function createNewsletter(input: NewsletterInput) {
  return request<{ id: string }>("/api/v1/newsletters", { method: "POST", body: JSON.stringify(input) });
}

export function updateNewsletter(id: string, input: Partial<NewsletterInput>) {
  return request<{ ok: true }>(`/api/v1/newsletters/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function sendNewsletter(id: string) {
  return request<{ ok: true; recipients: number; items: number }>(`/api/v1/newsletters/${id}/send`, { method: "POST" });
}

export function deleteNewsletter(id: string) {
  return request<{ ok: true }>(`/api/v1/newsletters/${id}`, { method: "DELETE" });
}

// ── Clôture d'activité mensuelle (RH) ────────────────────────────────────────
export interface ActivityClosureReminderSent {
  reminder_day: number;
  manual: boolean;
  sent_at: string;
  recipients: number;
}

export interface ActivityClosureStatus {
  closure_day: number;
  reminder_days: number[];
  period_key: string;
  period_label: string;
  closure_date: string;
  days_until_closure: number;
  is_closed: boolean;
  closed_at: string | null;
  reminders_sent: ActivityClosureReminderSent[];
}

export function getActivityClosure() {
  return request<ActivityClosureStatus>("/api/v1/hr/activity-closure");
}

export function remindActivityClosure() {
  return request<{ ok: true; period_label: string; recipients: number }>("/api/v1/hr/activity-closure/remind", {
    method: "POST",
  });
}

// ── Fiche « site vitrine » (prête à publier) ─────────────────────────────────
export interface SiteFichePayload {
  title: string;
  subtitle: string | null;
  author: string | null;
  genre: string | null;
  price: number | null;
  currency: string;
  summary: string | null;
  isbn: string | null;
}

export interface SiteFicheView {
  payload: SiteFichePayload;
  fiche: string; // texte prêt à copier
  cover: { available: boolean; version_id: string | null; mime_type: string | null; is_image: boolean };
  missing: string[];
  status: "non_publie" | "publie" | "erreur";
  external_url: string | null;
  published_at: string | null;
}

export function getSitePublication(manuscriptId: string) {
  return request<SiteFicheView>(`/api/v1/manuscripts/${manuscriptId}/site-publication`);
}

export function setSitePublished(manuscriptId: string, published: boolean, url?: string) {
  return request<{ ok: true; status: string; external_url: string | null; published_at: string | null }>(
    `/api/v1/manuscripts/${manuscriptId}/site-publication`,
    { method: "POST", body: JSON.stringify({ published, url: url ?? "" }) },
  );
}

// ── Suivi des ventes par ouvrage (sorties vs ventes réelles + écart) ─────────
export interface SalesTrackingRow {
  key: string;
  label: string;
  units_out: number;
  units_sold: number;
  amount: number;
  gap: number;
}
export interface SalesTrackingResult {
  granularity: "week" | "month";
  from: string | null;
  to: string | null;
  by_book: SalesTrackingRow[];
  by_period: SalesTrackingRow[];
  totals: { units_out: number; units_sold: number; amount: number; gap: number };
}
export function getSalesByBook(params: { from?: string; to?: string; granularity: "week" | "month" }) {
  const q = new URLSearchParams();
  q.set("granularity", params.granularity);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  return request<SalesTrackingResult>(`/api/v1/commercial/sales-by-book?${q.toString()}`);
}

// ── Commissions commerciales ─────────────────────────────────────────────────
export type CommissionGranularity = "week" | "month" | "semester" | "year";
export interface CommissionBookRow { isbn_id: string; title: string; units: number; amount: number; commission: number; }
export interface CommissionAgentRow { agent_id: string | null; agent_name: string; units: number; amount: number; commission: number; books: CommissionBookRow[]; }
export interface CommissionPeriodRow { period: string; units: number; amount: number; commission: number; }
export interface CommissionResult {
  rate: number;
  granularity: CommissionGranularity;
  by_agent: CommissionAgentRow[];
  by_period: CommissionPeriodRow[];
  totals: { units: number; amount: number; commission: number };
}
export function getCommissions(params: { from?: string; to?: string; granularity: CommissionGranularity }) {
  const q = new URLSearchParams();
  q.set("granularity", params.granularity);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  return request<CommissionResult>(`/api/v1/commercial/commissions?${q.toString()}`);
}
export function getCommissionRate() {
  return request<{ rate: number }>("/api/v1/commercial/commission-rate");
}
export function setCommissionRate(rate: number) {
  return request<{ ok: true; rate: number }>("/api/v1/commercial/commission-rate", { method: "PUT", body: JSON.stringify({ rate }) });
}

// --- Messagerie interne 1-à-1 (Communication interne) --------------------------
export const CHAT_API_BASE = API_BASE;
export interface ChatDirectoryEntry {
  id: string;
  name: string;
}
export interface ChatConversation {
  id: string;
  other_id: string;
  other_name: string;
  last_message: string;
  last_at: string | null;
  unread: number;
}
export interface ChatReplyPreview {
  id: string;
  sender_name: string;
  excerpt: string;
}
export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  mine: boolean;
  body: string;
  deleted: boolean;
  created_at: string;
  read: boolean;
  file: { name: string; mime: string | null; size: number | null } | null;
  // Options messagerie (Modifier / Transférer / Répondre)
  edited?: boolean;
  edited_at?: string | null;
  forwarded?: boolean;
  reply_to?: ChatReplyPreview | null;
}
export function getChatDirectory() {
  return request<ChatDirectoryEntry[]>("/api/v1/chat/directory");
}
export function getConversations() {
  return request<ChatConversation[]>("/api/v1/chat/conversations");
}
export function getChatUnread() {
  return request<{ unread: number }>("/api/v1/chat/unread");
}
export function startConversation(userId: string) {
  return request<{ id: string; other_id: string; other_name: string }>("/api/v1/chat/conversations", { method: "POST", body: JSON.stringify({ user_id: userId }) });
}
export function getMessages(conversationId: string) {
  return request<ChatMessage[]>(`/api/v1/chat/conversations/${conversationId}/messages`);
}
export function sendChatMessage(conversationId: string, body: string, replyToId?: string) {
  return request<ChatMessage>(`/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, ...(replyToId ? { reply_to_id: replyToId } : {}) }),
  });
}
// Envoi avec pièce jointe : multipart (le navigateur pose le bon Content-Type).
export async function sendChatMessageWithFile(conversationId: string, body: string, file: File, replyToId?: string): Promise<ChatMessage> {
  const form = new FormData();
  if (body) form.append("body", body);
  if (replyToId) form.append("reply_to_id", replyToId);
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/v1/chat/conversations/${conversationId}/messages`, { method: "POST", credentials: "include", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? `Erreur ${res.status}`);
  }
  return res.json() as Promise<ChatMessage>;
}
export function markConversationRead(conversationId: string) {
  return request<{ ok: true }>(`/api/v1/chat/conversations/${conversationId}/read`, { method: "POST" });
}
export function deleteChatMessage(messageId: string) {
  return request<{ ok: true }>(`/api/v1/chat/messages/${messageId}`, { method: "DELETE" });
}
// Supprimer une discussion entière : "me" = de mon côté seulement (réversible),
// "all" = pour les deux correspondants (suppression logique des messages).
export function deleteChatConversation(conversationId: string, scope: "me" | "all") {
  return request<{ ok: true; scope: "me" | "all" }>(`/api/v1/chat/conversations/${conversationId}`, {
    method: "DELETE",
    body: JSON.stringify({ scope }),
  });
}
// Modifier le texte d'un message déjà envoyé.
export function editChatMessage(messageId: string, body: string) {
  return request<ChatMessage>(`/api/v1/chat/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ body }) });
}
// Transférer un message vers un collègue (conversation créée au besoin).
export function forwardChatMessage(messageId: string, toUserId: string) {
  return request<ChatMessage & { other_id: string; other_name: string }>(`/api/v1/chat/messages/${messageId}/forward`, {
    method: "POST",
    body: JSON.stringify({ to_user_id: toUserId }),
  });
}
export function chatFileUrl(messageId: string): string {
  return `${API_BASE}/api/v1/chat/messages/${messageId}/file`;
}

// --- Espace Auteur (portail externe, inc. 1) -----------------------------------
export interface AuthorProfile {
  name: string;
  email: string;
  works_count: number;
}
export interface AuthorWork {
  id: string;
  title: string;
  subtitle: string | null;
  reference: string;
  stage_fr: string;
  stage_en: string;
  step_order: number;
  received_at: string;
  publication_date: string | null;
  published: boolean;
}
export interface AuthorWorkStep {
  stage_fr: string;
  stage_en: string;
  step_order: number;
  state: "done" | "current" | "upcoming";
  done_at: string | null;
}
export interface AuthorWorkDetail {
  id: string;
  title: string;
  subtitle: string | null;
  reference: string;
  stage_fr: string;
  stage_en: string;
  received_at: string;
  publication_date: string | null;
  timeline: AuthorWorkStep[];
}
export function getAuthorProfile() {
  return request<AuthorProfile>("/api/v1/author/me");
}
export function getAuthorWorks() {
  return request<AuthorWork[]>("/api/v1/author/works");
}
export function getAuthorWork(id: string) {
  return request<AuthorWorkDetail>(`/api/v1/author/works/${id}`);
}

// --- Espace Auteur : échange de fichiers (inc. 2a) -----------------------------
export interface AuthorFile {
  id: string;
  label: string;
  name: string;
  mime: string;
  size: number;
  direction: "from_author" | "to_author";
  from_house: boolean;
  created_at: string;
}
// Côté auteur
export function getAuthorWorkFiles(workId: string) {
  return request<AuthorFile[]>(`/api/v1/author/works/${workId}/files`);
}
export async function uploadAuthorWorkFile(workId: string, label: string, file: File): Promise<AuthorFile> {
  const form = new FormData();
  if (label) form.append("label", label);
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/v1/author/works/${workId}/files`, { method: "POST", credentials: "include", body: form });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Erreur ${res.status}`);
  return res.json() as Promise<AuthorFile>;
}
export function authorFileDownloadUrl(fileId: string): string {
  return `${API_BASE}/api/v1/author/files/${fileId}/download`;
}
export function deleteAuthorFile(fileId: string) {
  return request<{ ok: true }>(`/api/v1/author/files/${fileId}`, { method: "DELETE" });
}
// Côté personnel (fiche manuscrit)
export interface StaffAuthorFile extends AuthorFile {
  uploaded_by: string | null;
}
export function getManuscriptAuthorFiles(manuscriptId: string) {
  return request<StaffAuthorFile[]>(`/api/v1/manuscripts/${manuscriptId}/author-files`);
}
export async function shareFileToAuthor(manuscriptId: string, label: string, file: File): Promise<AuthorFile> {
  const form = new FormData();
  if (label) form.append("label", label);
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/v1/manuscripts/${manuscriptId}/author-files`, { method: "POST", credentials: "include", body: form });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Erreur ${res.status}`);
  return res.json() as Promise<AuthorFile>;
}
export function manuscriptAuthorFileDownloadUrl(manuscriptId: string, fileId: string): string {
  return `${API_BASE}/api/v1/manuscripts/${manuscriptId}/author-files/${fileId}/download`;
}

// --- Espace Auteur : messagerie vers les services (inc. 2b) ---------------------
export type ServiceDesk = "education" | "client";
export interface ServiceThreadSummary {
  id: string;
  service: ServiceDesk;
  service_label: string;
  subject: string;
  status: string;
  last_message: string;
  last_at: string | null;
  unread: number;
  author_name?: string;
}
export interface ServiceThreadMessage {
  id: string;
  body: string;
  created_at: string;
  mine?: boolean;
  from_service?: boolean;
  from_author?: boolean;
}
export interface ServiceThreadDetail {
  id: string;
  service: ServiceDesk;
  service_label: string;
  subject: string;
  status: string;
  author_name?: string;
  messages: ServiceThreadMessage[];
}
// Côté auteur
export function getAuthorServiceThreads() {
  return request<ServiceThreadSummary[]>("/api/v1/author/service-threads");
}
export function createAuthorServiceThread(service: ServiceDesk, subject: string, body: string) {
  return request<{ id: string }>("/api/v1/author/service-threads", { method: "POST", body: JSON.stringify({ service, subject, body }) });
}
export function getAuthorServiceThread(id: string) {
  return request<ServiceThreadDetail>(`/api/v1/author/service-threads/${id}`);
}
export function replyAuthorServiceThread(id: string, body: string) {
  return request<{ ok: true }>(`/api/v1/author/service-threads/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
}
// Côté personnel
export function getServiceThreads(service?: ServiceDesk) {
  return request<ServiceThreadSummary[]>(`/api/v1/service-threads${service ? `?service=${service}` : ""}`);
}
export function getServiceThread(id: string) {
  return request<ServiceThreadDetail>(`/api/v1/service-threads/${id}`);
}
export function replyServiceThread(id: string, body: string) {
  return request<{ ok: true }>(`/api/v1/service-threads/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
}

// --- Commandes à facturer + validation par seuil (Finance étape 3) --------------
export type BillingOrderCategory = "livre_scolaire" | "livre_general" | "autre";
export interface BillingOrder {
  id: string;
  reference: string;
  category: BillingOrderCategory;
  label: string;
  customer_name: string;
  amount_ht: number;
  tax_rate: number;
  amount_ttc: number;
  discount_pct: number;
  status: "pending" | "invoiced" | "cancelled";
  created_at: string;
}
// Ligne d'ouvrage d'une commande « livre scolaire » : support du calcul des
// droits d'auteur (ISBN, quantité, prix unitaire HT, taux éventuel).
export interface BillingOrderLineInput {
  isbn_id?: string;
  description: string;
  quantity: number;
  unit_price_ht: number;
  royalty_rate?: number; // fraction (ex. 0,12) ; sinon taux maison
}
export function createBillingOrder(input: {
  customer_id: string;
  category: BillingOrderCategory;
  label: string;
  amount_ht?: number;
  tax_rate?: number;
  discount_pct?: number;
  note?: string;
  lines?: BillingOrderLineInput[];
}) {
  return request<BillingOrder>("/api/v1/billing-orders", { method: "POST", body: JSON.stringify(input) });
}
export function getBillingOrders(status: "pending" | "invoiced" | "cancelled" = "pending") {
  return request<BillingOrder[]>(`/api/v1/billing-orders?status=${status}`);
}
export function invoiceBillingOrder(id: string, discountPct = 0) {
  return request<{ id: string; invoice_number: string; status: string; total_ttc: number; needs_validation: boolean }>(`/api/v1/billing-orders/${id}/invoice`, { method: "POST", body: JSON.stringify({ discount_pct: discountPct }) });
}
export function cancelBillingOrder(id: string, reason?: string) {
  return request<BillingOrder>(`/api/v1/billing-orders/${id}/cancel`, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) });
}
export interface PendingValidationInvoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  total_ttc: number;
  created_at: string;
}
export function getPendingValidationInvoices() {
  return request<PendingValidationInvoice[]>("/api/v1/invoices/pending-validation");
}
export function validateInvoice(id: string) {
  return request<{ ok: true; status: string }>(`/api/v1/invoices/${id}/validate`, { method: "POST" });
}
// Refus d'une facture en attente de validation (DG) : motif obligatoire ; la
// facture est annulée (hors CA) et la commande d'origine repasse « à facturer ».
export function rejectInvoiceValidation(id: string, reason: string) {
  return request<{ ok: true; status: string }>(`/api/v1/invoices/${id}/validate-reject`, { method: "POST", body: JSON.stringify({ reason }) });
}
// Annulation d'une facture soumise à validation du DG.
export function requestInvoiceCancellation(id: string, reason: string) {
  return request<{ ok: true; status: string }>(`/api/v1/invoices/${id}/request-cancellation`, { method: "POST", body: JSON.stringify({ reason }) });
}
export interface PendingCancellationInvoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  total_ttc: number;
  reason: string | null;
  requested_at: string | null;
}
export function getPendingCancellationInvoices() {
  return request<PendingCancellationInvoice[]>("/api/v1/invoices/pending-cancellation");
}
export function approveInvoiceCancellation(id: string) {
  return request<{ ok: true; status: string }>(`/api/v1/invoices/${id}/cancel-approve`, { method: "POST" });
}
// Annulation directe par le DG / administrateur général — possible même sur une
// facture déjà imprimée (essai / erreur). Motif obligatoire.
export function forceCancelInvoice(id: string, reason: string) {
  return request<{ ok: true; status: string }>(`/api/v1/invoices/${id}/force-cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function rejectInvoiceCancellation(id: string) {
  return request<{ ok: true; status: string }>(`/api/v1/invoices/${id}/cancel-reject`, { method: "POST" });
}
// Avoir (note de crédit) neutralisant une facture — voie légale quand la facture
// ne peut plus être annulée (déjà tirée / réglée).
export function createInvoiceCreditNote(id: string, reason?: string) {
  return request<{ id: string; invoice_number: string; total_ttc: number }>(`/api/v1/invoices/${id}/credit-note`, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) });
}
export function getValidationThreshold() {
  return request<{ threshold: number }>("/api/v1/finance/validation-threshold");
}
export function setValidationThreshold(threshold: number) {
  return request<{ threshold: number }>("/api/v1/finance/validation-threshold", { method: "PUT", body: JSON.stringify({ threshold }) });
}
