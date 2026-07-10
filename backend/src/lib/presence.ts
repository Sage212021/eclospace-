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
  // Grand pôle d'appartenance de la personne (déduit du département de sa fiche
  // employé), fixe pour la session — sert à regrouper les noms révélés par grand
  // pôle, indépendamment de la navigation courante.
  pole: string | null;
}

// Rattachement de chaque département (code de la fiche employé) à l'un des 6
// grands pôles du menu. Décision opérateur (10/07/2026) : le « Chef de
// département » raisonne au niveau des GRANDS PÔLES (Éditorial, Production,
// Commercial, Juridique & Finance, Administration, Pilotage), pas des
// départements fins. Rattachements calés sur la composition du menu (Archives →
// Éditorial, Contrôle qualité → Production, Stock → Commercial, Finance →
// Juridique & Finance, RH → Administration, Direction générale → Pilotage…) ;
// Marketing/communication rangé au Commercial. À ajuster ici si besoin.
const DEPARTMENT_CODE_TO_POLE: Record<string, string> = {
  SECR: "Éditorial",
  COMLEC: "Éditorial",
  DIRED: "Éditorial",
  CORR: "Éditorial",
  EXPERT: "Éditorial",
  ARCH: "Éditorial",
  MAQ: "Production",
  INFOG: "Production",
  CQ: "Production",
  IMPR: "Production",
  STOCK: "Commercial",
  COM: "Commercial",
  MKT: "Commercial",
  JURID: "Juridique & Finance",
  FIN: "Juridique & Finance",
  RH: "Administration",
  DG: "Pilotage",
};

export function poleForDepartmentCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return DEPARTMENT_CODE_TO_POLE[code] ?? null;
}

// Référence au registre de présence en mémoire, exposée pour la seule route
// REST de révélation des noms (réservée aux profils habilités). Le canal
// temps réel, lui, ne diffuse jamais d'identités (voir broadcast ci-dessous).
let liveStates: Map<string, SocketState> | null = null;

export interface PolePresence {
  pole: string;
  users: string[];
}

// Noms des personnes connectées, regroupés par GRAND PÔLE (déduit du département
// de la fiche employé) — servis UNIQUEMENT à un appelant habilité (vérifié côté
// route). Dédoublonné par personne (userId). `onlyPole` restreint le résultat à
// un seul grand pôle (cas du chef de département, borné à son propre pôle) ;
// absent = tous les pôles (Direction générale / super-administrateur).
export function getPresenceNamesByPole(onlyPole?: string | null): {
  total: number;
  poles: PolePresence[];
} {
  const byPole = new Map<string, Map<string, string>>();
  const everyone = new Set<string>();
  const UNASSIGNED = "__none__";
  if (liveStates) {
    for (const s of liveStates.values()) {
      everyone.add(s.userId);
      const key = s.pole ?? UNASSIGNED;
      let users = byPole.get(key);
      if (!users) {
        users = new Map();
        byPole.set(key, users);
      }
      users.set(s.userId, s.username);
    }
  }

  let entries = [...byPole.entries()];
  if (onlyPole !== undefined) {
    // Chef de département : borné à son seul grand pôle (jamais « sans pôle »
    // ni les autres équipes).
    entries = entries.filter(([key]) => key === (onlyPole ?? UNASSIGNED));
  }

  const poles: PolePresence[] = entries
    .filter(([key]) => key !== UNASSIGNED)
    .map(([key, users]) => ({
      pole: key,
      users: [...users.values()].sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .sort((a, b) => a.pole.localeCompare(b.pole, "fr"));

  return { total: everyone.size, poles };
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
    socket.data.pole = poleForDepartmentCode(user.employee?.department?.code ?? null);
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
      // même utilisateur ouvert deux fois ne compte qu'une fois.
      // Effectif par grand pôle = appartenance (fiche employé), pour rester
      // cohérent avec les noms révélés dans le Hall (même regroupement). Le
      // voyant par module, lui, reflète l'activité en cours (navigation).
      if (s.pole) (byPole[s.pole] ??= new Set()).add(s.userId);
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
      pole: socket.data.pole ?? null,
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
