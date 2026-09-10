import { jsPDF } from "jspdf";
import type { PayslipPrintData } from "./print";
import { ECLOSION_LOGO_PNG, ECLOSION_LOGO_RATIO, ECLOSION_FILIGRANE_PNG, ECLOSION_FILIGRANE_RATIO } from "./payslipAssets";

// BULLETIN DE PAIE — modèle UNIQUE, reproduction fidèle de l'onglet « Bulletin »
// du classeur moteur (docs/paie/Moteur_Paie_Eclosion_V26_MAJ10.xlsm) :
//   en-tête maison + identité légale · informations salarié · éléments de
//   rémunération (Désignation · Base de calcul · Taux/détail · Montant) ·
//   cotisations (Nature · Assiette · Taux · Part salarié · Part patronale) ·
//   retenues internes détaillées · NET À PAYER · coût employeur · mode de
//   paiement · mentions légales · informations complémentaires & congés.
// Le moteur reste la source de vérité : ce rendu N'EFFECTUE AUCUN CALCUL, il
// met en page les montants déjà calculés (aperçu = PDF = impression).

const NAVY = [11, 11, 12] as const; // #0B0B0C — noir (bandeaux de section)
const BEIGE = [242, 240, 234] as const; // #F2F0EA (sous-totaux, labels)
const GOLD = [217, 178, 26] as const; // #D9B21A — or officiel (bandeau NET À PAYER)
const INK = [40, 40, 40] as const;
const MUTED = [110, 110, 110] as const;
const HAIR = [225, 228, 234] as const;
const LEFT = 14;
const RIGHT = 196;

// Groupe les milliers avec une espace NORMALE : la police Helvetica de jsPDF
// n'a pas la glyphe « espace fine insécable » (U+202F) que produit
// toLocaleString("fr-FR") — sans ce nettoyage, « 70 715 » s'imprime « 70/715 ».
const grp = (n: number) => Math.round(n).toLocaleString("fr-FR").replace(/\s/g, " ");
const money = (n: number) => `${grp(n)} FCFA`;
const pct = (f: number) => `${(f * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/\s/g, " ")} %`;
const dash = "—";

// Identité légale de la maison (feuille « Bulletin » du moteur, en-tête fixe).
const EMPLOYER = {
  name: "ECLOSION EDITION SARL",
  lines: [
    "Carrefour INSTIC – Nouvelle route Kondengui, Yaoundé, Cameroun",
    "B.P. 33071 Yaoundé · Tél. : (+237) 698 03 15 02 / 678 70 40 86",
    "eclosionedition@gmail.com · https://www.eclosion.cm",
    "RCCM : RC/YAO/2019/B/144 · NIU : M021912751174Y · N° Affil. CNPS : C-YAO-2019-0144",
  ],
};

const CONTRACT_LABEL: Record<string, string> = { cdi: "CDI", cdd: "CDD", stage: "Stage", prestation: "Prestation", pre_emploi: "Pré-emploi", essai: "Essai" };

function renderPayslip(doc: jsPDF, d: PayslipPrintData): void {
  const p = d.payslip;
  const r = d.rates ?? null;

  // ---- Filigrane : ampoule Éclosion au centre, très pâle (authenticité) ----
  // Dessiné EN PREMIER, derrière tout le contenu.
  const filH = 150, filW = filH * ECLOSION_FILIGRANE_RATIO;
  doc.saveGraphicsState();
  // @ts-expect-error — GState est fourni par jsPDF à l'exécution.
  doc.setGState(new doc.GState({ opacity: 0.55 }));
  doc.addImage(ECLOSION_FILIGRANE_PNG, "PNG", (210 - filW) / 2, (297 - filH) / 2, filW, filH, "eclFil", "SLOW");
  doc.restoreGraphicsState();

  let y = 12;

  // ---- En-tête : logo réel Éclosion + titre -------------------------------
  const logoW = 40, logoH = logoW / ECLOSION_LOGO_RATIO;
  doc.addImage(ECLOSION_LOGO_PNG, "PNG", LEFT, y, logoW, logoH, "eclLogo", "SLOW");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.setFontSize(13);
  doc.text("BULLETIN DE PAIE", RIGHT, y + 6, { align: "right" });
  y += logoH + 1;

  // Identité légale de l'employeur (bloc gauche) + période/date (bloc droit).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(EMPLOYER.name, LEFT, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(`Période : ${frPeriod(d.period)}`, RIGHT, y, { align: "right" });
  y += 3.6;
  EMPLOYER.lines.forEach((l) => {
    doc.text(l, LEFT, y);
    y += 3.3;
  });
  y += 1;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(LEFT, y, RIGHT, y);
  y += 4;

  // Matricule · Période · Édité le.
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  doc.text(`Matricule : `, LEFT, y);
  doc.setFont("helvetica", "bold");
  doc.text(d.matricule ?? dash, LEFT + 20, y);
  doc.setFont("helvetica", "normal");
  doc.text(`Période : ${d.period}`, 80, y);
  doc.text(`Édité le ${new Date().toLocaleDateString("fr-FR")}`, RIGHT, y, { align: "right" });
  y += 5;

  // ---- Helpers de mise en page --------------------------------------------
  const sectionBar = (title: string) => {
    doc.setFillColor(...NAVY);
    doc.rect(LEFT, y, RIGHT - LEFT, 5.4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), LEFT + 2, y + 3.8);
    y += 7.6;
  };
  const hair = () => {
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(0.15);
    doc.line(LEFT, y + 1.3, RIGHT, y + 1.3);
  };
  // Écrit une valeur en gras à `x`, en réduisant la police (8 → 6) si nécessaire
  // pour tenir dans `maxW` — évite qu'un libellé long (département, banque…)
  // ne déborde de la page.
  const valueFit = (text: string, x: number, maxW: number) => {
    doc.setFont("helvetica", "bold");
    let fs = 8;
    doc.setFontSize(fs);
    while (doc.getTextWidth(text) > maxW && fs > 6) {
      fs -= 0.3;
      doc.setFontSize(fs);
    }
    doc.setTextColor(...INK);
    doc.text(text, x, y);
  };
  const infoRow = (l1: string, v1: string, l2: string, v2: string) => {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(l1, LEFT, y);
    doc.text(l2, 108, y);
    valueFit(v1 || dash, 48, 108 - 48 - 1);
    valueFit(v2 || dash, 150, RIGHT - 150);
    y += 5;
  };

  // ---- Informations salarié ------------------------------------------------
  sectionBar("Informations salarié");
  infoRow("Matricule", d.matricule ?? dash, "Département", d.department ?? dash);
  infoRow("Nom & Prénom", d.employee_name, "Date d'entrée", d.hire_date ?? dash);
  infoRow("N° CNPS", d.cnps_number ?? dash, "NIU", d.niu ?? dash);
  infoRow("Catégorie / Échelon", d.category ?? dash, "Parts fiscales", d.fiscal_parts != null ? String(d.fiscal_parts) : dash);
  infoRow("Email", d.email ?? dash, "Poste", d.position ?? dash);
  y += 1;

  // ---- Éléments de rémunération (Désignation · Base · Taux · Montant) ------
  sectionBar("Éléments de rémunération (FCFA)");
  const REM_BASE = 118, REM_TAUX = 150;
  const remHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text("Désignation", LEFT, y);
    doc.text("Base de calcul", REM_BASE, y, { align: "right" });
    doc.text("Taux / détail", REM_TAUX, y, { align: "right" });
    doc.text("Montant", RIGHT, y, { align: "right" });
    y += 4;
  };
  const remRow = (label: string, base: string, taux: string, value: number, opts?: { bold?: boolean; neg?: boolean }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(...INK);
    doc.text(label, LEFT, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(...MUTED);
    if (!opts?.bold) {
      doc.text(base, REM_BASE, y, { align: "right" });
      doc.text(taux, REM_TAUX, y, { align: "right" });
    }
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(...INK);
    doc.text(`${opts?.neg && value > 0 ? "- " : ""}${money(value)}`, RIGHT, y, { align: "right" });
    hair();
    y += 5.1;
  };
  // Lignes libres (RH) : les GAINS sont itemisés séparément et retirés du montant
  // « Compléments » afin de ne pas les compter deux fois (le brut reste juste).
  const extraLines = d.extra_lines ?? [];
  const extraGains = extraLines.filter((e) => e.kind === "gain");
  const extraGainsTotal = extraGains.reduce((s, e) => s + e.amount, 0);
  remHeader();
  remRow("Salaire mensuel de base (forfaitaire)", "Forfait mensuel", dash, p.base);
  remRow("Compléments de salaire (primes du poste)", "Forfait", dash, p.complements - extraGainsTotal);
  extraGains.forEach((e) => remRow(e.label, "Ligne libre", dash, e.amount));
  // Prime d'ancienneté et retenue d'absence : toujours affichées (modèle moteur),
  // même à 0. La retenue d'absence réduit le brut (avant impôt).
  remRow("Prime d'ancienneté", "", "", p.prime_anciennete);
  remRow("Retenue absence injustifiée", "Journal retenues", dash, p.retenue_absence, { neg: true });
  doc.setFillColor(...BEIGE);
  doc.rect(LEFT, y - 3.4, RIGHT - LEFT, 5.2, "F");
  remRow("SALAIRE BRUT DU MOIS", "", "", p.salaire_brut, { bold: true });
  y += 1;

  // ---- Cotisations (Nature · Assiette · Taux · Part sal. · Part pat.) ------
  sectionBar("Cotisations sociales & fiscales — Législation camerounaise");
  const C_ASS = 112, C_TAUX = 142, C_SAL = 170;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  doc.text("Nature", LEFT, y);
  doc.text("Assiette", C_ASS, y, { align: "right" });
  doc.text("Taux", C_TAUX, y, { align: "right" });
  doc.text("Part salarié", C_SAL, y, { align: "right" });
  doc.text("Part patronale", RIGHT, y, { align: "right" });
  y += 4;
  const cot = (label: string, assiette: number | null, taux: string, sal: number | null, pat: number | null) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(...INK);
    doc.text(label, LEFT, y);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(assiette != null ? grp(assiette) : dash, C_ASS, y, { align: "right" });
    doc.text(taux, C_TAUX, y, { align: "right" });
    doc.setFontSize(7.6);
    doc.setTextColor(...INK);
    doc.text(sal != null ? money(sal) : dash, C_SAL, y, { align: "right" });
    doc.text(pat != null ? money(pat) : dash, RIGHT, y, { align: "right" });
    hair();
    y += 4.9;
  };
  const tx2 = (a: number | undefined, b: number | undefined) => (r ? `${a != null ? pct(a) : dash} / ${b != null ? pct(b) : dash}` : dash);
  cot("CNPS – Vieillesse, Invalidité, Décès (PVID)", p.assiette_cnps, tx2(r?.vid_sal, r?.vid_pat), p.pvid_salarie, p.pvid_patronal);
  cot("CNPS – Prestations familiales (PF)", null, r ? `${dash} / ${pct(r.pf)}` : dash, null, p.prestations_familiales);
  cot("CNPS – Accidents du travail (AT)", null, r ? `${dash} / ${pct(r.at)}` : dash, null, p.accidents_travail);
  cot("CFC – Crédit Foncier du Cameroun", p.assiette_fiscale, tx2(r?.cfc_sal, r?.cfc_pat), p.cfc_salarie, p.cfc_patronal);
  cot("FNE – Fonds National de l'Emploi", null, r ? `${dash} / ${pct(r.fne)}` : dash, null, p.fne);
  cot("Taxe Communale (TC) – barème", null, "barème", p.taxe_communale, null);
  cot("Redevance Audiovisuelle (RAV) – barème", null, "barème", p.rav, null);
  cot("IRPP + CAC (barème progressif)", null, r ? `barème + ${Math.round(r.cac * 100)}% CAC` : "barème", p.irpp_cac, null);
  // Totaux cotisations.
  doc.setFillColor(...BEIGE);
  doc.rect(LEFT, y - 3.2, RIGHT - LEFT, 5.2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  doc.setTextColor(...NAVY);
  doc.text("TOTAL RETENUES LÉGALES / CHARGES", LEFT, y);
  doc.text(money(p.total_retenues_salariales), C_SAL, y, { align: "right" });
  doc.text(money(p.total_charges_patronales), RIGHT, y, { align: "right" });
  y += 7;

  // ---- Retenues internes du mois (détaillées) -----------------------------
  sectionBar("Retenues internes du mois — prêts, avances, retards");
  const intr = d.internal ?? { avance: 0, pret: 0, retard: 0, autres: 0 };
  const intRow = (label: string, value: number, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(8);
    doc.setTextColor(bold ? NAVY[0] : INK[0], bold ? NAVY[1] : INK[1], bold ? NAVY[2] : INK[2]);
    doc.text(label, LEFT, y);
    doc.text(money(value), RIGHT, y, { align: "right" });
    hair();
    y += 4.9;
  };
  intRow("Avance sur salaire", intr.avance);
  intRow("Remboursement prêt personnel", intr.pret);
  intRow("Retenue retard non justifié", intr.retard);
  intRow("Autres retenues internes", intr.autres);
  // Retenues libres (RH) itemisées.
  extraLines.filter((e) => e.kind === "retenue").forEach((e) => intRow(e.label, e.amount));
  doc.setFillColor(...BEIGE);
  doc.rect(LEFT, y - 3.2, RIGHT - LEFT, 5.2, "F");
  intRow("TOTAL RETENUES INTERNES", p.total_retenues_internes, true);
  // Rappel de la retenue d'absence : elle n'est PAS une retenue interne (elle a
  // déjà réduit le salaire brut, avant impôt) — mais on la re-signale ici, là où
  // le RH cherche les retenues du mois, pour éviter l'impression qu'elle a été
  // oubliée. Montant informatif, volontairement NON additionné au total ci-dessus.
  if (p.retenue_absence > 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(6.9);
    doc.setTextColor(...MUTED);
    doc.text(
      `Rappel : retenue d'absence injustifiée −${money(p.retenue_absence)} déjà déduite du SALAIRE BRUT (avant impôt) — non recomptée ici.`,
      LEFT,
      y,
    );
    y += 4.4;
  }
  y += 2;

  // ---- NET À PAYER (bandeau or) -------------------------------------------
  doc.setFillColor(...GOLD);
  doc.rect(LEFT, y, RIGHT - LEFT, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("NET À PAYER", LEFT + 3, y + 6);
  doc.text(money(p.net_a_payer), RIGHT - 3, y + 6, { align: "right" });
  y += 13;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text("Coût total employeur", LEFT, y);
  doc.text(money(p.cout_employeur), RIGHT, y, { align: "right" });
  y += 6;

  // Mode de paiement.
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.text(`Mode de paiement : ${d.payment_mode ?? dash}${d.account_number ? `   ·   N° compte : ${d.account_number}` : ""}`, LEFT, y);
  y += 5;

  // Mentions légales (art. 89 congés + art. 68 conservation).
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  doc.text("Congés payés : acquisition 1,5 jour ouvrable / mois de service effectif (art. 89 du Code du Travail camerounais).", LEFT, y);
  y += 3.2;
  doc.text("Document à conserver sans limitation de durée (Code du Travail camerounais, art. 68). Moteur de paie Éclosion V2.", LEFT, y);
  y += 5;

  // ---- Informations complémentaires & congés ------------------------------
  sectionBar("Informations complémentaires & congés");
  infoRow("Type de contrat", d.contract_type ? CONTRACT_LABEL[d.contract_type] ?? d.contract_type : dash, "Fonction / Poste", d.position ?? dash);
  infoRow("Date de naissance", d.birth_date ?? dash, "Situation familiale", d.situation_familiale ?? dash);
  infoRow("Nombre d'enfants", d.children_count != null ? String(d.children_count) : dash, "Téléphone", d.phone ?? dash);
  infoRow("Solde congés disponible (j)", d.leave_balance != null ? String(d.leave_balance) : dash, "Jours de congés pris (cumul)", d.leave_taken != null ? String(d.leave_taken) : dash);
  infoRow("Contact urgence", d.emergency_contact ?? dash, "", "");
}

// AAAA-MM → « MM/AAAA ».
function frPeriod(period: string): string {
  const [y, m] = period.split("-");
  return m ? `${m}/${y}` : period;
}

// Bulletin unique → base64 (pièce jointe e-mail).
export function buildPayslipPdfBase64(d: PayslipPrintData): string {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  renderPayslip(doc, d);
  const uri = doc.output("datauristring");
  return uri.split("base64,")[1] ?? "";
}

// Aperçu / impression : ouvre le MÊME bulletin PDF dans un nouvel onglet (la
// visionneuse PDF du navigateur permet d'imprimer et d'enregistrer). Garantit
// « aperçu = PDF = impression » : un seul document, aucune divergence.
export function printPayslipPdf(d: PayslipPrintData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  renderPayslip(doc, d);
  const url = doc.output("bloburl");
  window.open(url, "_blank");
}

// Génération MENSUELLE GROUPÉE : un seul PDF, un bulletin par page.
export function downloadPayslipsPdf(list: PayslipPrintData[], filename: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  list.forEach((d, i) => {
    if (i > 0) doc.addPage();
    renderPayslip(doc, d);
  });
  doc.save(filename);
}
