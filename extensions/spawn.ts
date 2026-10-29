/**
 * Locate (and if needed fetch) the Tauri dashboard binary, then spawn it.
 *
 * Resolution order — first candidate that exists AND passes header inspection wins:
 *   1. $PI_USAGE_MONITOR_BIN                          explicit override
 *   2. <pkg>/dist/bin/<target>/<bin>                  monorepo / file: installs
 *   3. @zhaowendao2005/usage-report-<target>/bin/<bin> optional npm dependency (registry installs)
 *   4. <pkg>/src-tauri/target/{release,debug}/<bin>   local cargo build
 *   5. <pkg>/dist/<bin>                               legacy layout
 *   6. ~/.pi/pi-usage-report-store/bin/<target>/<bin> download cache
 *
 * Nothing is exec'd on faith: every candidate is checked for the right binary
 * format and CPU arch (see ./binary.ts). Downloads are verified against the
 * release's `.sha256` sidecar when available.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { arch, homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { checkBinary, expectedArch, sha256File } from "./binary.js";

export const TARGET = `${platform()}-${arch()}`;
const BIN = platform() === "win32" ? "pi-usage-monitor.exe" : "pi-usage-monitor";
const STORE = join(homedir(), ".pi", "pi-usage-report-store");

/**
 * The npm package root, no matter how this module ended up on disk:
 * <pkg>/extensions/*.ts (source), <pkg>/dist/extensions/*.js (built).
 */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 3; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(here, "..");
}

function packageVersion(root: string): string | null {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** The optional dependency package, if the registry installed one for this platform. */
function fromPlatformPackage(): string | null {
  const require = createRequire(import.meta.url);
  // keep in sync with scripts/lib/platform.mjs (platformPackageName)
  const name = `@zhaowendao2005/usage-report-${TARGET}`;
  try {
    const pkgJson = require.resolve(`${name}/package.json`);
    const p = join(dirname(pkgJson), "bin", BIN);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

export function downloadUrl(version: string | null): string {
  const base =
    process.env.PI_USAGE_DOWNLOAD_BASE ??
    (version ? `https://github.com/zhaowendao2005/pi-agent_usage_report/releases/download/v${version}` : "");
  // keep in sync with scripts/lib/platform.mjs (assetName)
  const ext = platform() === "win32" ? ".exe" : "";
  return `${base.replace(/\/$/, "")}/pi-usage-monitor-${TARGET}${ext}`;
}

export function candidateBins(root = packageRoot()): string[] {
  const out: string[] = [];
  const env = process.env.PI_USAGE_MONITOR_BIN;
  if (env) out.push(env);
  out.push(join(root, "dist", "bin", TARGET, BIN)); // monorepo: <pkg>/dist/bin/...
  out.push(join(root, "bin", TARGET, BIN)); // hypothetical <pkg>/bin layout
  const platformPkg = fromPlatformPackage(); // registry install: usage-report-<target>
  if (platformPkg) out.push(platformPkg);
  out.push(join(root, "src-tauri", "target", "release", BIN));
  out.push(join(root, "src-tauri", "target", "debug", BIN));
  out.push(join(root, "dist", BIN)); // legacy
  out.push(join(STORE, "bin", TARGET, BIN)); // download cache
  return out;
}

interface Located {
  path: string;
  rejections: string[];
}

function locateBinary(root: string): Located | null {
  const rejections: string[] = [];
  for (const candidate of candidateBins(root)) {
    if (!existsSync(candidate)) continue;
    const check = checkBinary(candidate);
    if (!check.ok) {
      rejections.push(`${candidate} — ${check.reason}`);
      continue;
    }
    try {
      if (platform() !== "win32") chmodSync(candidate, 0o755);
    } catch {
      /* read-only store */
    }
    return { path: candidate, rejections };
  }
  return rejections.length > 0 ? { path: "", rejections } : null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

async function downloadBinary(version: string | null): Promise<string> {
  const url = downloadUrl(version);
  if (!url || !version) throw new Error("no download base configured (set PI_USAGE_DOWNLOAD_BASE)");

  const dir = join(STORE, "bin", TARGET);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, BIN);
  const tmp = `${dest}.part-${process.pid}`;

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText} ← ${url}`);

  writeFileSync(tmp, new Uint8Array(await res.arrayBuffer()));

  /* integrity: verify against the release sidecar, when published */
  const expectedHash = (await fetchText(`${url}.sha256`))?.split(/\s+/)[0]?.toLowerCase() ?? null;
  if (expectedHash) {
    const actual = sha256File(tmp);
    if (actual !== expectedHash) {
      rmSync(tmp, { force: true });
      throw new Error(`sha256 mismatch for ${url}\n  expected ${expectedHash}\n  actual   ${actual}`);
    }
  }

  const check = checkBinary(tmp);
  if (!check.ok) {
    rmSync(tmp, { force: true });
    throw new Error(`downloaded binary rejected (${check.reason}) ← ${url}`);
  }

  chmodSync(tmp, 0o755);
  renameSync(tmp, dest);
  return dest;
}

function spawnTarget(target: string): ChildProcess {
  return spawn(target, [], {
    cwd: packageRoot(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
}

function failureMessage(root: string, located: Located | null, extra?: string): string {
  const checked = candidateBins(root);
  const lines = [
    `Dashboard binary for ${TARGET} (${expectedArch()}) is not available.`,
    extra ? `Reason: ${extra}` : "",
    "Checked:",
    ...checked.map((p) => `  ${p}${existsSync(p) ? "" : "  (missing)"}`),
    located?.rejections.length ? "\nRejected (wrong format/arch):" : "",
    ...(located?.rejections.map((r) => `  ${r}`) ?? []),
    "",
    'Fixes: run "pnpm build" in a source checkout, install the optional',
    `"@zhaowendao2005/usage-report-${TARGET}" package, or set PI_USAGE_MONITOR_BIN to a valid binary.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Ensure dashboard is running and visible.
 * Tauri is a single-instance desktop app — spawning again usually focuses the
 * existing window (OS-dependent). We just spawn detached.
 */
export async function openDashboard(): Promise<{ ok: boolean; message: string }> {
  const root = packageRoot();
  const located = locateBinary(root);

  if (located?.path) {
    try {
      const child = spawnTarget(located.path);
      child.unref();
      return { ok: true, message: `Dashboard started: ${located.path}` };
    } catch (err) {
      return { ok: false, message: `Failed to spawn dashboard (${located.path}): ${err}` };
    }
  }

  if (process.env.PI_USAGE_SKIP_DOWNLOAD === "1") {
    return { ok: false, message: failureMessage(root, located, "download disabled by PI_USAGE_SKIP_DOWNLOAD") };
  }

  try {
    const path = await downloadBinary(packageVersion(root));
    const child = spawnTarget(path);
    child.unref();
    return { ok: true, message: `Dashboard downloaded and started: ${path}` };
  } catch (err) {
    return { ok: false, message: failureMessage(root, located, `download failed: ${(err as Error).message}`) };
  }
}
