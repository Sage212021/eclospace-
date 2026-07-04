// Données de référence du Lot 0 : les 17 départements (Ch. 3 §3.2, décision D-002),
// les rôles identifiés au Ch. 2 §2.2 et Ch. 3 §3.3, et un compte administrateur
// initial. Rejouable sans effet de bord (upsert par code).
import argon2 from "argon2";
import { PrismaClient, PermissionAction } from "@prisma/client";

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

// Modules déjà exposés par l'API au Lot 0 (Ch. 2 §2.3 : 4 niveaux d'action).
// Les modules métier (manuscrits, contrats...) seront ajoutés lot par lot.
const lot0Modules = ["documents", "notifications", "users", "settings"];
const actions = Object.values(PermissionAction);

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
  for (const module of lot0Modules) {
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
