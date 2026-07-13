import { useEffect, useState } from "react";
import { getAttendanceSummary, type AttendanceSummary } from "../api/client";
import { Card } from "./Card";
import { IconAdmin } from "./icons";
import { useI18n } from "../i18n";

// Restitution du calcul de présence (incrément 2) : synthèse du mois courant
// pour l'utilisateur connecté. Les tableaux de bord complets (par service,
// par employé, graphiques) arrivent à l'incrément 5.

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "over" }) {
  const color = tone === "warn" ? "var(--retard, #C4661F)" : tone === "over" ? "var(--eclosion, #C89A1B)" : "var(--ink)";
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

export function PresenceSummaryCard() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAttendanceSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : "Chargement impossible."));
  }, []);

  return (
    <Card
      title={t("att.my_time", "Mon temps de travail (ce mois)")}
      icon={<IconAdmin />}
      subtitle={t("att.my_time_sub", "Calcul indicatif issu de vos connexions/déconnexions — à valider par la hiérarchie avant la paie.")}
    >
      {error && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{error}</p>}
      {!error && !summary && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("att.loading", "Chargement…")}</p>}
      {summary?.no_employee && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          {t("att.no_employee_note", "Votre compte n'est rattaché à aucune fiche employé : cette synthèse concerne les collaborateurs suivis en présence.")}
        </p>
      )}
      {summary && !summary.no_employee && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 22 }}>
          <Stat label={t("att.worked", "Temps travaillé")} value={fmt(summary.totals.worked_minutes)} />
          <Stat label={t("att.days_worked", "Jours travaillés")} value={String(summary.totals.days_worked)} />
          <Stat label={t("att.late_cumul", "Retards cumulés")} value={fmt(summary.totals.late_minutes)} tone={summary.totals.late_minutes > 0 ? "warn" : undefined} />
          <Stat label={t("att.early_leave", "Départs anticipés")} value={fmt(summary.totals.early_leave_minutes)} tone={summary.totals.early_leave_minutes > 0 ? "warn" : undefined} />
          <Stat label={t("att.overtime", "Heures supp.")} value={fmt(summary.totals.overtime_minutes)} tone={summary.totals.overtime_minutes > 0 ? "over" : undefined} />
          <Stat label={t("att.absent_unjustified", "Absences injustifiées")} value={String(summary.totals.days_absent_unjustified) + t("att.day_unit", " j")} tone={summary.totals.days_absent_unjustified > 0 ? "warn" : undefined} />
        </div>
      )}
    </Card>
  );
}
