import { useEffect, useState } from "react";
import { getActivityClosure, remindActivityClosure, type ActivityClosureStatus } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { IconAdmin } from "./icons";
import { useI18n } from "../i18n";

// RH → Signalement de clôture d'activité mensuelle. L'activité d'un mois se
// clôture le DERNIER JOUR OUVRABLE du mois (calculé : horaire de la maison +
// jours fériés). Des rappels automatiques sont envoyés les deux jours
// précédents ; la hiérarchie peut déclencher un rappel manuel.
export function ActivityClosureSection({ canAdminister }: { canAdminister: boolean }) {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const [status, setStatus] = useState<ActivityClosureStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const s = await getActivityClosure();
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function sendNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await remindActivityClosure();
      setMessage(
        lang === "en"
          ? `Reminder sent to ${r.recipients} recipient(s).`
          : `Rappel envoyé à ${r.recipients} destinataire(s).`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <Card title={t("clo.title", "Clôture d'activité mensuelle")} icon={<IconAdmin />}>
        {error ? (
          <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("clo.loading", "Chargement…")}</p>
        )}
      </Card>
    );
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const days = status.days_until_closure;
  // Ton de l'encart selon l'urgence : clôturé = succès, échéance proche = alerte.
  const tone = status.is_closed ? "ok" : days <= 2 ? "urgent" : days <= 5 ? "soon" : "normal";
  const toneColor = tone === "ok" ? "var(--success)" : tone === "urgent" ? "var(--alert)" : tone === "soon" ? "#C4661F" : "var(--eclosion)";
  const toneSoft = tone === "ok" ? "var(--success-soft, #e6f4ea)" : tone === "urgent" ? "var(--alert-soft)" : "var(--eclosion-soft)";

  return (
    <Card
      title={t("clo.title", "Clôture d'activité mensuelle")}
      icon={<IconAdmin />}
      subtitle={t("clo.subtitle", "L'activité de chaque mois est arrêtée le dernier jour ouvrable du mois.")}
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={banner("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {/* Encart d'échéance */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", background: toneSoft, borderRadius: 12, padding: "14px 16px", marginTop: 8 }}>
        <div style={{ textAlign: "center", minWidth: 82 }}>
          {status.is_closed ? (
            <div style={{ fontSize: 22, fontWeight: 700, color: toneColor }}>✓</div>
          ) : (
            <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "var(--font-mono)", color: toneColor, lineHeight: 1 }}>{Math.max(0, days)}</div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>
            {status.is_closed ? t("clo.done", "Clôturée") : days <= 0 ? t("clo.today", "aujourd'hui") : t("clo.days_left", "jour(s) restant(s)")}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, color: "var(--ink)" }}>
            {status.is_closed
              ? t("clo.period_closed", "Paie de {p} clôturée.").replace("{p}", status.period_label)
              : t("clo.next", "Prochaine clôture : {d}").replace("{d}", fmtDate(status.closure_date))}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>
            {t("clo.period", "Période concernée :")} <strong>{status.period_label}</strong>
          </div>
        </div>
      </div>

      {/* Règle en vigueur */}
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 14 }}>
        {t("clo.rule", "L'activité se clôture le dernier jour ouvrable du mois. Rappels automatiques aux responsables (RH, Finance, Direction) le {r} — pour finaliser la paie : présences, absences et variables.")
          .replace("{r}", status.reminder_days.join(t("clo.and", " et ")))}
      </p>

      {/* Rappels déjà envoyés */}
      {status.reminders_sent.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)" }}>
          {t("clo.sent", "Rappels envoyés :")}{" "}
          {status.reminders_sent
            .map((r) => `${r.manual ? t("clo.manual", "manuel") : `${t("clo.dayof", "le")} ${r.reminder_day}`} (${new Date(r.sent_at).toLocaleDateString(locale, { day: "2-digit", month: "short" })})`)
            .join(" · ")}
        </div>
      )}

      {/* Administration (hiérarchie) : rappel manuel, hors fenêtre automatique. */}
      {canAdminister && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 14 }}>
          <Button variant="view" size="sm" onClick={sendNow} disabled={busy || status.is_closed}>
            {t("clo.remind_now", "Envoyer le rappel maintenant")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
