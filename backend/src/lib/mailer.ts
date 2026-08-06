import nodemailer from "nodemailer";

// Envoi d'e-mails transactionnels et documentaires. Configuration par variables
// d'environnement SMTP standard, à renseigner sur l'hébergement (boîte du
// domaine de la maison, hébergée chez Hostinger — smtp.hostinger.com) :
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//   SMTP_FROM_NAME   nom affiché par défaut (ex. « Éclosion Édition »)
//   SMTP_ARCHIVE_TO  copie invisible conservée par la maison (défaut : SMTP_FROM)
// Aucune dépendance à un fournisseur précis : tout service SMTP convient.
//
// Expéditeur (« De ») : pour la délivrabilité, l'adresse d'envoi doit être la
// boîte authentifiée du domaine de la maison (SMTP_FROM) — un serteur SMTP
// serveur SMTP refuse d'expédier « au nom de » une adresse qu'il n'authentifie
// pas. On
// identifie le pôle/l'agent qui écrit via le NOM affiché (fromName) et surtout
// via « Répondre à » (replyTo = e-mail professionnel de l'utilisateur connecté),
// de sorte que toute réponse arrive directement dans la boîte du bon pôle.
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Identité d'envoi dérivée de l'utilisateur connecté : « Répondre à » = son
// e-mail professionnel (boîte du pôle), nom affiché = marque + agent. Un même
// pôle pouvant disposer de 2-3 adresses, c'est l'adresse de la personne
// réellement connectée qui reçoit les réponses.
export function senderIdentity(user: { username: string; email?: string | null }): { replyTo?: string; fromName: string } {
  const brand = process.env.SMTP_FROM_NAME ?? "Éclosion Édition";
  const email = user.email?.trim();
  return {
    replyTo: email || undefined,
    fromName: `${brand} — ${user.username}`,
  };
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // E-mail professionnel de l'agent/pôle qui envoie : reçoit les réponses.
  replyTo?: string;
  // Nom affiché de l'expéditeur (ex. « Éclosion Édition — Service Éditorial »).
  fromName?: string;
  // Pièces jointes (ex. bulletin de paie PDF). Contenu binaire + nom de fichier.
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

// Renvoie true si l'e-mail a réellement été envoyé, false s'il a seulement été
// journalisé (mode développement/test sans SMTP configuré).
export async function sendMail(input: MailInput): Promise<boolean> {
  if (!isMailConfigured()) {
    // En production, l'absence de configuration SMTP est une erreur explicite :
    // le changement d'identifiant ne peut pas être confirmé sans e-mail.
    if (process.env.NODE_ENV === "production") {
      throw new Error("mail_not_configured");
    }
    // En développement/test : on journalise l'e-mail (dont le lien) au lieu de
    // l'envoyer, pour permettre les tests sans serveur SMTP réel.
    const via = input.replyTo ? ` | Répondre à: ${input.replyTo}` : "";
    console.log(`[mail:dev] À: ${input.to} | Sujet: ${input.subject}${via}\n${input.text}`);
    return false;
  }

  const port = Number(process.env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  // Adresse d'envoi = boîte authentifiée du domaine (délivrabilité). Le nom
  // affiché identifie le pôle/l'agent ; « Répondre à » ramène les réponses vers
  // sa boîte professionnelle.
  const fromAddress = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "";
  const fromName = input.fromName ?? process.env.SMTP_FROM_NAME;
  const from = fromName ? { name: fromName, address: fromAddress } : fromAddress;

  // La maison conserve une copie invisible de chaque envoi (« joindre le mail
  // officiel de la maison »). Par défaut, l'adresse officielle d'envoi.
  const archive = process.env.SMTP_ARCHIVE_TO ?? fromAddress;

  await transporter.sendMail({
    from,
    to: input.to,
    replyTo: input.replyTo,
    bcc: archive && archive !== input.to ? archive : undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  });
  return true;
}
