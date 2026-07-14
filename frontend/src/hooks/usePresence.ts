import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

// Même résolution d'URL que l'API : même origine en production, backend :3000
// en développement (Vite :5173).
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

// Présence diffusée en temps réel : uniquement des compteurs (confidentialité).
// Aucune identité ne transite par ce canal — les noms sont obtenus séparément,
// sur demande, par un profil habilité (voir la fenêtre « Hall / Présence »).
export interface PresenceState {
  total: number;
  byPole: Record<string, number>;
  byModule: Record<string, number>;
}

const EMPTY: PresenceState = { total: 0, byPole: {}, byModule: {} };

// Présence temps réel via Socket.IO (Ch. 5). Connecte une socket authentifiée
// par le cookie de session, écoute l'état de présence diffusé, et expose une
// fonction `join` pour signaler le pôle/module courant.
// Charge utile d'une nouvelle annonce poussée en temps réel (Babillard).
export interface AnnouncementPush {
  id: string;
  title: string;
  preview: string;
  priority: "normale" | "importante" | "urgente" | "critique";
  category: string | null;
  require_ack: boolean;
}

export function usePresence(enabled: boolean, onAnnouncement?: (a: AnnouncementPush) => void) {
  const [presence, setPresence] = useState<PresenceState>(EMPTY);
  const socketRef = useRef<Socket | null>(null);
  // Le gestionnaire d'annonce est stocké dans une ref pour rester à jour sans
  // reconnecter la socket à chaque rendu.
  const annHandler = useRef(onAnnouncement);
  annHandler.current = onAnnouncement;

  useEffect(() => {
    if (!enabled) {
      setPresence(EMPTY);
      return;
    }
    const socket = io(API_BASE || undefined, { withCredentials: true });
    socketRef.current = socket;
    socket.on("presence:update", (p: PresenceState) => setPresence(p));
    socket.on("announcement:new", (a: AnnouncementPush) => annHandler.current?.(a));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  const join = useCallback((poleId: string | null, moduleId: string | null) => {
    socketRef.current?.emit("presence:join", { poleId, moduleId });
  }, []);

  // Fermeture explicite de la socket (à la déconnexion), pour éviter tout
  // voyant « connecté » fantôme jusqu'au nettoyage du hook.
  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setPresence(EMPTY);
  }, []);

  return { presence, join, disconnect };
}
