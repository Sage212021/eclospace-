// Données de référence du Lot 0 : les 17 départements (Ch. 3 §3.2, décision D-002),
// les rôles identifiés au Ch. 2 §2.2 et Ch. 3 §3.3, et un compte administrateur
// initial. Rejouable sans effet de bord (upsert par code).
import argon2 from "argon2";
import { PrismaClient, PermissionAction, CustomerCategory } from "@prisma/client";
import { FORMULA_DEFS } from "../src/lib/payrollFormula.js";
import { DEFAULT_ABSENCE_REASONS } from "../src/lib/absenceReasons.js";
import { DEFAULT_SALARY_ELEMENTS } from "../src/lib/salaryElements.js";
import { dispatchReleaseNotes } from "../src/lib/releaseNotes.js";
import { BRANDING_KEY, BRANDING_DEFAULTS } from "../src/lib/branding.js";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

const departments = [
  { code: "DG", name: "Direction générale" },
  { code: "SECR", name: "Secrétariat éditorial" },
  { code: "COMLEC", name: "Comité de lecture" },
  { code: "DIRED", name: "Direction éditoriale" },
  { code: "JURID", name: "Service juridique" },
  { code: "CORR", name: "Correction éditoriale" },
  { code: "EXPERT", name: "Expertise scientifique" },
  { code: "MAQ", name: "Maquette et mise en page" },
  { code: "INFOG", name: "Infographie et design" },
  { code: "CQ", name: "Contrôle qualité" },
  { code: "IMPR", name: "Impression" },
  { code: "STOCK", name: "Gestion des stocks" },
  { code: "COM", name: "Service commercial" },
  { code: "MKT", name: "Marketing et communication" },
  { code: "FIN", name: "Administration et finances" },
  { code: "RH", name: "Ressources humaines" },
  { code: "ARCH", name: "Archivage" },
];

// Rattachement nul = rôle transverse (Ch. 2 : Administrateur général, Directeur général).
const roles: { code: string; label: string; departmentCode: string | null }[] = [
  { code: "ADMIN_GENERAL", label: "Administrateur général", departmentCode: null },
  { code: "DIR_GENERAL", label: "Directeur général", departmentCode: "DG" },
  { code: "DIR_EDITORIAL", label: "Directeur éditorial", departmentCode: "DIRED" },
  { code: "RESP_FINANCE", label: "Responsable administratif et financier", departmentCode: "FIN" },
  { code: "COMPTABLE", label: "Comptable", departmentCode: "FIN" },
  { code: "RESP_COMMERCIAL", label: "Responsable commercial", departmentCode: "COM" },
  { code: "COMMERCIAL", label: "Commercial", departmentCode: "COM" },
  { code: "RESP_INFOGRAPHIE", label: "Responsable infographie", departmentCode: "INFOG" },
  { code: "CORRECTEUR", label: "Correcteur", departmentCode: "CORR" },
  { code: "MAQUETTISTE", label: "Maquettiste", departmentCode: "MAQ" },
  { code: "MAGASINIER", label: "Magasinier", departmentCode: "STOCK" },
  { code: "ASSISTANT_EDITORIAL", label: "Assistant éditorial", departmentCode: "SECR" },
  { code: "MEMBRE_COMITE_LECTURE", label: "Membre du comité de lecture", departmentCode: "COMLEC" },
  { code: "RESP_JURIDIQUE", label: "Responsable juridique", departmentCode: "JURID" },
  { code: "RESP_QUALITE", label: "Responsable contrôle qualité", departmentCode: "CQ" },
  { code: "RESP_IMPRESSION", label: "Responsable production/impression", departmentCode: "IMPR" },
  { code: "CHARGE_COMMUNICATION", label: "Chargé de communication", departmentCode: "MKT" },
  { code: "RESP_RH", label: "Responsable RH", departmentCode: "RH" },
  // Rôle transverse « marqueur » (décision opérateur du 10/07/2026) : désigne le
  // responsable d'un département. Assigné en plus du rôle métier de la personne ;
  // son périmètre (le département) vient de la fiche employé, pas du rôle — d'où
  // departmentCode null. Sert notamment à révéler, dans le Hall, les noms des
  // personnes présentes de son seul département.
  { code: "CHEF_DEPARTEMENT", label: "Chef de département", departmentCode: null },
];

// Modules exposés par l'API (Ch. 2 §2.3 : 4 niveaux d'action), ajoutés lot par lot.
const lot0Modules = ["documents", "notifications", "users", "settings"];
const lot1Modules = ["manuscripts", "comite_lecture", "decision_editoriale"];
const lot2Modules = ["contracts", "tasks"];
const lot3Modules = ["production", "isbn", "bat", "printing"];
const lot4Modules = ["stock", "commercial"];
const lot5Modules = ["finance", "royalties"];
const lot6Modules = ["rh", "rh_confidentiel", "direction", "pilotage", "rapports"];
// Évolution : modules « Présences & Temps de travail » et « Paie » (D-007),
// indépendants et désactivables.
const evolutionModules = ["presences", "paie", "communication", "service_auteurs", "marketing"];
const modules = [...lot0Modules, ...lot1Modules, ...lot2Modules, ...lot3Modules, ...lot4Modules, ...lot5Modules, ...lot6Modules, ...evolutionModules];
const actions = Object.values(PermissionAction);

// Référentiel des ~20 étapes du workflow (Ch. 4 §4.3). Toutes sont créées dès
// le Lot 1 ; seules les étapes 1 à 4 sont pilotées par l'application à ce
// stade — les suivantes attendent les modules des lots 2 à 5.
const workflowStatuses: {
  code: string;
  label: string;
  stepOrder: number;
  departmentCode: string;
  isConditional?: boolean;
}[] = [
  { code: "RECEPTION", label: "Réception du manuscrit", stepOrder: 1, departmentCode: "SECR" },
  { code: "VERIF_ADMIN", label: "Vérification administrative", stepOrder: 2, departmentCode: "SECR" },
  { code: "COMITE_LECTURE", label: "Comité de lecture", stepOrder: 3, departmentCode: "COMLEC" },
  { code: "DECISION_EDITORIALE", label: "Décision éditoriale", stepOrder: 4, departmentCode: "DIRED" },
  // Décision opérateur (18/08/2026, D-010) : la CONTRACTUALISATION est déplacée
  // juste APRÈS la « Validation du BAT » (elle était à l'étape 5). L'auteur
  // valide d'abord le bon à tirer, puis le contrat est signé — enchaînement
  // « Validation BAT → Contractualisation → Impression ». Dérogation assumée au
  // Ch. 9 §9.12 (qui plaçait le contrat avant la production) : cf. registre des
  // décisions et docs/JOURNAL_TECHNIQUE.md.
  { code: "PLANIFICATION", label: "Planification du projet", stepOrder: 5, departmentCode: "DIRED" },
  // Décision opérateur (22/08/2026, D-014) : l'EXPERTISE scientifique et la
  // RÉÉCRITURE éditoriale passent AVANT la Correction éditoriale — on valide le
  // fond puis on réécrit la substance AVANT le polissage fin de la langue
  // (corriger avant de réécrire = corriger deux fois). Enchaînement :
  // Planification → Expertise → Réécriture → Correction → Mise en page.
  { code: "EXPERTISE", label: "Expertise scientifique", stepOrder: 6, departmentCode: "EXPERT", isConditional: true },
  { code: "REECRITURE", label: "Réécriture éditoriale", stepOrder: 7, departmentCode: "CORR", isConditional: true },
  { code: "CORRECTION", label: "Correction éditoriale", stepOrder: 8, departmentCode: "CORR" },
  { code: "MISE_EN_PAGE", label: "Mise en page", stepOrder: 9, departmentCode: "MAQ" },
  { code: "INFOGRAPHIE", label: "Infographie", stepOrder: 10, departmentCode: "INFOG" },
  // Ordre corrigé (Lot 3) par rapport au Lot 1 : Ch. 13 §13.9 et Ch. 14 §14.2
  // exigent tous deux que la complétude ISBN/dépôt légal/métadonnées soit
  // vérifiée AVANT la constitution du dossier de BAT — l'ordre initial du
  // Lot 1 (BAT avant attribution des références) contredisait ce texte.
  { code: "ATTRIBUTION_REFERENCES", label: "Attribution des références", stepOrder: 11, departmentCode: "SECR" },
  { code: "VALIDATION_BAT", label: "Validation du BAT Final", stepOrder: 12, departmentCode: "CQ" },
  { code: "CONTRACTUALISATION", label: "Contractualisation", stepOrder: 13, departmentCode: "JURID" },
  { code: "IMPRESSION", label: "Impression", stepOrder: 14, departmentCode: "IMPR" },
  { code: "CONTROLE_QUALITE_IMPRESSION", label: "Contrôle qualité (exemplaires imprimés)", stepOrder: 15, departmentCode: "CQ" },
  { code: "ENTREE_STOCK", label: "Entrée en stock", stepOrder: 16, departmentCode: "STOCK" },
  { code: "COMMERCIALISATION", label: "Commercialisation", stepOrder: 17, departmentCode: "COM" },
  { code: "VENTE_LIVRAISON", label: "Vente et livraison", stepOrder: 18, departmentCode: "COM" },
  { code: "SUIVI_POST_PUBLICATION", label: "Suivi post-publication", stepOrder: 19, departmentCode: "COM" },
  { code: "ARCHIVAGE", label: "Archivage", stepOrder: 20, departmentCode: "ARCH" },
];

// Domaines cités en exemple au Ch. 6 §6.2 — liste de départ, à compléter par
// le secrétariat éditorial selon le catalogue réel de la maison.
const genres = [
  { code: "ROMAN", label: "Roman" },
  { code: "ESSAI", label: "Essai" },
  { code: "POESIE", label: "Poésie" },
  { code: "MANUEL", label: "Manuel scolaire ou pratique" },
  { code: "JEUNESSE", label: "Jeunesse" },
  // Enrichissement du 30/08/2026 (D-024) : domaines réellement présents dans les
  // catalogues Éclosion (analyse des collections Source et Canari & les Héritiers).
  { code: "CONTE", label: "Conte & légende" },
  { code: "DOCUMENT", label: "Document & actualité" },
  { code: "TEMOIGNAGE", label: "Témoignage & biographie" },
  { code: "DEV_PERSO", label: "Développement personnel" },
  { code: "SCIENCES_HUMAINES", label: "Sciences humaines & économie" },
  { code: "THEATRE", label: "Théâtre" },
];

// Domaines RETIRÉS de la ligne éditoriale (suppression logique). « Spiritualité »
// n'est pas un domaine publié en soi (décision 06/09/2026) : le religieux/spirituel
// reste toléré comme THÈME dans une œuvre, mais n'est plus un domaine du catalogue.
// (La règle « thème toléré / doctrine proscrite » est portée par le prompt IA.)
const retiredGenreCodes = ["SPIRITUALITE"];

// Référentiel officiel des collections de la maison (D-025, 05/09/2026 —
// remplace les 2 collections de D-024). Trois collections, chacune couvrant
// des domaines précis :
//   • Canarie  → Roman, Théâtre, Poésie
//   • Héritier → Littérature jeunesse
//   • Sources  → Essai, Économie/Sciences humaines, Développement personnel…
// L'ancienne « Canari & les Héritiers » est scindée en Canarie / Héritier.
const collections = [
  { code: "CANARIE", label: "Collection Canarie" },
  { code: "HERITIER", label: "Collection Héritier" },
  { code: "SOURCES", label: "Collection Sources" },
];

// Codes des collections désormais retirées (remplacées par les 3 ci-dessus).
const retiredCollectionCodes = ["SOURCE", "CANARI"];

// Rattachement domaine → collection (tableau officiel D-025). Un domaine absent
// de cette table reste sans collection dédiée (collection_id NULL). Ce
// rattachement est « côté domaine » et sert notamment à l'analyse IA
// « adéquation avec la ligne éditoriale d'Éclosion ».
const genreCollectionByCode: Record<string, string> = {
  // Canarie — création littéraire (adulte)
  ROMAN: "CANARIE",
  THEATRE: "CANARIE",
  POESIE: "CANARIE",
  // Héritier — jeunesse & patrimoine
  JEUNESSE: "HERITIER",
  CONTE: "HERITIER",
  // Sources — savoir, réflexion & pratique (non-fiction)
  ESSAI: "SOURCES",
  SCIENCES_HUMAINES: "SOURCES",
  DEV_PERSO: "SOURCES",
  DOCUMENT: "SOURCES",
  TEMOIGNAGE: "SOURCES",
  MANUEL: "SOURCES",
};

// Grille d'évaluation du comité de lecture (Ch. 7 §7.4). Coefficients : les
// trois exemples donnés par le cahier des charges (§7.5) sont appliqués tels
// quels ; les autres critères restent à confirmer avec la Direction
// éditoriale (configurables via l'administration, non inventés au hasard).
const evaluationCriteria: { label: string; coefficient: number }[] = [
  { label: "Originalité du sujet", coefficient: 2 },
  { label: "Qualité de l'écriture", coefficient: 1 },
  { label: "Structure du texte", coefficient: 1 },
  { label: "Cohérence du contenu", coefficient: 1 },
  { label: "Rigueur scientifique (si applicable)", coefficient: 1 },
  { label: "Qualité des références", coefficient: 1 },
  { label: "Intérêt pour le public cible", coefficient: 1 },
  { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 3 },
  { label: "Potentiel commercial", coefficient: 2 },
];

async function main() {
  const departmentByCode = new Map<string, string>();
  for (const department of departments) {
    const row = await prisma.department.upsert({
      where: { code: department.code },
      update: { name: department.name },
      create: department,
    });
    departmentByCode.set(department.code, row.id);
  }

  const roleByCode = new Map<string, string>();
  for (const role of roles) {
    const row = await prisma.role.upsert({
      where: { code: role.code },
      update: { label: role.label, departmentId: role.departmentCode ? departmentByCode.get(role.departmentCode) : null },
      create: {
        code: role.code,
        label: role.label,
        departmentId: role.departmentCode ? departmentByCode.get(role.departmentCode) : null,
      },
    });
    roleByCode.set(role.code, row.id);
  }

  const permissionIdByKey = new Map<string, string>();
  for (const module of modules) {
    for (const action of actions) {
      const row = await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action },
      });
      permissionIdByKey.set(`${module}:${action}`, row.id);
    }
  }

  // Administrateur général : accès complet (Ch. 2 §2.2 : « Total »).
  const adminRoleId = roleByCode.get("ADMIN_GENERAL")!;
  for (const permissionId of permissionIdByKey.values()) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRoleId, permissionId } },
      update: {},
      create: { roleId: adminRoleId, permissionId },
    });
  }

  // Base transverse minimale pour tous les autres rôles : consultation des
  // documents et notifications qui les concernent. Les permissions fines par
  // module métier seront affinées lot par lot, à mesure que ces modules existent.
  const baselinePermissions = ["documents:consultation", "notifications:consultation"];
  for (const [roleCode, roleId] of roleByCode) {
    if (roleCode === "ADMIN_GENERAL") continue;
    for (const key of baselinePermissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permissionIdByKey.get(key)! } },
        update: {},
        create: { roleId, permissionId: permissionIdByKey.get(key)! },
      });
    }
  }

  // Permissions métier du Lot 1, par rôle (Ch. 2 §2.2-2.3, Ch. 6-8).
  async function grant(roleCode: string, keys: string[]) {
    const roleId = roleByCode.get(roleCode);
    if (!roleId) return;
    for (const key of keys) {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }

  // Retrait explicite d'une permission à un rôle : nécessaire pour corriger, sur
  // une base existante, un droit accordé par erreur (grant est idempotent mais
  // ne retire jamais). Rejouer le seed applique donc aussi les retraits décidés.
  async function revoke(roleCode: string, keys: string[]) {
    const roleId = roleByCode.get(roleCode);
    if (!roleId) return;
    for (const key of keys) {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
    }
  }

  await grant("ASSISTANT_EDITORIAL", [
    "manuscripts:consultation",
    "manuscripts:saisie",
    "comite_lecture:consultation",
    "comite_lecture:saisie",
    "users:consultation",
  ]);
  await grant("MEMBRE_COMITE_LECTURE", ["comite_lecture:consultation", "comite_lecture:saisie"]);
  await grant("DIR_EDITORIAL", [
    "manuscripts:consultation",
    // Le Directeur éditorial peut aussi DÉPOSER un manuscrit (demande opérateur
    // 09/09/2026) : « + Nouveau manuscrit » lui est désormais accessible, en plus
    // du dépôt par le Secrétariat éditorial.
    "manuscripts:saisie",
    "manuscripts:validation",
    "comite_lecture:consultation",
    "decision_editoriale:validation",
    "users:consultation",
    "contracts:consultation",
    "tasks:consultation",
    "tasks:saisie",
    "tasks:validation",
  ]);

  // Juridique et contrats (Ch. 9 §9.11 : accès réservé aux profils listés).
  await grant("RESP_JURIDIQUE", [
    "contracts:consultation",
    "contracts:saisie",
    "contracts:validation",
    "manuscripts:consultation",
    "users:consultation",
  ]);
  await grant("DIR_GENERAL", ["contracts:consultation", "contracts:validation", "manuscripts:administration"]);
  await grant("RESP_FINANCE", ["contracts:consultation"]);

  // Correction éditoriale (Ch. 10) : le correcteur voit et exécute ses tâches.
  await grant("CORRECTEUR", ["tasks:consultation", "tasks:saisie"]);

  // Maquette (Ch. 11) et Infographie (Ch. 12).
  await grant("MAQUETTISTE", ["production:consultation", "production:saisie", "manuscripts:consultation"]);
  await grant("RESP_INFOGRAPHIE", [
    "production:consultation",
    "production:saisie",
    "production:administration",
    "manuscripts:consultation",
  ]);
  await grant("DIR_EDITORIAL", ["production:consultation"]);

  // ISBN, dépôt légal, métadonnées (Ch. 13) : secrétariat éditorial.
  await grant("ASSISTANT_EDITORIAL", ["isbn:consultation", "isbn:saisie", "isbn:administration"]);
  await grant("DIR_GENERAL", ["isbn:consultation", "isbn:administration"]);

  // BAT et contrôle qualité (Ch. 14).
  await grant("RESP_QUALITE", ["bat:consultation", "bat:saisie", "bat:validation", "manuscripts:consultation"]);
  await grant("DIR_EDITORIAL", ["bat:consultation", "bat:validation"]);

  // Impression et fabrication (Ch. 15).
  await grant("RESP_IMPRESSION", [
    "printing:consultation",
    "printing:saisie",
    "printing:validation",
    "manuscripts:consultation",
  ]);
  await grant("DIR_GENERAL", ["printing:consultation", "printing:validation", "printing:administration"]);
  await grant("RESP_FINANCE", ["printing:consultation"]);

  // Supervision de toute la chaîne de production par la Direction : les modules
  // Production dépendent désormais des droits métier (production/isbn/bat/
  // printing) — et non plus du droit « manuscrits » générique, pour cloisonner
  // les rôles transverses (juridique, RH…). On garantit donc à la Direction
  // générale et éditoriale la visibilité complète de la Production.
  await grant("DIR_GENERAL", ["production:consultation", "isbn:consultation", "bat:consultation"]);
  await grant("DIR_EDITORIAL", ["production:consultation", "isbn:consultation", "bat:consultation", "printing:consultation"]);

  // Stock et magasin (Ch. 16).
  await grant("MAGASINIER", [
    "stock:consultation",
    "stock:saisie",
    "stock:validation",
    "stock:administration",
  ]);
  await grant("RESP_COMMERCIAL", ["stock:consultation"]);
  await grant("DIR_GENERAL", ["stock:consultation", "stock:validation"]);

  // Zones de stockage réelles (rapport d'inventaire opérateur du 06/07/2026),
  // pré-créées pour permettre l'inventaire par zone dès la mise en service.
  // Idempotent : créées seulement si absentes (repérées par leur libellé).
  const stockZones: { label: string; type: "entrepot" | "depot" | "depot_vente" | "emplacement" }[] = [
    { label: "Magasin — cartons", type: "entrepot" },
    { label: "Étagères DAF", type: "emplacement" },
    { label: "Salon / exposition", type: "emplacement" },
    { label: "Bureau DAF", type: "emplacement" },
    { label: "Direction générale", type: "emplacement" },
    { label: "Stock commerciaux", type: "depot_vente" },
  ];
  for (const zone of stockZones) {
    const existing = await prisma.stockLocation.findFirst({ where: { label: zone.label } });
    if (!existing) await prisma.stockLocation.create({ data: { type: zone.type, label: zone.label } });
  }

  // Commercial, distribution et ventes (Ch. 17) — la validation d'une
  // remise hors grille ou du déblocage d'un encours dépassé reste réservée
  // à la Direction générale (commercial:administration), même schéma que
  // printing:administration (Ch. 15).
  await grant("RESP_COMMERCIAL", ["commercial:consultation", "commercial:saisie", "commercial:validation"]);
  // Commercial simple : enregistre ses ventes et consulte SES performances, mais
  // ne voit ni le chiffre d'affaires global de l'entreprise, ni la performance des
  // autres commerciaux (pas de commercial:validation).
  await grant("COMMERCIAL", ["commercial:consultation", "commercial:saisie"]);
  await grant("RESP_FINANCE", ["commercial:consultation", "commercial:validation"]);
  await grant("DIR_GENERAL", ["commercial:consultation", "commercial:validation", "commercial:administration"]);

  // Finance et comptabilité (Ch. 18) — séparation des tâches (§18.11) : le
  // comptable saisit/valide au quotidien, la clôture de période et les
  // dépenses hors seuils restent réservées à la Direction générale.
  await grant("COMPTABLE", ["finance:consultation", "finance:saisie", "finance:validation"]);
  await grant("RESP_FINANCE", ["finance:consultation", "finance:saisie", "finance:validation", "finance:administration"]);
  await grant("DIR_GENERAL", ["finance:consultation", "finance:validation", "finance:administration"]);

  // Droits d'auteur — exécution financière (Ch. 9 §9.5, Ch. 18 §18.7).
  await grant("RESP_FINANCE", ["royalties:consultation", "royalties:saisie", "royalties:validation"]);
  await grant("COMPTABLE", ["royalties:consultation", "royalties:saisie"]);
  await grant("DIR_GENERAL", ["royalties:consultation", "royalties:validation"]);
  await grant("RESP_JURIDIQUE", ["royalties:consultation"]);

  // Seuil de délégation pour la validation finale des dépenses (Ch. 18
  // §18.11) : au-delà, la Direction générale doit valider en second — comme
  // purchase_order_delegation_threshold (Ch. 15 §15.3), valeur à confirmer.
  await prisma.setting.upsert({
    where: { key: "expense_dg_validation_threshold" },
    update: {},
    create: { key: "expense_dg_validation_threshold", value: 500_000 },
  });

  // Ressources humaines (Ch. 19) — le dossier RH est **réservé au responsable
  // RH et à la Direction générale** (§19.2, même exigence de confidentialité que
  // le juridique). Décision opérateur (19/07/2026) : on cloisonne — un
  // responsable de service (commercial, infographie, qualité, impression,
  // juridique) ne voit PAS le module RH. On revient donc sur l'élargissement
  // §19.4 précédemment appliqué (dérogation signalée, cf. JOURNAL_TECHNIQUE).
  const managementRoles = [
    "DIR_GENERAL",
    "DIR_EDITORIAL",
    "RESP_FINANCE",
    "RESP_COMMERCIAL",
    "RESP_INFOGRAPHIE",
    "RESP_JURIDIQUE",
    "RESP_QUALITE",
    "RESP_IMPRESSION",
    "RESP_RH",
  ];
  const hrConsultRoles = ["DIR_GENERAL", "RESP_RH"];
  for (const roleCode of managementRoles) {
    if (hrConsultRoles.includes(roleCode)) await grant(roleCode, ["rh:consultation"]);
    else await revoke(roleCode, ["rh:consultation"]); // corrige les bases déjà semées
  }
  await grant("RESP_RH", ["rh:saisie", "rh:validation", "rh:administration", "rh_confidentiel:consultation", "rh_confidentiel:saisie"]);
  await grant("DIR_GENERAL", ["rh:saisie", "rh:validation", "rh:administration", "rh_confidentiel:consultation", "rh_confidentiel:saisie"]);

  // Gestion des comptes et des rôles (Ch. 2 §2.4, Ch. 19 §19.3-19.4) — accès
  // « Utilisateurs & rôles ». Décision opérateur (30/07/2026) : cet accès n'est
  // PAS accordé d'office à la fonction RH ; il reste réservé à la Direction
  // générale (et à l'administrateur général, qui a tout), l'administrateur
  // pouvant l'attribuer explicitement à un autre profil via « Droits & pôles ».
  await revoke("RESP_RH", ["users:administration"]); // retire l'accès donné par erreur sur les bases existantes
  await grant("DIR_GENERAL", ["users:administration"]);

  // Direction générale et pilotage intelligent (Ch. 5) : tableau de bord
  // consolidé, recherche, alertes, recommandations — les indicateurs
  // financiers restent en outre soumis à finance:consultation (§5.2, §18).
  await grant("DIR_GENERAL", ["direction:consultation", "pilotage:consultation", "pilotage:saisie", "pilotage:administration"]);
  await grant("DIR_EDITORIAL", ["direction:consultation", "pilotage:consultation", "pilotage:saisie"]);
  await grant("RESP_FINANCE", ["direction:consultation", "pilotage:consultation", "pilotage:saisie"]);

  // Rapports, dictionnaire d'indicateurs, explorateur (Ch. 20) : outil de
  // pilotage réservé aux profils de direction / supervision. Décision opérateur
  // (19/07/2026) : les responsables opérationnels (commercial, infographie,
  // qualité, impression, juridique) n'y ont plus accès (cloisonnement).
  const reportRoles = ["DIR_GENERAL", "DIR_EDITORIAL", "RESP_FINANCE", "RESP_RH"];
  for (const roleCode of managementRoles) {
    if (reportRoles.includes(roleCode)) await grant(roleCode, ["rapports:consultation"]);
    else await revoke(roleCode, ["rapports:consultation"]); // corrige les bases déjà semées
  }
  await grant("DIR_GENERAL", ["rapports:saisie", "rapports:administration"]);
  await grant("RESP_RH", ["rapports:saisie"]);

  // Module « Présences & Temps de travail » (évolution). Chaque employé consulte
  // SES propres présences (consultation, périmètre borné à soi côté serveur) ;
  // le Responsable RH administre et valide ; la Direction générale supervise ;
  // les chefs de département valident les anomalies de leur pôle (incrément 4).
  for (const [roleCode] of roleByCode) {
    if (roleCode === "ADMIN_GENERAL") continue;
    await grant(roleCode, ["presences:consultation"]);
  }
  await grant("RESP_RH", ["presences:saisie", "presences:validation", "presences:administration"]);
  await grant("DIR_GENERAL", ["presences:validation", "presences:administration"]);
  await grant("CHEF_DEPARTEMENT", ["presences:validation"]);

  // Horaire officiel par défaut de la maison (§9 : 08:30-18:00, pause 12h-13h,
  // lundi→vendredi). Idempotent : créé seulement s'il n'existe aucun horaire
  // maison. Modifiable ensuite depuis RH → Paramètres → Horaires de travail.
  const existingCompanySchedule = await prisma.workSchedule.findFirst({ where: { scope: "company", deletedAt: null } });
  if (!existingCompanySchedule) {
    await prisma.workSchedule.create({
      data: {
        scope: "company",
        dayStartMin: 8 * 60 + 30,
        lunchStartMin: 12 * 60,
        lunchEndMin: 13 * 60,
        dayEndMin: 18 * 60,
        workingDays: "1,2,3,4,5",
        label: "Horaire officiel (défaut maison)",
      },
    });
  }

  // Règle de retenue par défaut (§21 : 500 FCFA / demi-heure, 1000 FCFA / heure ;
  // méthode « prorata exact » par défaut, la plus transparente — modifiable).
  // Idempotent : créée seulement si aucune règle n'existe.
  const existingDeductionRule = await prisma.deductionRule.findFirst();
  if (!existingDeductionRule) {
    await prisma.deductionRule.create({
      data: { perHalfHour: 500, perHour: 1000, method: "prorata", label: "Règle par défaut" },
    });
  }

  // Niveaux du circuit de validation des présences (§25-26). Défaut : chef de
  // service (grand pôle) et RH obligatoires, RAF facultatif, DG obligatoire.
  const validationLevels = [
    { code: "chef", label: "Chef de service", position: 1, mode: "obligatoire" as const },
    { code: "rh", label: "Responsable RH", position: 2, mode: "obligatoire" as const },
    { code: "raf", label: "Responsable administratif et financier", position: 3, mode: "facultatif" as const },
    { code: "dg", label: "Directeur général", position: 4, mode: "obligatoire" as const },
  ];
  for (const lvl of validationLevels) {
    await prisma.attendanceValidationLevel.upsert({ where: { code: lvl.code }, update: {}, create: lvl });
  }

  // Seuils de détection d'anomalies (§19), paramétrables.
  await prisma.setting.upsert({ where: { key: "presence_anomaly_late_minutes" }, update: {}, create: { key: "presence_anomaly_late_minutes", value: 15 } });
  await prisma.setting.upsert({ where: { key: "presence_anomaly_early_minutes" }, update: {}, create: { key: "presence_anomaly_early_minutes", value: 15 } });

  // Rubriques de paie prises en compte (§29), activables Oui/Non. Par défaut,
  // seules celles que le module calcule sont actives (heures travaillées,
  // absences, retenues, heures sup) ; les autres sont des repères que le
  // gestionnaire de paie active s'il les alimente lui-même.
  const payrollRubrics = [
    { code: "heures_travaillees", label: "Heures travaillées", enabled: true, sortOrder: 10 },
    { code: "retards", label: "Retards", enabled: true, sortOrder: 20 },
    { code: "departs_anticipes", label: "Départs anticipés", enabled: true, sortOrder: 30 },
    { code: "absences", label: "Absences", enabled: true, sortOrder: 40 },
    { code: "retenues", label: "Retenues", enabled: true, sortOrder: 50 },
    { code: "heures_supplementaires", label: "Heures supplémentaires", enabled: true, sortOrder: 60 },
    { code: "primes", label: "Primes", enabled: false, sortOrder: 70 },
    { code: "conges", label: "Congés", enabled: false, sortOrder: 80 },
    { code: "permissions", label: "Permissions", enabled: false, sortOrder: 90 },
    { code: "missions", label: "Missions", enabled: false, sortOrder: 100 },
    { code: "recuperations", label: "Récupérations", enabled: false, sortOrder: 110 },
    { code: "ajustements_manuels", label: "Ajustements manuels", enabled: false, sortOrder: 120 },
  ];
  for (const r of payrollRubrics) {
    await prisma.attendancePayrollRubric.upsert({ where: { code: r.code }, update: {}, create: r });
  }

  // Mode d'intégration à la paie (§28) : « manuel » par défaut (le gestionnaire
  // sélectionne les rubriques avant calcul), commutable en « auto ».
  await prisma.setting.upsert({ where: { key: "attendance_payroll_mode" }, update: {}, create: { key: "attendance_payroll_mode", value: "manuel" } });

  // Retenue des ABSENCES pleine journée sur la paie — DÉSACTIVÉE par défaut
  // (décision opérateur RH du 30/07/2026). La présence repose aujourd'hui sur la
  // connexion Eclospace, information trop peu fiable pour retenir sur le salaire :
  // la rubrique « Absences » sert au SUIVI, pas au calcul automatique. À réactiver
  // (valeur true) le jour où la maison dispose d'un vrai pointeur / registre de
  // présence. NB : les retards / départs anticipés / interruptions issus d'un
  // pointage réel restent, eux, retenables — ce réglage ne concerne que l'absence
  // pleine journée. `update: {}` : idempotent, ne réécrit jamais un choix opérateur.
  await prisma.setting.upsert({ where: { key: "presences.deduct_absences" }, update: {}, create: { key: "presences.deduct_absences", value: false } });

  // Module Paie natif (D-007) : permissions par rôle + interrupteur oui/non.
  await grant("RESP_FINANCE", ["paie:consultation", "paie:saisie", "paie:validation", "paie:administration"]);
  // Décision opérateur (31/07/2026) : le Responsable RH gère la paie de bout en
  // bout — consultation, saisie, validation ET administration.
  await grant("RESP_RH", ["paie:consultation", "paie:saisie", "paie:validation", "paie:administration"]);
  await grant("DIR_GENERAL", ["paie:consultation", "paie:validation", "paie:administration"]);

  // Internalisation de la paie DÉSACTIVÉE par défaut (D-007) : tant qu'elle est
  // « non », l'export externe (D-003) reste le mode par défaut.
  await prisma.setting.upsert({ where: { key: "payroll_internal_enabled" }, update: {}, create: { key: "payroll_internal_enabled", value: "false" } });

  // Barème légal camerounais initial, repris du classeur (docs/paie/), version
  // 2019-01-01. Idempotent : créé seulement si aucun barème n'existe.
  const existingRateSet = await prisma.payrollRateSet.findFirst();
  if (!existingRateSet) {
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2019-01-01T00:00:00.000Z"),
        label: "Barème 2019 (repris du moteur Excel)",
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });
  }

  // Formules de calcul modifiables par le RH (D-007). On sème l'expression PAR
  // DÉFAUT de chaque élément « à formule » avec custom=false : le moteur applique
  // alors son calcul codé en dur (comportement identique). Le RH peut ensuite
  // personnaliser une formule (avec motif) sans toucher au code. Idempotent :
  // on n'écrase JAMAIS une formule déjà personnalisée par le RH.
  for (const def of FORMULA_DEFS) {
    await prisma.payrollFormula.upsert({
      where: { code: def.code },
      update: { label: def.label }, // ne touche ni expression ni custom (respecte les personnalisations)
      create: { code: def.code, label: def.label, expression: def.defaultExpression, custom: false },
    });
  }

  // Règles par défaut du centre de pilotage intelligent (Ch. 5 §5.9, Ch. 20
  // §20.6) — seuils repris des exemples du cahier des charges, à ajuster par
  // la Direction générale (§5.9 : "définies par l'administrateur avec la direction").
  const smartRules = [
    {
      code: "manuscrits_bloques",
      label: "Manuscrits bloqués",
      description: "Manuscrits sans validation d'étape depuis plus de N jours.",
      params: { blocked_days_threshold: 10 },
      priority: "moyenne" as const,
    },
    {
      code: "stock_seuil_proche",
      label: "Stock proche du seuil d'alerte",
      // Ch. 16
      description: "Projection de rupture au rythme de vente courant.",
      params: { projection_days: 7 },
      priority: "moyenne" as const,
    },
    {
      code: "depassement_budget",
      label: "Dépassement budgétaire",
      description: "Coût réel d'un poste budgétaire dépassant le prévisionnel de N %.",
      params: { variance_pct_threshold: 15 },
      priority: "elevee" as const,
    },
  ];
  for (const rule of smartRules) {
    await prisma.smartRule.upsert({
      where: { code: rule.code },
      update: {},
      create: rule,
    });
  }

  // Dictionnaire des indicateurs (Ch. 20 §20.2) : définition et formule
  // documentées pour chaque indicateur diffusé — cf. lib/kpi.ts.
  const kpiDefinitions = [
    {
      code: "manuscripts_by_status",
      label: "Manuscrits par statut",
      definition: "Répartition des manuscrits actifs selon leur étape courante du workflow éditorial.",
      formula: "COUNT(manuscripts) GROUP BY statut courant, statut non supprimé.",
    },
    {
      code: "on_time_rate_pct",
      label: "Taux de respect des délais",
      definition: "Part des tâches terminées dans les délais prévus, parmi les tâches terminées ayant une échéance planifiée.",
      formula: "COUNT(tâches terminées où date réelle de fin <= date planifiée de fin) / COUNT(tâches terminées avec échéance planifiée) × 100.",
    },
    {
      code: "revenue_total",
      label: "Chiffre d'affaires net",
      definition: "Ventes nettes toutes factures confondues, avoirs déduits.",
      formula: "SUM(invoice_lines.line_total × signe) où signe = -1 pour un avoir, +1 pour une facture.",
    },
    {
      code: "royalties_due",
      label: "Droits d'auteur à payer",
      definition: "Somme des soldes dus sur les relevés de droits d'auteur émis et non réglés.",
      formula: "SUM(royalty_statements.balance_due) WHERE status = 'issued'.",
    },
    {
      code: "treasury_position",
      label: "Situation de trésorerie",
      definition: "Position de trésorerie cumulée, tous comptes et caisses confondus.",
      formula: "SUM(payments.amount WHERE direction = 'in') − SUM(payments.amount WHERE direction = 'out').",
    },
  ];
  for (const kpi of kpiDefinitions) {
    await prisma.kpiDefinition.upsert({
      where: { code: kpi.code },
      update: { label: kpi.label, definition: kpi.definition, formula: kpi.formula },
      create: kpi,
    });
  }

  // Bibliothèque de rapports standards (Ch. 20 §20.3), un par domaine.
  const reports = [
    { key: "editorial_flow", label: "Flux des manuscrits", domain: "editorial" as const, description: "Reçus, acceptés, refusés par genre et période." },
    { key: "production_delays", label: "Délais de production par étape", domain: "production" as const, description: "Durée moyenne réalisée par étape du workflow." },
    { key: "commercial_sales", label: "Ventes par canal", domain: "commercial" as const, description: "Unités et chiffre d'affaires par canal de distribution." },
    { key: "financial_margins", label: "Marges par ouvrage", domain: "financier" as const, description: "Coût, ventes nettes et marge par ouvrage ; titres sous leur point d'équilibre." },
    { key: "rh_workload", label: "Charge par département", domain: "rh" as const, description: "Effectif et tâches ouvertes/en retard par département." },
  ];
  for (const report of reports) {
    await prisma.report.upsert({ where: { key: report.key }, update: {}, create: report });
  }

  // Référentiel des étapes du workflow (Ch. 4 §4.3).
  for (const status of workflowStatuses) {
    await prisma.workflowStatus.upsert({
      where: { code: status.code },
      update: {
        label: status.label,
        stepOrder: status.stepOrder,
        departmentId: departmentByCode.get(status.departmentCode),
        isConditional: status.isConditional ?? false,
      },
      create: {
        code: status.code,
        label: status.label,
        stepOrder: status.stepOrder,
        departmentId: departmentByCode.get(status.departmentCode),
        isConditional: status.isConditional ?? false,
      },
    });
  }

  // Référentiel des genres (Ch. 6 §6.2). Les genres actifs sont ré-activés
  // (deletedAt = null) au cas où ils auraient été retirés puis réintroduits.
  for (const genre of genres) {
    await prisma.genre.upsert({ where: { code: genre.code }, update: { label: genre.label, deletedAt: null }, create: genre });
  }
  // Domaines retirés de la ligne (ex. Spiritualité) : suppression logique. Les
  // critères de grille qui leur seraient propres sont désactivés du même coup.
  for (const code of retiredGenreCodes) {
    const g = await prisma.genre.findFirst({ where: { code, deletedAt: null } });
    if (!g) continue;
    await prisma.evaluationCriterion.updateMany({ where: { genreId: g.id, isActive: true }, data: { isActive: false } });
    await prisma.genre.update({ where: { id: g.id }, data: { deletedAt: new Date(), collectionId: null } });
  }

  // Référentiel des collections (D-025). Les ouvrages du catalogue général y
  // sont rattachés plus bas (collectionId), d'après leur collection d'origine.
  for (const collection of collections) {
    await prisma.collection.upsert({
      where: { code: collection.code },
      update: { label: collection.label, deletedAt: null },
      create: collection,
    });
  }
  // Retrait des anciennes collections (D-024) remplacées par les 3 officielles :
  // suppression logique uniquement (contrainte d'intégrité §13). Les ouvrages qui
  // y étaient rattachés sont ré-affectés plus bas aux nouvelles collections.
  for (const code of retiredCollectionCodes) {
    await prisma.collection.updateMany({
      where: { code, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
  // Rattachement domaine → collection (tableau officiel D-025), « côté domaine ».
  {
    const collByCode = new Map(
      (await prisma.collection.findMany({ where: { deletedAt: null }, select: { id: true, code: true } })).map((c) => [c.code, c.id]),
    );
    for (const [genreCode, collCode] of Object.entries(genreCollectionByCode)) {
      const collectionId = collByCode.get(collCode);
      if (!collectionId) continue;
      await prisma.genre.updateMany({ where: { code: genreCode }, data: { collectionId } });
    }
  }

  // Bibliothèque de prompts IA (Lot IA-0). Ces prompts sont ÉDITABLES ensuite
  // dans l'ERP (Paramètres) ; on ne fait que poser des valeurs de départ. Règle
  // d'or commune : l'IA écrit AU NOM du relecteur d'Éclosion Édition, ne dit
  // jamais qu'elle est une IA, et remplit la structure imposée sans l'inventer.
  // `upsert` avec `update: {}` : on ne PIÉTINE PAS les modifications de
  // l'opérateur au re-seed ; on ne crée que ce qui manque.
  const REGLE_DOR =
    "Tu rédiges au nom du Service de relecture d'Éclosion Édition. Tu ne mentionnes JAMAIS que tu es une intelligence artificielle ni aucun outil ; tu écris comme le relecteur professionnel de la maison, en français sobre et professionnel, sous l'en-tête « ÉCLOSION ÉDITION ». Tu remplis EXACTEMENT la structure de rapport fournie, sans ajouter ni retirer de rubrique. Tu écris une prose NATURELLE et argumentée, JAMAIS de façon mécanique ou répétitive : pas de formules automatiques, pas de tournures qui restituent bêtement le barème. La « recommandation spéciale de l'éditeur » éventuelle est une consigne prioritaire. Tu n'es qu'un avis de relecteur : tu ne prends aucune décision éditoriale.";
  const aiPrompts: {
    workType: "evaluation" | "correction_1" | "correction_2" | "couverture" | "expertise" | "reecriture";
    label: string;
    systemPrompt: string;
    userTemplate: string;
    reportTemplate: unknown;
  }[] = [
    {
      workType: "evaluation",
      label: "Rapport d'évaluation (Comité de lecture)",
      systemPrompt:
        REGLE_DOR +
        " Pour le critère « Adéquation avec la ligne éditoriale », tu procèdes ainsi, sans t'en écarter : (1) tu identifies le DOMAINE et la COLLECTION déclarés du manuscrit ; (2) tu juges l'adéquation UNIQUEMENT contre la CHARTE de cette collection (fournie ci-dessous) — il suffit que l'ouvrage relève d'UN des domaines de sa collection pour être adéquat ; (3) note haute s'il colle nettement à sa collection ; note moyenne s'il est hybride ou à la lisière (tu précises alors le meilleur rattachement) ; note basse SEULEMENT s'il ne relève d'AUCUNE des trois collections. INTERDITS ABSOLUS : ne compare JAMAIS l'ouvrage à des domaines ou collections qu'il n'a pas revendiqués et n'énumère pas ceux auxquels il n'appartient pas ; n'exige JAMAIS qu'il couvre plusieurs domaines de sa collection (une collection regroupe plusieurs lignes distinctes, l'ouvrage n'en vise qu'une). Tu respectes la règle transversale thème/doctrine fournie ci-dessous. La grille (critères, coefficients) est celle de la maison ; tu ne la modifies pas.",
      userTemplate:
        "Ligne éditoriale d'Éclosion Édition (chartes des collections) :\n{{domaines_collections}}\n\nOuvrage soumis — titre : {{titre}} · auteur : {{auteur}} · domaine/collection déclaré : {{domaine}}.\nRecommandation spéciale de l'éditeur : {{recommandation_editeur}}\n\nManuscrit à évaluer :\n{{manuscrit}}",
      reportTemplate: {
        title: "RAPPORT D'ÉVALUATION DE MANUSCRIT",
        sections: [
          { key: "A", title: "Identification du manuscrit (titre · auteur · domaine déclaré · collection déclarée · longueur estimée · état du manuscrit · date du rapport · relecteur : Comité de lecture)" },
          { key: "B", title: "Synthèse générale (sujet, intrigue, intention, positionnement éditorial)" },
          { key: "C", title: "Grille d'évaluation (critère · coefficient · note /10 · commentaire argumenté)" },
          { key: "D", title: "Calcul du score global" },
          { key: "E", title: "Analyse qualitative" },
          { key: "F", title: "Analyse structurelle" },
          { key: "G", title: "Points forts" },
          { key: "H", title: "Points à améliorer (localisation · gravité · recommandation)" },
          { key: "I", title: "Points de vigilance éditoriaux" },
          { key: "J", title: "Vérification des métadonnées" },
          { key: "K", title: "Recommandation du relecteur" },
          { key: "L", title: "Conditions éventuelles" },
          { key: "M", title: "Avis final du relecteur" },
        ],
        guidance:
          "Ce document est un RAPPORT D'ÉVALUATION (comité de lecture), et NON un rapport de correction : il ne contient AUCUNE annotation de type « texte original / correction proposée / explication », NI tableau de corrections. La rubrique A « Identification » est présentée en LISTE « Champ : valeur » (une ligne par élément : Titre, Auteur, Domaine déclaré, Collection déclarée, Longueur estimée, État du manuscrit, Date du rapport, Relecteur : Comité de lecture Éclosion Édition) — PAS de tableau étroit. Le SEUL tableau est la rubrique C « Grille d'évaluation » (Critère · Coefficient · Note /10 · Commentaire argumenté) : elle reprend EXACTEMENT les critères et coefficients de la grille officielle fournie (dont « Adéquation avec la ligne éditoriale d'Éclosion Édition », coefficient 3), sans en inventer ni en retirer ; le score global (rubrique D) = Σ(note × coefficient) / Σ(coefficients). Le « Commentaire argumenté » de chaque ligne de la grille est une PROSE d'analyse qui justifie l'appréciation ; il NE restitue JAMAIS la note de façon mécanique (proscris « Note élevée. », « Note faible. », « Bonne note », « Note : X » et toute mention chiffrée de la note en fin de commentaire — la note figure déjà dans sa colonne). Les rubriques H (points à améliorer), I (points de vigilance) et J (vérification des métadonnées) sont des LISTES À PUCES rédigées — pour H : « Point — Localisation — Gravité (mineur/modéré/important/critique) — Recommandation » ; pour I : « Type de risque — Passage concerné — Recommandation » ; pour J : « Élément — Statut (Conforme / Incohérence) — Observation ». La rubrique K énumère les options de recommandation puis indique l'option retenue et sa justification. La recommandation DOIT être COHÉRENTE avec le score global (D) : si elle diverge nettement du score (ex. score correct mais refus), tu justifies EXPLICITEMENT le motif bloquant — le plus souvent une adéquation faible avec la ligne éditoriale (coefficient le plus fort) ou un point de vigilance rédhibitoire. Les autres rubriques sont rédigées en prose (sous-parties en gras).",
        footer: "Ce rapport constitue un avis argumenté de relecteur et ne représente pas une décision éditoriale finale.",
      },
    },
    {
      workType: "correction_1",
      label: "Relecture BAT1 (Correction éditoriale)",
      systemPrompt:
        REGLE_DOR +
        " Tu produis le RAPPORT DE RELECTURE — BAT1 (premier passage de correction éditoriale) selon le modèle officiel Éclosion, et les annotations permettant d'obtenir le manuscrit corrigé BAT1." +
        " La grille de notation compte EXACTEMENT 7 critères notés chacun /20 : Richesse du contenu et pertinence thématique ; Cohérence et progression argumentative ; Qualité syntaxique et grammaticale ; Maîtrise de l'orthographe et de l'accord ; Ponctuation et typographie ; Rigueur des références et notes de bas de page ; Clarté et fluidité de la lecture. La NOTE GLOBALE est la somme des 7 notes (sur 140), ramenée sur 100." +
        " Chaque annotation de correction précise : n° (numérotation continue) · page RÉELLE du manuscrit · catégorie et sévérité · TEXTE ORIGINAL cité EXACTEMENT (la citation du passage fautif, jamais un simple numéro de page) · correction proposée · explication. Catégories : Orthographe · Accord · Syntaxe · Ponctuation · Typographie · Style (combinables, ex. « Accord+Syntaxe »). Sévérité : C1 mineure · C2 modérée · C3 majeure. Les annotations sont classées par ordre d'apparition dans le texte.",
      userTemplate:
        "Recommandation spéciale de l'éditeur : {{recommandation_editeur}}\n\nManuscrit à relire (BAT1 — premier passage) :\n{{manuscrit}}",
      reportTemplate: {
        title: "RAPPORT DE RELECTURE — BAT1 (Correction éditoriale)",
        sections: [
          { key: "0", title: "Informations sur le document (titre · auteur(e) · éditeur · format : pages/chapitres · ISBN · type de document · niveau de relecture · étape : BAT1 · pagination de référence)" },
          { key: "1", title: "Évaluation globale (verdict synthétique · synthèse de 2 à 4 phrases · grille de notation : 7 critères notés /20 · NOTE GLOBALE somme sur 140 ramenée sur 100)" },
          { key: "2", title: "Points forts de l'œuvre" },
          { key: "3", title: "Annotations de correction (n° · page · catégorie + sévérité · texte original cité exactement · correction proposée · explication)" },
          { key: "4", title: "Observations structurelles et stylistiques" },
          { key: "5", title: "Corrections prioritaires avant publication (Priorité 1 urgente/bloquante · Priorité 2 importante · Priorité 3 recommandée)" },
          { key: "6", title: "Recommandations éditoriales générales" },
          { key: "7", title: "Conclusion et verdict" },
        ],
        guidance:
          "Rapport de RELECTURE BAT1 (modèle officiel Éclosion). Rubrique 1 : la grille de notation est un TABLEAU à deux colonnes (CRITÈRE · NOTE) avec les 7 critères notés /20, suivie d'une ligne NOTE GLOBALE (somme /140 ramenée sur 100). Rubrique 3 : les annotations de correction forment un TABLEAU à 6 colonnes (N° · Page · Catégorie · Texte original (citation exacte) · Correction proposée · Explication) ; « Texte original » cite TOUJOURS le passage fautif exact, jamais un numéro de page ; « Page » est la page réelle ; numérotation continue ; catégories Orthographe/Accord/Syntaxe/Ponctuation/Typographie/Style ; sévérité C1/C2/C3 indiquée dans la catégorie (ex. « Accord (C1) »). Rubrique 5 : trois blocs Priorité 1/2/3. Les rubriques 0, 2, 4, 6, 7 sont rédigées en prose et listes. La rubrique « Informations sur le document » (identification) est présentée en LISTE « Champ : valeur », une ligne par élément, jamais un tableau à colonnes étroites.",
        deliverables: ["Rapport_relecture_BAT1", "Manuscrit_corrige_BAT1"],
      },
    },
    {
      workType: "correction_2",
      label: "Relecture BAT2 (Correction éditoriale)",
      systemPrompt:
        REGLE_DOR +
        " Tu produis le RAPPORT DE RELECTURE — BAT2 (deuxième passage) selon le modèle officiel Éclosion. Sa particularité est la rubrique « SUIVI DES CORRECTIONS DU BAT PRÉCÉDENT » : tu reprends CHAQUE correction demandée au BAT1 et tu indiques son statut — ✔ appliquée · ✘ non appliquée · ~ partiellement appliquée — avec une observation (page à l'appui), puis tu signales les améliorations apportées par l'auteur(e) depuis le BAT précédent. Si tu ne disposes pas du détail des demandes du BAT1, tu le signales explicitement et tu déduis le suivi des corrections encore visibles." +
        " La grille de notation compte EXACTEMENT 7 critères notés chacun /20 (Richesse du contenu et pertinence thématique ; Cohérence et progression argumentative ; Qualité syntaxique et grammaticale ; Maîtrise de l'orthographe et de l'accord ; Ponctuation et typographie ; Rigueur des références et notes de bas de page ; Clarté et fluidité de la lecture) ; la NOTE GLOBALE est la somme (sur 140) ramenée sur 100." +
        " Chaque annotation de correction précise : n° (numérotation continue) · page réelle · catégorie et sévérité · TEXTE ORIGINAL cité exactement · correction proposée · explication. Catégories : Orthographe · Accord · Syntaxe · Ponctuation · Typographie · Style. Sévérité : C1 mineure · C2 modérée · C3 majeure. Annotations classées par ordre d'apparition.",
      userTemplate:
        "Recommandation spéciale de l'éditeur : {{recommandation_editeur}}\n\nManuscrit après BAT1 (à contrôler pour BAT2) :\n{{manuscrit}}",
      reportTemplate: {
        title: "RAPPORT DE RELECTURE — BAT2 (Correction éditoriale)",
        sections: [
          { key: "0", title: "Informations sur le document (titre · auteur(e) · éditeur · format · ISBN · type de document · niveau de relecture · étape : BAT2 · pagination de référence)" },
          { key: "1", title: "Évaluation globale (verdict synthétique · synthèse de 2 à 4 phrases · grille de notation : 7 critères notés /20 · NOTE GLOBALE somme sur 140 ramenée sur 100)" },
          { key: "2", title: "Suivi des corrections du BAT précédent (tableau : N° (BAT1) · correction demandée · statut ✔ appliquée / ✘ non appliquée / ~ partielle · observation) + améliorations apportées par l'auteur(e) depuis le BAT précédent" },
          { key: "3", title: "Points forts de l'œuvre" },
          { key: "4", title: "Annotations de correction (n° · page · catégorie + sévérité · texte original cité exactement · correction proposée · explication)" },
          { key: "5", title: "Observations structurelles et stylistiques" },
          { key: "6", title: "Corrections prioritaires avant publication (Priorité 1 urgente/bloquante · Priorité 2 importante · Priorité 3 recommandée)" },
          { key: "7", title: "Recommandations éditoriales générales" },
          { key: "8", title: "Conclusion et verdict" },
        ],
        guidance:
          "Rapport de RELECTURE BAT2 (modèle officiel Éclosion). Rubrique 1 : grille en TABLEAU (CRITÈRE · NOTE) avec les 7 critères notés /20 + ligne NOTE GLOBALE (somme /140 ramenée sur 100). Rubrique 2 « Suivi des corrections du BAT précédent » : TABLEAU à 4 colonnes (N° (BAT1) · Correction demandée · Statut ✔/✘/~ · Observation), puis une liste des améliorations apportées par l'auteur(e). Rubrique 4 : annotations en TABLEAU à 6 colonnes (N° · Page · Catégorie · Texte original (citation exacte) · Correction proposée · Explication), mêmes règles qu'au BAT1 (citation exacte, page réelle, numérotation continue, sévérité C1/C2/C3). Rubrique 6 : blocs Priorité 1/2/3. Les rubriques 0, 3, 5, 7, 8 sont en prose et listes. La rubrique « Informations sur le document » (identification) est présentée en LISTE « Champ : valeur », une ligne par élément, jamais un tableau à colonnes étroites.",
        deliverables: ["Rapport_relecture_BAT2", "Manuscrit_corrige_BAT2"],
      },
    },
    {
      workType: "couverture",
      label: "Relecture de couverture (BAT1 / BAT2)",
      systemPrompt:
        REGLE_DOR +
        " Tu relis la couverture (1ʳᵉ, dos, 4ᵉ) — c'est le volet couverture du BAT. Tu vérifies impérativement la COHÉRENCE couverture ↔ intérieur (titre, sous-titre, auteur, collection) et l'ISBN. Tu produis les annotations (zone · élément · original · correction · explication) et un verdict de publication." +
        " Distingue le passage : au 1ᵉʳ passage (BAT1) il n'y a pas de suivi ; à partir du 2ᵉ passage (BAT2), tu VÉRIFIES si les corrections demandées au BAT précédent ont été INTÉGRÉES (statut ✔ intégrée / ✘ non intégrée / ~ partielle, avec observation), tu signales CE QUI MANQUE encore, et tu APPRÉCIES les améliorations apportées par l'auteur(e). Si tu ne disposes pas du détail des demandes du BAT précédent, tu le signales et tu déduis le suivi à partir de la couverture elle-même.",
      userTemplate:
        "Recommandation spéciale de l'éditeur : {{recommandation_editeur}}\n\nTextes de couverture / fichier de couverture à relire :\n{{manuscrit}}",
      reportTemplate: {
        title: "RAPPORT DE RELECTURE DE COUVERTURE (BAT)",
        sections: [
          { key: "0", title: "Identification (titre, sous-titre, auteur, ISBN couverture, éditeur/collection, fichier analysé, étape : BAT1 ou BAT2, date)" },
          { key: "1", title: "Synthèse et grille de notation (note globale pondérée /20)" },
          { key: "2", title: "Suivi des corrections du BAT précédent (au BAT2 : intégrations effectuées ✔/✘/~ · ce qui manque · améliorations apportées par l'auteur ; au BAT1 : indiquer « premier passage, pas de suivi »)" },
          { key: "3", title: "Analyse par zone (1ʳᵉ de couverture · dos · 4ᵉ de couverture)" },
          { key: "4", title: "Vérifications factuelles (ISBN, code-barres EAN, cohérence couverture ↔ intérieur, mentions)" },
          { key: "5", title: "Tableau d'annotations (sévérité · zone/emplacement · constat · recommandation)" },
          { key: "6", title: "Verdict de publication" },
        ],
        guidance:
          "Rapport de RELECTURE DE COUVERTURE (volet couverture du BAT). Rubrique 1 : grille de notation en TABLEAU (Critère · Note /20 · Observations) + note globale pondérée /20. Rubrique 2 « Suivi des corrections du BAT précédent » : au BAT2, un TABLEAU (N° (BAT précédent) · Correction demandée · Statut ✔ intégrée / ✘ non intégrée / ~ partielle · Observation) suivi de « Ce qui manque » et des « Améliorations apportées par l'auteur(e) » ; au BAT1, indiquer simplement « Premier passage — pas de suivi ». Rubrique 5 « Tableau d'annotations » : TABLEAU (Sévérité C1/C2/C3 · Zone/emplacement · Constat · Recommandation). Rubriques 0, 3, 4, 6 en prose et listes (vérifications factuelles de la rubrique 4 en liste : ISBN, code-barres EAN, cohérence couverture ↔ intérieur). La rubrique « Informations sur le document » (identification) est présentée en LISTE « Champ : valeur », une ligne par élément, jamais un tableau à colonnes étroites.",
        deliverables: ["Rapport_couverture"],
      },
    },
    {
      workType: "expertise",
      label: "Expertise scientifique",
      systemPrompt:
        REGLE_DOR +
        " Tu produis une EXPERTISE SCIENTIFIQUE du document, au nom du Service d'expertise d'Éclosion Édition. Tu analyses selon une grille en 18 points : (1) Pertinence du sujet ; (2) Clarté de la problématique ; (3) Cohérence des objectifs ; (4) Cohérence des hypothèses lorsqu'elles existent ; (5) Pertinence de la méthodologie ; (6) Cohérence entre méthode et objectifs ; (7) Qualité du raisonnement ; (8) Cohérence des arguments ; (9) Qualité des résultats ; (10) Cohérence des conclusions ; (11) Qualité des références ; (12) Actualité des références lorsque cela peut être déterminé ; (13) Cohérence des citations ; (14) Présence d'affirmations insuffisamment étayées ; (15) Contradictions internes ; (16) Lacunes ; (17) Limites scientifiques ; (18) Suggestions d'amélioration." +
        " Pour chaque problème relevé, tu distingues EXPLICITEMENT quatre niveaux : CONSTAT (ce qui est observé) · PROBLÈME (ce qui pose difficulté) · EXPLICATION (pourquoi cela pose problème) · RECOMMANDATION (comment améliorer)." +
        " GARDE-FOU SUR LES SOURCES : tu n'inventes JAMAIS de référence bibliographique. Si une information ou une source ne peut être vérifiée, tu écris « Vérification nécessaire » et tu le signales dans le rapport. Tu ne présentes aucune source non vérifiable comme certaine." +
        " Le SCORE éventuel est une APPRÉCIATION ASSISTÉE PAR IA (Excellent · Très satisfaisant · Satisfaisant · À améliorer · Insuffisant), jamais une vérité scientifique absolue." +
        " La PROPOSITION D'AVIS (Favorable · Favorable sous réserves · À revoir · Défavorable) est présentée comme « Proposition d'avis générée avec assistance IA » avec ses motifs — ce n'est JAMAIS une décision définitive ni une validation d'expertise.",
      userTemplate:
        "Document soumis à expertise — titre : {{titre}} · auteur : {{auteur}} · domaine déclaré : {{domaine}}.\nConsigne particulière de l'éditeur (type/portée d'expertise, domaine scientifique, points à privilégier) : {{recommandation_editeur}}\n\nDocument à expertiser :\n{{manuscrit}}",
      reportTemplate: {
        title: "RAPPORT D'EXPERTISE SCIENTIFIQUE",
        sections: [
          { key: "A", title: "Identification (Éclosion Édition SARL · titre · auteur · référence du dossier · date · version analysée · type d'expertise · domaine scientifique)" },
          { key: "B", title: "Objet de l'expertise" },
          { key: "C", title: "Résumé de l'appréciation (avec appréciation assistée par IA : Excellent / Très satisfaisant / Satisfaisant / À améliorer / Insuffisant)" },
          { key: "D", title: "Points forts" },
          { key: "E", title: "Points faibles" },
          { key: "F", title: "Analyse détaillée (grille en 18 points : critère · appréciation · commentaire argumenté)" },
          { key: "G", title: "Problèmes identifiés (Constat · Problème · Explication · Recommandation)" },
          { key: "H", title: "Références et sources (cohérence, actualité, affirmations à étayer ; toute source non vérifiable est marquée « Vérification nécessaire »)" },
          { key: "I", title: "Recommandations" },
          { key: "J", title: "Conclusion" },
          { key: "K", title: "Proposition d'avis générée avec assistance IA (Favorable / Favorable sous réserves / À revoir / Défavorable) et ses motifs" },
        ],
        guidance:
          "Rapport d'EXPERTISE SCIENTIFIQUE. La rubrique A « Identification » est présentée en LISTE « Champ : valeur » (une ligne par élément), jamais en tableau étroit. La rubrique F « Analyse détaillée » est un TABLEAU reprenant EXACTEMENT les 18 points de la grille (N° · Critère · Appréciation · Commentaire argumenté) : le commentaire est une prose d'analyse, jamais une restitution mécanique de l'appréciation. La rubrique G « Problèmes identifiés » distingue systématiquement, pour chaque problème, les quatre niveaux Constat / Problème / Explication / Recommandation (une entrée par problème). La rubrique H signale toute source non vérifiable par « Vérification nécessaire » et n'invente AUCUNE référence. La rubrique K énonce la proposition d'avis EN LA PRÉSENTANT comme assistée par IA, avec ses motifs, sans jamais la présenter comme une décision ou une validation définitive. Les autres rubriques sont rédigées en prose et listes.",
        footer: "Rapport généré avec assistance IA — validation humaine requise. Ce document est une aide à la décision et ne constitue ni une expertise humaine signée ni une décision éditoriale finale.",
      },
    },
    {
      workType: "reecriture",
      label: "Réécriture éditoriale",
      systemPrompt:
        REGLE_DOR +
        " Tu produis le RAPPORT DE RÉÉCRITURE qui accompagne la version réécrite du document (la version réécrite elle-même est produite séparément). Tu interviens selon le TYPE demandé : correction linguistique (orthographe, grammaire, conjugaison, syntaxe, ponctuation, typographie) ; amélioration stylistique (fluidité, clarté, précision, vocabulaire, suppression des lourdeurs et des répétitions, transitions) ; réécriture approfondie (reformulation, structure des paragraphes, logique, cohérence argumentative, lisibilité) ; réécriture académique (rigueur du vocabulaire, précision, cohérence scientifique, articulation des idées, neutralité) ; réécriture professionnelle (documents destinés aux entreprises, institutions, bailleurs, administrations)." +
        " RÈGLE IMPÉRATIVE : tu PRÉSERVES AU MAXIMUM LA VOIX DE L'AUTEUR (ton, rythme, vocabulaire caractéristique) ; tu ne transformes jamais le texte en prose générique." +
        " Tu SIGNALES explicitement les passages où tu n'es pas certain (« intervention humaine nécessaire ») et les problèmes qui ne peuvent pas être corrigés automatiquement. La PROPOSITION D'AVIS ÉDITORIAL est présentée comme « Proposition générée avec assistance IA », jamais comme une décision.",
      userTemplate:
        "Document à réécrire — titre : {{titre}} · auteur : {{auteur}}.\nConsigne particulière de l'éditeur (type de réécriture, niveau de préservation de la voix, paragraphes ciblés) : {{recommandation_editeur}}\n\nDocument à réécrire :\n{{manuscrit}}",
      reportTemplate: {
        title: "RAPPORT DE RÉÉCRITURE",
        sections: [
          { key: "1", title: "Objet (document réécrit : titre · auteur · version · date)" },
          { key: "2", title: "Type de réécriture (correction linguistique / stylistique / approfondie / académique / professionnelle · niveau de préservation de la voix)" },
          { key: "3", title: "Principales interventions (corrections linguistiques · reformulations · améliorations stylistiques · améliorations structurelles · transitions · suppressions de répétitions)" },
          { key: "4", title: "Points nécessitant une intervention humaine (passages incertains signalés)" },
          { key: "5", title: "Observations éditoriales (problèmes non corrigeables automatiquement)" },
          { key: "6", title: "Résultat (résumé de la qualité de la version produite)" },
          { key: "7", title: "Proposition d'avis éditorial générée avec assistance IA (texte satisfaisant / corrections mineures recommandées / réécriture recommandée / restructuration nécessaire / intervention éditoriale approfondie recommandée)" },
        ],
        guidance:
          "Rapport de RÉÉCRITURE, qui accompagne la « Version réécrite (IA) » produite séparément. La rubrique 1 « Objet » est en LISTE « Champ : valeur ». La rubrique 3 « Principales interventions » est une liste à puces rédigée par catégorie d'intervention. La rubrique 4 énumère précisément les passages où l'IA n'est pas certaine (localisation + raison). La rubrique 5 signale les problèmes qui relèvent d'une décision éditoriale humaine. La rubrique 7 énonce la proposition d'avis EN LA PRÉSENTANT comme assistée par IA, jamais comme une décision. Le rapport ne réécrit pas le texte : il EXPLIQUE l'intervention (la version réécrite est un document distinct).",
        deliverables: ["Rapport_reecriture", "Version_reecrite"],
        footer: "Rapport généré avec assistance IA — validation humaine requise. La version réécrite est une proposition : elle ne remplace pas le document original, qui est conservé.",
      },
    },
  ];
  for (const p of aiPrompts) {
    await prisma.aiPrompt.upsert({
      where: { workType: p.workType },
      update: {}, // ne pas écraser les personnalisations de l'opérateur
      create: {
        workType: p.workType,
        label: p.label,
        systemPrompt: p.systemPrompt,
        userTemplate: p.userTemplate,
        reportTemplate: p.reportTemplate as object,
      },
    });
  }

  // Convergence des gabarits IA « par défaut » vers leur version canonique
  // (structure + consignes de forme à jour), SANS écraser une personnalisation
  // de l'opérateur : on ne met à jour un gabarit que si son titre est encore
  // l'un des titres par défaut connus (actuels ou historiques). Idempotent : la
  // mise à jour n'a lieu que si le contenu diffère réellement.
  const DEFAULT_TITLES: Record<string, string[]> = {
    evaluation: ["RAPPORT D'ÉVALUATION DE MANUSCRIT"],
    correction_1: ["RAPPORT DE RELECTURE PROFESSIONNELLE", "RAPPORT DE RELECTURE — BAT1 (Correction éditoriale)"],
    correction_2: ["RAPPORT DE 2ᵉ CORRECTION", "RAPPORT DE 2ᵉ CORRECTION — CONTRÔLE DE LA 1ʳᵉ RELECTURE", "RAPPORT DE RELECTURE — BAT2 (Correction éditoriale)"],
    couverture: ["RAPPORT DE RELECTURE DE COUVERTURE", "RAPPORT DE RELECTURE DE COUVERTURE (BAT)"],
    expertise: ["RAPPORT D'EXPERTISE SCIENTIFIQUE"],
    reecriture: ["RAPPORT DE RÉÉCRITURE"],
  };
  for (const p of aiPrompts) {
    const existing = await prisma.aiPrompt.findUnique({ where: { workType: p.workType } });
    if (!existing) continue;
    const curTitle = (existing.reportTemplate as { title?: string })?.title ?? "";
    const isDefault = (DEFAULT_TITLES[p.workType] ?? []).includes(curTitle);
    const differs = existing.systemPrompt !== p.systemPrompt || existing.label !== p.label || JSON.stringify(existing.reportTemplate) !== JSON.stringify(p.reportTemplate);
    if (isDefault && differs) {
      await prisma.aiPrompt.update({
        where: { workType: p.workType },
        data: { label: p.label, systemPrompt: p.systemPrompt, reportTemplate: p.reportTemplate as object, version: { increment: 1 } },
      });
    }
  }

  // Seuils du comité de lecture (Ch. 7 §7.5 : "seuils paramétrables") —
  // valeurs de départ sur une échelle de 0 à 10, à confirmer avec la
  // Direction éditoriale et ajustables ensuite via la table settings.
  await prisma.setting.upsert({
    where: { key: "evaluation_rating_thresholds" },
    update: {},
    create: { key: "evaluation_rating_thresholds", value: { excellent: 8.5, very_good: 7, good: 5, to_rework: 3 } },
  });
  await prisma.setting.upsert({
    where: { key: "evaluation_score_gap_threshold" },
    update: {},
    create: { key: "evaluation_score_gap_threshold", value: 3 },
  });

  // Seuil d'alerte du stock d'ISBN disponibles (Ch. 13 §13.2, "seuil
  // paramétrable") — valeur de départ à confirmer avec la Direction éditoriale.
  await prisma.setting.upsert({
    where: { key: "isbn_stock_alert_threshold" },
    update: {},
    create: { key: "isbn_stock_alert_threshold", value: 20 },
  });

  // Seuil de délégation pour la validation d'un bon de commande d'impression
  // (Ch. 15 §15.3 point 5, "seuil paramétrable") — montant en XOF, au-delà
  // duquel la validation de la Direction générale est requise (à confirmer).
  await prisma.setting.upsert({
    where: { key: "purchase_order_delegation_threshold" },
    update: {},
    create: { key: "purchase_order_delegation_threshold", value: 5_000_000 },
  });

  // Seuil d'alerte de stock par défaut (Ch. 16 §16.5) — utilisé quand une
  // référence n'a pas de seuil propre paramétré sur sa fiche stock_items.
  await prisma.setting.upsert({
    where: { key: "stock_default_alert_threshold" },
    update: {},
    create: { key: "stock_default_alert_threshold", value: 20 },
  });

  // Rapports hebdomadaires (Demande opérateur du 11/07/2026) — paramétrables :
  // mode de validation ("dg" par défaut, ou "chef" = chef de département) et
  // périodicité ("weekly" par défaut, "biweekly" ou "monthly").
  await prisma.setting.upsert({
    where: { key: "weekly_report_validation_mode" },
    update: {},
    create: { key: "weekly_report_validation_mode", value: "dg" },
  });
  await prisma.setting.upsert({
    where: { key: "weekly_report_periodicity" },
    update: {},
    create: { key: "weekly_report_periodicity", value: "weekly" },
  });

  // Modes de paiement configurables — 5 modes historiques (codes stables). Créés
  // aussi par la migration ; l'upsert garantit leur présence sur base neuve.
  const basePaymentMethods = [
    { code: "cash", label: "Espèces", kind: "especes" as const, sortOrder: 10 },
    { code: "transfer", label: "Virement bancaire", kind: "virement" as const, sortOrder: 20 },
    { code: "cheque", label: "Chèque", kind: "cheque" as const, sortOrder: 30 },
    { code: "card", label: "Carte bancaire", kind: "carte" as const, sortOrder: 40 },
    { code: "mobile_money", label: "Mobile Money", kind: "mobile_money" as const, sortOrder: 50 },
  ];
  for (const m of basePaymentMethods) {
    await prisma.paymentMethodDef.upsert({ where: { code: m.code }, update: {}, create: m });
  }

  // Portefeuilles Mobile Money du Cameroun : Orange Money et MTN Mobile Money.
  // On les distingue du « Mobile Money » générique pour un rapprochement de
  // trésorerie propre (un opérateur = un compte, un relevé). Chaque mode est
  // rattaché à son compte financier par défaut. Idempotent : le compte est
  // retrouvé par son libellé avant toute création.
  const mobileWallets = [
    { code: "orange_money", label: "Orange Money", sortOrder: 51 },
    { code: "mtn_momo", label: "MTN Mobile Money", sortOrder: 52 },
  ];
  for (const wallet of mobileWallets) {
    let account = await prisma.bankAccount.findFirst({ where: { label: wallet.label } });
    if (!account) {
      account = await prisma.bankAccount.create({
        data: { label: wallet.label, type: "mobile_money", currency: "XAF" },
      });
    }
    await prisma.paymentMethodDef.upsert({
      where: { code: wallet.code },
      update: { label: wallet.label, kind: "mobile_money", sortOrder: wallet.sortOrder, defaultAccountId: account.id },
      create: { code: wallet.code, label: wallet.label, kind: "mobile_money", sortOrder: wallet.sortOrder, defaultAccountId: account.id },
    });
  }

  // Grille de remise par défaut par catégorie de client (Ch. 17 §17.4).
  const discountGrids: { category: CustomerCategory; discountPct: number }[] = [
    { category: "librairie", discountPct: 35 },
    { category: "distributeur", discountPct: 45 },
    { category: "institution", discountPct: 15 },
    { category: "particulier", discountPct: 0 },
    { category: "plateforme", discountPct: 40 },
  ];
  for (const grid of discountGrids) {
    await prisma.discountGrid.upsert({
      where: { category: grid.category },
      update: { discountPct: grid.discountPct },
      create: { category: grid.category, discountPct: grid.discountPct },
    });
  }

  // Grille d'évaluation PAR DÉFAUT du comité de lecture (Ch. 7 §7.4-7.5).
  // Portée à la grille par défaut (genreId null) — on ne touche PAS aux grilles
  // propres à un type (même libellé possible avec un coefficient différent).
  for (const criterion of evaluationCriteria) {
    const existing = await prisma.evaluationCriterion.findFirst({ where: { label: criterion.label, genreId: null } });
    if (existing) {
      await prisma.evaluationCriterion.update({ where: { id: existing.id }, data: { coefficient: criterion.coefficient } });
    } else {
      await prisma.evaluationCriterion.create({ data: { label: criterion.label, coefficient: criterion.coefficient } });
    }
  }

  // Grilles d'évaluation PROPRES à certains types de manuscrits (demande
  // opérateur) : critères adaptés au genre. Semées UNE fois par domaine si celui-ci
  // n'a pas déjà sa grille ; entièrement ajustables dans « Domaines & collections ».
  const perTypeGrids: Record<string, { label: string; coefficient: number }[]> = {
    "Manuel scolaire ou pratique": [
      { label: "Conformité au programme / curriculum officiel", coefficient: 3 },
      { label: "Exactitude et rigueur des contenus", coefficient: 3 },
      { label: "Clarté pédagogique et progression des apprentissages", coefficient: 2 },
      { label: "Qualité et pertinence des exercices et activités", coefficient: 2 },
      { label: "Adaptation au niveau et au public scolaire visé", coefficient: 2 },
      { label: "Structure et repérage (sommaire, objectifs, index, corrigés)", coefficient: 1 },
      { label: "Illustrations, schémas et supports visuels", coefficient: 1 },
      { label: "Qualité de la langue et lisibilité", coefficient: 1 },
      { label: "Potentiel d'adoption / commercial", coefficient: 1 },
    ],
    "Poésie": [
      { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 2 },
      { label: "Force et originalité de la voix poétique", coefficient: 3 },
      { label: "Musicalité, rythme et travail de la langue", coefficient: 3 },
      { label: "Richesse des images et puissance évocatrice", coefficient: 2 },
      { label: "Cohérence et unité du recueil", coefficient: 1 },
      { label: "Émotion et portée universelle", coefficient: 1 },
      { label: "Potentiel commercial", coefficient: 1 },
    ],
    "Jeunesse": [
      { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 2 },
      { label: "Adaptation à l'âge et au public visé", coefficient: 3 },
      { label: "Qualité et intérêt du récit / de l'imaginaire", coefficient: 2 },
      { label: "Valeur éducative et messages véhiculés", coefficient: 2 },
      { label: "Illustrations et rapport texte-image", coefficient: 2 },
      { label: "Qualité de la langue et lisibilité", coefficient: 1 },
      { label: "Adéquation des contenus (absence de contenu inapproprié)", coefficient: 1 },
      { label: "Potentiel commercial", coefficient: 1 },
    ],
    "Théâtre": [
      { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 2 },
      { label: "Qualité dramaturgique (conflit, tension, structure)", coefficient: 3 },
      { label: "Qualité et vivacité des dialogues", coefficient: 3 },
      { label: "Consistance des personnages", coefficient: 2 },
      { label: "Jouabilité / faisabilité scénique", coefficient: 1 },
      { label: "Qualité de la langue", coefficient: 1 },
      { label: "Potentiel de représentation / commercial", coefficient: 1 },
    ],
    "Essai": [
      { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 2 },
      { label: "Rigueur et solidité de l'argumentation", coefficient: 3 },
      { label: "Originalité et pertinence de la thèse", coefficient: 3 },
      { label: "Qualité et fiabilité des sources et références", coefficient: 2 },
      { label: "Clarté et structure du propos", coefficient: 2 },
      { label: "Qualité de l'écriture", coefficient: 1 },
      { label: "Potentiel commercial", coefficient: 1 },
    ],
    "Sciences humaines & économie": [
      { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 2 },
      { label: "Rigueur scientifique et méthodologique", coefficient: 3 },
      { label: "Qualité et fiabilité des sources et de l'appareil critique", coefficient: 3 },
      { label: "Originalité et apport à la discipline", coefficient: 2 },
      { label: "Clarté et structure de la démonstration", coefficient: 2 },
      { label: "Actualité et pertinence du sujet", coefficient: 1 },
      { label: "Qualité de l'écriture et accessibilité", coefficient: 1 },
      { label: "Potentiel commercial / universitaire", coefficient: 1 },
    ],
    "Témoignage & biographie": [
      { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 2 },
      { label: "Authenticité et sincérité du témoignage", coefficient: 3 },
      { label: "Qualité narrative et intérêt du récit", coefficient: 2 },
      { label: "Portée humaine et universelle", coefficient: 2 },
      { label: "Points de vigilance (véracité, diffamation, vie privée)", coefficient: 2 },
      { label: "Qualité de la langue", coefficient: 1 },
      { label: "Potentiel commercial", coefficient: 1 },
    ],
    "Conte & légende": [
      { label: "Adéquation avec la ligne éditoriale d'Éclosion Édition", coefficient: 2 },
      { label: "Ancrage culturel et fidélité à la tradition", coefficient: 3 },
      { label: "Qualité de l'oralité et du souffle narratif", coefficient: 2 },
      { label: "Portée universelle et morale", coefficient: 2 },
      { label: "Qualité de la langue et accessibilité", coefficient: 1 },
      { label: "Illustrations / supports (le cas échéant)", coefficient: 1 },
      { label: "Potentiel commercial", coefficient: 1 },
    ],
  };
  for (const [genreLabel, grid] of Object.entries(perTypeGrids)) {
    const g = await prisma.genre.findFirst({ where: { label: genreLabel, deletedAt: null } });
    if (!g) continue;
    const already = await prisma.evaluationCriterion.count({ where: { genreId: g.id } });
    if (already === 0) {
      await prisma.evaluationCriterion.createMany({ data: grid.map((c) => ({ label: c.label, coefficient: c.coefficient, genreId: g.id })) });
    }
  }

  // Compte administrateur initial — mot de passe à changer dès la première connexion.
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "ChangeMoiImmediatement!";
  const passwordHash = await argon2.hash(adminPassword);
  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    // Compte passe-partout : marqué protégé même sur une base déjà seedée.
    update: { isProtected: true },
    create: {
      username: "admin",
      email: "admin@eclospace.local",
      passwordHash,
      status: "active",
      isProtected: true,
    },
  });

  const existingAdminRole = await prisma.userRole.findFirst({
    where: { userId: adminUser.id, roleId: adminRoleId, revokedAt: null },
  });
  if (!existingAdminRole) {
    await prisma.userRole.create({ data: { userId: adminUser.id, roleId: adminRoleId } });
  }

  // TVA (Ch. 18 §18.9) : au Cameroun, les livres sont exonérés — taux par défaut
  // à 0 %. Création seule (update vide) : un changement fait depuis l'écran
  // Finance n'est jamais écrasé lors d'un redéploiement.
  await prisma.taxRate.upsert({
    where: { country_productType: { country: "default", productType: "livre" } },
    update: {},
    create: { country: "default", productType: "livre", rate: 0 },
  });

  // ── Espace Auteur : compte auteur de démonstration (inc. 1) ────────────────
  // Fiche Partenaire (auteur) + compte externe relié + un ouvrage en cours de
  // correction, pour montrer le portail auteur. Idempotent (créé une seule fois).
  const demoAuthorEmail = "auteur.demo@eclospace.local";
  let demoPartner = await prisma.partner.findFirst({ where: { email: demoAuthorEmail } });
  if (!demoPartner) {
    demoPartner = await prisma.partner.create({
      data: { category: "auteur", firstName: "Amina", lastName: "Nkolo", penName: "Amina Nkolo", email: demoAuthorEmail },
    });
  }
  const demoAuthorExists = await prisma.user.findFirst({ where: { partnerId: demoPartner.id } });
  if (!demoAuthorExists) {
    await prisma.user.create({
      data: {
        username: "amina.auteur",
        email: demoAuthorEmail,
        passwordHash: await argon2.hash(process.env.DEMO_AUTHOR_PASSWORD ?? "AuteurDemo123!"),
        status: "active",
        accountType: "external",
        partnerId: demoPartner.id,
      },
    });
  }
  // Un ouvrage de démonstration, positionné en « Correction éditoriale ».
  const corrStatus = await prisma.workflowStatus.findUnique({ where: { code: "CORRECTION" } });
  if (corrStatus && !(await prisma.manuscript.findFirst({ where: { manuscriptNumber: "MS-DEMO-0001" } }))) {
    const demoMs = await prisma.manuscript.create({
      data: {
        manuscriptNumber: "MS-DEMO-0001",
        title: "Les Palmes du Dja",
        subtitle: "roman",
        language: "fr",
        origin: "soumission",
        statusId: corrStatus.id,
        ownerId: adminUser.id,
        receivedAt: new Date("2026-05-04"),
      },
    });
    await prisma.workContributor.create({ data: { manuscriptId: demoMs.id, partnerId: demoPartner.id, role: "author" } });
    // Quelques étapes franchies pour illustrer le fil d'avancement.
    for (const code of ["RECEPTION", "COMITE_LECTURE"]) {
      const st = await prisma.workflowStatus.findUnique({ where: { code } });
      if (st) {
        await prisma.manuscriptStep.create({
          data: { manuscriptId: demoMs.id, statusId: st.id, actualStart: new Date("2026-05-05"), actualEnd: new Date("2026-05-20"), validatedAt: new Date("2026-05-20") },
        });
      }
    }
    await prisma.manuscriptStep.create({ data: { manuscriptId: demoMs.id, statusId: corrStatus.id, actualStart: new Date("2026-06-01") } });
  }

  // ── Centre de Communication Interne — Babillard d'annonces (évolution) ──────
  // RBAC strict (décision opérateur D-027, 01/09/2026) : tout le personnel
  // CONSULTE les annonces qui le ciblent (consultation, bornée à soi côté
  // serveur), mais l'ADMINISTRATION du babillard (créer, modifier, supprimer,
  // publier/dépublier, programmer, catégories, paramètres) est réservée à
  // TROIS profils seulement : DG, RH et l'Administrateur général. Tous les
  // autres rôles — Direction éditoriale et Finance INCLUS — sont en lecture
  // seule. L'administrateur général a déjà toutes les permissions (plus haut).
  for (const [roleCode] of roleByCode) {
    if (roleCode === "ADMIN_GENERAL") continue;
    await grant(roleCode, ["communication:consultation"]);
  }
  for (const publisher of ["DIR_GENERAL", "RESP_RH"]) {
    await grant(publisher, ["communication:saisie", "communication:administration"]);
  }
  // Retrait sur les bases déjà semées : Finance et Direction éditoriale avaient
  // reçu l'administration du babillard ; D-027 la leur retire (lecture seule).
  // N'affecte QUE le babillard (permissions `communication:*`) — leurs autres
  // droits métier (finance, éditorial, service auteurs…) sont intacts.
  for (const demoted of ["RESP_FINANCE", "DIR_EDITORIAL"]) {
    await revoke(demoted, ["communication:saisie", "communication:administration"]);
  }

  // ── Pôle Marketing, Communication & Distribution (D-031) : fiche marketing ──
  // Consultation ouverte aux profils qui suivent la mise en marché ; saisie pour
  // le marketing/communication, la direction éditoriale et le DG ;
  // administration (paramètres du pôle) pour le DG. L'administrateur général a
  // déjà toutes les permissions.
  for (const r of ["CHARGE_COMMUNICATION", "DIR_GENERAL", "DIR_EDITORIAL", "RESP_COMMERCIAL", "RESP_RH"]) {
    await grant(r, ["marketing:consultation"]);
  }
  for (const r of ["CHARGE_COMMUNICATION", "DIR_GENERAL", "DIR_EDITORIAL"]) {
    await grant(r, ["marketing:saisie"]);
  }
  await grant("DIR_GENERAL", ["marketing:validation", "marketing:administration"]);

  // ── Espace Auteur : guichets Service Éducation / Service Client (inc. 2b) ────
  // Les messages des auteurs vers les services sont traités par les profils
  // transverses (communication, commercial, direction éditoriale et générale).
  for (const desk of ["CHARGE_COMMUNICATION", "RESP_COMMERCIAL", "DIR_EDITORIAL", "DIR_GENERAL"]) {
    await grant(desk, ["service_auteurs:consultation", "service_auteurs:saisie"]);
  }

  // Catégories d'annonces par défaut (référentiel extensible depuis l'écran).
  // Idempotent (upsert par code) ; la Direction peut en ajouter sans migration.
  const announcementCategories = [
    { code: "note_service", label: "Note de service", sortOrder: 10 },
    { code: "reunion", label: "Réunion", sortOrder: 20 },
    { code: "projet_editorial", label: "Nouveau projet éditorial", sortOrder: 30 },
    { code: "calendrier_production", label: "Calendrier de production", sortOrder: 40 },
    { code: "echeance", label: "Échéance importante", sortOrder: 50 },
    { code: "rh", label: "Annonce RH", sortOrder: 60 },
    { code: "felicitation", label: "Félicitations", sortOrder: 70 },
    { code: "anniversaire", label: "Anniversaire", sortOrder: 80 },
    { code: "arrivee_depart", label: "Arrivée / Départ", sortOrder: 90 },
    // Nouveautés & améliorations du logiciel, à annoncer aux utilisateurs des
    // pôles concernés (ciblage par département/pôle ou par rôle à la publication).
    { code: "nouveaute_logiciel", label: "Nouveauté du logiciel", sortOrder: 95 },
    { code: "info_generale", label: "Information générale", sortOrder: 100 },
  ];
  for (const cat of announcementCategories) {
    await prisma.announcementCategory.upsert({
      where: { code: cat.code },
      update: { label: cat.label, sortOrder: cat.sortOrder },
      create: cat,
    });
  }

  // « Quoi de neuf » — notes de version. Le DÉVELOPPEUR ajoute ici une entrée à
  // chaque mise à jour d'un pôle ; au déploiement suivant, les utilisateurs
  // concernés (par département/pôle, rôle, ou tous) reçoivent automatiquement un
  // message explicatif dans leur messagerie interne (la cloche). Idempotent :
  // `slug` unique + `dispatchedAt` garantissent UN seul envoi par note. On ne
  // touche PAS `dispatchedAt` au ré-upsert (ré-éditer le texte ne renvoie rien).
  const releaseNotes: { slug: string; version: string; title: string; body: string; audienceAll?: boolean; departmentCodes?: string[]; roleCodes?: string[] }[] = [
    {
      slug: "2026-09-rh-absences-suivi",
      version: "2026.09",
      title: "Nouveauté — Suivi des absences amélioré",
      body: "Le registre des absences affiche désormais le NOM du salarié demandeur, avec un bouton « Voir » ouvrant la fiche complète (motif, période, validateur, date de décision, référence). Vous pouvez générer une notification de décision (PDF à en-tête Éclosion) et l'envoyer par e-mail au salarié (renseignez son e-mail sur sa fiche).",
      departmentCodes: ["RH"],
    },
    {
      slug: "2026-09-editorial-evaluation-ia",
      version: "2026.09",
      title: "Nouveauté — Évaluation éditoriale assistée par l'IA affinée",
      body: "Dans « Mes lectures » : le type de manuscrit adapte la grille, les curseurs de note se pré-alignent sur le rapport IA, l'adéquation à la ligne éditoriale est recadrée par collection, et les rapports d'évaluation vont désormais de A à M sans coupure. Nouvelle recommandation « Rejet avec encouragement à retravailler ».",
      departmentCodes: ["COMLEC", "DIRED"],
    },
  ];
  for (const n of releaseNotes) {
    await prisma.releaseNote.upsert({
      where: { slug: n.slug },
      update: { version: n.version, title: n.title, body: n.body, audienceAll: n.audienceAll ?? false, departmentCodes: n.departmentCodes ?? [], roleCodes: n.roleCodes ?? [] },
      create: { slug: n.slug, version: n.version, title: n.title, body: n.body, audienceAll: n.audienceAll ?? false, departmentCodes: n.departmentCodes ?? [], roleCodes: n.roleCodes ?? [] },
    });
  }

  // Catalogue des motifs d'absence (droit du travail — intégration 20/08/2026).
  // Idempotent (upsert par code). On ne remet à jour QUE le libellé, la catégorie
  // et l'ordre : les RÈGLES (payé, justificatif, retenue…) ne sont pas réécrites
  // au redéploiement pour préserver les réglages faits par la RH depuis l'écran.
  for (const r of DEFAULT_ABSENCE_REASONS) {
    await prisma.absenceReason.upsert({
      where: { code: r.code },
      update: { label: r.label, category: r.category, sortOrder: r.sortOrder },
      create: {
        code: r.code,
        label: r.label,
        category: r.category,
        paid: r.paid,
        requiresJustification: r.requiresJustification,
        justificationDeadlineDays: r.justificationDeadlineDays ?? null,
        indicativeDaysMin: r.indicativeDaysMin ?? null,
        indicativeDaysMax: r.indicativeDaysMax ?? null,
        decrementsLeave: r.decrementsLeave,
        payrollDeductible: r.payrollDeductible,
        isFault: r.isFault,
        sortOrder: r.sortOrder,
      },
    });
  }
  console.log(`Motifs d'absence : ${DEFAULT_ABSENCE_REASONS.length} référencés.`);

  // Catalogue des éléments de salaire (traitement fiscal/CNPS — doc 21/08/2026).
  // Idempotent (upsert par code). On ne réécrit QUE le libellé, la catégorie,
  // la référence juridique et l'ordre : les STATUTS fiscal/CNPS ne sont pas
  // réécrits au redéploiement pour préserver les ajustements faits par la RH.
  for (const e of DEFAULT_SALARY_ELEMENTS) {
    await prisma.salaryElement.upsert({
      where: { code: e.code },
      update: { label: e.label, category: e.category, legalRef: e.legalRef, sortOrder: e.sortOrder },
      create: {
        code: e.code,
        label: e.label,
        category: e.category,
        fiscalStatus: e.fiscalStatus,
        cnpsStatus: e.cnpsStatus,
        legalRef: e.legalRef,
        sortOrder: e.sortOrder,
      },
    });
  }
  console.log(`Éléments de salaire : ${DEFAULT_SALARY_ELEMENTS.length} référencés (fiscal + CNPS).`);

  // Réparation des identifiants/e-mails « pollués » par un espace parasite
  // (clavier mobile) : un espace de début/fin empêchait la connexion (comparaison
  // exacte). On rogne les valeurs déjà en base, uniquement si la valeur nettoyée
  // reste unique (sinon on laisse tel quel pour ne pas heurter la contrainte).
  const usersToTrim = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, username: true, email: true } });
  for (const u of usersToTrim) {
    const cleanUsername = u.username.trim();
    const cleanEmail = u.email.trim();
    const data: { username?: string; email?: string } = {};
    if (cleanUsername !== u.username && !(await prisma.user.findFirst({ where: { username: cleanUsername, id: { not: u.id } } }))) {
      data.username = cleanUsername;
    }
    if (cleanEmail !== u.email && !(await prisma.user.findFirst({ where: { email: cleanEmail, id: { not: u.id } } }))) {
      data.email = cleanEmail;
    }
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: u.id }, data });
      console.log(`Identifiant réparé (espace retiré) : ${u.username.trim()}`);
    }
  }

  // Planning annuel des événements 2026 (fourni par la maison). Chargé une seule
  // fois (si aucun événement n'existe) ; ensuite tout est modifiable dans l'ERP
  // par le RH et la Direction. Les statuts/dates/lieux restent modulables.
  if ((await prisma.annualEvent.count()) === 0) {
    const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
    const events: { title: string; description?: string; start: string; end?: string; location?: string; dg?: boolean; status?: "a_venir" | "a_confirmer" }[] = [
      { title: "Réunion de lancement", start: "2026-01-09", location: "Siège d'Éclosion (Yaoundé)", dg: true },
      { title: "Encre de jeune", start: "2026-02-10", location: "Yaoundé", dg: true },
      { title: "Dame de lettre", start: "2026-03-06", location: "Yaoundé", dg: true },
      { title: "Salon de Paris", start: "2026-04-19", end: "2026-04-23", location: "Paris", dg: true },
      { title: "Remise du prix littéraire OSU", start: "2026-04-21", end: "2026-04-23", location: "Yaoundé", dg: true },
      { title: "Salon de l'industrie culturelle", description: "avec l'intervention de la DG", start: "2026-05-24", end: "2026-05-28", location: "Douala", dg: true },
      { title: "Salon du livre Éclosion", start: "2026-05-29", end: "2026-05-30", location: "Douala", dg: true },
      { title: "Festival BINGUEL", description: "atelier de lecture pour enfants", start: "2026-08-12", end: "2026-08-15", location: "à préciser" },
      { title: "Éclos Académie — Masterclass", description: "événement prévisionnel", start: "2026-10-17", location: "à préciser", status: "a_confirmer" },
      { title: "Salon africain du livre féminin", start: "2026-12-12", end: "2026-12-13", location: "Yaoundé", dg: true },
      { title: "Noël à Éclosion", start: "2026-12-22", end: "2026-12-23", location: "Yaoundé", dg: true },
    ];
    for (const e of events) {
      await prisma.annualEvent.create({
        data: {
          title: e.title,
          description: e.description ?? null,
          startDate: D(e.start),
          endDate: e.end ? D(e.end) : null,
          location: e.location ?? null,
          dgPresent: e.dg ?? false,
          status: e.status ?? "a_venir",
        },
      });
    }
    console.log(`Planning annuel : ${events.length} événements 2026 chargés.`);
  }

  // Réparation ciblée d'une base déjà chargée : le « Salon de Paris » avait été
  // enregistré avec une plage trop large (19 mars → 30 avril), qui colorait tout
  // le mois sur le calendrier. Dates confirmées par l'opérateur : 19 → 23 avril
  // 2026. On ne touche qu'à l'événement encore aux anciennes dates (idempotent,
  // et sans écraser une éventuelle modification manuelle).
  const salonRepair = await prisma.annualEvent.updateMany({
    where: { title: "Salon de Paris", startDate: new Date("2026-03-19T00:00:00.000Z"), deletedAt: null },
    data: { startDate: new Date("2026-04-19T00:00:00.000Z"), endDate: new Date("2026-04-23T00:00:00.000Z") },
  });
  if (salonRepair.count > 0) console.log(`Dates du « Salon de Paris » corrigées : 19 → 23 avril 2026.`);

  // ── Catalogue des manuels scolaires d'Éclosion (fourni par la maison) ───────
  // Charge les ouvrages du catalogue pour qu'ils soient SÉLECTIONNABLES dans le
  // formulaire de commande à facturer (plus besoin de les ressaisir : on choisit
  // l'ouvrage, on attribue quantité/prix). Idempotent : manuscrit repéré par son
  // numéro, ISBN par (manuscrit, format), prix créé s'il manque. Les ISBN sont
  // provisoires (préfixe interne) tant que les ISBN officiels ne sont pas fournis.
  const catStatus = (await prisma.workflowStatus.findFirst({ orderBy: { stepOrder: "desc" } })) ?? (await prisma.workflowStatus.findFirst());
  if (catStatus) {
    const ean13 = (base12: string): string => {
      let sum = 0;
      for (let k = 0; k < 12; k++) sum += Number(base12[k]) * (k % 2 === 0 ? 1 : 3);
      return base12 + String((10 - (sum % 10)) % 10);
    };
    const ensureAuthor = async (name: string) => {
      const found = await prisma.partner.findFirst({ where: { category: "auteur", penName: name } });
      if (found) return found;
      const parts = name.trim().split(/\s+/);
      const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
      return prisma.partner.create({ data: { category: "auteur", firstName, lastName, penName: name } });
    };
    // Catalogue des manuels. `isbn` = ISBN OFFICIEL de la maison (fourni). Les
    // ouvrages sans ISBN officiel connu gardent un ISBN provisoire (préfixe
    // interne) calculé depuis leur rang. matiere/classe sont portés par le
    // sous-titre, affiché à côté du titre.
    const catalogue: { num: string; title: string; matiere: string; classe: string; authors: string[]; coAuthors: string[]; price: number; isbn?: string }[] = [
      { num: "MS-CAT-0001", title: "LATINISTAS 6ème-5ème", matiere: "Latin", classe: "6ᵉ-5ᵉ", authors: ["Ottou Fouda"], coAuthors: ["Sabikanda"], price: 5000, isbn: "9789956362769" },
      { num: "MS-CAT-0002", title: "LATINISTAS 4ème-3ème", matiere: "Latin", classe: "4ᵉ-3ᵉ", authors: ["Ottou Fouda"], coAuthors: ["Sabikanda"], price: 5000, isbn: "9789956362752" },
      { num: "MS-CAT-0003", title: "Je découvre la langue grecque 4ème-3ème", matiere: "Grec", classe: "4ᵉ-3ᵉ", authors: ["Ottou Fouda"], coAuthors: ["Sabikanda"], price: 5000, isbn: "9789956362776" },
      { num: "MS-CAT-0004", title: "Informatique 6ème", matiere: "Informatique", classe: "6ᵉ", authors: ["Jean Paul Paul"], coAuthors: ["Wida Orpa"], price: 3500, isbn: "9789956362653" },
      { num: "MS-CAT-0005", title: "Informatique 4ème", matiere: "Informatique", classe: "4ᵉ", authors: ["Jean Paul Paul"], coAuthors: ["Wida Orpa"], price: 4000, isbn: "9789956362646" },
      { num: "MS-CAT-0006", title: "Informatique 3ème", matiere: "Informatique", classe: "3ᵉ", authors: ["Jean Paul Paul"], coAuthors: ["Wida Orpa"], price: 4000, isbn: "9789956362691" },
      { num: "MS-CAT-0009", title: "LATINISTAS 2nde-1ère-Tle", matiere: "Latin", classe: "2nde-1ère-Tle", authors: ["Ottou Fouda"], coAuthors: ["Sabikanda"], price: 5000, isbn: "9789956362745" },
      { num: "MS-CAT-0007", title: "Au cœur des ténèbres", matiere: "Littérature", classe: "1ᵉʳᵉˢ", authors: ["Joseph Conrad"], coAuthors: [], price: 1900 },
      { num: "MS-CAT-0008", title: "Stances et Poèmes, suivi de Les Épreuves", matiere: "Littérature", classe: "Terminales", authors: ["Sully Prudhomme"], coAuthors: [], price: 1900 },
      // Littérature CM1 / CM2 (fiches éditoriales de la maison). ISBN officiels
      // désormais dissociés : le 978-9956-0776-1-8 appartient au CM2 (« Une nation
      // bénie »), le CM1 (« La naissance d'une grande nation ») porte le
      // 978-9956-0776-2-5. Auteurs (texte) + illustrateurs (co-auteurs).
      { num: "MS-CAT-0010", title: "La naissance d'une grande nation", matiere: "Littérature", classe: "CM1", authors: ["Endele Damaris", "Obela Fréderic Russel"], coAuthors: ["Yaneinstein", "Foch"], price: 1000, isbn: "9789956077625" },
      { num: "MS-CAT-0011", title: "Une nation bénie", matiere: "Littérature", classe: "CM2", authors: ["Endele Damaris", "Obela Fréderic Russel"], coAuthors: ["Yaneinstein", "Foch"], price: 1000, isbn: "9789956077618" },
    ];
    for (const b of catalogue) {
      const subtitle = `${b.matiere} · ${b.classe}`;
      const ms = await prisma.manuscript.upsert({
        where: { manuscriptNumber: b.num },
        update: { title: b.title, subtitle, editorialSegment: "scolaire", isBackCatalogue: true, keywords: [b.matiere, b.classe] },
        create: {
          manuscriptNumber: b.num,
          title: b.title,
          subtitle,
          keywords: [b.matiere, b.classe],
          language: "fr",
          statusId: catStatus.id,
          ownerId: adminUser.id,
          receivedAt: new Date("2026-01-01"),
          publicationDate: new Date("2025-09-01"),
          isBackCatalogue: true,
          editorialSegment: "scolaire",
        },
      });
      let order = 0;
      for (const name of b.authors) {
        const p = await ensureAuthor(name);
        await prisma.workContributor.upsert({
          where: { manuscriptId_partnerId_role: { manuscriptId: ms.id, partnerId: p.id, role: "author" } },
          update: {},
          create: { manuscriptId: ms.id, partnerId: p.id, role: "author", displayOrder: order++ },
        });
      }
      for (const name of b.coAuthors) {
        const p = await ensureAuthor(name);
        await prisma.workContributor.upsert({
          where: { manuscriptId_partnerId_role: { manuscriptId: ms.id, partnerId: p.id, role: "co_author" } },
          update: {},
          create: { manuscriptId: ms.id, partnerId: p.id, role: "co_author", displayOrder: order++ },
        });
      }
      // ISBN officiel s'il est fourni, sinon provisoire (préfixe interne) dérivé
      // du NUMÉRO DE MANUSCRIT (stable, insensible à l'ordre du tableau).
      const seq = Number(b.num.replace("MS-CAT-", ""));
      const targetIsbn = b.isbn ?? ean13("97820010000" + seq);
      let isbn = await prisma.isbn.findFirst({ where: { manuscriptId: ms.id, format: "print" } });
      if (!isbn) {
        isbn = await prisma.isbn.create({
          data: { isbn13: targetIsbn, format: "print", manuscriptId: ms.id, status: "published", assignedAt: new Date() },
        });
      } else if (isbn.isbn13 !== targetIsbn) {
        // Remplace l'ISBN provisoire par l'ISBN officiel (l'identifiant interne de
        // la ligne ne change pas : les références existantes restent valides).
        isbn = await prisma.isbn.update({ where: { id: isbn.id }, data: { isbn13: targetIsbn } });
      }
      const hasPrice = await prisma.priceList.findFirst({ where: { isbnId: isbn.id } });
      if (!hasPrice) {
        await prisma.priceList.create({ data: { isbnId: isbn.id, country: "CM", currency: "XAF", price: b.price, effectiveFrom: new Date("2026-01-01") } });
      }
    }
    console.log(`Catalogue scolaire : ${catalogue.length} ouvrages disponibles à la commande.`);

    // ── Catalogue des livres GÉNÉRAUX / simples d'Éclosion (par collection) ────
    // Même mécanisme que le scolaire : les ouvrages sont SÉLECTIONNABLES dans le
    // formulaire de commande à facturer (catégorie « Livre général / simple »),
    // groupés par collection. Collections Source et Canari & les Héritiers.
    // Les ISBN sont les ISBN OFFICIELS de la maison quand ils sont valides et
    // uniques ; quand la source les donne malformés, dupliqués ou absents, un
    // ISBN PROVISOIRE (préfixe interne 978-2-00190-…) est attribué en attendant
    // le bon ISBN (cf. rapport `docs/RAPPORT_ISBN_LIVRES_GENERAUX.md`), pour
    // respecter la contrainte « ISBN jamais réutilisé ». Pas de prix catalogue :
    // il est saisi à la commande.
    const generalCatalogue: { num: string; title: string; collection: string; authors: string[]; isbn: string; year: number; provisional?: boolean; genre?: string }[] = [
      { num: "LG-CAT-0001", title: "06 Étapes à suivre pour trouver le travail", collection: "Collection Source", authors: ["Olive Ndjabi"], isbn: "9789956996179", year: 2022 },
      { num: "LG-CAT-0002", title: "Institutions de Bretton Woods et changement des paradigmes du discours sur l'économie", collection: "Collection Source", authors: ["Alphonse Joseph Tonye"], isbn: "9789956996278", year: 2021 },
      { num: "LG-CAT-0003", title: "Cas Pratique de Gestion", collection: "Collection Source", authors: ["Philippe Mouangue Mbale"], isbn: "9782001900015", year: 2021, provisional: true },
      { num: "LG-CAT-0004", title: "Commentaires", collection: "Collection Source", authors: ["Georges Alain Boyomo"], isbn: "9789956362592", year: 2023 },
      { num: "LG-CAT-0005", title: "Comprendre le Règlement N° 02/18/CEMAC/UMAC/CM du 21 décembre portant réglementation des changes de la CEMAC", collection: "Collection Source", authors: ["Batuo John Ndah"], isbn: "9789956996391", year: 2022 },
      { num: "LG-CAT-0006", title: "Voici pourquoi la Chine dominera le Monde", collection: "Collection Source", authors: ["Pierre Chemete"], isbn: "9789956363025", year: 2025 },
      { num: "LG-CAT-0007", title: "Coup d'État manqué du 06 avril 1984 au Cameroun", collection: "Collection Source", authors: ["Jean Pascal Mendam Nsa"], isbn: "9789956362813", year: 2024 },
      { num: "LG-CAT-0008", title: "Politiques publiques, action publique internationale et les grands évènements sportifs internationaux", collection: "Collection Source", authors: ["Armand Elono Essono"], isbn: "9789956996162", year: 2022 },
      { num: "LG-CAT-0009", title: "Quand journalisme et communication des organisations", collection: "Collection Source", authors: ["Dominique Pekassa Ngou"], isbn: "9789956078424", year: 2025 },
      { num: "LG-CAT-0010", title: "Management financier — Structures, valeur et méthodes", collection: "Collection Source", authors: ["Yves Alain Secke"], isbn: "9782001900022", year: 2022, provisional: true },
      { num: "LG-CAT-0011", title: "25 Questions-réponses sur la présidentielle 2025", collection: "Collection Source", authors: ["Georges Alain Boyomo"], isbn: "9782001900039", year: 2025, provisional: true },
      { num: "LG-CAT-0012", title: "25 Questions and answers on the 2025 presidentials", collection: "Collection Source", authors: ["Georges Alain Boyomo"], isbn: "9782001900046", year: 2025, provisional: true },
      { num: "LG-CAT-0013", title: "In the public Service Arena — Shady slopes and glimmers of hope", collection: "Collection Source", authors: ["Philip Ngwese Ngole"], isbn: "9789956077908", year: 2022 },
      { num: "LG-CAT-0014", title: "Dans l'arène de la fonction publique — Cônes d'ombres et lueurs d'espoir", collection: "Collection Source", authors: ["Philip Ngwese Ngole"], isbn: "9782001900053", year: 2022, provisional: true },
      { num: "LG-CAT-0015", title: "Disruption monétaire et financière en Afrique centrale", collection: "Collection Source", authors: ["Jean René Fils Ndouma"], isbn: "9789956362608", year: 2022 },
      { num: "LG-CAT-0016", title: "Énigme de prévention et de résolution des conflits en Afrique", collection: "Collection Source", authors: ["David Gadji"], isbn: "9789956078202", year: 2025 },
      { num: "LG-CAT-0017", title: "Mpod bo kl mbon", collection: "Collection Source", authors: ["Yamb Timba"], isbn: "9789956077762", year: 2022 },
      { num: "LG-CAT-0018", title: "Guerre de Bakassi", collection: "Collection Source", authors: ["Vincent Ntuda Ebode"], isbn: "9789956078493", year: 2025 },
      { num: "LG-CAT-0019", title: "Marketing Territorial", collection: "Collection Source", authors: ["Lionel Nga"], isbn: "9789956996353", year: 2021 },
      { num: "LG-CAT-0020", title: "Le Miracle Camerounais", collection: "Collection Source", authors: ["Pr Olivier Bile"], isbn: "9782001900060", year: 2025, provisional: true },
      { num: "LG-CAT-0021", title: "Itinéraire d'une débrouillarde devenue milliardaire", collection: "Collection Source", authors: ["Françoise Puene"], isbn: "9789956077939", year: 2022 },
      { num: "LG-CAT-0022", title: "Zéro", collection: "Collection Source", authors: ["Simon Mougnol"], isbn: "9789956996322", year: 2022 },
      { num: "LG-CAT-0023", title: "Industrialisez-vous et taisez-vous !", collection: "Collection Source", authors: ["Martial Bissog"], isbn: "9789956078097", year: 2022 },
      { num: "LG-CAT-0024", title: "Spatial chez l'Ewondo", collection: "Collection Source", authors: ["Francis Pascal Obono Esthos"], isbn: "9782001900077", year: 2022, provisional: true },
      { num: "LG-CAT-0025", title: "Sortir de la Prostitution", collection: "Collection Source", authors: ["Christian Mouandjo Ebongue"], isbn: "9789956078370", year: 2025 },
      { num: "LG-CAT-0026", title: "Éloges Funèbres", collection: "Collection Source", authors: ["Fridolin Nke"], isbn: "9789956362967", year: 2024 },
      { num: "LG-CAT-0027", title: "Pratique des fondamentaux du développement optimal par l'Afrique", collection: "Collection Source", authors: ["Erik Essousse"], isbn: "9789956077595", year: 2023 },
      { num: "LG-CAT-0028", title: "Et Dieu de plus en plus haut", collection: "Collection Source", authors: ["Dr Bingono Bingono"], isbn: "9789956077946", year: 2023 },
      { num: "LG-CAT-0029", title: "Fossi Jacob, le Gamin et son héros", collection: "Collection Source", authors: ["Pr Tetanye Ekoe"], isbn: "9789956362820", year: 2024 },
      { num: "LG-CAT-0030", title: "La bonne préparation au mariage favorise l'exaucement", collection: "Collection Source", authors: ["Jovic Beleck"], isbn: "9789956362622", year: 2022 },
      { num: "LG-CAT-0031", title: "La Commune de Yokadouma : L'Éléphant devait tomber", collection: "Collection Source", authors: ["Jean-Dunon Kemche"], isbn: "9782001900084", year: 2022, provisional: true },
      { num: "LG-CAT-0032", title: "La Révolution de la Pensée africaine", collection: "Collection Source", authors: ["Fridolin Nke"], isbn: "9789956996421", year: 2024 },
      { num: "LG-CAT-0033", title: "Le Hamburger, c'est quoi ?", collection: "Collection Source", authors: ["Pr Jean Bahebeck"], isbn: "9789956362905", year: 2024 },
      { num: "LG-CAT-0034", title: "Le Contrôle des Marchés Publics", collection: "Collection Source", authors: ["Mouncherou Abdoul Aziz"], isbn: "9789956077571", year: 2023 },
      { num: "LG-CAT-0035", title: "Management financier — Épargnes / Réserve de valeur", collection: "Collection Source", authors: ["Yves Alain Secke"], isbn: "9789956078028", year: 2022 },
      { num: "LG-CAT-0036", title: "L'auto-motivation, une arme efficace pour réaliser ses projets", collection: "Collection Source", authors: ["Olive Ndjabi"], isbn: "9789956077663", year: 2022 },
      { num: "LG-CAT-0037", title: "Pauvreté et misère", collection: "Collection Source", authors: ["Moise Nlend"], isbn: "9789956078042", year: 2025 },
      { num: "LG-CAT-0038", title: "Pratique de la Police Judiciaire au Cameroun", collection: "Collection Source", authors: ["David Leroi Nono Behalal"], isbn: "9789956077656", year: 2022 },
      { num: "LG-CAT-0039", title: "Comment mener le Cameroun à l'émergence en 10 ans", collection: "Collection Source", authors: ["Célestin Bedzigui"], isbn: "9789956996339", year: 2024 },
      { num: "LG-CAT-0040", title: "Management Toolkit of methods", collection: "Collection Source", authors: ["Joel Nana Kontchou"], isbn: "9789956996148", year: 2021 },
      { num: "LG-CAT-0041", title: "La diplomatie sanitaire — Pour une causalité d'accès aux soins", collection: "Collection Source", authors: ["Véronique Lehman"], isbn: "9789956078035", year: 2022 },
      { num: "LG-CAT-0042", title: "Viol", collection: "Collection Canari & les Héritiers", authors: ["Aline Fomete"], isbn: "9789956996346", year: 2020 },
      { num: "LG-CAT-0043", title: "Le cri de l'amnésie", collection: "Collection Canari & les Héritiers", authors: ["Coretta Forcin"], isbn: "9789956078103", year: 2023 },
      { num: "LG-CAT-0044", title: "Le village d'Ining", collection: "Collection Canari & les Héritiers", authors: ["Wilfried Ekanga"], isbn: "9789956362639", year: 2022 },
      { num: "LG-CAT-0045", title: "L'enfant bâtard", collection: "Collection Canari & les Héritiers", authors: ["Tchebal Dafrik"], isbn: "9789956077670", year: 2022 },
      { num: "LG-CAT-0046", title: "Libre", collection: "Collection Canari & les Héritiers", authors: ["Bibiche Kound"], isbn: "9789956077885", year: 2023 },
      { num: "LG-CAT-0047", title: "Mon enfant, ma vie", collection: "Collection Canari & les Héritiers", authors: ["Rosine Yemele"], isbn: "9859956996322", year: 2022 },
      { num: "LG-CAT-0048", title: "J'étais une femme riche", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9789956078363", year: 2023 },
      { num: "LG-CAT-0049", title: "Je suis nègre, mais les noirs ne m'aiment pas", collection: "Collection Canari & les Héritiers", authors: ["Junior Haussin"], isbn: "9789956078196", year: 2023 },
      { num: "LG-CAT-0050", title: "Que d'être une femme", collection: "Collection Canari & les Héritiers", authors: ["Davy Djomeni"], isbn: "9789956362844", year: 2023 },
      { num: "LG-CAT-0051", title: "Victime", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9789956362783", year: 2023 },
      { num: "LG-CAT-0052", title: "L'ailleurs", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9789956078349", year: 2024 },
      { num: "LG-CAT-0053", title: "ADA et Agnès, pas de vêtements courts", collection: "Collection Canari & les Héritiers", authors: ["Fridoline Mvondo"], isbn: "9782001900091", year: 2021, provisional: true },
      { num: "LG-CAT-0054", title: "MAFEU et les travaux ménagers", collection: "Collection Canari & les Héritiers", authors: ["Aline Fomete"], isbn: "9789956996261", year: 2020 },
      { num: "LG-CAT-0055", title: "MOLO et TAKAM en vacances au village", collection: "Collection Canari & les Héritiers", authors: ["Olive Ndjabi"], isbn: "9782001900107", year: 2022, provisional: true },
      { num: "LG-CAT-0056", title: "Makwan, mon bijou", collection: "Collection Canari & les Héritiers", authors: ["Aline Fomete"], isbn: "9789956362806", year: 2023 },
      { num: "LG-CAT-0057", title: "Devenir un homme", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9789956078356", year: 2025 },
      { num: "LG-CAT-0058", title: "Aïe a ses règles", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9782001900114", year: 2021, provisional: true },
      { num: "LG-CAT-0059", title: "DJANGA n'est pas propre", collection: "Collection Canari & les Héritiers", authors: ["Aline Fomete"], isbn: "9782001900121", year: 2022, provisional: true },
      { num: "LG-CAT-0060", title: "NOUNPOU A et YENTEMA apprennent l'argent", collection: "Collection Canari & les Héritiers", authors: ["Larissa Lankoa Nde"], isbn: "9789956363001", year: 2024 },
      { num: "LG-CAT-0061", title: "La fête à la maternelle", collection: "Collection Canari & les Héritiers", authors: ["Caroline Thérèse Boumny Emb"], isbn: "9789956078301", year: 2025 },
      { num: "LG-CAT-0062", title: "Contes et légendes du sahel", collection: "Collection Canari & les Héritiers", authors: ["Ghislain Thomas Tchofo"], isbn: "9789956363018", year: 2024 },
      { num: "LG-CAT-0063", title: "MERO face aux moqueries des camarades", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9789956078387", year: 2024 },
      { num: "LG-CAT-0064", title: "MERO au défilé du 20 mai", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9789956362875", year: 2023 },
      { num: "LG-CAT-0065", title: "MERO à la découverte du Cameroun", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9782001900138", year: 2024, provisional: true },
      { num: "LG-CAT-0066", title: "Palmes d'or T1 : les fables — Livre d'histoires africaines", collection: "Collection Canari & les Héritiers", authors: ["Princesse Sika Beha"], isbn: "9789956077878", year: 2022 },
      { num: "LG-CAT-0067", title: "MERO discovering Cameroon", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9782001900145", year: 2024, provisional: true },
      { num: "LG-CAT-0068", title: "MERO et les traditions", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9782001900152", year: 2024, provisional: true },
      { num: "LG-CAT-0069", title: "The wolves valley", collection: "Collection Canari & les Héritiers", authors: ["Ndongo Tsango Pastel"], isbn: "9789956077984", year: 2024 },
      { num: "LG-CAT-0070", title: "MERO and the traditions", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9782001900169", year: 2024, provisional: true },
      { num: "LG-CAT-0071", title: "Au-delà de l'autisme", collection: "Collection Canari & les Héritiers", authors: ["Généviève Nga"], isbn: "9789956078080", year: 2021 },
      { num: "LG-CAT-0072", title: "Ces Vies que j'aurais vécues", collection: "Collection Canari & les Héritiers", authors: ["Irène Maben"], isbn: "9789956362851", year: 2025 },
      { num: "LG-CAT-0073", title: "Chansons pour mon pays l'Afrique", collection: "Collection Canari & les Héritiers", authors: ["Nti Z Matriz Ibori"], isbn: "9789956362943", year: 2024 },
      { num: "LG-CAT-0074", title: "Dans la Tourmente", collection: "Collection Canari & les Héritiers", authors: ["Aline Fomete"], isbn: "9789956996216", year: 2022 },
      { num: "LG-CAT-0075", title: "Felonica, la femme de chez nous", collection: "Collection Canari & les Héritiers", authors: ["Solange Nsomo"], isbn: "9782001900176", year: 2025, provisional: true },
      { num: "LG-CAT-0076", title: "L'Antenne de nos 30 ans", collection: "Collection Canari & les Héritiers", authors: ["Rashel Malongo (dir.)"], isbn: "9789956078400", year: 2025 },
      { num: "LG-CAT-0077", title: "Impossible", collection: "Collection Canari & les Héritiers", authors: ["Faustin Mvogo"], isbn: "9789956362790", year: 2020 },
      { num: "LG-CAT-0078", title: "L'œil du Loup, tome 1", collection: "Collection Canari & les Héritiers", authors: ["Me Simon Ahielton"], isbn: "9789956362912", year: 2025 },
      { num: "LG-CAT-0079", title: "L'œil du Loup, tome II", collection: "Collection Canari & les Héritiers", authors: ["Me Simon Ahielton"], isbn: "9789956362929", year: 2025 },
      { num: "LG-CAT-0080", title: "Le Roi Mbella", collection: "Collection Canari & les Héritiers", authors: ["Samuel Eddy Mbog"], isbn: "9789956077977", year: 2024 },
      { num: "LG-CAT-0081", title: "Un Sourire apaise les larmes", collection: "Collection Canari & les Héritiers", authors: ["Vincent Siankam"], isbn: "9789956078219", year: 2024 },
      { num: "LG-CAT-0082", title: "Vers Amers", collection: "Collection Canari & les Héritiers", authors: ["Louis Ebene"], isbn: "9789956077892", year: 2025 },
      { num: "LG-CAT-0083", title: "La troisième Manquée", collection: "Collection Canari & les Héritiers", authors: ["Léopold Ngodji"], isbn: "9789956077823", year: 2022 },
      { num: "LG-CAT-0084", title: "L'enfance effacée", collection: "Collection Canari & les Héritiers", authors: ["William Timma"], isbn: "9782001900183", year: 2022, provisional: true },
      { num: "LG-CAT-0085", title: "Née au MBOKO, fille d'une Nanga", collection: "Collection Canari & les Héritiers", authors: ["Jocelyne Ebanga"], isbn: "9789956077793", year: 2022 },
      { num: "LG-CAT-0086", title: "On a volé Dieu", collection: "Collection Canari & les Héritiers", authors: ["David Serge Mvondo"], isbn: "9789956077816", year: 2022 },
      { num: "LG-CAT-0087", title: "À qui la faute ?", collection: "Collection Canari & les Héritiers", authors: ["Arsène Mangoumou"], isbn: "9782001900190", year: 2022, provisional: true },
      { num: "LG-CAT-0088", title: "Amnésique", collection: "Collection Canari & les Héritiers", authors: ["Yvette Nouga"], isbn: "9789956078110", year: 2023 },
      { num: "LG-CAT-0089", title: "L'Afrique en larmes", collection: "Collection Canari & les Héritiers", authors: ["Bibiche Kound"], isbn: "9782001900206", year: 2023, provisional: true },
      { num: "LG-CAT-0090", title: "L'appel Pressant", collection: "Collection Canari & les Héritiers", authors: ["Mgr Jean Ndjewel"], isbn: "9789956362547", year: 2023 },
      { num: "LG-CAT-0091", title: "Le journal d'un enseignant", collection: "Collection Canari & les Héritiers", authors: ["Arthur Bilounga"], isbn: "9789956362554", year: 2023 },
      { num: "LG-CAT-0092", title: "Les fantômes du passé", collection: "Collection Canari & les Héritiers", authors: ["Marie Nicaise Ebanga"], isbn: "9789956078141", year: 2023 },
      { num: "LG-CAT-0093", title: "Les Petits-Africains", collection: "Collection Canari & les Héritiers", authors: ["Princesse Sika-Beha"], isbn: "9789956362530", year: 2023 },
      { num: "LG-CAT-0094", title: "Réalités épineuses", collection: "Collection Canari & les Héritiers", authors: ["Aminatou Ndam Mbendia"], isbn: "9782001900213", year: 2023, provisional: true },
      { num: "LG-CAT-0095", title: "Vérité Mensongère", collection: "Collection Canari & les Héritiers", authors: ["Jordan Tegoudjon"], isbn: "9789956362523", year: 2023 },
      { num: "LG-CAT-0096", title: "Stella and corruption", collection: "Collection Canari & les Héritiers", authors: ["Pastel Ndongo"], isbn: "9789956362981", year: 2024 },
      { num: "LG-CAT-0097", title: "Les Mémoires d'une Terre Camerounaise", collection: "Collection Canari & les Héritiers", authors: ["Sara Timb"], isbn: "9789956078233", year: 2024 },
      { num: "LG-CAT-0098", title: "Ronoowo", collection: "Collection Canari & les Héritiers", authors: ["Nadine Ndjomo"], isbn: "9789956078271", year: 2024 },
      { num: "LG-CAT-0099", title: "Matricule E.C.I", collection: "Collection Canari & les Héritiers", authors: ["Ibrahim Fioko"], isbn: "9789956078288", year: 2024 },
      { num: "LG-CAT-0100", title: "Nkobi et Djobi", collection: "Collection Canari & les Héritiers", authors: ["Muriel Menye"], isbn: "9789956078295", year: 2024 },
      // Ajouts opérateur (01/09/2026) : 2 essais (Collection Source) et 2 romans
      // (Collection Canari & les Héritiers). ISBN officiels et année de parution
      // (2026) fournis par la maison.
      { num: "LG-CAT-0109", title: "Les clés d'une retraite épanouie", collection: "Collection Source", authors: ["Olga Lona"], isbn: "9789956079421", year: 2026, genre: "ESSAI" },
      { num: "LG-CAT-0110", title: "Rêver en Afrique", collection: "Collection Source", authors: ["Avom Paul"], isbn: "9789956079452", year: 2026, genre: "ESSAI" },
      { num: "LG-CAT-0111", title: "Paternité charnelle", collection: "Collection Canari & les Héritiers", authors: ["Zang Zang Elie Denis"], isbn: "9789956078615", year: 2026, genre: "ROMAN" },
      { num: "LG-CAT-0112", title: "Le bal des vampires", collection: "Collection Canari & les Héritiers", authors: ["Emile Kweguem"], isbn: "9789956078547", year: 2026, genre: "ROMAN" },
    ];
    // Réorganisation idempotente : au re-seed, on repart d'ISBN temporaires pour
    // les manuscrits du catalogue général, afin d'éviter tout conflit d'unicité
    // si un ISBN change d'ouvrage entre deux versions de la liste.
    {
      const existingLg = await prisma.isbn.findMany({ where: { format: "print", manuscript: { manuscriptNumber: { startsWith: "LG-CAT-" } } }, select: { id: true } });
      let tmp = 0;
      for (const row of existingLg) {
        await prisma.isbn.update({ where: { id: row.id }, data: { isbn13: `TMP-LGCAT-${String(tmp++).padStart(5, "0")}` } });
      }
    }
    // Correspondance libellé de collection → identifiant (D-025), pour rattacher
    // chaque ouvrage du catalogue général à sa collection. Les libellés
    // historiques du catalogue (D-024) sont ré-aiguillés vers les nouvelles
    // collections : « Source » → « Sources » ; « Canari & les Héritiers » →
    // « Canarie » (littérature générale — le gros du fonds ; les rares titres
    // jeunesse pourront être re-filés vers « Héritier » depuis l'administration).
    const collectionsByLabel = new Map(
      (await prisma.collection.findMany({ where: { deletedAt: null }, select: { id: true, label: true } })).map((c) => [c.label, c.id]),
    );
    const collectionLabelAlias: Record<string, string> = {
      "Collection Source": "Collection Sources",
      "Collection Canari & les Héritiers": "Collection Canarie",
    };
    // Titres de l'ancien fonds « Canari & les Héritiers » identifiés comme
    // JEUNESSE par l'opérateur (05/09/2026) : rattachés à « Collection Héritier »
    // (et non Canarie). Set stable par numéro de catalogue → durable et re-jouable
    // en production. Les autres restent dans « Canarie ».
    const heritierBookNums = new Set([
      "LG-CAT-0053", // ADA et Agnès, pas de vêtements courts
      "LG-CAT-0054", // MAFEU et les travaux ménagers
      "LG-CAT-0055", // MOLO et TAKAM en vacances au village
      "LG-CAT-0056", // Makwan, mon bijou
      "LG-CAT-0058", // Aïe a ses règles
      "LG-CAT-0059", // DJANGA n'est pas propre
      "LG-CAT-0060", // NOUNPOU A et YENTEMA apprennent l'argent
      "LG-CAT-0061", // La fête à la maternelle
      "LG-CAT-0062", // Contes et légendes du sahel
      "LG-CAT-0063", // MERO face aux moqueries des camarades
      "LG-CAT-0064", // MERO au défilé du 20 mai
      "LG-CAT-0065", // MERO à la découverte du Cameroun
      "LG-CAT-0066", // Palmes d'or T1 : les fables
      "LG-CAT-0067", // MERO discovering Cameroon
      "LG-CAT-0068", // MERO et les traditions
      "LG-CAT-0070", // MERO and the traditions
      "LG-CAT-0093", // Les Petits-Africains
      "LG-CAT-0100", // Nkobi et Djobi
    ]);
    const resolveCollectionId = (label: string, num: string): string | null => {
      if (heritierBookNums.has(num)) return collectionsByLabel.get("Collection Héritier") ?? null;
      return collectionsByLabel.get(collectionLabelAlias[label] ?? label) ?? null;
    };
    // Correspondance code de domaine → identifiant (essai, roman…), pour classer
    // les ouvrages qui précisent leur domaine.
    const genresByCode = new Map(
      (await prisma.genre.findMany({ select: { id: true, code: true } })).map((g) => [g.code, g.id]),
    );
    for (const b of generalCatalogue) {
      const collectionId = resolveCollectionId(b.collection, b.num);
      const genreId = b.genre ? genresByCode.get(b.genre) ?? null : null;
      const ms = await prisma.manuscript.upsert({
        where: { manuscriptNumber: b.num },
        update: { title: b.title, subtitle: b.collection, editorialSegment: "general", isBackCatalogue: true, keywords: [b.collection], collectionId, genreId },
        create: {
          manuscriptNumber: b.num,
          title: b.title,
          subtitle: b.collection,
          keywords: [b.collection],
          collectionId,
          genreId,
          language: "fr",
          statusId: catStatus.id,
          ownerId: adminUser.id,
          receivedAt: new Date(`${b.year}-01-01`),
          publicationDate: new Date(`${b.year}-09-01`),
          isBackCatalogue: true,
          editorialSegment: "general",
        },
      });
      let order = 0;
      for (const name of b.authors) {
        const p = await ensureAuthor(name);
        await prisma.workContributor.upsert({
          where: { manuscriptId_partnerId_role: { manuscriptId: ms.id, partnerId: p.id, role: "author" } },
          update: {},
          create: { manuscriptId: ms.id, partnerId: p.id, role: "author", displayOrder: order++ },
        });
      }
      let isbn = await prisma.isbn.findFirst({ where: { manuscriptId: ms.id, format: "print" } });
      if (!isbn) {
        isbn = await prisma.isbn.create({ data: { isbn13: b.isbn, format: "print", manuscriptId: ms.id, status: "published", assignedAt: new Date() } });
      } else if (isbn.isbn13 !== b.isbn) {
        isbn = await prisma.isbn.update({ where: { id: isbn.id }, data: { isbn13: b.isbn } });
      }
    }
    const provCount = generalCatalogue.filter((b) => b.provisional).length;
    console.log(`Catalogue général : ${generalCatalogue.length} ouvrages disponibles à la commande (${provCount} avec ISBN provisoire à corriger).`);

    // ── Liste officielle « Livres & ISBN » de la maison (docx opérateur du
    // 20/08/2026) : fait foi pour l'ISBN DÉFINITIF et le PRIX PUBLIC (XAF) de
    // chaque ouvrage. On corrige les ISBN provisoires, on renseigne les prix, et
    // on ajoute au catalogue les titres qui n'y figuraient pas encore. Mappage
    // DÉTERMINISTE (chaque ligne pointe un numéro de catalogue précis) — aucune
    // correspondance floue à l'exécution. Idempotent (upsert par numéro).
    const officialList: { num: string; title: string; author: string; isbn?: string; price?: number; isNew?: boolean }[] = [
      { num: "LG-CAT-0101", title: "Afrique première puissance", author: "Milton Mbombo", isbn: "9789956078332", price: 10000, isNew: true },
      { num: "LG-CAT-0102", title: "L'éveil démocratique", author: "Frank Kemajou", isbn: "9789956363094", price: 5000, isNew: true },
      { num: "LG-CAT-0103", title: "De la misère à l'abondance", author: "Lucas Kamdem", isbn: "9789956510999", price: 10000, isNew: true },
      { num: "LG-CAT-0076", title: "L'Antenne de nos 30 ans", author: "Daniel Anicet Noah", isbn: "9789956078400", price: 10000 },
      { num: "LG-CAT-0092", title: "Les fantômes du passé", author: "Marie Nicaise Ebanga", isbn: "9789956078141", price: 3500 },
      { num: "LG-CAT-0090", title: "L'appel Pressant", author: "Mgr Jean Ndjewel", isbn: "9789956362547", price: 4000 },
      { num: "LG-CAT-0104", title: "Management, outils essentiels", author: "Joël Nana Kontchou", price: 10000, isNew: true },
      { num: "LG-CAT-0094", title: "Réalités épineuses", author: "Aminatou Ndam Mbendia", isbn: "9789956378155", price: 5000 },
      { num: "LG-CAT-0006", title: "Voici pourquoi la Chine dominera le Monde", author: "Pierre Chemete", isbn: "9789956363025", price: 10000 },
      { num: "LG-CAT-0089", title: "L'Afrique en larmes", author: "Bibiche Kound", isbn: "9789956078134", price: 4000 },
      { num: "LG-CAT-0087", title: "À qui la faute ?", author: "Arsène Mangoumou", isbn: "9789956362578", price: 4000 },
      { num: "LG-CAT-0097", title: "Les Mémoires d'une Terre Camerounaise", author: "Sara Timb", isbn: "9789956078233", price: 3500 },
      { num: "LG-CAT-0099", title: "Matricule E.C.I", author: "Ibrahim Fioko", isbn: "9789956078288", price: 5000 },
      { num: "LG-CAT-0105", title: "Rhapsodies", author: "Mouelle Kombi II", isbn: "9789956079391", price: 5000, isNew: true },
      { num: "LG-CAT-0106", title: "Journalisme culturel : entre tradition & modernité", author: "Marie Gabrielle Mfegue", isbn: "9789956078653", price: 5000, isNew: true },
      { num: "LG-CAT-0107", title: "Marketing & communication politique et électorale", author: "François Elandi", isbn: "9789956078509", price: 10000, isNew: true },
      { num: "LG-CAT-0080", title: "Le Roi Mbella", author: "Samuel Eddy Mbog", isbn: "9789956077977", price: 5000 },
      { num: "LG-CAT-0017", title: "Mpod bo kl mbon", author: "Yamb Timba", isbn: "9789956077762" },
      { num: "LG-CAT-0084", title: "L'enfance effacée", author: "Arthur Bilounga", isbn: "9789956077809", price: 4000 },
      { num: "LG-CAT-0086", title: "On a volé Dieu", author: "David Serge Mvondo", isbn: "9789956077816", price: 2500 },
      { num: "LG-CAT-0083", title: "La troisième Manquée", author: "Léopold Ngodji", isbn: "9789956077823", price: 5000 },
      { num: "LG-CAT-0098", title: "Ronoowo", author: "Nadine Ndjomo", isbn: "9789956078271", price: 3500 },
      { num: "LG-CAT-0108", title: "Maire de Tsanga sud", author: "David Massoma", isbn: "9789956078622", price: 7000, isNew: true },
      { num: "LG-CAT-0074", title: "Dans la Tourmente", author: "Aline Fomete", isbn: "9789956996216", price: 3500 },
    ];

    let priced = 0;
    let corrected = 0;
    let created = 0;
    for (const b of officialList) {
      const ms = await prisma.manuscript.upsert({
        where: { manuscriptNumber: b.num },
        update: {},
        create: {
          manuscriptNumber: b.num,
          title: b.title,
          subtitle: "Catalogue Éclosion",
          language: "fr",
          statusId: catStatus.id,
          ownerId: adminUser.id,
          receivedAt: new Date("2024-01-01"),
          publicationDate: new Date("2024-09-01"),
          isBackCatalogue: true,
          editorialSegment: "general",
          keywords: ["Catalogue Éclosion"],
        },
      });
      if (b.isNew) created++;

      // Auteur (créé si absent), sans dédoublonner un auteur déjà rattaché.
      const author = await ensureAuthor(b.author);
      await prisma.workContributor.upsert({
        where: { manuscriptId_partnerId_role: { manuscriptId: ms.id, partnerId: author.id, role: "author" } },
        update: {},
        create: { manuscriptId: ms.id, partnerId: author.id, role: "author", displayOrder: 0 },
      });

      // ISBN officiel — posé seulement s'il n'est pas déjà rattaché à un AUTRE
      // ouvrage (respect de la contrainte « ISBN jamais réutilisé »).
      if (b.isbn) {
        const clash = await prisma.isbn.findFirst({ where: { isbn13: b.isbn, manuscriptId: { not: ms.id } } });
        if (!clash) {
          const existing = await prisma.isbn.findFirst({ where: { manuscriptId: ms.id, format: "print" } });
          if (!existing) {
            await prisma.isbn.create({ data: { isbn13: b.isbn, format: "print", manuscriptId: ms.id, status: "published", assignedAt: new Date() } });
          } else if (existing.isbn13 !== b.isbn) {
            await prisma.isbn.update({ where: { id: existing.id }, data: { isbn13: b.isbn } });
            corrected++;
          }
        }
      }

      // Prix public officiel (XAF) → fiche ouvrage (work_metadata).
      if (b.price != null) {
        await prisma.workMetadata.upsert({
          where: { manuscriptId: ms.id },
          update: { pricePublic: b.price },
          create: { manuscriptId: ms.id, pricePublic: b.price },
        });
        priced++;
      }
    }
    console.log(`Liste officielle : ${officialList.length} ouvrages traités (${created} ajoutés, ${corrected} ISBN corrigés, ${priced} prix renseignés).`);
  }

  // Pièces du pôle Stock & magasin déjà émises par la maison (revue opérateur
  // du 27/08/2026) : on enregistre les deux premières pièces réelles pour que la
  // numérotation reparte ensuite à 0002 dans chaque série. Idempotent : garde
  // par numéro ; le compteur de l'année est initialisé à 1.
  if (!(await prisma.bookReceiptVoucher.findUnique({ where: { number: "BR-2026-0001" } }))) {
    await prisma.bookReceiptVoucher.create({
      data: {
        number: "BR-2026-0001",
        receivedAt: new Date("2026-08-26T00:00:00.000Z"),
        supplier: "GLC SARL",
        orderNumber: "0081",
        deliveryNote: "0063",
        carrier: "GLC SARL",
        receivedByName: "NDI SANAMA EVRARD WILFRIED",
        receivedByRole: "Responsable logistique et des stocks",
        remarks:
          "Dans la commande N° 0063 reçue le 26 août 2026 : sur 400 livres réceptionnés, 223 sont en état conforme aux exigences exprimées par l'auteur, tandis que 177 livres sont endommagés du fait de leur encollage.",
        createdById: adminUser.id,
        lines: {
          create: [
            { position: 0, title: "Les clés d'une retraite épanouie", author: "Olga Lona", qtyOrdered: null, qtyReceived: 400, qtyGood: 223, qtyDamaged: 177 },
            { position: 1, title: "Et dieu de plus en plus haut", author: "Emile Kwegueng", qtyOrdered: null, qtyReceived: 30, qtyGood: 20, qtyDamaged: 10 },
            { position: 2, title: "Je suis nègre mais les noirs ne m'aiment pas", author: null, qtyOrdered: null, qtyReceived: 30, qtyGood: 24, qtyDamaged: 6 },
          ],
        },
      },
    });
  }
  await prisma.bookReceiptCounter.upsert({ where: { year: 2026 }, create: { year: 2026, lastValue: 1 }, update: {} });

  if (!(await prisma.authorWithdrawalVoucher.findUnique({ where: { number: "RA-2026-0001" } }))) {
    await prisma.authorWithdrawalVoucher.create({
      data: {
        number: "RA-2026-0001",
        issuedAt: new Date("2026-08-27T00:00:00.000Z"),
        place: "Yaoundé",
        authorName: "M. Zang Zang Elie Denis",
        authorAddress: "Yaoundé",
        authorPhone: "656 09 78 07",
        authorEmail: "zangzangeliedenis@gmail.com",
        workTitle: "Paternité charnelle",
        quantity: 15,
        motive: "restitution_stock",
        createdById: adminUser.id,
      },
    });
  }
  await prisma.authorWithdrawalCounter.upsert({ where: { year: 2026 }, create: { year: 2026, lastValue: 1 }, update: {} });

  // « Quoi de neuf » : distribue aux utilisateurs concernés les notes de version
  // non encore envoyées (une notification par utilisateur, une seule fois).
  const dispatch = await dispatchReleaseNotes();
  console.log(`Notes de version : ${dispatch.notes} traitée(s), ${dispatch.notifications} notification(s) envoyée(s).`);

  // Cachets & signature officiels (demande opérateur 09/09/2026) : valeurs par
  // défaut installées une seule fois (création). Un téléversement ultérieur par
  // l'administration est préservé (on ne réécrit jamais un réglage existant).
  const existingBranding = await prisma.setting.findUnique({ where: { key: BRANDING_KEY } });
  if (!existingBranding) {
    const stampDataUrl = (file: string): string | null => {
      try {
        const buf = readFileSync(new URL(`../assets/stamps/${file}`, import.meta.url));
        return `data:image/png;base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    };
    await prisma.setting.create({
      data: {
        key: BRANDING_KEY,
        value: {
          cachet_editoriale: stampDataUrl("cachet-direction-editoriale.png"),
          cachet_generale: stampDataUrl("cachet-direction-generale.png"),
          signature_dg: stampDataUrl("signature-dg.png"),
          ...BRANDING_DEFAULTS,
        },
      },
    });
    console.log("Cachets & signature officiels : valeurs par défaut installées.");
  }

  console.log("Seed Lot 0 terminé.");
  console.log(`Compte administrateur : admin / ${adminPassword} (à changer immédiatement)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
