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
  // Département d'appartenance de la personne (fiche employé), fixe pour la
  // session — sert à regrouper les noms révélés par département réel, sans
  // dépendre de la navigation courante ni d'un rattachement de pôle deviné.
  departmentId: string | null;
  departmentName: string | null;
}

// Référence au registre de présence en mémoire, exposée pour la seule route
// REST de révélation des noms (réservée aux profils habilités). Le canal
// temps réel, lui, ne diffuse jamais d'identités (voir broadcast ci-dessous).
let liveStates: Map<string, SocketState> | null = null;

export interface DepartmentPresence {
  departmentId: string | null;
  departmentName: string;
  users: string[];
}

// Noms des personnes connectées, regroupés par DÉPARTEMENT réel (fiche employé)
// — servis UNIQUEMENT à un appelant habilité (vérifié côté route). Dédoublonné
// par personne (userId) : un même utilisateur sur deux onglets n'apparaît qu'une
// fois. `onlyDepartmentId` restreint le résultat à un seul département (cas du
// chef de département, borné à son propre département) ; absent = tous les
// départements (Direction générale / super-administrateur).
export function getPresenceNamesByDepartment(onlyDepartmentId?: string | null): {
  total: number;
  departments: DepartmentPresence[];
} {
  const byDept = new Map<string, { name: string; users: Map<string, string> }>();
  const everyone = new Set<string>();
  const UNASSIGNED = "__none__";
  if (liveStates) {
    for (const s of liveStates.values()) {
      everyone.add(s.userId);
      const key = s.departmentId ?? UNASSIGNED;
      const name = s.departmentName ?? "Sans département";
      let bucket = byDept.get(key);
      if (!bucket) {
        bucket = { name, users: new Map() };
        byDept.set(key, bucket);
      }
      bucket.users.set(s.userId, s.username);
    }
  }

  let entries = [...byDept.entries()];
  if (onlyDepartmentId !== undefined) {
    // Chef de département : borné à son seul département (jamais « sans
    // département » ni les autres équipes).
    entries = entries.filter(([key]) => key === (onlyDepartmentId ?? UNASSIGNED));
  }

  const departments: DepartmentPresence[] = entries
    .map(([key, bucket]) => ({
      departmentId: key === UNASSIGNED ? null : key,
      departmentName: bucket.name,
      users: [...bucket.users.values()].sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName, "fr"));

  return { total: everyone.size, departments };
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
  // Partage le registre avec getPresenceNamesByPole (révélation habilitée).
  liveStates = states;

  // Authentification de la socket par le cookie de session existant (RBAC
  // inchangé : on réutilise verifySessionToken).
  io.use(async (socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const userId = verifySessionToken(cookies[SESSION_COOKIE]);
    if (!userId) return next(new Error("unauthorized"));
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { employee: { include: { department: true } } },
    });
    if (!user) return next(new Error("unauthorized"));
    socket.data.userId = user.id;
    socket.data.username = user.username;
    socket.data.departmentId = user.employee?.department?.id ?? null;
    socket.data.departmentName = user.employee?.department?.name ?? null;
    next();
  });

  // Confidentialité (exigence de sécurité du 09/07/2026) : le canal temps réel
  // ne diffuse QUE des compteurs — jamais l'identité des personnes connectées.
  // Chacun voit « où » et « combien » (pôle actif + nombre), mais les noms ne
  // transitent pas par la diffusion générale. Ils ne sont révélés que sur
  // demande, à un profil habilité (Direction générale, super-administrateur, ou
  // responsable pour son propre pôle), via une route REST vérifiée côté serveur.
  function broadcast() {
    const connectedUserIds = new Set<string>();
    const byPole: Record<string, Set<string>> = {};
    const byModule: Record<string, Set<string>> = {};

    for (const s of states.values()) {
      connectedUserIds.add(s.userId);
      // On dénombre des personnes distinctes (par userId), pas des onglets : un
      // même utilisateur ouvert deux fois ne compte qu'une fois par pôle/module.
      if (s.poleId) (byPole[s.poleId] ??= new Set()).add(s.userId);
      if (s.moduleId) (byModule[s.moduleId] ??= new Set()).add(s.userId);
    }

    const toCounts = (map: Record<string, Set<string>>) =>
      Object.fromEntries(Object.entries(map).map(([k, set]) => [k, set.size]));

    io.emit("presence:update", {
      total: connectedUserIds.size,
      byPole: toCounts(byPole),
      byModule: toCounts(byModule),
    });
  }

  io.on("connection", (socket: Socket) => {
    states.set(socket.id, {
      userId: socket.data.userId,
      username: socket.data.username,
      poleId: null,
      moduleId: null,
      departmentId: socket.data.departmentId ?? null,
      departmentName: socket.data.departmentName ?? null,
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
