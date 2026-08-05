import { prisma } from "./prisma.js";

// Tableau de bord du sous-module « Comité de lecture » (refonte du pôle
// éditorial). RÉUTILISE les données déjà en base (manuscrits à l'étape
// COMITE_LECTURE + leurs missions de lecture) — aucune double saisie.
// Réservé, côté route, aux rôles éditorial/direction. Additif : n'altère
// aucun autre module.

const COMMITTEE_CODE = "COMITE_LECTURE";

// Sous-état d'un manuscrit au comité, pour le menu local (accordéon) :
//  - a_affecter : aucune mission active (aucun relecteur encore désigné) ;
//  - en_lecture : au moins une mission en cours (pending/late) ;
//  - rapports_remis : toutes les missions (non annulées) sont remises → prêt à clore.
export type CommitteeSubState = "a_affecter" | "en_lecture" | "rapports_remis";

export interface CommitteeManuscript {
  id: string;
  manuscript_number: string;
  title: string;
  received_at: string;
  sub_state: CommitteeSubState;
  assigned: number; // missions non annulées
  submitted: number; // rapports remis
  pending: number; // missions en attente (pending)
  late: number; // missions en retard (late, ou pending échue)
}

export interface ReadingCommitteeDashboard {
  en_comite: number; // manuscrits à l'étape comité de lecture
  a_affecter: number;
  en_lecture: number;
  rapports_remis: number; // prêts à clore
  en_retard: number; // manuscrits avec au moins une mission en retard
  rapports_en_attente: number; // total des missions non remises (pending + late)
  relecteurs_actifs: number; // relecteurs distincts ayant une mission en cours
  manuscripts: CommitteeManuscript[];
}

export async function readingCommitteeDashboard(): Promise<ReadingCommitteeDashboard> {
  const now = Date.now();
  const rows = await prisma.manuscript.findMany({
    where: { deletedAt: null, status: { code: COMMITTEE_CODE } },
    select: {
      id: true,
      manuscriptNumber: true,
      title: true,
      receivedAt: true,
      readingAssignments: { select: { readerId: true, status: true, dueAt: true } },
    },
    orderBy: { receivedAt: "asc" },
  });

  const activeReaders = new Set<string>();
  let a_affecter = 0;
  let en_lecture = 0;
  let rapports_remis = 0;
  let en_retard = 0;
  let rapports_en_attente = 0;

  const manuscripts: CommitteeManuscript[] = rows.map((m) => {
    const live = m.readingAssignments.filter((a) => a.status !== "cancelled");
    const submitted = live.filter((a) => a.status === "submitted").length;
    // Une mission « en retard » = statut late, ou pending dont l'échéance est passée.
    const late = live.filter((a) => a.status === "late" || (a.status === "pending" && a.dueAt.getTime() < now)).length;
    const pending = live.filter((a) => a.status === "pending" && a.dueAt.getTime() >= now).length;
    const active = pending + late; // missions non remises
    rapports_en_attente += active;
    for (const a of live) if (a.status === "pending" || a.status === "late") activeReaders.add(a.readerId);
    if (late > 0) en_retard++;

    let sub_state: CommitteeSubState;
    if (live.length === 0) {
      sub_state = "a_affecter";
      a_affecter++;
    } else if (active > 0) {
      sub_state = "en_lecture";
      en_lecture++;
    } else {
      sub_state = "rapports_remis";
      rapports_remis++;
    }

    return {
      id: m.id,
      manuscript_number: m.manuscriptNumber,
      title: m.title,
      received_at: m.receivedAt.toISOString(),
      sub_state,
      assigned: live.length,
      submitted,
      pending,
      late,
    };
  });

  return {
    en_comite: rows.length,
    a_affecter,
    en_lecture,
    rapports_remis,
    en_retard,
    rapports_en_attente,
    relecteurs_actifs: activeReaders.size,
    manuscripts,
  };
}
