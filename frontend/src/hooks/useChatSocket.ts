import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage } from "../api/client";

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

// Réception temps réel des messages de la messagerie interne : la socket
// authentifiée par le cookie rejoint la salle `user:<id>` côté serveur, qui reçoit
// l'événement `chat:message`. Le gestionnaire est gardé dans une ref pour ne pas
// reconnecter la socket à chaque rendu.
export interface ChatReadEvent {
  conversationId: string;
  readerId: string;
  readAt: string;
}

export function useChatSocket(
  onMessage: (m: ChatMessage) => void,
  onRead?: (e: ChatReadEvent) => void,
  enabled = true,
  onUpdate?: (m: ChatMessage) => void,
) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const readHandler = useRef(onRead);
  readHandler.current = onRead;
  const updateHandler = useRef(onUpdate);
  updateHandler.current = onUpdate;

  useEffect(() => {
    if (!enabled) return;
    // Reconnexion espacée (jusqu'à 20 s entre tentatives) pour ne pas solliciter
    // la machine en boucle serrée quand le serveur est momentanément indisponible
    // (ex. pendant un redéploiement).
    const socket: Socket = io(API_BASE || undefined, { withCredentials: true, reconnectionDelayMax: 20000, timeout: 20000 });
    socket.on("chat:message", (m: ChatMessage) => handler.current?.(m));
    socket.on("chat:read", (e: ChatReadEvent) => readHandler.current?.(e));
    // Message modifié / supprimé à distance : mise à jour en place du fil.
    socket.on("chat:message:update", (m: ChatMessage) => updateHandler.current?.(m));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
