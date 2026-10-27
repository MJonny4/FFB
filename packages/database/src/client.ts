import { SQL } from "bun";
export type { SQL, TransactionSQL } from "bun";
export function database(url: string) {
  return new SQL(url, { max: 10, idleTimeout: 30, connectionTimeout: 10, prepare: false });
}
export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const uid = () => crypto.randomUUID();
export const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
export const opaque = () => crypto.getRandomValues(new Uint8Array(32)).toHex();
