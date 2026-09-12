import { jsPDF } from "jspdf";
import { EDITEUR_LEGAL } from "./print";
import { drawWatermark } from "./pdfWatermark";
import type { Absence } from "../api/client";

// Notification de décision d'absence/permission — PDF à en-tête Éclosion, généré
// côté navigateur (jsPDF, comme le contrat et le bulletin : pas de dépendance
// serveur). Sert à remettre / envoyer au salarié la décision RH (approuvée,
// refusée ou en cours de traitement), avec la référence de la demande.

const ABS_TYPE_LABELS: Record<string, string> = {
  conge: "Congé",
  maladie: "Maladie",
  mission: "Mission",
  teletravail: "Télétravail",
  permission: "Permission",
  suspension: "Suspension",
  injustifiee: "Absence injustifiée",
};

const frDate = (v?: string | null): string => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
};

function statusBlock(a: Absence): { heading: string; color: [number, number, number]; body: string } {
  const type = (ABS_TYPE_LABELS[a.type] ?? "demande").toLowerCase();
  if (a.status === "validee") {
    return {
      heading: "DEMANDE APPROUVÉE",
      color: [47, 125, 74], // vert
      body: `Nous vous informons que votre demande de ${type} pour la période indiquée ci-dessus a été APPROUVÉE. Nous vous invitons à respecter les conditions et dates convenues.`,
    };
  }
  if (a.status === "refusee") {
    return {
      heading: "DEMANDE REFUSÉE",
      color: [178, 58, 46], // rouge
      body: `Nous vous informons que votre demande de ${type} pour la période indiquée ci-dessus n'a pas pu être accordée.${a.reason ? ` Motif : ${a.reason}.` : ""} Vous pouvez vous rapprocher des Ressources humaines pour toute précision.`,
    };
  }
  return {
    heading: "DEMANDE EN COURS DE TRAITEMENT",
    color: [184, 116, 0], // ambre
    body: `Votre demande de ${type} pour la période indiquée ci-dessus est en cours de traitement. Une notification vous sera adressée dès qu'une décision aura été prise.`,
  };
}

export function absenceNoticeFileName(a: Absence): string {
  const name = a.employee ? `${a.employee.firstName}-${a.employee.lastName}` : "salarie";
  return `Notification-${(a.reference ?? name).replace(/[^A-Za-z0-9-]+/g, "")}.pdf`;
}

export function buildAbsenceNoticePdf(a: Absence): Blob {
  const ED = EDITEUR_LEGAL;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 20, R = 190, W = R - L;
  let y = 20;
  drawWatermark(doc);

  const line = (s: string, opts?: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] }) => {
    const size = opts?.size ?? 10.5;
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(size);
    if (opts?.color) doc.setTextColor(...opts.color); else doc.setTextColor(11, 11, 12);
    for (const ln of doc.splitTextToSize(s, W) as string[]) {
      doc.text(ln, L, y);
      y += size * 0.42 + 1.6;
    }
    y += opts?.gap ?? 0;
  };
  const rule = (col: [number, number, number] = [198, 183, 140]) => {
    doc.setDrawColor(...col); doc.setLineWidth(0.4); doc.line(L, y, R, y); y += 5;
  };
  const kv = (k: string, v: string) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(11, 11, 12);
    doc.text(k, L, y);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(v, W - 45) as string[], L + 45, y);
    y += 6.4;
  };

  // En-tête maison.
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(11, 11, 12);
  doc.text(ED.name, L, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(70, 65, 58);
  doc.text(doc.splitTextToSize(`${ED.siege} · Tél ${ED.tel} · ${ED.email} · ${ED.web}`, W) as string[], L, y);
  y += 8;
  // Bandeau or discret.
  doc.setDrawColor(217, 178, 26); doc.setLineWidth(1.1); doc.line(L, y, R, y); y += 8;

  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(154, 122, 18);
  doc.text("RESSOURCES HUMAINES", L, y); y += 6;
  doc.setFontSize(16); doc.setTextColor(11, 11, 12);
  doc.text("NOTIFICATION DE DÉCISION", L, y); y += 4;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70, 65, 58);
  doc.text(`Référence : ${a.reference ?? "—"}`, L, y); y += 8;

  // Identification de la demande.
  const emp = a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : "—";
  kv("Salarié :", emp + (a.employee?.position ? `  (${a.employee.position})` : ""));
  kv("Type de demande :", ABS_TYPE_LABELS[a.type] ?? a.type);
  kv("Motif :", a.reasonRef?.label ?? "—");
  kv("Période concernée :", `${frDate(a.fromDate)} au ${frDate(a.toDate)}`);
  kv("Date de la demande :", frDate(a.createdAt ?? null));
  y += 2; rule();

  // Décision.
  const sb = statusBlock(a);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...sb.color);
  doc.text(`Statut : ${sb.heading}`, L, y); y += 8;
  line(sb.body, { size: 10.5, color: [11, 11, 12], gap: 3 });

  if (a.status !== "en_attente") {
    y += 1;
    kv(a.status === "validee" ? "Validée par :" : "Refusée par :", a.approvedByName ?? "Responsable RH");
    kv("Date de décision :", frDate(a.approvedAt ?? null));
  }

  y += 6; rule([220, 220, 216]);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(70, 65, 58);
  doc.text("Ressources humaines", L, y); y += 5;
  doc.setFont("helvetica", "bold"); doc.setTextColor(11, 11, 12);
  doc.text(ED.name, L, y);

  // Pied de page.
  doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(120, 116, 110);
  doc.text("Document généré par ÉclosPace — Ressources humaines. Ce document fait foi de la décision RH pour la demande référencée.", L, 285, { maxWidth: W });

  return doc.output("blob");
}
