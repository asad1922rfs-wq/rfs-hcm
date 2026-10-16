import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_VERSION, loadConfig } from "./config.ts";
import { Outbox } from "./outbox.ts";
import { startAdmsServer } from "./adms.ts";
import { startUplink } from "./uplink.ts";

const cfg = loadConfig();
const logFile = join(cfg.dataDir, "agent.log");
const log = (msg: string) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    /* ignore */
  }
};

log(`RFS HCM sync agent ${AGENT_VERSION} starting — server ${cfg.serverUrl}`);
const outbox = new Outbox(cfg.dataDir);
log(`${outbox.pendingCount()} punch(es) waiting to be forwarded`);
startAdmsServer(cfg, outbox, log);
startUplink(cfg, outbox, log);

process.on("uncaughtException", (err) => log(`Uncaught: ${err.stack ?? err.message}`));
process.on("unhandledRejection", (err) => log(`Unhandled: ${String(err)}`));
