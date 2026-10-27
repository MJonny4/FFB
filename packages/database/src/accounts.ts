import type { SQL, TransactionSQL } from "bun";
import type { z, signupInput } from "@ffb/contracts";
import { DomainError, hash, opaque, uid } from "./client.ts";
import { wallet } from "./wallet.ts";
export const SESSION_MS = 30 * 86400000;
export async function createSession(tx: TransactionSQL, userId: string) {
  const token = opaque();
  await tx`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${hash(token)},${userId},${new Date(Date.now() + SESSION_MS)})`;
  return token;
}
export async function session(sql: SQL, token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [s] =
    await sql`SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${hash(token)} AND s.expires_at>clock_timestamp() AND u.deactivated_at IS NULL`;
  return s ? { userId: s.user_id as string, tokenHash: hash(token) } : null;
}
async function issueToken(
  tx: TransactionSQL,
  userId: string,
  purpose: "verify" | "reset",
  webOrigin: string,
) {
  const [u] = await tx`SELECT email FROM users WHERE id=${userId} FOR UPDATE`;
  await tx`UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=${userId} AND purpose=${purpose} AND consumed_at IS NULL`;
  const token = opaque();
  await tx`INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES(${hash(token)},${userId},${purpose},${new Date(Date.now() + (purpose === "verify" ? 86400000 : 3600000))})`;
  const link = `${webOrigin}/#/${purpose === "verify" ? "verify-email" : "reset-password"}?token=${token}`;
  await tx`INSERT INTO mail_outbox(id,user_id,recipient,subject,body) VALUES(${uid()},${userId},${u.email},${purpose === "verify" ? "Verify your FFB email" : "Reset your FFB password"},${`Open this link to ${purpose === "verify" ? "verify your email" : "reset your password"}: ${link}`})`;
}
export async function signup(sql: SQL, input: z.infer<typeof signupInput>, webOrigin: string) {
  const passwordHash = await Bun.password.hash(input.password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 2,
  });
  return sql.begin(async (tx) => {
    const [existing] =
      await tx`SELECT id FROM users WHERE email=${input.email} OR username=${input.username}`;
    if (existing) throw new DomainError(409, "Unable to create this account");
    const id = uid();
    await tx`INSERT INTO users(id,email,username,display_name,password_hash) VALUES(${id},${input.email},${input.username},${input.displayName},${passwordHash})`;
    await wallet(tx, id, "TOPUP", 1000, "signup");
    await issueToken(tx, id, "verify", webOrigin);
    return { userId: id, token: await createSession(tx, id) };
  });
}
// Fixed valid hash keeps the unknown-account branch on the password verification path.
const dummyHash = Bun.password.hashSync("invalid-account-dummy-password", {
  algorithm: "argon2id",
  memoryCost: 65536,
  timeCost: 2,
});
export async function login(sql: SQL, email: string, password: string) {
  const [u] = await sql`SELECT id,password_hash,deactivated_at FROM users WHERE email=${email}`;
  const valid = await Bun.password.verify(password, u?.password_hash ?? dummyHash);
  if (!u || !valid || u.deactivated_at)
    throw new DomainError(401, "Email or password is incorrect");
  return sql.begin(async (tx) => {
    const [current] =
      await tx`SELECT id FROM users WHERE id=${u.id} AND password_hash=${u.password_hash} AND deactivated_at IS NULL FOR UPDATE`;
    if (!current) throw new DomainError(401, "Email or password is incorrect");
    return { userId: u.id as string, token: await createSession(tx, u.id) };
  });
}
export async function requestToken(
  sql: SQL,
  purpose: "verify" | "reset",
  webOrigin: string,
  lookup: { email?: string; userId?: string },
) {
  await sql.begin(async (tx) => {
    const [u] =
      await tx`SELECT id,verified_at FROM users WHERE (${lookup.email ?? null}::text IS NOT NULL AND email=${lookup.email ?? null} OR ${lookup.userId ?? null}::text IS NOT NULL AND id=${lookup.userId ?? null}) AND deactivated_at IS NULL FOR UPDATE`;
    if (u && (purpose === "reset" || !u.verified_at))
      await issueToken(tx, u.id, purpose, webOrigin);
  });
  return { accepted: true as const };
}
export async function consumeToken(
  sql: SQL,
  token: string,
  purpose: "verify" | "reset",
  password?: string,
) {
  const passwordHash = password
    ? await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 })
    : null;
  return sql.begin(async (tx) => {
    const [candidate] =
      await tx`SELECT user_id FROM account_tokens WHERE token_hash=${hash(token)}`;
    if (!candidate) throw new DomainError(400, "Link is invalid or expired");
    const [u] =
      await tx`SELECT id FROM users WHERE id=${candidate.user_id} AND deactivated_at IS NULL FOR UPDATE`;
    if (!u) throw new DomainError(400, "Link is invalid or expired");
    const used =
      await tx`UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE token_hash=${hash(token)} AND purpose=${purpose} AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING user_id`;
    if (!used.length) throw new DomainError(400, "Link is invalid or expired");
    if (purpose === "verify") {
      await tx`UPDATE users SET verified_at=clock_timestamp() WHERE id=${u.id}`;
      return { userId: u.id as string, token: null };
    }
    if (!passwordHash) throw new Error("Reset password required");
    await tx`UPDATE users SET password_hash=${passwordHash} WHERE id=${u.id}`;
    await tx`DELETE FROM sessions WHERE user_id=${u.id}`;
    await tx`UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=${u.id} AND purpose='reset' AND consumed_at IS NULL`;
    return { userId: u.id as string, token: await createSession(tx, u.id) };
  });
}
export async function changePassword(
  sql: SQL,
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const newHash = await Bun.password.hash(newPassword, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 2,
  });
  return sql.begin(async (tx) => {
    const [u] = await tx`SELECT password_hash FROM users WHERE id=${userId} FOR UPDATE`;
    if (!(await Bun.password.verify(currentPassword, u.password_hash)))
      throw new DomainError(400, "Current password is incorrect");
    await tx`UPDATE users SET password_hash=${newHash} WHERE id=${userId}`;
    await tx`DELETE FROM sessions WHERE user_id=${userId}`;
    await tx`UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=${userId} AND purpose='reset' AND consumed_at IS NULL`;
    return createSession(tx, userId);
  });
}
export async function deactivate(sql: SQL, userId: string, password: string) {
  return sql.begin(async (tx) => {
    const clubs = await tx`SELECT id FROM teams WHERE manager_id=${userId}`;
    for (const club of clubs)
      await tx`SELECT id FROM matches WHERE status='SCHEDULED' AND (home_id=${club.id} OR away_id=${club.id}) ORDER BY id FOR UPDATE`;
    await tx`SELECT id FROM teams WHERE manager_id=${userId} FOR UPDATE`;
    const [u] = await tx`SELECT password_hash FROM users WHERE id=${userId} FOR UPDATE`;
    if (!(await Bun.password.verify(password, u.password_hash)))
      throw new DomainError(400, "Password is incorrect");
    await tx`UPDATE users SET deactivated_at=clock_timestamp(),avatar=NULL,avatar_type=NULL WHERE id=${userId}`;
    await tx`UPDATE teams SET manager_id=NULL WHERE manager_id=${userId}`;
    await tx`DELETE FROM sessions WHERE user_id=${userId}`;
    await tx`UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=${userId} AND consumed_at IS NULL`;
  });
}
