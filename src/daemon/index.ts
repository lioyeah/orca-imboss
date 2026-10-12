/**
 * Headless imboss daemon (spike).
 *
 * Runs the application core with no Electron window, keeps it alive for the
 * cron scheduler and the IM integrations, and serves a minimal MCP surface on
 * stdio so a remote/agent client can drive it.
 *
 * Usage:
 *   node out/main/daemon.js [--force] [--no-integrations] [--no-models]
 *                           [--locale=zh-CN] [--help]
 *
 * Notes:
 * - stdout is reserved for MCP traffic; all logging goes to stderr.
 * - The data directory is single-owner: the daemon takes a lease and refuses to
 *   start while another live owner (e.g. the GUI, later) holds it.
 */

import { startCore, stopCore } from "../main/core";
import { subscribe } from "../main/events";
import { acquireLease } from "./lease";
import { startMcpStdioServer } from "./mcp";

interface Options {
  force: boolean;
  integrations: boolean;
  refreshModels: boolean;
  locale: string | undefined;
  help: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    force: false,
    integrations: true,
    refreshModels: true,
    locale: undefined,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--force") options.force = true;
    else if (arg === "--no-integrations") options.integrations = false;
    else if (arg === "--no-models") options.refreshModels = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--locale=")) {
      options.locale = arg.slice("--locale=".length);
    }
  }
  return options;
}

/** Best-effort locale from the environment (`LANG=zh_CN.UTF-8` → `zh-CN`). */
function envLocale(): string | undefined {
  const raw = process.env["LC_ALL"] ?? process.env["LANG"];
  if (!raw) return undefined;
  const normalized = raw.split(".")[0].replace("_", "-");
  return normalized.length > 0 ? normalized : undefined;
}

const log = (...parts: unknown[]): void => {
  console.error("[daemon]", ...parts);
};

const HELP = `imboss daemon (spike)

Runs the app core headless and serves MCP over stdio.

Options:
  --force             take over a live lease (another owner is running)
  --no-integrations   do not start the WeChat/QQ/Telegram integrations
  --no-models         do not refresh the model catalog at startup
  --locale=<locale>   fallback locale when none is stored (default: $LANG)
  -h, --help          show this help
`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stderr.write(HELP);
    return;
  }

  const lease = acquireLease("daemon", options.force);
  if (!lease.ok) {
    log(
      `another owner holds the data lease (pid ${lease.holder.pid}, ` +
        `owner ${lease.holder.owner}, heartbeat ${new Date(
          lease.holder.heartbeatAt,
        ).toISOString()}).`,
    );
    log("refusing to start; stop it first, or pass --force to take over.");
    process.exitCode = 1;
    return;
  }

  // Core events → stderr (a real gateway would also fan out to WS clients).
  subscribe((channel, payload) => {
    log(`event ${channel}`, summarize(payload));
  });

  startCore({
    fallbackLocale: options.locale ?? envLocale(),
    integrations: options.integrations,
    refreshModels: options.refreshModels,
  });

  const mcp = startMcpStdioServer();
  log(`ready (pid ${process.pid}); MCP over stdio, ${mcp.toolCount} tools`);

  // Standalone keep-alive: with no MCP client holding stdin open, nothing else
  // would keep the event loop busy, and the daemon would exit immediately.
  const keepAlive = setInterval(() => {}, 60_000);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${signal})`);
    clearInterval(keepAlive);
    mcp.close();
    await stopCore();
    lease.release();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/** Keep event logging short: never dump whole message lists. */
function summarize(payload: unknown): string {
  try {
    const json = JSON.stringify(payload);
    return json.length > 160 ? `${json.slice(0, 160)}…` : json;
  } catch {
    return String(payload);
  }
}

void main().catch((err) => {
  log("fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
