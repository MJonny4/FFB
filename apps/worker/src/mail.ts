import type { SQL } from "bun";
import type { Config } from "@ffb/config";
export interface Mail {
  id: string;
  recipient: string;
  subject: string;
  body: string;
}
export interface MailProvider {
  send(mail: Mail): Promise<string>;
}
export function mailProvider(config: Config): MailProvider {
  if (config.MAIL_MODE === "capture")
    return {
      async send(mail) {
        return `captured:${mail.id}`;
      },
    };
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
