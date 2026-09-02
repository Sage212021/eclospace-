import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { prisma } from "./prisma.js";
import { SESSION_COOKIE, verifySessionToken } from "./session.js";
import { setRealtimeServer, userRoom } from "./realtime.js";

// Présence temps réel (Ch. 5, indicateurs de présence) via Socket.IO, attaché
// au MÊME serveur HTTP que Fastify (un seul $PORT sur Scalingo). État en
// mémoire — mono-instance : suffisant pour la recette. En cas de passage à
// plusieurs conteneurs web (scaling horizontal), il faudrait un adaptateur
// partagé (@socket.io/redis-adapter + addon Redis) pour synchroniser la
// présence entre instances (voir docs/JOURNAL_TECHNIQUE.md).

// Activité réelle d'un onglet : « active » = ERP au premier plan et visible ;
// « away » = onglet en arrière-plan / écran rabattu (toujours connecté mais
// plus devant l'ERP). Le « non connecté » n'existe pas ici : une socket fermée
// est simplement retirée du registre (voyant gris = personne).
type PresenceActivity = "active" | "away";

interface SocketState {
  userId: string;
  username: string;
  poleId: string | null;
  moduleId: string | null;
  // Grand pôle d'appartenance de la personne (déduit du département de sa fiche
  // employé), fixe pour la session — sert à regrouper les noms révélés par grand
  // pôle, indépendamment de la navigation courante.
  pole: string | null;
  // Activité de cet onglet précis (premier plan vs arrière-plan).
  activity: PresenceActivity;
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

// Grand pôle de repli pour une personne connectée sans rattachement opérationnel
// (super-administrateur et comptes sans fiche/département). Sans cela, ces
// personnes seraient comptées dans le total « en ligne » mais n'apparaîtraient
// dans aucun pôle du Hall (incohérence « N en ligne » vs tous les pôles vides).
// L'Administrateur général relève naturellement de l'« Administration ».
const FALLBACK_POLE = "Administration";

export function poleForPresence(code: string | null | undefined): string {
  return poleForDepartmentCode(code) ?? FALLBACK_POLE;
}

// Rattachement d'un RÔLE à un grand pôle — utilisé en repli quand l'utilisateur
// n'a pas de département sur sa fiche employé (fréquent pour les comptes créés
// sans profil RH). Ainsi le voyant vert d'un pôle s'allume dès qu'un de ses
// membres est connecté, même sans fiche employé.
const ROLE_CODE_TO_POLE: Record<string, string> = {
  SECR: "Éditorial", COMLEC: "Éditorial", MEMBRE_COMITE_LECTURE: "Éditorial", COMITE_LECTURE: "Éditorial", DIRED: "Éditorial", DIR_EDITORIAL: "Éditorial", CORR: "Éditorial", CORRECTEUR: "Éditorial", CORRECTION: "Éditorial", REECRITURE: "Éditorial", EXPERT: "Éditorial", EXPERTISE: "Éditorial", ARCH: "Éditorial", ARCHIVAGE: "Éditorial", ASSISTANT_EDITORIAL: "Éditorial", DECISION_EDITORIALE: "Éditorial", ROMAN: "Éditorial", ESSAI: "Éditorial", JEUNESSE: "Éditorial", MANUEL: "Éditorial", POESIE: "Éditorial",
  MAQ: "Production", MAQUETTISTE: "Production", MISE_EN_PAGE: "Production", INFOG: "Production", INFOGRAPHIE: "Production", RESP_INFOGRAPHIE: "Production", CQ: "Production", CONTROLE_QUALITE_IMPRESSION: "Production", RESP_QUALITE: "Production", IMPR: "Production", IMPRESSION: "Production", RESP_IMPRESSION: "Production", VALIDATION_BAT: "Production", PLANIFICATION: "Production", ATTRIBUTION_REFERENCES: "Production",
  STOCK: "Commercial", MAGASINIER: "Commercial", ENTREE_STOCK: "Commercial", COM: "Commercial", COMMERCIALISATION: "Commercial", RESP_COMMERCIAL: "Commercial", VENTE_LIVRAISON: "Commercial", MKT: "Commercial", SUIVI_POST_PUBLICATION: "Commercial", CHARGE_COMMUNICATION: "Commercial",
  JURID: "Juridique & Finance", RESP_JURIDIQUE: "Juridique & Finance", CONTRACTUALISATION: "Juridique & Finance", FIN: "Juridique & Finance", COMPTABLE: "Juridique & Finance", RESP_FINANCE: "Juridique & Finance", VERIF_ADMIN: "Juridique & Finance",
  RH: "Administration", RESP_RH: "Administration", ADMIN_GENERAL: "Administration",
  DG: "Pilotage", DIR_GENERAL: "Pilotage", CHEF_DEPARTEMENT: "Pilotage",
};

export function poleForRoles(roleCodes: string[]): string | null {
  for (const c of roleCodes) {
    const p = ROLE_CODE_TO_POLE[c];
    if (p) return p;
  }
  return null;
}

// Pôle d'appartenance d'un utilisateur : département de la fiche employé si
// présent, sinon déduit de ses rôles, sinon repli « Administration ».
export function poleForUser(departmentCode: string | null | undefined, roleCodes: string[]): string {
  return poleForDepartmentCode(departmentCode) ?? poleForRoles(roleCodes) ?? FALLBACK_POLE;
}

// Référence au registre de présence en mémoire, exposée pour la seule route
// REST de révélation des noms (réservée aux profils habilités). Le canal
// temps réel, lui, ne diffuse jamais d'identités (voir broadcast ci-dessous).
let liveStates: Map<string, SocketState> | null = null;

// Une personne a-t-elle un onglet ERP AU PREMIER PLAN en ce moment ? Sert à
// décider s'il faut pousser une notification (push) : inutile si elle est déjà
// active devant l'écran (la livraison temps réel suffit), utile si elle est en
// arrière-plan ou hors ligne.
export function isUserActive(userId: string): boolean {
  if (!liveStates) return false;
  for (const s of liveStates.values()) {
    if (s.userId === userId && s.activity === "active") return true;
  }
  return false;
}

export interface PolePresenceUser {
  name: string;
  // « active » si au moins un onglet de la personne est au premier plan ;
  // « away » si elle est connectée mais tous ses onglets sont en arrière-plan.
  activity: PresenceActivity;
}

export interface PolePresence {
  pole: string;
  users: PolePresenceUser[];
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
  // Par pôle → par personne : nom + activité agrégée (active si un onglet est
  // au premier plan, sinon away).
  const byPole = new Map<string, Map<string, PolePresenceUser>>();
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
      const existing = users.get(s.userId);
      // Une personne est « active » dès qu'UN de ses onglets l'est.
      const activity: PresenceActivity = existing?.activity === "active" || s.activity === "active" ? "active" : "away";
      users.set(s.userId, { name: s.username, activity });
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
      users: [...users.values()].sort((a, b) => a.name.localeCompare(b.name, "fr")),
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
  // Enregistre le serveur pour l'émission temps réel ciblée (lib/realtime.ts).
  setRealtimeServer(io);

  // Authentification de la socket par le cookie de session existant (RBAC
  // inchangé : on réutilise verifySessionToken).
  io.use(async (socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const userId = verifySessionToken(cookies[SESSION_COOKIE]);
    if (!userId) return next(new Error("unauthorized"));
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { employee: { include: { department: true } }, userRoles: { where: { revokedAt: null }, include: { role: true } } },
    });
    if (!user) return next(new Error("unauthorized"));
    socket.data.userId = user.id;
    socket.data.username = user.username;
    // Pôle d'appartenance : département de la fiche employé si présent, sinon
    // déduit des rôles (le voyant du pôle s'allume dès qu'un membre est en
    // ligne), sinon repli « Administration ».
    const roleCodes = user.userRoles.map((ur) => ur.role.code);
    socket.data.pole = poleForUser(user.employee?.department?.code ?? null, roleCodes);
    next();
  });

  // Confidentialité (exigence de sécurité du 09/07/2026) : le canal temps réel
  // ne diffuse QUE des compteurs — jamais l'identité des personnes connectées.
  // Chacun voit « où » et « combien » (pôle actif + nombre), mais les noms ne
  // transitent pas par la diffusion générale. Ils ne sont révélés que sur
  // demande, à un profil habilité (Direction générale, super-administrateur, ou
  // responsable pour son propre pôle), via une route REST vérifiée côté serveur.
  // Diffusion regroupée (anti-rebond) + dédoublonnée.
  //
  // Sans cela, CHAQUE événement de présence (connexion, navigation d'écran =
  // presence:join, départ, déconnexion) de N'IMPORTE quel poste déclenchait un
  // io.emit vers TOUS les postes, et chaque poste re-rendait toute sa page.
  // Sur une maison active, cette tempête de recalculs ralentissait les machines
  // (constaté par l'infographe). On coalesce donc les rafales dans une seule
  // diffusion (~800 ms) et on n'émet que si les compteurs ont réellement changé.
  const COALESCE_MS = 800;
  let pending: NodeJS.Timeout | null = null;
  let lastSignature = "";

  function computeCounts() {
    const connectedUserIds = new Set<string>();
    const byPole: Record<string, Set<string>> = {};
    const byModule: Record<string, Set<string>> = {};
    // Pôle « actif » (vert) dès qu'un de ses membres a un onglet au premier
    // plan ; sinon « away » (orange) : connecté mais tout en arrière-plan.
    const poleActive: Record<string, boolean> = {};

    for (const s of states.values()) {
      connectedUserIds.add(s.userId);
      // On dénombre des personnes distinctes (par userId), pas des onglets : un
      // même utilisateur ouvert deux fois ne compte qu'une fois.
      // Effectif par grand pôle = appartenance (fiche employé), pour rester
      // cohérent avec les noms révélés dans le Hall (même regroupement). Le
      // voyant par module, lui, reflète l'activité en cours (navigation).
      if (s.pole) {
        (byPole[s.pole] ??= new Set()).add(s.userId);
        poleActive[s.pole] = poleActive[s.pole] || s.activity === "active";
      }
      if (s.moduleId) (byModule[s.moduleId] ??= new Set()).add(s.userId);
    }

    const toCounts = (map: Record<string, Set<string>>) =>
      Object.fromEntries(
        Object.entries(map)
          .map(([k, set]) => [k, set.size] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      );

    const poleStatus = Object.fromEntries(
      Object.entries(poleActive)
        .map(([k, active]) => [k, active ? "active" : "away"] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

    return {
      total: connectedUserIds.size,
      byPole: toCounts(byPole),
      byModule: toCounts(byModule),
      poleStatus,
    };
  }

  function emitNow() {
    pending = null;
    const payload = computeCounts();
    const signature = JSON.stringify(payload);
    // Rien n'a bougé depuis la dernière diffusion : on ne réveille pas les postes.
    if (signature === lastSignature) return;
    lastSignature = signature;
    io.emit("presence:update", payload);
  }

  // Programme une diffusion coalescée. Les rafales (plusieurs navigations en
  // même temps) sont fusionnées en un seul envoi.
  function broadcast() {
    if (pending) return;
    pending = setTimeout(emitNow, COALESCE_MS);
  }

  io.on("connection", (socket: Socket) => {
    states.set(socket.id, {
      userId: socket.data.userId,
      username: socket.data.username,
      poleId: null,
      moduleId: null,
      pole: socket.data.pole ?? null,
      activity: "active",
    });
    // Salle par utilisateur : permet de pousser une notification ciblée (ex.
    // nouvelle annonce du Babillard) au seul destinataire concerné.
    socket.join(userRoom(socket.data.userId));
    // Le nouvel arrivant reçoit l'état courant tout de suite (envoi ciblé),
    // sans réveiller les autres postes ; la diffusion générale, elle, reste
    // coalescée et n'émet que si les compteurs changent.
    socket.emit("presence:update", computeCounts());
    broadcast();

    socket.on("presence:join", (payload: JoinPayload) => {
      const state = states.get(socket.id);
      if (!state) return;
      state.poleId = payload?.poleId ?? null;
      state.moduleId = payload?.moduleId ?? null;
      broadcast();
    });

    // Activité de l'onglet (premier plan / arrière-plan), signalée par le
    // navigateur (Page Visibility + focus). Met à jour le voyant en temps réel.
    socket.on("presence:state", (payload: { active?: boolean }) => {
      const state = states.get(socket.id);
      if (!state) return;
      const next: PresenceActivity = payload?.active ? "active" : "away";
      if (state.activity === next) return;
      state.activity = next;
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
