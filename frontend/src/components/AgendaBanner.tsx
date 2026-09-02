import { useEffect, useMemo, useState } from "react";
import { getAgendaBanner, type AgendaBannerEvent, type HallAgendaConfig } from "../api/client";

// Bandeau « 📅 Programme à venir » (rappel discret, D-029) : capsules qui
// défilent une par une sous la barre du haut. L'information vient à l'employé —
// aucun clic requis pour la lire (le clic ouvre le détail). Le passé est déjà
// retiré côté serveur ; les urgents (≤ seuil) sont mis en tête et le bandeau
// reste alors affiché. Sinon, il défile une fois puis se masque et revient
// après le délai configuré. Rien à venir → rien ne s'affiche.

const ICONS: Record<string, string> = {
  reunion: "📋",
  echeance: "⏰",
  formation: "🎓",
  sortie: "🚌",
  ceremonie: "🎉",
  autre: "📌",
  anniversaire: "🎂",
  dedicace: "✍️",
  salon: "🎪",
  lancement: "🎊",
};

// Couleurs charte « Noir souverain » : rouge = urgent, ambre = ce mois, or =
// à venir, or pour aujourd'hui (marque). Jamais de bleu.
const PRIORITY_STYLE: Record<AgendaBannerEvent["priority"], { border: string; label: string }> = {
  urgent: { border: "#B23A2E", label: "#B23A2E" },
  today: { border: "#D9B21A", label: "#9A7A12" },
  month: { border: "#B87400", label: "#B87400" },
  later: { border: "#D9B21A", label: "var(--muted)" },
};

function whenLabel(e: AgendaBannerEvent): string {
  const d = new Date(e.starts_at);
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  if (e.priority === "urgent" && e.minutes_until !== null) {
    return e.minutes_until <= 0 ? "maintenant" : `dans ${e.minutes_until} min`;
  }
  if (e.all_day) return date;
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

function capsuleText(e: AgendaBannerEvent): string {
  if (e.birthday && e.person) return `Anniversaire — ${e.person}`;
  return e.title;
}

export function AgendaBanner({ enabled, onOpenCalendar }: { enabled: boolean; onOpenCalendar?: () => void }) {
  const [data, setData] = useState<{ config: HallAgendaConfig; events: AgendaBannerEvent[] } | null>(null);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const [cycleKey, setCycleKey] = useState(0);

  // Rafraîchissement périodique : retire le passé, capte les nouveaux et
  // l'imminence (le délai « dans X min » est un instantané côté serveur).
  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let alive = true;
    const load = () =>
      getAgendaBanner()
        .then((d) => {
          if (alive) setData(d);
        })
        .catch(() => {
          /* silencieux : le bandeau reste masqué si l'appel échoue */
        });
    load();
    const t = window.setInterval(load, 180_000); // 3 min
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [enabled]);

  const cfg = data?.config ?? null;
  const events = useMemo(() => data?.events ?? [], [data]);
  const eventsSig = events.map((e) => `${e.id}:${e.priority}`).join("|");
  const hasUrgent = events.some((e) => e.priority === "urgent");

  // Cycle « rappel discret » : défile une fois puis se masque, revient après le
  // délai configuré. En présence d'un urgent, reste affiché et reboucle.
  useEffect(() => {
    if (!cfg || events.length === 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
    setIdx(0);
    let i = 0;
    const capsuleMs = Math.max(2, cfg.capsuleSeconds) * 1000;
    let hideTimer: number | undefined;
    const rot = window.setInterval(() => {
      i += 1;
      if (i < events.length) {
        setIdx(i);
        return;
      }
      if (hasUrgent) {
        i = 0;
        setIdx(0);
        return; // reste visible, reboucle
      }
      window.clearInterval(rot);
      setVisible(false);
      hideTimer = window.setTimeout(() => setCycleKey((k) => k + 1), Math.max(1, cfg.reappearMinutes) * 60_000);
    }, capsuleMs);
    return () => {
      window.clearInterval(rot);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.capsuleSeconds, cfg?.reappearMinutes, eventsSig, hasUrgent, cycleKey]);

  if (!enabled || !visible || events.length === 0) return null;
  const e = events[Math.min(idx, events.length - 1)];
  const style = PRIORITY_STYLE[e.priority];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "7px 14px",
        background: "var(--paper, #FAF8F2)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--muted)", whiteSpace: "nowrap", textTransform: "uppercase" }}>
        📅 À venir
      </span>
      <button
        type="button"
        onClick={onOpenCalendar}
        title="Ouvrir l'agenda"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          padding: "5px 12px",
          borderRadius: 999,
          border: `1px solid ${style.border}`,
          background: "var(--bg, #fff)",
          cursor: onOpenCalendar ? "pointer" : "default",
          fontSize: 13,
          color: "var(--ink)",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          transition: "opacity .3s",
        }}
      >
        <span style={{ flexShrink: 0 }}>{e.priority === "urgent" ? "🔔" : ICONS[e.type] ?? "📌"}</span>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{capsuleText(e)}</span>
        <span style={{ color: style.label, fontWeight: 700, flexShrink: 0 }}>— {whenLabel(e)}</span>
        {e.location && e.priority === "urgent" && <span style={{ color: "var(--muted)", flexShrink: 0 }}>· {e.location}</span>}
      </button>
      {events.length > 1 && (
        <span style={{ display: "inline-flex", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
          {events.slice(0, 8).map((ev, i) => (
            <span
              key={ev.id}
              style={{ width: 6, height: 6, borderRadius: 999, background: i === Math.min(idx, events.length - 1) ? "var(--ink)" : "var(--line)", display: "inline-block" }}
            />
          ))}
        </span>
      )}
    </div>
  );
}
