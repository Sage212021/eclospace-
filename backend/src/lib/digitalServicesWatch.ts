import type { NotificationPriority } from "@prisma/client";
import { prisma } from "./prisma.js";
import { notifyRole } from "./notify.js";
import { computeServiceView } from "./digitalServices.js";

// Veille AUTOMATIQUE des abonnements (Phase B). Parcourt les services actifs et,
// pour chacun, émet UNE alerte quand un seuil d'échéance (J-15/J-7/J-3/J-1/
// dépassé) ou de consommation (70/85/95 %) est franchi — sans jamais renvoyer
// deux fois la même (table `DigitalServiceAlert`, clé anti-doublon). Un nouveau
// cycle (paiement qui avance l'échéance, nouveau mois de conso) ré-ouvre les
// alertes. Les alertes vont à l'ADMIN_GENERAL (cloche + e-mail pour les niveaux
// importants/critiques). Ne lève jamais : une panne n'interrompt rien.

const ADMIN_ROLE = "ADMIN_GENERAL";

// Seuils d'échéance, du plus large au plus serré. Priorité → couleur/e-mail.
const DEADLINE_BANDS: { threshold: string; maxDays: number; priority: NotificationPriority; label: string }[] = [
  { threshold: "J-1", maxDays: 1, priority: "high", label: "échéance dans 1 jour" },
  { threshold: "J-3", maxDays: 3, priority: "high", label: "échéance dans 3 jours" },
  { threshold: "J-7", maxDays: 7, priority: "medium", label: "échéance dans 7 jours" },
  { threshold: "J-15", maxDays: 15, priority: "low", label: "échéance dans 15 jours" },
];
// Seuils de consommation, du plus haut au plus bas.
const USAGE_BANDS: { threshold: string; min: number; priority: NotificationPriority }[] = [
  { threshold: "95", min: 95, priority: "critical" },
  { threshold: "85", min: 85, priority: "high" },
  { threshold: "70", min: 70, priority: "medium" },
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function fireOnce(key: string, serviceId: string, kind: string, threshold: string, prio: NotificationPriority, title: string, body: string): Promise<boolean> {
  const exists = await prisma.digitalServiceAlert.findUnique({ where: { dedupeKey: key }, select: { id: true } });
  if (exists) return false;
  await prisma.digitalServiceAlert.create({ data: { serviceId, kind, threshold, dedupeKey: key } });
  await notifyRole({ roleCode: ADMIN_ROLE, type: "echeance", priority: prio, title, body, entityType: "digital_service", entityId: serviceId });
  return true;
}

export async function runSubscriptionWatch(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  const services = await prisma.digitalService.findMany({ where: { deletedAt: null, active: true } });
  for (const s of services) {
    try {
      const view = computeServiceView({ nextDueDate: s.nextDueDate, kind: s.kind, monthlyBudget: s.monthlyBudget, currentUsage: s.currentUsage }, now);

      // Échéance : dépassé, ou la bande la plus serrée atteinte (une seule alerte).
      if (s.nextDueDate) {
        const dueKey = isoDay(s.nextDueDate);
        if (view.daysToDue != null && view.daysToDue < 0) {
          if (await fireOnce(`${s.id}:deadline:overdue:${dueKey}`, s.id, "deadline", "overdue", "critical", `Paiement en retard — ${s.name}`, `L'échéance du service « ${s.name} » est dépassée (${dueKey}). Régularisez le paiement pour éviter toute interruption.`)) sent++;
        } else if (view.daysToDue != null) {
          const band = [...DEADLINE_BANDS].sort((a, b) => a.maxDays - b.maxDays).find((b) => view.daysToDue! <= b.maxDays);
          if (band && await fireOnce(`${s.id}:deadline:${band.threshold}:${dueKey}`, s.id, "deadline", band.threshold, band.priority, `Échéance proche — ${s.name}`, `Le service « ${s.name} » arrive à échéance (${band.label}, le ${dueKey}). Pensez à préparer le paiement.`)) sent++;
        }
      }

      // Consommation (forfaits à l'usage) : la bande la plus haute atteinte.
      if (view.usagePct != null && s.usagePeriod) {
        const band = USAGE_BANDS.find((b) => view.usagePct! >= b.min);
        if (band && await fireOnce(`${s.id}:usage:${band.threshold}:${s.usagePeriod}`, s.id, "usage", band.threshold, band.priority, `Budget API à surveiller — ${s.name}`, `La consommation du service « ${s.name} » atteint ${view.usagePct}% du budget du mois (${s.usagePeriod}). Au-delà, les corrections (BAT1/BAT2) risquent d'être interrompues.`)) sent++;
      }
    } catch (err) {
      console.error(`[subscription-watch] échec sur le service ${s.key}:`, err);
    }
  }
  return { sent };
}
