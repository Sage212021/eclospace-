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
