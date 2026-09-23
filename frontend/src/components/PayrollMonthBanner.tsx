import { frMonth, calendarPeriod } from "../lib/payrollPeriod";

// Bandeau d'avertissement : rappelle en clair quand on traite un mois de paie
// DIFFÉRENT du mois calendaire (ex. finalisation d'août début septembre), pour
// qu'aucune saisie ne soit imputée par erreur au mauvais mois. Charte or/ambre.
export function PayrollMonthBanner({ period }: { period: string }) {
  const calendar = calendarPeriod();
  if (!period || period === calendar) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        background: "var(--amber-soft, #F6E7D2)", color: "#8A5A00",
        border: "1px solid #D9B21A", borderRadius: 8, padding: "8px 12px",
        fontSize: 13, fontWeight: 600, margin: "0 0 10px",
      }}
    >
      <span aria-hidden style={{ fontSize: 15 }}>⚠️</span>
      Vous traitez la paie de <strong>{frMonth(period)}</strong> — le mois en cours est {frMonth(calendar)}. Toute saisie sera imputée à {frMonth(period)}.
    </div>
  );
}
