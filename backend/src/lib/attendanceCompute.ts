// Moteur de calcul des présences (incrément 2) — fonctions PURES, sans accès
// base, donc entièrement testables. Toutes les durées sont en minutes.
//
// Règles (Partie 2 du cahier d'évolution) :
//  • temps travaillé = présence dans la plage officielle, PAUSE DÉJEUNER EXCLUE (§16) ;
//  • retard = arrivée après le début officiel (§13) ;
//  • départ anticipé = départ avant la fin officielle (§14) ;
//  • heures supplémentaires = présence au-delà de la fin officielle (§17) ;
//  • interruptions = temps attendu non couvert au milieu de la journée (hors pause) ;
//  • absence pleine journée = jour ouvrable, non férié, sans aucun pointage.
// La justification (congé, mission…) est portée en métadonnée sans fausser les
// chiffres bruts : la retenue (incrément 3) décidera de l'exonération.

export interface DaySchedule {
  dayStartMin: number;
  lunchStartMin: number;
  lunchEndMin: number;
  dayEndMin: number;
  workingDays: number[]; // jours ISO travaillés (1=lundi … 7=dimanche)
}

export interface DayEvent {
  kind: string; // "in" | "out"
  localMinutes: number; // minute locale (0-1439) de l'événement ce jour-là
}

export interface DayResult {
  date: string; // AAAA-MM-JJ
  is_working_day: boolean;
  is_holiday: boolean;
  has_data: boolean;
  first_in_min: number | null;
  last_out_min: number | null;
  presence_minutes: number;
  worked_minutes: number;
  expected_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  interruption_minutes: number;
  absent_full_day: boolean;
  justified: boolean;
  nature: string | null;
}

// Chevauchement (en minutes) de deux intervalles [a1,a2] et [b1,b2].
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

// Reconstitue les intervalles de présence à partir des pointages bruts d'un
// jour. Tolère les séquences imparfaites (double « in », « out » orphelin,
// « in » final sans « out »). Un « in » sans « out » est fermé à la fin de la
// journée officielle (l'anomalie « oubli de déconnexion » sera signalée à
// l'incrément 4, sans surestimer le temps travaillé).
export function buildIntervals(events: DayEvent[], dayEndMin: number): Array<[number, number]> {
  const sorted = [...events].sort((a, b) => a.localMinutes - b.localMinutes);
  const intervals: Array<[number, number]> = [];
  let openAt: number | null = null;
  for (const e of sorted) {
    if (e.kind === "in") {
      if (openAt === null) openAt = e.localMinutes;
      // « in » consécutif : on conserve le premier (ignore les doublons).
    } else if (e.kind === "out") {
      if (openAt !== null) {
        if (e.localMinutes > openAt) intervals.push([openAt, e.localMinutes]);
        openAt = null;
      }
      // « out » orphelin : ignoré.
    }
  }
  if (openAt !== null && dayEndMin > openAt) intervals.push([openAt, dayEndMin]);
  return intervals;
}

export function computeDay(params: {
  date: string;
  isoWeekday: number;
  events: DayEvent[];
  schedule: DaySchedule;
  isHoliday: boolean;
  covering: { type: string } | null;
}): DayResult {
  const { schedule: s } = params;
  const isWorkingDay = params.schedule.workingDays.includes(params.isoWeekday) && !params.isHoliday;
  const lunchDuration = Math.max(0, s.lunchEndMin - s.lunchStartMin);
  const expectedMinutes = isWorkingDay ? Math.max(0, s.dayEndMin - s.dayStartMin - lunchDuration) : 0;

  const intervals = buildIntervals(params.events, s.dayEndMin);
  const hasData = intervals.length > 0;

  const firstIn = hasData ? intervals[0][0] : null;
  const lastOut = hasData ? intervals[intervals.length - 1][1] : null;

  let presenceMinutes = 0;
  let workedMinutes = 0;
  for (const [a, b] of intervals) {
    presenceMinutes += Math.max(0, b - a);
    // Temps travaillé : dans la plage officielle, moins la pause déjeuner.
    const inWindow = overlap(a, b, s.dayStartMin, s.dayEndMin);
    const inLunch = overlap(a, b, s.lunchStartMin, s.lunchEndMin);
    workedMinutes += Math.max(0, inWindow - inLunch);
  }

  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let overtimeMinutes = 0;
  if (isWorkingDay && hasData && firstIn !== null && lastOut !== null) {
    lateMinutes = Math.min(Math.max(0, firstIn - s.dayStartMin), expectedMinutes);
    const clampedOut = Math.min(lastOut, s.dayEndMin);
    earlyLeaveMinutes = Math.max(0, s.dayEndMin - Math.max(clampedOut, s.dayStartMin));
    overtimeMinutes = Math.max(0, lastOut - s.dayEndMin);
  }

  // Interruptions au milieu de journée (hors pause) = attendu non couvert, une
  // fois retirés le retard (avant la 1re arrivée) et le départ anticipé.
  const interruptionMinutes = isWorkingDay && hasData
    ? Math.max(0, expectedMinutes - workedMinutes - lateMinutes - earlyLeaveMinutes)
    : 0;

  const absentFullDay = isWorkingDay && !hasData;
  const justified = params.covering !== null;
  const nature = params.covering?.type ?? null;

  return {
    date: params.date,
    is_working_day: isWorkingDay,
    is_holiday: params.isHoliday,
    has_data: hasData,
    first_in_min: firstIn,
    last_out_min: lastOut,
    presence_minutes: presenceMinutes,
    worked_minutes: workedMinutes,
    expected_minutes: expectedMinutes,
    late_minutes: lateMinutes,
    early_leave_minutes: earlyLeaveMinutes,
    overtime_minutes: overtimeMinutes,
    interruption_minutes: interruptionMinutes,
    absent_full_day: absentFullDay,
    justified,
    nature,
  };
}

export interface RangeSummary {
  from: string;
  to: string;
  days: DayResult[];
  totals: {
    worked_minutes: number;
    expected_minutes: number;
    late_minutes: number;
    early_leave_minutes: number;
    overtime_minutes: number;
    interruption_minutes: number;
    days_worked: number;
    days_absent_unjustified: number;
    days_absent_justified: number;
  };
}

export function summarize(from: string, to: string, days: DayResult[]): RangeSummary {
  const totals = {
    worked_minutes: 0,
    expected_minutes: 0,
    late_minutes: 0,
    early_leave_minutes: 0,
    overtime_minutes: 0,
    interruption_minutes: 0,
    days_worked: 0,
    days_absent_unjustified: 0,
    days_absent_justified: 0,
  };
  for (const d of days) {
    totals.worked_minutes += d.worked_minutes;
    totals.expected_minutes += d.expected_minutes;
    totals.late_minutes += d.late_minutes;
    totals.early_leave_minutes += d.early_leave_minutes;
    totals.overtime_minutes += d.overtime_minutes;
    totals.interruption_minutes += d.interruption_minutes;
    if (d.has_data && d.worked_minutes > 0) totals.days_worked += 1;
    if (d.absent_full_day) {
      if (d.justified) totals.days_absent_justified += 1;
      else totals.days_absent_unjustified += 1;
    }
  }
  return { from, to, days, totals };
}
