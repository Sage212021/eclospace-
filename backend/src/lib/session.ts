import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("SESSION_SECRET manquant (voir .env.example)");
}

export const SESSION_COOKIE = "eclospace_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — session expirée après inactivité (Ch. 21 §21.4)

interface SessionPayload {
  sub: string; // user id (compte effectivement utilisé)
  imp?: string; // id de l'administrateur qui usurpe l'identité, le cas échéant
  iat: number;
  exp: number;
}

export interface ResolvedSession {
  userId: string;
  impersonatorId: string | null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", SECRET!).update(data).digest("base64url");
}

export function createSessionToken(userId: string, impersonatorId?: string): string {
  const now = Date.now();
  const payload: SessionPayload = { sub: userId, iat: now, exp: now + SESSION_TTL_MS };
  if (impersonatorId) payload.imp = impersonatorId;
  const body = base64url(JSON.stringify(payload));
  const signature = sign(body);
  return `${body}.${signature}`;
}

// Résout la session complète (compte utilisé + éventuel usurpateur).
export function verifySession(token: string | undefined): ResolvedSession | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (Date.now() > payload.exp) return null;
    return { userId: payload.sub, impersonatorId: payload.imp ?? null };
  } catch {
    return null;
  }
}

// Compat : ne renvoie que l'identifiant du compte utilisé (présence, etc.).
export function verifySessionToken(token: string | undefined): string | null {
  return verifySession(token)?.userId ?? null;
}

// Options communes du cookie de session (posé à la connexion comme à
// l'usurpation d'identité).
export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
}
