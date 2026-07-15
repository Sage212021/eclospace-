import type { Server as SocketIOServer } from "socket.io";

// Point d'émission temps réel partagé : le serveur Socket.IO est créé par
// `attachPresence()` (lib/presence.ts) puis enregistré ici, afin que les routes
// métier (ex. publication d'une annonce) puissent pousser un événement vers des
// utilisateurs précis SANS créer de cycle d'import avec la présence.
//
// Chaque socket authentifiée rejoint la salle `user:<id>` (voir presence.ts) :
// on cible donc un utilisateur par sa salle. Seuls les utilisateurs connectés
// reçoivent l'événement ; la notification persistée (cloche) reste la source de
// vérité pour ceux qui sont hors ligne.
let ioRef: SocketIOServer | null = null;

export function setRealtimeServer(io: SocketIOServer): void {
  ioRef = io;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function emitToUsers(userIds: string[], event: string, payload: unknown): void {
  if (!ioRef || userIds.length === 0) return;
  const rooms = [...new Set(userIds)].map(userRoom);
  ioRef.to(rooms).emit(event, payload);
}
