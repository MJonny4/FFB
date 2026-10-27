import { loadConfig } from "@ffb/config";
import { startApi } from "./server.ts";
const api = startApi(loadConfig());
console.info(`FFB API listening on ${api.server.port}`);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void api.close().then(() => process.exit(0));
  });
