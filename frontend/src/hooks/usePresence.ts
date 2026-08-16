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

export function usePresence(enabled: boolean, onAnnouncement?: (a: AnnouncementPush) => void, onNotification?: (n: AnnouncementPush) => void) {
  const [presence, setPresence] = useState<PresenceState>(EMPTY);
  const socketRef = useRef<Socket | null>(null);
  // Signature de la dernière présence appliquée : on ne re-rend l'application
  // que si les compteurs ont réellement changé. Le serveur coalesce déjà les
  // diffusions ; cette garde évite en plus tout rendu inutile côté poste.
  const lastPresenceSig = useRef("");
  // Les gestionnaires sont stockés dans des refs pour rester à jour sans
  // reconnecter la socket à chaque rendu.
  const annHandler = useRef(onAnnouncement);
  annHandler.current = onAnnouncement;
  const notifHandler = useRef(onNotification);
  notifHandler.current = onNotification;

  useEffect(() => {
    if (!enabled) {
      lastPresenceSig.current = "";
      setPresence(EMPTY);
      return;
    }
    // Reconnexion espacée (jusqu'à 20 s) pour éviter une boucle serrée de
    // reconnexion qui charge la machine quand le serveur est indisponible.
    const socket = io(API_BASE || undefined, { withCredentials: true, reconnectionDelayMax: 20000, timeout: 20000 });
    socketRef.current = socket;
    socket.on("presence:update", (p: PresenceState) => {
      const sig = JSON.stringify(p);
      if (sig === lastPresenceSig.current) return; // aucun changement : pas de rendu
      lastPresenceSig.current = sig;
      setPresence(p);
    });
    socket.on("announcement:new", (a: AnnouncementPush) => annHandler.current?.(a));
    // Alerte temps réel générale (info renvoyée par un autre pôle) : son + pop-up.
    socket.on("notification:new", (n: AnnouncementPush) => notifHandler.current?.(n));
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
    lastPresenceSig.current = "";
    setPresence(EMPTY);
  }, []);

  return { presence, join, disconnect };
}
