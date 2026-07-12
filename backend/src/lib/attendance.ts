import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import type { WorkSchedule } from "@prisma/client";

// Librairie du module « Présences & Temps de travail » (incrément 1).
// Regroupe : (1) l'enregistrement du pointage à partir des événements bruts de
// connexion/déconnexion, tolérant aux pannes (ne bloque jamais l'authentification) ;
// (2) la résolution de l'horaire officiel applicable à un employé à une date.

export const DEFAULT_SCHEDULE = {
  dayStartMin: 8 * 60 + 30, // 08:30
  lunchStartMin: 12 * 60, // 12:00
  lunchEndMin: 13 * 60, // 13:00
  dayEndMin: 18 * 60, // 18:00
  workingDays: "1,2,3,4,5",
} as const;

// "HH:MM" ↔ minutes depuis minuit — conversions exactes, sans dérive de fuseau.
export function hhmmToMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Heure invalide : « ${value} » (attendu HH:MM).`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Heure hors plage : « ${value} ».`);
  return h * 60 + min;
}

export function minutesToHhmm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Cohérence d'un horaire : début < pause < fin de pause < fin de journée.
export function assertScheduleCoherent(s: {
  dayStartMin: number;
  lunchStartMin: number;
  lunchEndMin: number;
  dayEndMin: number;
}): void {
  if (!(s.dayStartMin < s.lunchStartMin && s.lunchStartMin < s.lunchEndMin && s.lunchEndMin < s.dayEndMin)) {
    throw new Error(
      "Horaire incohérent : il faut début de journée < début de pause < fin de pause < fin de journée.",
    );
  }
}

// Enregistrement d'un événement de pointage — au mieux (best-effort). Toute
// erreur est avalée : le module « Présences » peut être désactivé ou en panne
// sans jamais empêcher un utilisateur de se connecter ou se déconnecter.
export async function recordAttendanceEvent(params: {
  userId: string;
  kind: "in" | "out";
  source?: string;
  request?: Pick<FastifyRequest, "ip" | "headers">;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { employeeId: true },
    });
    const ua = params.request?.headers?.["user-agent"];
    await prisma.attendanceEvent.create({
      data: {
        userId: params.userId,
        employeeId: user?.employeeId ?? null,
        kind: params.kind,
        source: params.source ?? "erp_session",
        ipAddress: params.request?.ip ?? null,
        userAgent: typeof ua === "string" ? ua.slice(0, 400) : null,
      },
    });
  } catch {
    // Silencieux volontairement : le pointage ne doit jamais casser l'auth.
  }
}

export interface ResolvedSchedule {
  dayStartMin: number;
  lunchStartMin: number;
  lunchEndMin: number;
  dayEndMin: number;
  workingDays: number[];
  source: "employee" | "department" | "company" | "default";
}

function parseWorkingDays(csv: string): number[] {
  return csv
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

function toResolved(s: WorkSchedule, source: ResolvedSchedule["source"]): ResolvedSchedule {
  return {
    dayStartMin: s.dayStartMin,
    lunchStartMin: s.lunchStartMin,
    lunchEndMin: s.lunchEndMin,
    dayEndMin: s.dayEndMin,
    workingDays: parseWorkingDays(s.workingDays),
    source,
  };
}

// Horaire officiel applicable à un employé pour une date : la surcharge la plus
// spécifique l'emporte (employé > département > maison), en retenant la version
// active la plus récente dont la date d'effet précède la date visée. À défaut de
// tout paramétrage, l'horaire de référence par défaut (08:30-18:00, pause 12h-13h).
export async function resolveSchedule(params: {
  employeeId?: string | null;
  departmentId?: string | null;
  onDate?: Date;
}): Promise<ResolvedSchedule> {
  const onDate = params.onDate ?? new Date();
  const base = { active: true, deletedAt: null, effectiveFrom: { lte: onDate } };

  if (params.employeeId) {
    const s = await prisma.workSchedule.findFirst({
      where: { ...base, scope: "employee", employeeId: params.employeeId },
      orderBy: { effectiveFrom: "desc" },
    });
    if (s) return toResolved(s, "employee");
  }

  if (params.departmentId) {
    const s = await prisma.workSchedule.findFirst({
      where: { ...base, scope: "department", departmentId: params.departmentId },
      orderBy: { effectiveFrom: "desc" },
    });
    if (s) return toResolved(s, "department");
  }

  const company = await prisma.workSchedule.findFirst({
    where: { ...base, scope: "company" },
    orderBy: { effectiveFrom: "desc" },
  });
  if (company) return toResolved(company, "company");

  return {
    ...DEFAULT_SCHEDULE,
    workingDays: parseWorkingDays(DEFAULT_SCHEDULE.workingDays),
    source: "default",
  };
}
