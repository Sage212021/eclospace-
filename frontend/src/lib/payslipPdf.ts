import { jsPDF } from "jspdf";
import type { PayslipPrintData } from "./print";

// Bulletin de paie PDF côté navigateur (décision opérateur : pas de dépendance
// serveur/Chromium), calqué sur le MODÈLE DU CLASSEUR ERP : bloc salarié,
// éléments de rémunération, cotisations en deux colonnes (part salariale ET
// patronale), éléments internes, net à payer, coût employeur, mode de paiement.
// Moteur de calcul inchangé. Factorisé pour le bulletin unique (base64 e-mail)
// et la génération mensuelle groupée (un bulletin par page).

const NAVY = [22, 35, 61] as const;
const GOLD = [200, 154, 27] as const;
const INK = [40, 40, 40] as const;
const MUTED = [110, 110, 110] as const;
const LEFT = 14;
const RIGHT = 196;
const money = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;

function renderPayslip(doc: jsPDF, d: PayslipPrintData): void {
  const p = d.payslip;
  let y = 16;

  // ---- En-tête maison ------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.setFontSize(16);
  doc.text("Éclosion Édition", LEFT, y);
  doc.setFontSize(12);
  doc.setTextColor(...GOLD);
  doc.text("BULLETIN DE PAIE", RIGHT, y, { align: "right" });
  y += 4;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.6);
  doc.line(LEFT, y, RIGHT, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Éclosion Édition SARL — L'avenir du livre · Yaoundé, Cameroun · Contrat de travail camerounais & législation CNPS", LEFT, y);
  y += 6;

  // ---- Bloc « Informations salarié » --------------------------------------
  const sectionBar = (title: string) => {
    doc.setFillColor(...NAVY);
    doc.rect(LEFT, y, RIGHT - LEFT, 5.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), LEFT + 2, y + 3.9);
    y += 8;
  };
  // Paire d'infos (label gris + valeur) sur deux colonnes.
  const infoRow = (l1: string, v1: string, l2: string, v2: string) => {
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(l1, LEFT, y);
    doc.text(l2, 108, y);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.text(v1 || "—", 46, y);
    doc.text(v2 || "—", 150, y);
    y += 5;
  };

  sectionBar("Informations salarié");
  infoRow("Nom & Prénom", d.employee_name, "Matricule", d.matricule ?? "—");
  infoRow("N° CNPS", d.cnps_number ?? "—", "NIU (fiscal)", d.niu ?? "—");
  infoRow("Département", d.department ?? "—", "Poste / Fonction", d.position ?? "—");
  infoRow("Catégorie / Échelon", d.category ?? "—", "Date d'entrée", d.hire_date ?? "—");
  infoRow("Parts fiscales", d.fiscal_parts != null ? String(d.fiscal_parts) : "—", "Période", d.period);
  y += 1;

  // ---- Éléments de rémunération -------------------------------------------
  const row = (label: string, value: number, opts?: { bold?: boolean; gold?: boolean; neg?: boolean; indent?: boolean }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(8.7);
    doc.setTextColor(opts?.gold ? GOLD[0] : INK[0], opts?.gold ? GOLD[1] : INK[1], opts?.gold ? GOLD[2] : INK[2]);
    doc.text(label, LEFT + (opts?.indent ? 3 : 0), y);
    doc.text(`${opts?.neg ? "− " : ""}${money(value)}`, RIGHT, y, { align: "right" });
    doc.setDrawColor(230, 233, 239);
    doc.setLineWidth(0.15);
    doc.line(LEFT, y + 1.4, RIGHT, y + 1.4);
    y += 5.4;
  };

  sectionBar("Éléments de rémunération (FCFA)");
  row("Salaire de base", p.base);
  if (p.complements) row("Compléments de salaire (primes du poste, heures sup.)", p.complements);
  if (p.prime_anciennete > 0) row("Prime d'ancienneté", p.prime_anciennete);
  if (p.retenue_absence > 0) row("Retenue d'absence", p.retenue_absence, { neg: true });
  row("SALAIRE BRUT DU MOIS", p.salaire_brut, { bold: true });
  y += 1;

  // ---- Cotisations : part salariale ET part patronale ---------------------
  sectionBar("Cotisations sociales & fiscales — législation camerounaise");
  // En-têtes de colonnes.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("Nature", LEFT, y);
  doc.text("Part salariale", 150, y, { align: "right" });
  doc.text("Part patronale", RIGHT, y, { align: "right" });
  y += 4;
  const cot = (label: string, sal: number | null, pat: number | null) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(label, LEFT, y);
    doc.text(sal != null ? money(sal) : "—", 150, y, { align: "right" });
    doc.text(pat != null ? money(pat) : "—", RIGHT, y, { align: "right" });
    doc.setDrawColor(230, 233, 239);
    doc.setLineWidth(0.15);
    doc.line(LEFT, y + 1.4, RIGHT, y + 1.4);
    y += 5.2;
  };
  cot("CNPS — Vieillesse, invalidité, décès (PVID)", p.pvid_salarie, p.pvid_patronal);
  cot("CNPS — Prestations familiales (PF)", null, p.prestations_familiales);
  cot("CNPS — Accidents du travail (AT)", null, p.accidents_travail);
  cot("CFC — Crédit Foncier du Cameroun", p.cfc_salarie, p.cfc_patronal);
  cot("FNE — Fonds National de l'Emploi", null, p.fne);
  cot("Taxe communale (TC)", p.taxe_communale, null);
  cot("Redevance audiovisuelle (RAV)", p.rav, null);
  cot("IRPP + CAC (barème progressif)", p.irpp_cac, null);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.7);
  doc.setTextColor(...NAVY);
  doc.text("TOTAL RETENUES / CHARGES", LEFT, y);
  doc.text(money(p.total_retenues_salariales), 150, y, { align: "right" });
  doc.text(money(p.total_charges_patronales), RIGHT, y, { align: "right" });
  y += 7;

  // ---- Éléments internes du mois (net) ------------------------------------
  if (p.total_retenues_internes > 0) {
    sectionBar("Éléments internes du mois (avances, prêts, retards…)");
    row("Total retenues internes", p.total_retenues_internes, { neg: true, bold: true });
    y += 1;
  }

  // ---- Net à payer (bandeau or) -------------------------------------------
  y += 1;
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

  // ---- Mode de paiement ----------------------------------------------------
  if (d.payment_mode || d.account_number) {
    doc.setTextColor(...MUTED);
    doc.setFontSize(8.5);
    doc.text(`Mode de paiement : ${d.payment_mode ?? "—"}${d.account_number ? `   ·   N° compte : ${d.account_number}` : ""}`, LEFT, y);
    y += 6;
  }

  // ---- Pied ----------------------------------------------------------------
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("Document à conserver sans limitation de durée (art. 68 du Code du travail camerounais).", LEFT, 288);
}

// Bulletin unique → base64 (pièce jointe e-mail).
export function buildPayslipPdfBase64(d: PayslipPrintData): string {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  renderPayslip(doc, d);
  const uri = doc.output("datauristring");
  return uri.split("base64,")[1] ?? "";
}

// Génération MENSUELLE GROUPÉE : un seul PDF, un bulletin par page.
export function downloadPayslipsPdf(list: PayslipPrintData[], filename: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  list.forEach((d, i) => {
    if (i > 0) doc.addPage();
    renderPayslip(doc, d);
  });
  doc.save(filename);
}
