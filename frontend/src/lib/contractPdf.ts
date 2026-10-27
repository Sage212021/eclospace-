import { jsPDF } from "jspdf";
import { EDITEUR_LEGAL, buildAuthorContractHtml, buildAuthorAccountContractHtml, buildDemiContractHtml, buildServiceContractHtml, type PublisherLegal } from "./print";
import { drawWatermark } from "./pdfWatermark";
import { inkStamp, type InkedImage } from "./stampInk";
import type { ContractDetail, Branding } from "../api/client";

// Signature + cachet de l'éditeur, images déjà « encrées » (fond transparent).
export interface ContractPdfSign {
  signature?: InkedImage | null;
  cachet?: InkedImage | null;
  dgName?: string;
  dgTitle?: string;
}

// Contrat d'édition à compte d'éditeur — génération PDF côté navigateur (jsPDF,
// même choix que le bulletin de paie : pas de dépendance serveur/Chromium, pas
// de html2canvas). Sert à TRANSFÉRER le contrat (messagerie interne / WhatsApp)
// en pièce jointe. La version imprimée stylée reste `printAuthorContract`
// (print.ts) ; ce module en reprend fidèlement l'en-tête (identité réelle de
// l'auteur, termes variables) et les 15 articles du modèle maison.

const frDate = (v?: string | null): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR");
};
const dots = (n = 14) => "…".repeat(n);
const pct = (rate: number) => `${(rate * 100).toFixed(2).replace(/\.00$/, "").replace(".", ",")} %`;

// Les 15 articles du modèle (texte brut ; les libellés « 1/ … » restent inline).
function articles(vars: { titre: string; dureeTxt: string; tauxTxt: string }): { n: number; title: string; paras: string[] }[] {
  const { titre, dureeTxt, tauxTxt } = vars;
  return [
    { n: 1, title: "OBJET DU CONTRAT", paras: [
      `L'auteur cède à titre exclusif à l'éditeur, sur l'œuvre de sa composition qui a pour titre « ${titre} », ci-après dénommée « l'œuvre » : le droit de fabriquer ou de faire fabriquer en nombre des exemplaires de l'œuvre ; les droits seconds et dérivés attachés à cette œuvre ; le droit de réaliser ou de faire réaliser l'œuvre sous une forme numérique.`,
      "Tout droit non expressément cédé aux termes du présent contrat demeure la seule propriété de l'auteur et ne pourra être exploité par l'éditeur, sauf accord formel faisant l'objet d'un nouveau contrat ou d'un avenant. La cession des droits d'adaptation audiovisuelle sur l'œuvre fera l'objet, s'il y a lieu, d'un contrat distinct." ] },
    { n: 2, title: "OBLIGATIONS DE L'AUTEUR", paras: [
      "1/ Clause de garantie. L'auteur garantit à l'éditeur la jouissance entière et libre de toutes servitudes des droits cédés contre tous troubles, revendications et évictions quelconques. Il déclare notamment que son œuvre est originale, ne contenant ni emprunt à une création protégée par la propriété intellectuelle, ni propos à caractère diffamatoire. L'auteur garantit également que son œuvre ne fait l'objet ni d'un autre contrat ni d'un droit de préférence consenti à un tiers.",
      "2/ Remise des éléments permettant la publication. L'auteur s'engage à remettre à l'éditeur, qui a l'obligation d'en accuser réception, l'œuvre dans sa forme définitive et complète dans une période de 3 mois au plus tard. Les documents originaux fournis par l'auteur lui seront restitués sur simple demande, au plus tard 3 mois après la parution." ] },
    { n: 3, title: "OBLIGATIONS DE L'ÉDITEUR", paras: [
      "1/ Publication. L'éditeur s'engage à assurer personnellement et à ses frais la publication de l'ouvrage dans les délais prévus à l'article 9.",
      "2/ Exploitation permanente et suivie. L'éditeur s'engage à assurer une exploitation permanente et suivie de l'œuvre et à lui procurer une diffusion auprès du public.",
      "3/ Cession à des tiers. Sous réserve d'une publication préalable, l'éditeur est habilité à accorder à des tiers, au Cameroun comme à l'étranger, toutes autorisations de reproduire et de représenter tout ou partie de l'œuvre, dans la limite des droits cédés, en informant l'auteur des exploitations concédées.",
      "4/ Reddition des comptes. L'éditeur est tenu de rendre compte à l'auteur du calcul de la rémunération de façon explicite et transparente. Les comptes sont arrêtés chaque année le 15 décembre ; un premier bilan des ventes est communiqué 3 mois après la mise en vente. L'état des comptes mentionne le stock initial et final, les exemplaires fabriqués, vendus, hors droits et détruits, les cessions de droits, les redevances dues et versées, ainsi que les assiettes et taux.",
      "5/ Paiement des droits. Le paiement des droits d'auteur intervient au plus tard au mois de novembre de chaque année, par virement bancaire, cash ou transfert d'argent mobile (MTN, Orange Money, transfert national/international). Le virement bancaire est obligatoire pour toute somme égale ou supérieure à 150 000 FCFA.",
      "6/ Clause d'audit. Une fois par an, l'auteur pourra vérifier les comptes de l'éditeur, sous réserve d'un préavis de 15 jours. En cas d'erreurs révélées, le coût de l'audit est à la charge de l'éditeur.",
      "7/ Droit moral. L'éditeur exerce les droits cédés dans le strict respect du droit moral et n'apporte à l'œuvre aucune modification sans accord préalable formel de l'auteur." ] },
    { n: 4, title: "GESTION COLLECTIVE", paras: [
      "Certains droits cédés font ou sont susceptibles de faire l'objet d'une gestion collective dont les parties acceptent l'application. Toute disposition contraire aux règles de cette gestion collective sera réputée non écrite. L'auteur percevra notamment la rémunération lui revenant au titre du droit de reprographie." ] },
    { n: 5, title: "ÉTENDUE DE LA CESSION", paras: [
      `1/ Durée. La présente cession est consentie pour une durée de ${dureeTxt}, tacitement reconductible pour une même durée sauf lettre recommandée avec accusé de réception adressée au plus tard 3 mois avant l'échéance. La cession engage l'auteur, ses héritiers et ayants droit.`,
      "2/ Territoire. La présente cession prendra effet en tous lieux.",
      "3/ Droits cédés. L'auteur cède le droit de reproduire, publier et exploiter l'œuvre sous forme imprimée, ainsi que les droits seconds et dérivés (reproduction et adaptation graphique, traduction en toutes langues, représentation et communication au public, hors adaptation audiovisuelle). Les exploitations non visées demeurent la propriété de l'auteur." ] },
    { n: 6, title: "REMISE DES ÉPREUVES ET BON À TIRER", paras: [
      "L'éditeur envoie les épreuves à l'auteur, qui devra les lire, les corriger et les retourner dans un délai maximum de 3 semaines dès réception, revêtues de son « bon à tirer ». À défaut de retour dans ce délai, l'éditeur pourra confier les fichiers à un correcteur de son choix, sans conséquence financière pour l'auteur." ] },
    { n: 7, title: "PRÉROGATIVES DE L'ÉDITEUR", paras: [
      "L'éditeur détermine, sous réserve du droit moral de l'auteur : le format de l'ouvrage, sa présentation et son prix de vente. Les éléments promotionnels relèvent de l'éditeur et sont soumis à l'auteur pour approbation.",
      "L'éditeur s'engage à faire figurer sur la couverture et les documents promotionnels le nom de l'auteur ou son pseudonyme, et à n'apporter à l'œuvre aucune modification sans autorisation écrite." ] },
    { n: 8, title: "TIRAGE", paras: [
      `L'éditeur s'engage à faire imprimer ${dots(8)} exemplaires, tirés en une seule fois et constituant le premier tirage. Lors du premier tirage, l'éditeur remet gratuitement 3 exemplaires à l'auteur pour son usage personnel, puis un exemplaire pour chaque nouveau tirage ou édition.` ] },
    { n: 9, title: "PUBLICATION SOUS FORME IMPRIMÉE", paras: [
      `L'éditeur s'engage à publier l'œuvre au plus tard le ${dots(12)}. Si l'ouvrage n'est pas publié dans les 6 mois suivant la remise des éléments, le contrat est résilié aux torts exclusifs de l'éditeur, après mise en demeure restée sans effet pendant 1 mois.` ] },
    { n: 10, title: "EXPLOITATION PERMANENTE ET SUIVIE", paras: [
      "À compter de la publication, l'éditeur assure une diffusion active : présentation aux catalogues papier et numérique, disponibilité dans au moins une base interprofessionnelle, qualité conforme aux règles de l'art, satisfaction des commandes dans les meilleurs délais. À défaut, la cession est résiliée de plein droit après mise en demeure restée sans effet pendant 6 mois." ] },
    { n: 11, title: "RÉMUNÉRATION DE L'AUTEUR", paras: [
      `1/ Exploitation principale. En contrepartie de la cession, l'éditeur verse à l'auteur des droits d'auteur de ${tauxTxt} sur chaque exemplaire vendu, calculés sur le prix de vente public hors taxes (PPHT) de l'ouvrage, fixé à ${dots(8)} FCFA.`,
      `2/ Droits seconds et dérivés. En cas de cessions à des tiers, l'éditeur verse à l'auteur ${tauxTxt} des sommes brutes encaissées ou comptabilisées. Aucune commission annexe ne peut être déduite de l'assiette de calcul.`,
      "3/ Exemplaires sans droit. La rémunération ne porte pas sur : les 5 exemplaires du dépôt légal, au plus 3 exemplaires de service de presse/promotion, 2 exemplaires de justificatifs, 3 exemplaires remis gratuitement à l'auteur." ] },
    { n: 12, title: "MISE AU PILON", paras: [
      "Si, dans les 2 ans suivant la mise en vente, l'éditeur a en stock plus d'exemplaires que nécessaire, il peut proposer à l'auteur de racheter tout ou partie du stock, ou à défaut le pilonner, en conservant un stock suffisant à l'exploitation. L'auteur est informé du pilonnage lors de la reddition annuelle des comptes." ] },
    { n: 13, title: "FORCE MAJEURE", paras: [
      "En cas de force majeure entraînant la détérioration ou la destruction du stock, l'éditeur n'est pas tenu pour responsable. Toutefois, s'il perçoit une indemnité d'assurance sur les exemplaires détruits, l'auteur percevra la part de droits prévue au contrat, au prorata du montant alloué." ] },
    { n: 14, title: "RÉSILIATION DE PLEIN DROIT", paras: [
      "Manquement au paiement des droits. À défaut de paiement dans les délais, l'auteur dispose de 12 mois pour mettre l'éditeur en demeure ; sans effet dans les 6 mois, le contrat est résilié de plein droit.",
      "Redressement ou liquidation. La procédure de sauvegarde ou de redressement n'entraîne pas la résiliation ; en cas de cessation d'activité de plus de 3 mois ou de liquidation, l'auteur peut demander la résiliation et dispose d'un droit de préemption sur les exemplaires (rachat plafonné à 15 % du PPHT).",
      "Fin d'exploitation. Le contrat est résilié lorsque, 5 ans après la publication et pendant 2 années consécutives, les redditions ne font apparaître aucun droit versé ou crédité." ] },
    { n: 15, title: "LITIGES", paras: [
      "Le présent contrat est soumis à la loi camerounaise. Tout différend fera l'objet d'une tentative d'arrangement amiable ; à défaut, seuls les tribunaux de Yaoundé sont compétents." ] },
  ];
}

// Construit le PDF du contrat d'édition et le renvoie sous forme de Blob.
// `sign` (facultatif) : signature + cachet DG apposés dans la case « L'éditeur »
// (images déjà encrées, fond transparent) quand la maison signe automatiquement.
export function buildAuthorContractPdf(c: ContractDetail, publisher?: Partial<PublisherLegal> | null, sign?: ContractPdfSign | null, templates?: Record<number, string>): Blob {
  const ED = { ...EDITEUR_LEGAL, ...(publisher ?? {}) };
  const p = c.partner;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 18, R = 192, W = R - L;
  const bottom = 282;
  let y = 20;
  drawWatermark(doc);

  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); drawWatermark(doc); y = 20; } };
  const text = (s: string, opts?: { size?: number; bold?: boolean; gap?: number }) => {
    const size = opts?.size ?? 9.5;
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(s, W) as string[];
    for (const line of lines) {
      ensure(size * 0.42 + 1.4);
      doc.text(line, L, y);
      y += size * 0.42 + 1.4;
    }
    y += opts?.gap ?? 1.6;
  };

  // En-tête éditeur.
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(ED.name, L, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(doc.splitTextToSize(`${ED.desc} ${ED.rc} · N° Contribuable ${ED.niu}. Siège : ${ED.siege} · Tél ${ED.tel} · ${ED.email} · ${ED.web}`, W) as string[], L, y);
  y += 10;
  doc.setDrawColor(200); doc.line(L, y, R, y); y += 8;

  // Titre + numéro.
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("CONTRAT D'ÉDITION À COMPTE D'ÉDITEUR", L, y); y += 7;
  doc.setFontSize(9.5); doc.setFont("helvetica", "normal");
  doc.text(`Contrat n° ${c.contractNumber}`, L, y); y += 8;

  // Parties (identité réelle de l'auteur).
  const auteur = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || dots(20);
  const idBits = [
    `né(e) le ${frDate(p.birthDate) ?? dots(10)} à ${p.birthPlace || dots(12)}`,
    `de nationalité ${p.nationality || dots(12)}`,
    `profession ${p.profession || dots(14)}`,
    `BP : ${p.address || dots(14)}`,
    `Tél. : ${p.phone || dots(12)}`,
    `CNI n° ${p.idNumber || dots(12)} délivrée le ${frDate(p.idIssuedDate) ?? dots(10)} à ${p.idIssuedPlace || dots(10)}`,
    `Email : ${p.email || dots(20)}`,
  ].join(", ");
  text("Entre les soussignés", { bold: true, gap: 0.5 });
  text(`M./Mme ${auteur}, ${idBits}, ci-après dénommé « l'Auteur », d'une part ;`);
  text(`Et : ${ED.name}, ${ED.desc} ${ED.rc}, N° Contribuable ${ED.niu}. Siège social : ${ED.siege} ; Tél : ${ED.tel}, Email : ${ED.email}, représentée par ${ED.rep}, ci-après dénommée « l'Éditeur », d'autre part ;`);
  text("Il a été convenu ce qui suit :", { bold: true });

  // Variables de termes.
  const titre = c.manuscript?.title || dots(30);
  const rt = c.royaltyTerms;
  const tauxTxt = rt?.tiers?.length
    ? rt.tiers.map((t) => pct(Number(t.rate))).filter((v, i, a) => a.indexOf(v) === i).join(" / ")
    : dots(6);
  const dureeTxt = c.durationMonths
    ? c.durationMonths % 12 === 0 ? `${c.durationMonths / 12} (0${c.durationMonths / 12}) années` : `${c.durationMonths} mois`
    : `${dots(6)} années`;

  const base = articles({ titre, dureeTxt, tauxTxt });
  // §9 — Surcharge PROPRE au contrat (articleOverrides) > modèle éditable
  // (templates) > texte standard. Champs {{…}} remplacés (valeurs plates).
  const overrides = (c.articleOverrides && typeof c.articleOverrides === "object" && !Array.isArray(c.articleOverrides)
    ? (c.articleOverrides as Record<string, string>)
    : {});
  const ctx: Record<string, string> = {
    numero: c.contractNumber,
    titre: (c.manuscript?.title ?? "").trim(),
    auteur: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    editeur: ED.name,
    taux: rt?.tiers?.length ? rt.tiers.map((t) => pct(Number(t.rate))).filter((v, i, a) => a.indexOf(v) === i).join(" / ") : "",
    duree: c.durationMonths ? (c.durationMonths % 12 === 0 ? `${c.durationMonths / 12} année(s)` : `${c.durationMonths} mois`) : "",
  };
  const fill = (t: string) => t.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, k: string) => (ctx[k.toLowerCase()] ? ctx[k.toLowerCase()] : m));
  const resolved = base.map((a) => {
    const raw = overrides[String(a.n)] ?? templates?.[a.n];
    if (raw === undefined || raw === null || !String(raw).trim()) return a;
    return { ...a, paras: fill(String(raw)).split(/\n{2,}/).map((s) => s.replace(/\n/g, " ").trim()).filter(Boolean) };
  });
  // Articles additionnels propres au contrat (clauses ajoutées), numérotés 16+.
  const extra = (c.customClauses ?? []).map((cl, i) => ({ n: 16 + i, title: (cl.title || "").toUpperCase(), paras: [cl.body] }));
  for (const a of [...resolved, ...extra]) {
    ensure(12);
    y += 2;
    text(`ARTICLE ${a.n} — ${a.title}`, { bold: true, size: 10.5, gap: 1 });
    for (const para of a.paras) text(para);
  }

  ensure(30);
  y += 4;
  text(`Fait à ${ED.ville}, le ${dots(14)}. En deux (02) exemplaires.`);
  y += 6;
  ensure(44);
  const colR = L + W / 2;
  doc.setFontSize(9.5); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
  doc.text("L'auteur", L, y); doc.text("L'éditeur", colR, y);
  const sigTop = y + 3;
  // Case « L'éditeur » : signature manuscrite + cachet DG apposés (fondus, fond
  // transparent) si la maison signe automatiquement. La case « L'auteur » reste
  // vierge (signée à la main). Le cachet est décalé à droite de la signature
  // pour ne pas la masquer (cohérent avec l'impression HTML, D-035).
  if (sign?.signature) {
    const h = 15; const w = Math.min(46, (h * sign.signature.w) / sign.signature.h);
    try { doc.addImage(sign.signature.url, "PNG", colR, sigTop, w, h, "ctrSig", "SLOW"); } catch { /* ignore */ }
  }
  if (sign?.cachet) {
    const h = 30; const w = Math.min(42, (h * sign.cachet.w) / sign.cachet.h);
    try { doc.addImage(sign.cachet.url, "PNG", colR + 22, sigTop - 3, w, h, "ctrCachet", "SLOW"); } catch { /* ignore */ }
  }
  y = sigTop + (sign && (sign.signature || sign.cachet) ? 32 : 13);
  doc.setDrawColor(120);
  doc.line(L, y, L + 60, y); doc.line(colR, y, colR + 60, y);
  y += 4;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110);
  doc.text("Signature (lu et approuvé)", L, y);
  doc.text("Signature & cachet", colR, y);
  if (sign?.dgName) {
    y += 5; doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0);
    doc.text(sign.dgName, colR, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90);
    for (const line of (sign.dgTitle ?? "").split("\n").map((s) => s.trim()).filter(Boolean)) { y += 3.6; doc.text(line, colR, y); }
  }
  doc.setTextColor(0);

  return doc.output("blob");
}

// Télécharge le contrat en PDF NATIF (vectoriel, net sur tout appareil, mobile
// compris). Prépare d'abord la signature + le cachet DG (fond blanc rendu
// transparent) quand la maison signe automatiquement les contrats.
export async function downloadAuthorContractPdf(
  c: ContractDetail,
  publisher?: Partial<PublisherLegal> | null,
  branding?: Branding | null,
  templates?: Record<number, string>,
): Promise<void> {
  let sign: ContractPdfSign | undefined;
  if (branding && branding.auto_sign_contracts) {
    const [cachet, signature] = await Promise.all([inkStamp(branding.cachet_generale), inkStamp(branding.signature_dg)]);
    sign = { cachet, signature, dgName: branding.dg_name, dgTitle: branding.dg_title };
  }
  const blob = buildAuthorContractPdf(c, publisher, sign, templates);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Contrat-${c.contractNumber}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// PDF générique construit À PARTIR DU MÊME HTML que l'aperçu/impression, pour que
// le document TRANSFÉRÉ (messagerie / WhatsApp) corresponde EXACTEMENT au contrat
// affiché — quel que soit le modèle (édition, compte d'auteur, compte à demi,
// prestation). On parse les blocs (titre, articles, paragraphes, listes) et on
// rend en texte ; la zone de signature est dessinée par jsPDF (non coupée) à
// partir de `sign` (images encrées), comme le PDF natif.
export function buildContractPdfFromHtml(html: string, publisher?: Partial<PublisherLegal> | null, sign?: ContractPdfSign | null): Blob {
  const ED = { ...EDITEUR_LEGAL, ...(publisher ?? {}) };
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 18, R = 192, W = R - L, bottom = 282;
  let y = 20;
  drawWatermark(doc);
  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); drawWatermark(doc); y = 20; } };
  const text = (s: string, opts?: { size?: number; bold?: boolean; gap?: number }) => {
    const size = opts?.size ?? 9.5;
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(0);
    for (const chunk of s.split("\n")) {
      const lines = doc.splitTextToSize(chunk, W) as string[];
      for (const line of lines) { ensure(size * 0.42 + 1.4); doc.text(line, L, y); y += size * 0.42 + 1.4; }
    }
    y += opts?.gap ?? 1.6;
  };

  // En-tête éditeur (identique au PDF natif).
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(ED.name, L, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(doc.splitTextToSize(`${ED.desc} ${ED.rc} · N° Contribuable ${ED.niu}. Siège : ${ED.siege} · Tél ${ED.tel} · ${ED.email} · ${ED.web}`, W) as string[], L, y);
  y += 10; doc.setDrawColor(200); doc.line(L, y, R, y); y += 8;

  const root = new DOMParser().parseFromString(`<div id="w">${html}</div>`, "text/html").getElementById("w");
  const blockText = (el: Element): string => {
    const c2 = el.cloneNode(true) as HTMLElement;
    c2.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    return (c2.textContent || "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  };

  const renderSignatures = () => {
    ensure(46);
    y += 2;
    const colR = L + W / 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(0);
    doc.text("L'auteur", L, y); doc.text("L'éditeur", colR, y);
    const sigTop = y + 3;
    if (sign?.signature) { const h = 15; const w = Math.min(46, (h * sign.signature.w) / sign.signature.h); try { doc.addImage(sign.signature.url, "PNG", colR, sigTop, w, h, "trSig", "SLOW"); } catch { /* ignore */ } }
    if (sign?.cachet) { const h = 30; const w = Math.min(42, (h * sign.cachet.w) / sign.cachet.h); try { doc.addImage(sign.cachet.url, "PNG", colR + 22, sigTop - 3, w, h, "trCachet", "SLOW"); } catch { /* ignore */ } }
    y = sigTop + (sign && (sign.signature || sign.cachet) ? 32 : 13);
    doc.setDrawColor(120); doc.line(L, y, L + 60, y); doc.line(colR, y, colR + 60, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110);
    doc.text("Signature (lu et approuvé)", L, y); doc.text("Signature & cachet", colR, y);
    if (sign?.dgName) {
      y += 5; doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0); doc.text(sign.dgName, colR, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90);
      for (const line of (sign.dgTitle ?? "").split("\n").map((s) => s.trim()).filter(Boolean)) { y += 3.6; doc.text(line, colR, y); }
    }
    doc.setTextColor(0);
  };

  for (const el of Array.from(root?.children ?? [])) {
    const cls = el.getAttribute("class") || "";
    if (cls.includes("doc__title")) { ensure(10); y += 2; text(blockText(el), { bold: true, size: 14, gap: 1 }); continue; }
    if (cls.includes("meta")) { text(blockText(el), { size: 8, gap: 2 }); continue; }
    if (cls.includes("art")) {
      ensure(14); y += 2;
      const h3 = el.querySelector("h3");
      if (h3) text(blockText(h3), { bold: true, size: 10.5, gap: 1 });
      for (const child of Array.from(el.children)) {
        if (child.tagName === "H3") continue;
        if (child.tagName === "UL") { for (const liEl of Array.from(child.querySelectorAll("li"))) text("• " + blockText(liEl)); }
        else text(blockText(child));
      }
      continue;
    }
    if (el.querySelector && el.querySelector(".party__label")) { renderSignatures(); continue; }
    const t = blockText(el);
    if (t) text(t);
  }

  return doc.output("blob");
}

// Prépare le PDF du contrat À TRANSFÉRER, fidèle au MODÈLE (édition / compte
// d'auteur / compte à demi / prestation) — même contenu que l'aperçu.
export async function buildTransferContractPdf(
  c: ContractDetail,
  kind: "edition" | "auteur" | "demi" | "service",
  publisher?: Partial<PublisherLegal> | null,
  branding?: Branding | null,
  templates?: Record<number, string>,
): Promise<Blob> {
  let sign: ContractPdfSign | undefined;
  if (branding && branding.auto_sign_contracts) {
    const [cachet, signature] = await Promise.all([inkStamp(branding.cachet_generale), inkStamp(branding.signature_dg)]);
    sign = { cachet, signature, dgName: branding.dg_name, dgTitle: branding.dg_title };
  }
  // HTML sans signature intégrée (la signature est dessinée par jsPDF depuis `sign`).
  const html =
    kind === "auteur" ? buildAuthorAccountContractHtml(c, publisher, null, templates)
    : kind === "demi" ? buildDemiContractHtml(c, publisher, null, templates)
    : kind === "service" ? buildServiceContractHtml(c, publisher, null, templates)
    : buildAuthorContractHtml(c, publisher, null, templates);
  return buildContractPdfFromHtml(html, publisher, sign);
}
