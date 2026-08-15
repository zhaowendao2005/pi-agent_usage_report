/**
 * Locate and spawn the Tauri dashboard binary.
 *
 * The extension can live in two layouts:
 *   1. source:  <pkg>/extensions/spawn.ts        → exe at <pkg>/dist/<bin>
 *   2. dist:    <pkg>/dist/extensions/spawn.js   → exe at <pkg>/dist/<bin>
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

/** Parent dir of this module: <pkg>/extensions (source) or <pkg>/dist (compiled). */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

function candidateBins(root: string): string[] {
  const isWin = platform() === "win32";
  const name = isWin ? "pi-usage-monitor.exe" : "pi-usage-monitor";
  // root is <pkg>/dist when running the compiled extension → exe sits right here
  const inDist = basename(root) === "dist";
  const bins: string[] = [];
  if (inDist) bins.push(join(root, name)); // dist layout: <pkg>/dist/<bin>
  bins.push(join(root, "dist", name)); // source layout: <pkg>/dist/<bin>
  bins.push(join(root, "src-tauri", "target", "release", name)); // cargo release
  bins.push(join(root, "src-tauri", "target", "debug", name)); // cargo debug
  bins.push(join(root, "dist", isWin ? "usage-server.exe" : "usage-server")); // legacy
  return bins;
}

function spawnTarget(target: string): ChildProcess {
  const root = packageRoot();
  const isWin = platform() === "win32";
  return spawn(target, [], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
}

/**
 * Ensure dashboard is running and visible.
 * Tauri is a single-instance desktop app — spawning again usually focuses existing window
 * (OS-dependent). We just spawn detached.
 */
export async function openDashboard(): Promise<{ ok: boolean; message: string }> {
  const root = packageRoot();
  const candidates = candidateBins(root);
  const target = candidates.find((p) => existsSync(p));
  if (!target) {
    return {
      ok: false,
      message:
        `Dashboard binary not found. Looked in:\n${candidates.join("\n")}\n` +
        `Build with: npm run build`,
    };
  }

  try {
    const child = spawnTarget(target);
    child.unref();
    return { ok: true, message: `Dashboard started: ${target}` };
  } catch (err) {
    return { ok: false, message: `Failed to spawn dashboard: ${err}` };
  }
}
