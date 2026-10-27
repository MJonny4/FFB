import { RedisClient } from "bun";
import type { Config } from "@ffb/config";
import { database, recover, runNextJob } from "@ffb/database";
import { deliverMail, mailProvider } from "./mail.ts";
export function startWorker(config: Config) {
  const sql = database(config.DATABASE_URL),
    redis = new RedisClient(config.REDIS_URL, { connectionTimeout: 1000, maxRetries: 1 }),
    provider = mailProvider(config);
  let stopping = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    nextRecovery = 0;
  let wake: (() => void) | undefined;
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });
  const done = (async () => {
    while (!stopping) {
      try {
        if (Date.now() >= nextRecovery) {
          await recover(sql);
          nextRecovery = Date.now() + 60000;
        }
        const result = await runNextJob(sql);
        if (result) {
          void redis
            .publish("ffb:v1:changed", JSON.stringify({ v: 1, type: "changed", ...result }))
            .catch(() => undefined);
          continue;
        }
        if (await deliverMail(sql, provider)) continue;
        const [next] =
          await sql`SELECT min(run_at) AS at FROM (SELECT run_at FROM jobs WHERE done_at IS NULL UNION ALL SELECT run_at FROM mail_outbox WHERE delivered_at IS NULL) pending`;
        const delay = Math.min(
          60000,
          next.at ? Math.max(50, +next.at - Date.now()) : 60000,
          nextRecovery - Date.now(),
        );
        await pause(Math.max(50, delay));
      } catch {
        console.error("Worker operation failed; durable state will be retried");
        await pause(5000);
      }
    }
    redis.close();
    await sql.close();
  })();
  // Mail/API writes may arrive while the worker sleeps; bounded wakeup repairs pubsub loss.
  const subscriber = new RedisClient(config.REDIS_URL);
  void subscriber
    .subscribe("ffb:v1:changed", () => {
      if (timer) clearTimeout(timer);
      wake?.();
    })
    .catch(() => undefined);
  return {
    done,
    async close() {
      stopping = true;
      if (timer) clearTimeout(timer);
      wake?.();
      subscriber.close();
      await done;
    },
  };
}
