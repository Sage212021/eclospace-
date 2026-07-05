// Ch. 18 §18.10 (Option B, décision opérateur du 04/07/2026) : l'export
// comptable prépare les écritures pour un cabinet/logiciel externe (Sage,
// Odoo, SAP, Excel — tous important un CSV structuré). Le plan de comptes
// ci-dessous s'inspire du SYSCOHADA révisé à titre indicatif : CES NUMÉROS DE
// COMPTE NE SONT PAS CERTIFIÉS et doivent être validés par le comptable de la
// maison avant tout usage réel — une erreur de compte dans une vraie
// déclaration a des conséquences fiscales concrètes.
export const SYSCOHADA_ACCOUNTS = {
  clients: "411000",
  ventesMarchandises: "707000",
  banque: "512000",
  caisse: "571000",
  droitsAuteur: "646000",
  fournisseurs: "401000",
  loyer: "613200",
  salaire: "661000",
  prestation: "622000",
  transport: "624000",
  communication: "623000",
  autre: "628000",
} as const;

export const JOURNAL_CODES = {
  ventes: "VE",
  avoirs: "AV",
  banque: "BQ",
  caisse: "CA",
  operationsDiverses: "OD",
} as const;

export function expenseCategoryToAccount(category: string): string {
  switch (category) {
    case "loyer":
      return SYSCOHADA_ACCOUNTS.loyer;
    case "salaire":
      return SYSCOHADA_ACCOUNTS.salaire;
    case "prestation":
      return SYSCOHADA_ACCOUNTS.prestation;
    case "transport":
      return SYSCOHADA_ACCOUNTS.transport;
    case "communication":
      return SYSCOHADA_ACCOUNTS.communication;
    default:
      return SYSCOHADA_ACCOUNTS.autre;
  }
}
