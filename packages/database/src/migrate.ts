import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { loadConfig } from "@ffb/config";
export async function migrate(sql: SQL) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(72411001)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const source = await Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text();
      const checksum = new Bun.CryptoHasher("sha256").update(source).digest("hex");
      const [existing] = await tx`SELECT checksum FROM schema_migrations WHERE name=${name}`;
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${checksum})`;
    }
  });
}
if (import.meta.main) {
  const config = loadConfig();
  const sql = new SQL(config.DIRECT_DATABASE_URL ?? config.DATABASE_URL);
  try {
    await migrate(sql);
    console.info("Migrations applied");
  } finally {
    await sql.close();
  }
}
