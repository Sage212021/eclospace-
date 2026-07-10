import { useEffect, useRef, useState } from "react";

interface Toast {
  id: number;
  kind: "join" | "leave";
  text: string;
}

// Notifications discrètes de présence (point 10 de la refonte des accès).
// Elles signalent qu'une personne s'est connectée ou déconnectée, SANS jamais
// la nommer : le canal temps réel ne transporte que des compteurs
// (confidentialité, cf. lib/presence.ts). Le déclencheur est la variation du
// nombre total en ligne — qui ne bouge qu'à une vraie connexion/déconnexion,
// pas lors d'un simple changement de vue. Chaque message s'efface seul.
export function PresenceToasts({ total }: { total: number }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Dernière valeur STABILISÉE du nombre en ligne. La connexion d'une personne
  // provoque souvent plusieurs transitions rapprochées (transport Socket.IO en
  // long-polling puis bascule WebSocket, reconnexions) : on ne compare donc pas
  // chaque valeur brute, on attend que le total se stabilise avant d'annoncer un
  // changement net. Un aller-retour transitoire ne déclenche ainsi aucun message.
  const settledTotal = useRef<number | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const settle = setTimeout(() => {
      const prev = settledTotal.current;
      settledTotal.current = total;
      // Premier état reçu = référence : on n'annonce rien au chargement.
      if (prev === null || total === prev) return;

      const kind: Toast["kind"] = total > prev ? "join" : "leave";
      const text = kind === "join" ? "Une personne s'est connectée." : "Une personne s'est déconnectée.";
      const id = nextId.current++;
      setToasts((list) => [...list, { id, kind, text }]);
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
    }, 700);
    return () => clearTimeout(settle);
  }, [total]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--chrome)",
            color: "#fff",
            borderRadius: 999,
            padding: "8px 14px",
            fontSize: 12.5,
            boxShadow: "0 8px 24px rgba(9, 16, 33, 0.28)",
            opacity: 0.96,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              flexShrink: 0,
              background: t.kind === "join" ? "var(--success)" : "var(--muted)",
              display: "inline-block",
            }}
          />
          {t.text}
        </div>
      ))}
    </div>
  );
}
