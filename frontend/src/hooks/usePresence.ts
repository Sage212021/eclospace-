import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

// Même résolution d'URL que l'API : même origine en production, backend :3000
// en développement (Vite :5173).
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

export interface PresenceState {
  connectedUsers: { userId: string; username: string }[];
  byPole: Record<string, string[]>;
  byModule: Record<string, string[]>;
}

const EMPTY: PresenceState = { connectedUsers: [], byPole: {}, byModule: {} };

// Présence temps réel via Socket.IO (Ch. 5). Connecte une socket authentifiée
// par le cookie de session, écoute l'état de présence diffusé, et expose une
// fonction `join` pour signaler le pôle/module courant.
export function usePresence(enabled: boolean) {
  const [presence, setPresence] = useState<PresenceState>(EMPTY);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPresence(EMPTY);
      return;
    }
    const socket = io(API_BASE || undefined, { withCredentials: true });
    socketRef.current = socket;
    socket.on("presence:update", (p: PresenceState) => setPresence(p));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  const join = useCallback((poleId: string | null, moduleId: string | null) => {
    socketRef.current?.emit("presence:join", { poleId, moduleId });
  }, []);

  return { presence, join };
}
