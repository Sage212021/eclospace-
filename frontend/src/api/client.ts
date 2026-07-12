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
export interface DashboardStats {
  ouvrages: number | null;
  utilisateurs: number | null;
  ventes: number | null;
  stock: number | null;
}

export function getDashboardStats() {
  return request<DashboardStats>("/api/v1/dashboard/stats");
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
  title: string;
  body: string;
  priority: "low" | "medium" | "high" | "critical";
  readAt: string | null;
  createdAt: string;
}

export function listUnreadNotifications() {
  return request<Notification[]>("/api/v1/notifications?unread=true");
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

export function getManuscript(id: string) {
  return request<
    Manuscript & {
      workContributors: { partner: { id: string; firstName: string; lastName: string; penName: string | null } }[];
      owner: UserSummary;
    }
  >(`/api/v1/manuscripts/${id}`);
}

export function getManuscriptTimeline(id: string) {
  return request<TimelineStep[]>(`/api/v1/manuscripts/${id}/timeline`);
}

export function createManuscript(input: {
  title: string;
  genre_id: string;
  language: string;
  owner_id: string;
  author: { first_name: string; last_name: string };
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
  options?: { observations?: string; outcome?: "conforme" | "incomplet"; requires_rewrite?: boolean },
) {
  return request<{ advanced: boolean; status: string | null }>(`/api/v1/manuscripts/${manuscriptId}/steps/${step}/validate`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

export interface ReadingAssignment {
  id: string;
  manuscriptId: string;
  readerId: string;
  dueAt: string;
  submittedAt: string | null;
  status: "pending" | "submitted" | "late" | "cancelled";
  manuscript?: { id: string; manuscriptNumber: string; title: string };
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

export interface Partner {
  id: string;
  category: PartnerCategory;
  firstName: string;
  lastName: string;
}

export function listPartners(category?: PartnerCategory) {
  const query = category ? `?category=${category}` : "";
  return request<Partner[]>(`/api/v1/partners${query}`);
}

export function createPartner(input: { category: PartnerCategory; first_name: string; last_name: string }) {
  return request<Partner>("/api/v1/partners", { method: "POST", body: JSON.stringify(input) });
}

export interface Contract {
  id: string;
  contractNumber: string;
  type: string;
  status: ContractStatus;
  signedAt: string | null;
  partner: { id: string; firstName: string; lastName: string };
  manuscript: { id: string; manuscriptNumber: string; title: string } | null;
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

export interface ContractDetail extends Contract {
  effectiveAt?: string | null;
  durationMonths?: number | null;
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

export function createContract(input: {
  type: string;
  manuscript_id?: string;
  partner_id: string;
  financial_terms: Record<string, unknown>;
}) {
  return request<Contract>("/api/v1/contracts", { method: "POST", body: JSON.stringify(input) });
}

export function updateContractStatus(id: string, status: ContractStatus) {
  return request<Contract>(`/api/v1/contracts/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
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
}

export function listImageAssets(manuscriptId: string) {
  return request<ImageAsset[]>(`/api/v1/manuscripts/${manuscriptId}/image-assets`);
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

export interface WorkMetadata {
  version: number;
  summary: string | null;
  weightGrams: number | null;
  themaCodes: string[];
}

export function getWorkMetadata(manuscriptId: string) {
  return request<WorkMetadata | null>(`/api/v1/manuscripts/${manuscriptId}/metadata`);
}

export function updateWorkMetadata(manuscriptId: string, input: Partial<{ summary: string; weight_grams: number; thema_codes: string[] }>) {
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

export type StockLocationType = "entrepot" | "depot" | "depot_vente" | "emplacement";

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

export type StockMovementType =
  | "production_in"
  | "sale_out"
  | "consignment_out"
  | "consignment_return"
  | "customer_return"
  | "transfer"
  | "press_copy"
  | "author_copy"
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
}) {
  return request(`/api/v1/stock-movements`, { method: "POST", body: JSON.stringify(input) });
}

export type CustomerCategory = "librairie" | "distributeur" | "institution" | "particulier" | "plateforme" | "auteur";

export interface Customer {
  id: string;
  category: CustomerCategory;
  name: string;
  creditLimit: string | null;
}

export function listCustomers(category?: CustomerCategory) {
  const query = category ? `?category=${category}` : "";
  return request<Customer[]>(`/api/v1/customers${query}`);
}

export function createCustomer(input: { category: CustomerCategory; name: string; credit_limit?: number; shipping_zone?: string }) {
  return request<Customer>("/api/v1/customers", { method: "POST", body: JSON.stringify(input) });
}

export function getCustomer(id: string) {
  return request<Customer & { outstandingBalance: number }>(`/api/v1/customers/${id}`);
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
  isbn_id: string;
  location_id: string;
  quantity: number;
  unit_price: number;
  payment_method: "cash" | "card" | "mobile_money";
  event_label?: string;
  point_of_sale_id?: string;
}) {
  return request(`/api/v1/pos-sales`, { method: "POST", body: JSON.stringify(input) });
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

// Ch. 18 : Finance et comptabilité (Lot 5).
export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: "invoice" | "credit_note";
  status: string;
  totalHt: string;
  totalTax: string;
  totalTtc: string;
  dueDate: string | null;
  createdAt: string;
  customer: { name: string };
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
  account?: { username: string; email: string; password: string; role_code: string };
}) {
  return request<Employee>("/api/v1/employees", { method: "POST", body: JSON.stringify(input) });
}

export function updateEmployee(id: string, input: Partial<{ department_id: string | null; status: EmployeeStatus; position: string; manager_id: string | null }>) {
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

export type AbsenceType = "conge" | "maladie" | "mission" | "teletravail";
export type AbsenceStatus = "en_attente" | "validee" | "refusee";

export interface Absence {
  id: string;
  employeeId: string;
  type: AbsenceType;
  fromDate: string;
  toDate: string;
  status: AbsenceStatus;
  reason: string | null;
}

export function createAbsence(input: { employee_id: string; type: AbsenceType; from_date: string; to_date: string; reason?: string }) {
  return request<Absence>("/api/v1/absences", { method: "POST", body: JSON.stringify(input) });
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
