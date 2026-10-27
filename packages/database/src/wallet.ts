import type { TransactionSQL } from "bun";
import { DomainError, uid } from "./client.ts";
export async function wallet(
  tx: TransactionSQL,
  userId: string,
  type: "TOPUP" | "STAKE" | "REFUND" | "PAYOUT",
  amount: number,
  reference: string,
) {
  if (!Number.isSafeInteger(amount) || !amount || (type === "STAKE") !== amount < 0)
    throw new Error("Invalid wallet amount");
  const [user] = await tx`SELECT balance FROM users WHERE id=${userId} FOR UPDATE`;
  if (!user) throw new DomainError(404, "Account not found");
  const [previous] =
    await tx`SELECT amount,type,balance_after FROM ledger WHERE user_id=${userId} AND reference=${reference}`;
  if (previous) {
    if (Number(previous.amount) !== amount || previous.type !== type)
      throw new DomainError(409, "Idempotency conflict");
    return Number(user.balance);
  }
  const balance = Number(user.balance) + amount;
  if (balance < 0) throw new DomainError(409, "Insufficient coins");
  if (!Number.isSafeInteger(balance)) throw new Error("Balance overflow");
  await tx`UPDATE users SET balance=${balance} WHERE id=${userId}`;
  await tx`INSERT INTO ledger(id,user_id,type,amount,balance_after,reference) VALUES(${uid()},${userId},${type},${amount},${balance},${reference})`;
  return balance;
}
