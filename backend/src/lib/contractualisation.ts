import { prisma } from "./prisma.js";
import type { EffectiveUser } from "./permissions.js";

// Étape « Contractualisation » (circuit : BAT Final → Contractualisation →
// Impression, décision D-010 du 18/08/2026). À ce niveau, la Direction générale
// établit/fait signer le contrat d'édition et dépose le scan signé des deux
// parties ; rien ne part à l'impression tant que ce n'est pas fait.
export const CONTRACTUALISATION_CODE = "CONTRACTUALISATION";

// Rôles auxquels le DG peut DÉLÉGUER la préparation de la contractualisation
// d'un dossier (demande opérateur 16/10) : Direction éditoriale, RH, ou
// Responsable administratif et financier (DAF). Le clic final de validation
// reste réservé au DG.
export const CONTRACTUALISATION_DELEGATE_ROLES = ["DIR_EDITORIAL", "RESP_RH", "RESP_FINANCE"] as const;

// Le DG (ou l'administrateur général) : seul habilité au clic final de
// contractualisation, et toujours autorisé à préparer le contrat à cette étape.
export function isDirectionGenerale(user: EffectiveUser): boolean {
  return user.roles.includes("DIR_GENERAL") || user.roles.includes("ADMIN_GENERAL");
}

// Identifiant de l'étape CONTRACTUALISATION (mémoïsé le temps du process).
let contractualisationStatusId: string | null = null;
export async function getContractualisationStatusId(): Promise<string | null> {
  if (contractualisationStatusId) return contractualisationStatusId;
  const status = await prisma.workflowStatus.findUnique({ where: { code: CONTRACTUALISATION_CODE }, select: { id: true } });
  contractualisationStatusId = status?.id ?? null;
  return contractualisationStatusId;
}

// Le délégué désigné pour la contractualisation de ce dossier (responsable de
// l'étape CONTRACTUALISATION), s'il y en a un.
export async function contractualisationDelegateId(manuscriptId: string): Promise<string | null> {
  const statusId = await getContractualisationStatusId();
  if (!statusId) return null;
  const step = await prisma.manuscriptStep.findUnique({
    where: { manuscriptId_statusId: { manuscriptId, statusId } },
    select: { responsibleId: true },
  });
  return step?.responsibleId ?? null;
}

// Le dossier est-il ACTUELLEMENT à l'étape Contractualisation ?
export async function isAtContractualisation(manuscriptId: string): Promise<boolean> {
  const m = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    select: { status: { select: { code: true } } },
  });
  return m?.status?.code === CONTRACTUALISATION_CODE;
}

// Accès SCOPÉ à la préparation du contrat : le DG, ou le délégué désigné, peut
// établir/compléter le contrat et déposer le scan signé — UNIQUEMENT pour ce
// dossier précis et UNIQUEMENT tant qu'il est en contractualisation. On n'ouvre
// donc jamais le module Contrats en grand à RH/DAF/Éditorial.
export async function canPrepareContractForManuscript(
  user: EffectiveUser,
  manuscriptId: string | null | undefined,
): Promise<boolean> {
  if (!manuscriptId) return false;
  if (!(await isAtContractualisation(manuscriptId))) return false;
  if (isDirectionGenerale(user)) return true;
  const delegateId = await contractualisationDelegateId(manuscriptId);
  return !!delegateId && delegateId === user.id;
}
