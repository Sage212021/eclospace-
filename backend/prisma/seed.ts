// Données de référence du Lot 0 : les 17 départements (Ch. 3 §3.2, décision D-002),
// les rôles identifiés au Ch. 2 §2.2 et Ch. 3 §3.3, et un compte administrateur
// initial. Rejouable sans effet de bord (upsert par code).
import argon2 from "argon2";
import { PrismaClient, PermissionAction, CustomerCategory } from "@prisma/client";

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
];

// Modules exposés par l'API (Ch. 2 §2.3 : 4 niveaux d'action), ajoutés lot par lot.
const lot0Modules = ["documents", "notifications", "users", "settings"];
const lot1Modules = ["manuscripts", "comite_lecture", "decision_editoriale"];
const lot2Modules = ["contracts", "tasks"];
const lot3Modules = ["production", "isbn", "bat", "printing"];
const lot4Modules = ["stock", "commercial"];
const lot5Modules = ["finance", "royalties"];
const lot6Modules = ["rh", "rh_confidentiel", "direction", "pilotage", "rapports"];
const modules = [...lot0Modules, ...lot1Modules, ...lot2Modules, ...lot3Modules, ...lot4Modules, ...lot5Modules, ...lot6Modules];
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
  { code: "CONTRACTUALISATION", label: "Contractualisation", stepOrder: 5, departmentCode: "JURID" },
  { code: "PLANIFICATION", label: "Planification du projet", stepOrder: 6, departmentCode: "DIRED" },
  { code: "CORRECTION", label: "Correction éditoriale", stepOrder: 7, departmentCode: "CORR" },
  { code: "EXPERTISE", label: "Expertise scientifique", stepOrder: 8, departmentCode: "EXPERT", isConditional: true },
  { code: "REECRITURE", label: "Réécriture éditoriale", stepOrder: 9, departmentCode: "CORR", isConditional: true },
  { code: "MISE_EN_PAGE", label: "Mise en page", stepOrder: 10, departmentCode: "MAQ" },
  { code: "INFOGRAPHIE", label: "Infographie", stepOrder: 11, departmentCode: "INFOG" },
  // Ordre corrigé (Lot 3) par rapport au Lot 1 : Ch. 13 §13.9 et Ch. 14 §14.2
  // exigent tous deux que la complétude ISBN/dépôt légal/métadonnées soit
  // vérifiée AVANT la constitution du dossier de BAT — l'ordre initial du
  // Lot 1 (BAT avant attribution des références) contredisait ce texte.
  { code: "ATTRIBUTION_REFERENCES", label: "Attribution des références", stepOrder: 12, departmentCode: "SECR" },
  { code: "VALIDATION_BAT", label: "Validation du BAT", stepOrder: 13, departmentCode: "CQ" },
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
];

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

  // Stock et magasin (Ch. 16).
  await grant("MAGASINIER", [
    "stock:consultation",
    "stock:saisie",
    "stock:validation",
    "stock:administration",
  ]);
  await grant("RESP_COMMERCIAL", ["stock:consultation"]);
  await grant("DIR_GENERAL", ["stock:consultation", "stock:validation"]);

  // Commercial, distribution et ventes (Ch. 17) — la validation d'une
  // remise hors grille ou du déblocage d'un encours dépassé reste réservée
  // à la Direction générale (commercial:administration), même schéma que
  // printing:administration (Ch. 15).
  await grant("RESP_COMMERCIAL", ["commercial:consultation", "commercial:saisie", "commercial:validation"]);
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

  // Ressources humaines (Ch. 19) — le dossier RH est réservé au responsable
  // RH et à la Direction ; consultation élargie aux responsables de service
  // (revue des accès de leur équipe, §19.4) mais sans les données
  // confidentielles (rémunération), à accès restreint (§19.2, même exigence
  // que le juridique).
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
  for (const roleCode of managementRoles) {
    await grant(roleCode, ["rh:consultation"]);
  }
  await grant("RESP_RH", ["rh:saisie", "rh:validation", "rh:administration", "rh_confidentiel:consultation", "rh_confidentiel:saisie"]);
  await grant("DIR_GENERAL", ["rh:saisie", "rh:validation", "rh:administration", "rh_confidentiel:consultation", "rh_confidentiel:saisie"]);

  // Attribution/retrait des rôles applicatifs (Ch. 2 §2.4, Ch. 19 §19.3-19.4)
  // — réservé au responsable RH et à la Direction générale.
  await grant("RESP_RH", ["users:administration"]);
  await grant("DIR_GENERAL", ["users:administration"]);

  // Direction générale et pilotage intelligent (Ch. 5) : tableau de bord
  // consolidé, recherche, alertes, recommandations — les indicateurs
  // financiers restent en outre soumis à finance:consultation (§5.2, §18).
  await grant("DIR_GENERAL", ["direction:consultation", "pilotage:consultation", "pilotage:saisie", "pilotage:administration"]);
  await grant("DIR_EDITORIAL", ["direction:consultation", "pilotage:consultation", "pilotage:saisie"]);
  await grant("RESP_FINANCE", ["direction:consultation", "pilotage:consultation", "pilotage:saisie"]);

  // Rapports, dictionnaire d'indicateurs, explorateur (Ch. 20).
  for (const roleCode of managementRoles) {
    await grant(roleCode, ["rapports:consultation"]);
  }
  await grant("DIR_GENERAL", ["rapports:saisie", "rapports:administration"]);
  await grant("RESP_RH", ["rapports:saisie"]);

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
      description: "Projection de rupture au rythme de vente courant (Ch. 16).",
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

  // Référentiel des genres (Ch. 6 §6.2).
  for (const genre of genres) {
    await prisma.genre.upsert({ where: { code: genre.code }, update: { label: genre.label }, create: genre });
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

  // Grille d'évaluation du comité de lecture (Ch. 7 §7.4-7.5).
  for (const criterion of evaluationCriteria) {
    const existing = await prisma.evaluationCriterion.findFirst({ where: { label: criterion.label } });
    if (existing) {
      await prisma.evaluationCriterion.update({
        where: { id: existing.id },
        data: { coefficient: criterion.coefficient },
      });
    } else {
      await prisma.evaluationCriterion.create({
        data: { label: criterion.label, coefficient: criterion.coefficient },
      });
    }
  }

  // Compte administrateur initial — mot de passe à changer dès la première connexion.
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "ChangeMoiImmediatement!";
  const passwordHash = await argon2.hash(adminPassword);
  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      email: "admin@eclospace.local",
      passwordHash,
      status: "active",
    },
  });

  const existingAdminRole = await prisma.userRole.findFirst({
    where: { userId: adminUser.id, roleId: adminRoleId, revokedAt: null },
  });
  if (!existingAdminRole) {
    await prisma.userRole.create({ data: { userId: adminUser.id, roleId: adminRoleId } });
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
