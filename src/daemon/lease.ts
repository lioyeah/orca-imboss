/**
 * Single-owner lease for the app's data directory.
 *
 * `~/.imboss` (SQLite database, agent sessions, credentials) assumes one writer.
 * The GUI and the headless daemon therefore share a lease file: whoever holds it
 * owns the data; a second owner is refused unless it forces the takeover.
 *
 * The lease is advisory and crash-safe: a lease whose process is gone is stale
 * and is taken over silently.
 */

import { readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureDataDir, getDataRoot } from "../main/data-dir";

const LEASE_FILE = "daemon.lock";
/** How often the holder refreshes `heartbeatAt` (ms). */
const HEARTBEAT_MS = 10_000;

export interface LeaseInfo {
  pid: number;
  startedAt: number;
  heartbeatAt: number;
  /** `daemon` today; the GUI could take the lease later. */
  owner: string;
}

export interface AcquiredLease {
  ok: true;
  release(): void;
}

export interface DeniedLease {
  ok: false;
  /** The live holder that refused us. */
  holder: LeaseInfo;
}

function leasePath(): string {
  return join(getDataRoot(), LEASE_FILE);
}

function readLease(): LeaseInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(leasePath(), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const pid = record["pid"];
    const startedAt = record["startedAt"];
    const heartbeatAt = record["heartbeatAt"];
    if (
      typeof pid !== "number" ||
      typeof startedAt !== "number" ||
      typeof heartbeatAt !== "number"
    ) {
      return null;
    }
    return {
      pid,
      startedAt,
      heartbeatAt,
      owner: typeof record["owner"] === "string" ? record["owner"] : "unknown",
    };
  } catch {
    return null;
  }
}

/** True when `pid` is a live process (signal 0 probe). */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Try to take the data-directory lease.
 *
 * Succeeds when there is no lease, the lease is malformed, or its holder is
 * gone. `force` takes over a live lease (used by `--force`).
 */
export function acquireLease(
  owner = "daemon",
  force = false,
): AcquiredLease | DeniedLease {
  // The lease lives in the data root, which may not exist on a first run.
  ensureDataDir();
  const existing = readLease();
  if (existing && isAlive(existing.pid) && !force) {
    return { ok: false, holder: existing };
  }

  const info: LeaseInfo = {
    pid: process.pid,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    owner,
  };
  writeFileSync(leasePath(), JSON.stringify(info, null, 2), "utf8");

  const timer = setInterval(() => {
    const current = readLease();
    // Another process took over: stop refreshing, this holder is done.
    if (!current || current.pid !== process.pid) {
      clearInterval(timer);
      return;
    }
    current.heartbeatAt = Date.now();
    try {
      writeFileSync(leasePath(), JSON.stringify(current, null, 2), "utf8");
    } catch {
      // Best-effort heartbeat only.
    }
  }, HEARTBEAT_MS);
  // Never keep the process alive just for the heartbeat.
  timer.unref?.();

  return {
    ok: true,
    release(): void {
      clearInterval(timer);
      const current = readLease();
      if (current?.pid === process.pid) {
        try {
          unlinkSync(leasePath());
        } catch {
          // Best-effort cleanup only.
        }
      }
    },
  };
}

/** Read the current lease (for diagnostics / a GUI warning). */
export function peekLease(): LeaseInfo | null {
  return readLease();
}
