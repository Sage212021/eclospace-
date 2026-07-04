const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

export interface EffectiveUser {
  id: string;
  username: string;
  email: string;
  mfa_enabled: boolean;
  roles: string[];
  permissions: string[];
}

interface ApiError {
  code: string;
  message: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
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

export function listManuscripts() {
  return request<Manuscript[]>("/api/v1/manuscripts?sort=priority");
}

export function getManuscript(id: string) {
  return request<
    Manuscript & {
      workContributors: { author: { firstName: string; lastName: string; penName: string | null } }[];
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

export function validateStep(manuscriptId: string, step: string, options?: { observations?: string; outcome?: "conforme" | "incomplet" }) {
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
