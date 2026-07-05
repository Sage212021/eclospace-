import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("SESSION_SECRET manquant (voir .env.example)");
}

export const SESSION_COOKIE = "eclospace_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — session expirée après inactivité (Ch. 21 §21.4)

interface SessionPayload {
  sub: string; // user id
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", SECRET!).update(data).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const now = Date.now();
  const payload: SessionPayload = { sub: userId, iat: now, exp: now + SESSION_TTL_MS };
  const body = base64url(JSON.stringify(payload));
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifySessionToken(token: string | undefined): string | null {
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
    return payload.sub;
  } catch {
    return null;
  }
}
