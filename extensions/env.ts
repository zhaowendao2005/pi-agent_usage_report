/**
 * Runtime environment detection (dev checkout vs. installed package) and an
 * in-process instance registry so that a locally loaded development build can
 * automatically suspend the production install when both are loaded by the
 * same `pi` process.
 *
 * Why this is needed:
 *   - `pi -e ./dist` (or `pi install ./repo`) loads a second copy of this
 *     extension next to the npm-installed release.
 *   - Without coordination both copies attach the collector (double DB writes,
 *     racing `active_turn.json`) and register `/usage` twice (pi renames the
 *     second one to `/usage:2`).
 *   - The extension API has no "unregister" hook, so activation (collector
 *     handlers + commands) is deferred until `session_start`, at which point
 *     every loaded instance is known and a single leader can be elected.
 *
 * Detection is path based:
 *   - A published npm package only ships `dist/`, `scripts/` and `README.md`
 *     (`files` in package.json), so it never contains `.git/` or `src-tauri/`.
 *   - Local checkouts / `pi -e` / `pi install ./path` keep the full repo on
 *     disk, so those markers are present (or the module is loaded from
 *     `extensions/*.ts` source).
 *
 * Overrides:
 *   PI_USAGE_DEV=1   force dev mode
 *   PI_USAGE_PROD=1  force production mode (dev build behaves like a release)
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeMode = "dev" | "prod";

export interface RuntimeEnv {
  mode: RuntimeMode;
  packageRoot: string;
  modulePath: string;
  version: string | null;
  /** Human readable reason, surfaced in logs and `/usage-db`. */
  reason: string;
}

function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function findPackageRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function readVersion(root: string): string | null {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

let cached: RuntimeEnv | null = null;

export function detectRuntimeEnv(): RuntimeEnv {
  if (cached) return cached;

  const modulePath = realpathSafe(fileURLToPath(import.meta.url));
  const here = dirname(modulePath);
  const root = realpathSafe(findPackageRoot(here) ?? join(here, ".."));

  const segments = modulePath.split(/[\\/]/);
  const loadedFromSource = !segments.includes("dist") && segments.includes("extensions") && modulePath.endsWith(".ts");
  const isCheckout = existsSync(join(root, ".git")) || existsSync(join(root, "src-tauri"));

  let mode: RuntimeMode;
  let reason: string;

  if (truthy(process.env.PI_USAGE_DEV)) {
    mode = "dev";
    reason = "forced by PI_USAGE_DEV";
  } else if (truthy(process.env.PI_USAGE_PROD)) {
    mode = "prod";
    reason = "forced by PI_USAGE_PROD";
  } else if (loadedFromSource) {
    mode = "dev";
    reason = "loaded from TypeScript source (extensions/*.ts)";
  } else if (isCheckout) {
    mode = "dev";
    const marker = existsSync(join(root, ".git")) ? ".git" : "src-tauri";
    reason = `source checkout (${marker} present at ${root})`;
  } else {
    mode = "prod";
    reason = `installed package (${root}${sep}dist)`;
  }

  cached = {
    mode,
    packageRoot: root,
    modulePath,
    version: readVersion(root),
    reason,
  };
  return cached;
}

// ---------------------------------------------------------------------------
// In-process instance registry + leader election
// ---------------------------------------------------------------------------

export interface InstanceRecord {
  id: number;
  mode: RuntimeMode;
  packageRoot: string;
  modulePath: string;
  version: string | null;
  reason: string;
  registeredAt: number;
  disposed: boolean;
}

interface InstanceRegistry {
  nextId: number;
  instances: InstanceRecord[];
}

const REGISTRY_KEY = Symbol.for("pi.usage-report.registry.v1");

function registry(): InstanceRegistry {
  const holder = globalThis as unknown as Record<symbol, InstanceRegistry | undefined>;
  let reg = holder[REGISTRY_KEY];
  if (!reg) {
    reg = { nextId: 1, instances: [] };
    holder[REGISTRY_KEY] = reg;
  }
  return reg;
}

/**
 * Register this module instance. Loading the same module path again (e.g. an
 * extension reload) replaces the previous record instead of accumulating.
 */
export function registerInstance(env: RuntimeEnv = detectRuntimeEnv()): InstanceRecord {
  const reg = registry();
  reg.instances = reg.instances.filter((i) => i.modulePath !== env.modulePath && !i.disposed);
  const record: InstanceRecord = {
    id: reg.nextId++,
    mode: env.mode,
    packageRoot: env.packageRoot,
    modulePath: env.modulePath,
    version: env.version,
    reason: env.reason,
    registeredAt: Date.now(),
    disposed: false,
  };
  reg.instances.push(record);
  return record;
}

/**
 * Pick the single active instance for this pi process.
 *
 * Priority: any dev instance beats production. Within the same mode the
 * earliest registered instance wins, which keeps behaviour stable when the
 * same package is loaded twice.
 */
export function electLeader(): InstanceRecord | null {
  const live = registry().instances.filter((i) => !i.disposed);
  if (live.length === 0) return null;
  const devs = live.filter((i) => i.mode === "dev");
  const pool = devs.length > 0 ? devs : live;
  return pool.reduce((best, cur) => (cur.registeredAt < best.registeredAt ? cur : best));
}

export function disposeInstance(record: InstanceRecord | null): void {
  if (!record) return;
  record.disposed = true;
  const reg = registry();
  reg.instances = reg.instances.filter((i) => i !== record);
}

export function describeInstances(): string {
  const live = registry().instances.filter((i) => !i.disposed);
  if (live.length === 0) return "no live instances";
  return live
    .map((i) => `${i.mode}#${i.id}@${i.packageRoot}${i.version ? ` v${i.version}` : ""}`)
    .join(", ");
}
