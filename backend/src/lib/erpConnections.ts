// Relevé des connexions ERP (spec opérateur 12/08/2026) — agrégation PURE et
// testable des évènements de connexion/déconnexion tracés au journal d'audit.
//
// PRINCIPE ABSOLU : ces données sont INDICATIVES. Les connexions/déconnexions à
// l'ERP ne sont PAS un système de pointage. Elles ne génèrent jamais d'absence,
// de retard ni de retenue sur salaire (aucun impact automatique sur la paie).
// Références officielles de présence = pointeur physique + registre manuel signé.
// Ce relevé sert uniquement de trace technique et d'outil d'arbitrage RH.

// Le Cameroun (WAT) est à UTC+1 toute l'année (pas d'heure d'été) : on décale
// les horodatages UTC de +1 h pour obtenir la date et l'heure LOCALES, sans
// dépendre du fuseau du serveur ni des données ICU.
const CAMEROON_OFFSET_MS = 60 * 60 * 1000;

export interface ConnectionEvent {
  occurredAt: Date;
  kind: "login" | "logout";
}

export interface DayConnections {
  date: string; // AAAA-MM-JJ (local Cameroun)
  weekday: number; // 0 = dimanche … 6 = samedi
  has_connection: boolean;
  first_login: string | null; // HH:MM (local) — 1re connexion du jour
  last_logout: string | null; // HH:MM (local) — dernière déconnexion du jour
  nb_logins: number;
  nb_logouts: number;
}

export interface ConnectionRecord {
  month: string; // AAAA-MM
  days: DayConnections[];
  recap: {
    days_in_month: number;
    days_with_connection: number;
    total_logins: number;
    total_logouts: number;
  };
}

function localParts(d: Date): { date: string; weekday: number; hhmm: string } {
  const l = new Date(d.getTime() + CAMEROON_OFFSET_MS);
  const y = l.getUTCFullYear();
  const m = String(l.getUTCMonth() + 1).padStart(2, "0");
  const day = String(l.getUTCDate()).padStart(2, "0");
  const hh = String(l.getUTCHours()).padStart(2, "0");
  const mm = String(l.getUTCMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, weekday: l.getUTCDay(), hhmm: `${hh}:${mm}` };
}

// Bornes UTC du mois local Cameroun : [1er du mois 00:00 WAT ; 1er du mois suivant 00:00 WAT[.
export function monthBoundsUtc(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  // 00:00 local Cameroun = 23:00 UTC la veille → on retranche l'offset.
  const start = new Date(Date.UTC(y, m - 1, 1) - CAMEROON_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - CAMEROON_OFFSET_MS);
  return { start, end };
}

// Construit le relevé mensuel : une ligne par jour du mois (avec ou sans
// connexion), la 1re connexion et la dernière déconnexion, et les compteurs.
export function buildConnectionRecord(month: string, events: ConnectionEvent[]): ConnectionRecord {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Squelette : tous les jours du mois, dans l'ordre.
  const byDate = new Map<string, DayConnections>();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    byDate.set(date, { date, weekday, has_connection: false, first_login: null, last_logout: null, nb_logins: 0, nb_logouts: 0 });
  }

  for (const ev of events) {
    const { date, hhmm } = localParts(ev.occurredAt);
    const row = byDate.get(date);
    if (!row) continue; // évènement hors du mois demandé (garde-fou)
    row.has_connection = true;
    if (ev.kind === "login") {
      row.nb_logins += 1;
      if (row.first_login === null || hhmm < row.first_login) row.first_login = hhmm;
    } else {
      row.nb_logouts += 1;
      if (row.last_logout === null || hhmm > row.last_logout) row.last_logout = hhmm;
    }
  }

  const days = [...byDate.values()];
  const recap = {
    days_in_month: daysInMonth,
    days_with_connection: days.filter((d) => d.has_connection).length,
    total_logins: days.reduce((s, d) => s + d.nb_logins, 0),
    total_logouts: days.reduce((s, d) => s + d.nb_logouts, 0),
  };
  return { month, days, recap };
}
