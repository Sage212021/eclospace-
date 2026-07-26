import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage } from "../api/client";

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

// Réception temps réel des messages de la messagerie interne : la socket
// authentifiée par le cookie rejoint la salle `user:<id>` côté serveur, qui reçoit
// l'événement `chat:message`. Le gestionnaire est gardé dans une ref pour ne pas
// reconnecter la socket à chaque rendu.
export function useChatSocket(onMessage: (m: ChatMessage) => void, enabled = true) {
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!enabled) return;
    const socket: Socket = io(API_BASE || undefined, { withCredentials: true });
    socket.on("chat:message", (m: ChatMessage) => handler.current?.(m));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
