import { jsPDF } from "jspdf";
import type { PayslipPrintData } from "./print";

// Génère le bulletin de paie en PDF côté navigateur (décision opérateur : pas de
// dépendance serveur/Chromium) et renvoie son contenu en base64, pour l'attacher
// à l'e-mail via le moteur d'envoi existant. Reprend les mêmes rubriques que le
// bulletin imprimé (moteur de calcul inchangé).
export function buildPayslipPdfBase64(d: PayslipPrintData): string {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const p = d.payslip;
  const money = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
  const left = 16;
  const right = 194;
  let y = 20;

  const NAVY = [22, 35, 61] as const;
  const GOLD = [200, 154, 27] as const;

  // En-tête maison
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.setFontSize(16);
  doc.text("Éclosion Édition", left, y);
  doc.setFontSize(11);
  doc.setTextColor(...GOLD);
  doc.text("Bulletin de paie", right, y, { align: "right" });
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.6);
  y += 3;
  doc.line(left, y, right, y);
  y += 8;

  // Période / salarié
  doc.setTextColor(60, 60, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const meta = [`Période : ${d.period}`, d.matricule ? `Matricule : ${d.matricule}` : "", d.cnps_number ? `CNPS : ${d.cnps_number}` : "", d.niu ? `NIU : ${d.niu}` : ""].filter(Boolean).join("    ");
  doc.text(meta, left, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.setFontSize(13);
  doc.text(d.employee_name, left, y);
  y += 8;

  // Tableau générique
  const row = (label: string, value: number, opts?: { bold?: boolean; gold?: boolean; neg?: boolean }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(10);
    doc.setTextColor(opts?.gold ? GOLD[0] : 40, opts?.gold ? GOLD[1] : 40, opts?.gold ? GOLD[2] : 40);
    doc.text(label, left, y);
    doc.text(`${opts?.neg ? "− " : ""}${money(value)}`, right, y, { align: "right" });
    doc.setDrawColor(230, 233, 239);
    doc.setLineWidth(0.2);
    doc.line(left, y + 1.5, right, y + 1.5);
    y += 6.5;
  };
  const section = (title: string) => {
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text(title.toUpperCase(), left, y);
    y += 5;
  };

  section("Rémunération");
  row("Salaire de base", p.base);
  row("Compléments de salaire", p.complements);
  if (p.prime_anciennete > 0) row("Prime d'ancienneté", p.prime_anciennete);
  if (p.retenue_absence > 0) row("Retenue absence injustifiée", p.retenue_absence, { neg: true });
  row("Salaire brut du mois", p.salaire_brut, { bold: true });

  section("Cotisations & retenues (législation camerounaise)");
  row("CNPS – PVID (vieillesse/invalidité/décès)", p.pvid_salarie, { neg: true });
  row("CFC – Crédit Foncier du Cameroun", p.cfc_salarie, { neg: true });
  row("Taxe communale", p.taxe_communale, { neg: true });
  row("Redevance audiovisuelle (RAV)", p.rav, { neg: true });
  row("IRPP + CAC (barème progressif)", p.irpp_cac, { neg: true });
  row("Total retenues salariales", p.total_retenues_salariales, { bold: true });

  y += 2;
  row("NET À PAYER", p.net_a_payer, { bold: true, gold: true });
  y += 2;
  row("Coût total employeur", p.cout_employeur, { bold: true });

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("Document à conserver sans limitation de durée (art. 68 du Code du travail camerounais).", left, y);

  const uri = doc.output("datauristring");
  return uri.split("base64,")[1] ?? "";
}
