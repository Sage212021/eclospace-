import nodemailer from "nodemailer";

// Envoi d'e-mails transactionnels (confirmation de changement d'identifiant).
// Configuration par variables d'environnement SMTP standard, à renseigner sur
// l'hébergement (addon SMTP Scalingo ou fournisseur type Brevo/Mailgun) :
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Aucune dépendance à un fournisseur précis : tout service SMTP convient.
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
    console.log(`[mail:dev] À: ${input.to} | Sujet: ${input.subject}\n${input.text}`);
    return false;
  }

  const port = Number(process.env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return true;
}
