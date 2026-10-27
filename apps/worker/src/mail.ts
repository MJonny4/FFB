import type { SQL } from "bun";
import type { Config } from "@ffb/config";
import nodemailer from "nodemailer";
export interface Mail {
  id: string;
  recipient: string;
  subject: string;
  body: string;
}
export interface MailProvider {
  send(mail: Mail): Promise<string>;
}
interface SmtpTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<{
    messageId: string;
  }>;
}
type CreateSmtpTransport = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}) => SmtpTransport;
export function mailProvider(
  config: Config,
  createSmtpTransport: CreateSmtpTransport = (options) => nodemailer.createTransport(options),
): MailProvider {
  if (config.MAIL_MODE === "capture")
    return {
      async send(mail) {
        return `captured:${mail.id}`;
      },
    };
  if (config.MAIL_MODE === "smtp") {
    const transport = createSmtpTransport({
      host: config.SMTP_HOST!,
      port: config.SMTP_PORT!,
      secure: config.SMTP_SECURE!,
      auth: { user: config.SMTP_USER!, pass: config.SMTP_PASS! },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
    });
    return {
      async send(mail) {
        const result = await transport.sendMail({
          from: config.SMTP_FROM!,
          to: mail.recipient,
          subject: mail.subject,
          text: mail.body,
        });
        if (!result.messageId) throw new Error("Invalid SMTP response");
        return result.messageId;
      },
    };
  }
  return {
    async send(mail) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `ffb/${mail.id}`,
        },
        body: JSON.stringify({
          from: config.MAIL_FROM,
          to: [mail.recipient],
          subject: mail.subject,
          text: mail.body,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Email provider delivery failed");
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string")
        throw new Error("Invalid email provider response");
      return value.id;
    },
  };
}
export async function deliverMail(sql: SQL, provider: MailProvider) {
  let id: string | undefined;
  try {
    return await sql.begin(async (tx) => {
      const [mail] = await tx<
        Mail[]
      >`SELECT id,recipient,subject,body FROM mail_outbox WHERE delivered_at IS NULL AND run_at<=clock_timestamp() ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!mail) return false;
      id = mail.id;
      const providerId = await provider.send(mail);
      await tx`UPDATE mail_outbox SET delivered_at=clock_timestamp(),provider_id=${providerId} WHERE id=${mail.id}`;
      return true;
    });
  } catch (error) {
    if (id)
      await sql`UPDATE mail_outbox SET attempts=attempts+1,run_at=clock_timestamp()+least(3600,power(2,least(attempts+1,11))) * interval '1 second' WHERE id=${id}`;
    throw error;
  }
}
