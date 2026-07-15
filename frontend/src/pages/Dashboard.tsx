import { useEffect, useState } from "react";
import { getDashboardStats, getTodayBirthdays, getUpcomingEvents, type CalendarEvent, type DashboardStats, type EffectiveUser } from "../api/client";
import { useI18n } from "../i18n";
import { AnnouncementBanner } from "../components/AnnouncementBanner";

interface DashboardProps {
  user: EffectiveUser;
  onOpenAnnouncement?: (id: string) => void;
  onOpenCalendar?: () => void;
}

// Grands indicateurs affichés en tête du tableau de bord. Chacun n'apparaît que
// si le serveur en renvoie la valeur (permission de consultation accordée).
const KPI_CARDS: { key: keyof DashboardStats; label: string; icon: string }[] = [
  { key: "ouvrages", label: "Ouvrages", icon: "📚" },
  { key: "utilisateurs", label: "Utilisateurs", icon: "👥" },
  { key: "ventes", label: "Ventes", icon: "💰" },
  { key: "stock", label: "Stock", icon: "📦" },
];

// Page d'accueil : grands indicateurs de synthèse + rappel de la session.
// L'audit RBAC détaillé (badges de permissions) a été déplacé dans l'écran
// « Diagnostics système » (Administration), réservé à l'administrateur général.
export function Dashboard({ user, onOpenAnnouncement, onOpenCalendar }: DashboardProps) {
  const { t, lang } = useI18n();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [birthdays, setBirthdays] = useState<{ id: string; name: string }[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const canSeeAnnouncements = user.permissions.includes("communication:consultation");

  useEffect(() => {
    getDashboardStats().then(setStats).catch(() => setStats(null));
    if (canSeeAnnouncements) {
      getTodayBirthdays().then(setBirthdays).catch(() => setBirthdays([]));
      getUpcomingEvents(7).then(setUpcoming).catch(() => setUpcoming([]));
    }
  }, [canSeeAnnouncements]);

  const visibleKpis = stats ? KPI_CARDS.filter((c) => stats[c.key] !== null) : [];

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)", maxWidth: 900 }}>
      {canSeeAnnouncements && onOpenAnnouncement && <AnnouncementBanner onOpen={onOpenAnnouncement} />}
      {/* Anniversaires du jour : n'apparaît QUE le jour même, jamais à l'avance. */}
      {birthdays.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 13.5, color: "var(--ink)" }}>
          <span style={{ fontSize: 20 }}>🎂</span>
          <span>
            <strong>{t("cal.birthday_today", "Anniversaire aujourd'hui")} : </strong>
            {birthdays.map((b) => b.name).join(", ")} — {t("cal.birthday_wish", "pensez à leur souhaiter !")}
          </span>
        </div>
      )}
      {/* Événements à venir (7 jours) qui me concernent. */}
      {upcoming.length > 0 && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            {t("cal.upcoming", "Événements à venir")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {upcoming.map((e) => (
              <button
                key={e.id}
                onClick={() => onOpenCalendar?.()}
                style={{ display: "flex", alignItems: "baseline", gap: 10, background: "transparent", border: "none", textAlign: "left", cursor: onOpenCalendar ? "pointer" : "default", padding: "2px 0", width: "100%" }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", flexShrink: 0, minWidth: 118 }}>
                  {new Date(e.starts_at).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "2-digit", month: "short" })}
                  {!e.all_day && ` · ${new Date(e.starts_at).toLocaleTimeString(lang === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
                </span>
                <span style={{ fontSize: 13.5, color: "var(--ink)" }}>{e.title}{e.location ? <span style={{ color: "var(--muted)" }}> · {e.location}</span> : null}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 22, marginBottom: 4 }}>{t("dash.welcome", "Bienvenue")}, {user.username}</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>{t("dash.subtitle", "Vue d'ensemble de votre maison d'édition.")}</p>

      {visibleKpis.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 14,
            marginTop: 16,
          }}
        >
          {visibleKpis.map((c) => (
            <KpiCard key={c.key} icon={c.icon} label={t(`dash.kpi.${c.key}`, c.label)} value={stats![c.key] as number} />
          ))}
        </div>
      )}

      <h2 style={{ fontFamily: "var(--font-title)", fontSize: 15, margin: "24px 0 0" }}>{t("dash.session", "Ma session")}</h2>
      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, marginTop: 10, maxWidth: 640 }}>
        <Row label={t("dash.username", "Identifiant")} value={user.username} mono />
        <Row label={t("dash.role", "Rôle")} value={user.roles.length > 0 ? user.roles.map((r) => t(`role.${r}`, roleLabel(r))).join(", ") : t("dash.no_role", "Aucun rôle attribué")} />
        <Row
          label={t("dash.status", "Statut")}
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--eclosion)", display: "inline-block" }} />
              {t("dash.online", "Connecté")}
            </span>
          }
        />
      </div>
    </div>
  );
}

// Carte d'indicateur : icône dorée, grand chiffre (chasse fixe), libellé.
function KpiCard({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(30, 36, 48, 0.06)",
        padding: 18,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 46,
          height: 46,
          borderRadius: 12,
          background: "var(--eclosion-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color: "var(--ink)", lineHeight: 1.1 }}>
          {value.toLocaleString("fr-FR")}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

// Libellés lisibles des rôles techniques les plus courants (l'écran
// Diagnostics affiche, lui, les codes exacts). Repli sur le code si inconnu.
const ROLE_LABELS: Record<string, string> = {
  ADMIN_GENERAL: "Administrateur général",
  DIR_GENERAL: "Directeur général",
  DIR_EDITORIALE: "Direction éditoriale",
  RESP_FINANCE: "Responsable administratif et financier",
  RESP_RH: "Responsable RH",
  RESP_COMMERCIAL: "Responsable commercial",
  RESP_IMPRESSION: "Responsable production/impression",
  RESP_INFOGRAPHIE: "Responsable infographie",
  MAGASINIER: "Magasinier",
  CORRECTEUR: "Correcteur",
  MEMBRE_COMITE_LECTURE: "Membre du comité de lecture",
  ASSISTANT_EDITORIAL: "Assistant éditorial",
};

function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
      <div style={{ width: 140, color: "var(--muted)", fontSize: 13 }}>{label}</div>
      <div style={{ fontFamily: mono ? "var(--font-mono)" : undefined }}>{value}</div>
    </div>
  );
}
