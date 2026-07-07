import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { prisma } from "./prisma.js";
import { SESSION_COOKIE, verifySessionToken } from "./session.js";

// Présence temps réel (Ch. 5, indicateurs de présence) via Socket.IO, attaché
// au MÊME serveur HTTP que Fastify (un seul $PORT sur Scalingo). État en
// mémoire — mono-instance : suffisant pour la recette. En cas de passage à
// plusieurs conteneurs web (scaling horizontal), il faudrait un adaptateur
// partagé (@socket.io/redis-adapter + addon Redis) pour synchroniser la
// présence entre instances (voir docs/JOURNAL_TECHNIQUE.md).

interface SocketState {
  userId: string;
  username: string;
  poleId: string | null;
  moduleId: string | null;
}

interface JoinPayload {
  poleId?: string | null;
  moduleId?: string | null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function attachPresence(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    // Même origine en production ; en développement, le frontend Vite (5173)
    // se connecte au backend (3000).
    cors: { origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173", credentials: true },
  });

  const states = new Map<string, SocketState>();

  // Authentification de la socket par le cookie de session existant (RBAC
  // inchangé : on réutilise verifySessionToken).
  io.use(async (socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const userId = verifySessionToken(cookies[SESSION_COOKIE]);
    if (!userId) return next(new Error("unauthorized"));
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) return next(new Error("unauthorized"));
    socket.data.userId = user.id;
    socket.data.username = user.username;
    next();
  });

  function broadcast() {
    const connectedById = new Map<string, string>();
    const byPole: Record<string, Set<string>> = {};
    const byModule: Record<string, Set<string>> = {};

    for (const s of states.values()) {
      connectedById.set(s.userId, s.username);
      if (s.poleId) (byPole[s.poleId] ??= new Set()).add(s.username);
      if (s.moduleId) (byModule[s.moduleId] ??= new Set()).add(s.username);
    }

    const toArrays = (map: Record<string, Set<string>>) =>
      Object.fromEntries(Object.entries(map).map(([k, set]) => [k, [...set]]));

    io.emit("presence:update", {
      connectedUsers: [...connectedById.entries()].map(([userId, username]) => ({ userId, username })),
      byPole: toArrays(byPole),
      byModule: toArrays(byModule),
    });
  }

  io.on("connection", (socket: Socket) => {
    states.set(socket.id, {
      userId: socket.data.userId,
      username: socket.data.username,
      poleId: null,
      moduleId: null,
    });
    broadcast();

    socket.on("presence:join", (payload: JoinPayload) => {
      const state = states.get(socket.id);
      if (!state) return;
      state.poleId = payload?.poleId ?? null;
      state.moduleId = payload?.moduleId ?? null;
      broadcast();
    });

    socket.on("presence:leave", () => {
      const state = states.get(socket.id);
      if (!state) return;
      state.poleId = null;
      state.moduleId = null;
      broadcast();
    });

    // Déconnexion propre (fermeture d'onglet incluse) : évite les voyants fantômes.
    socket.on("disconnect", () => {
      states.delete(socket.id);
      broadcast();
    });
  });

  return io;
}
