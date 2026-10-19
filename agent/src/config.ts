import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AgentConfig = {
  /** RFS HCM base URL, e.g. https://hr.example.com */
  serverUrl: string;
  agentId: string;
  agentSecret: string;
  /** Port the ZKTeco device pushes to (device: Comm → Cloud Server Settings → Server Port) */
  listenPort: number;
  listenHost: string;
  /** Only these device serial numbers are accepted. Empty = accept any device on the LAN. */
  allowedSerials: string[];
  /** Device timezone offset in hours sent in the ADMS handshake (Pakistan = 5) */
  timezoneHours: number;
  /**
   * Minutes to add to real time in the clock the device copies from us (the HTTP Date header it reads at
   * handshake). -2 keeps the device 2 minutes behind real time. This PC's own clock is not changed.
   */
  deviceClockOffsetMinutes: number;
  dataDir: string;
};

export const AGENT_VERSION = "0.1.0";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(): AgentConfig {
  const file = process.env.RFS_AGENT_CONFIG ?? join(root, "config.json");
  if (!existsSync(file)) {
    throw new Error(`Config not found: ${file}. Copy config.example.json to config.json and fill it in.`);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AgentConfig>;
  const cfg: AgentConfig = {
    serverUrl: String(raw.serverUrl ?? "").replace(/\/+$/, ""),
    agentId: String(raw.agentId ?? ""),
    agentSecret: String(raw.agentSecret ?? ""),
    listenPort: Number(raw.listenPort ?? 8081),
    listenHost: String(raw.listenHost ?? "0.0.0.0"),
    allowedSerials: Array.isArray(raw.allowedSerials) ? raw.allowedSerials.map(String) : [],
    timezoneHours: Number(raw.timezoneHours ?? 5),
    deviceClockOffsetMinutes: Number(raw.deviceClockOffsetMinutes ?? 0),
    dataDir: resolve(root, String(raw.dataDir ?? "data")),
  };
  if (!/^https?:\/\//.test(cfg.serverUrl)) throw new Error("serverUrl must start with http:// or https://");
  if (!cfg.agentId || !cfg.agentSecret.startsWith("rfsa_")) throw new Error("agentId/agentSecret missing — create an agent in RFS HCM → Biometric devices.");
  if (cfg.serverUrl.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(cfg.serverUrl)) {
    console.warn("WARNING: serverUrl is not HTTPS. Use HTTPS for anything other than local testing.");
  }
  mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}
