import { loadConfig } from "@ffb/config";
import { startWorker } from "./worker.ts";
const worker = startWorker(loadConfig());
console.info("FFB durable worker started");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void worker.close().then(() => process.exit(0));
  });
