import { prisma } from "./prisma.js";
import { announcementPreview } from "./announcementHtml.js";

// Centre de Communication Interne — Compilation du bulletin d'actualités
// (module « communication »). Un bulletin (« newsletter ») regroupe, pour une
// période donnée, les actualités de portée MAISON : les annonces publiées
// diffusées à « tous » et les événements du calendrier ouverts à « tous ».
//
// Choix de confidentialité : un bulletin est envoyé à l'ensemble du personnel,
// on n'y agrège donc QUE le contenu explicitement destiné à tout le monde.
// Les annonces et événements ciblés sur un pôle/rôle/personne restent privés et
// ne remontent jamais dans un bulletin général.

export interface NewsletterItem {
  kind: "announcement" | "event";
  id: string;
  title: string;
  date: Date | null;
  preview: string | null;
}

// Rassemble les actualités « maison » d'une période, triées par date
// décroissante (le plus récent d'abord). Borné (200 de chaque) : un bulletin
// n'a pas vocation à lister des centaines d'entrées.
export async function compileNewsletter(periodStart: Date, periodEnd: Date): Promise<NewsletterItem[]> {
  const [announcements, events] = await Promise.all([
    prisma.announcement.findMany({
      where: {
        deletedAt: null,
        status: "publiee",
        publishedAt: { gte: periodStart, lte: periodEnd },
        targets: { some: { targetType: "tous" } },
      },
      orderBy: { publishedAt: "desc" },
      take: 200,
      select: { id: true, title: true, publishedAt: true, bodyHtml: true },
    }),
    prisma.calendarEvent.findMany({
      where: {
        deletedAt: null,
        startsAt: { gte: periodStart, lte: periodEnd },
        targets: { some: { targetType: "tous" } },
      },
      orderBy: { startsAt: "desc" },
      take: 200,
      select: { id: true, title: true, startsAt: true, location: true, description: true },
    }),
  ]);

  const items: NewsletterItem[] = [
    ...announcements.map((a) => ({
      kind: "announcement" as const,
      id: a.id,
      title: a.title,
      date: a.publishedAt,
      preview: announcementPreview(a.bodyHtml, 160),
    })),
    ...events.map((e) => ({
      kind: "event" as const,
      id: e.id,
      title: e.title,
      date: e.startsAt,
      preview: [e.location, e.description].filter(Boolean).join(" · ") || null,
    })),
  ];

  items.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return items;
}
