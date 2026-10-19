// Restart the attendance machine from this PC: queues a REBOOT that the device picks up on its next poll
// (within ~10 seconds). On restart it handshakes again and takes the clock the agent gives it.
// Usage: npm run reboot-device            (every allowed device)
//        npm run reboot-device -- <serial>
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.ts";
import { Outbox } from "./outbox.ts";

const cfg = loadConfig();
const outbox = new Outbox(cfg.dataDir);
const serials = process.argv[2] ? [process.argv[2]] : cfg.allowedSerials;
if (serials.length === 0) throw new Error("Give the device serial: npm run reboot-device -- <serial>");
for (const serial of serials) {
  // Local-only command: marked reported so it is never sent to the server as a command result.
  const id = `local-reboot-${randomUUID()}`;
  outbox.queueCommand({ id, serial, type: "REBOOT", payload: {} });
  outbox.markReported([id]);
  console.log(`Restart queued for ${serial}; the machine will restart within about 10 seconds.`);
}
