#!/usr/bin/env node
/**
 * Publish the platform payload packages, then the main package.
 *
 * Order matters: platform packages first, main package last. If it were the
 * other way around there would be a window where users install the main package
 * but no binary exists for their platform (they would fall back to downloading).
 *
 * Idempotent: anything already on the registry at this exact version is skipped,
 * so this doubles as the retry path when a publish fails halfway.
 *
 * Usage:
 *   node scripts/publish.mjs                       # publish what is present locally
 *   node scripts/publish.mjs --dry-run
 *   node scripts/publish.mjs --expect-version 0.2.0
 *   node scripts/publish.mjs --skip-main           # platform packages only
 *
 * Auth: NODE_AUTH_TOKEN (CI) or an interactive npm login. `--provenance` is added
 * automatically when running inside GitHub Actions.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipMain = args.includes("--skip-main");
const eqArg = args.find((a) => a.startsWith("--expect-version="));
const eqIdx = args.indexOf("--expect-version");
const expectVersion = eqArg ? eqArg.split("=")[1] : eqIdx >= 0 ? (args[eqIdx + 1] ?? null) : null;
const inCI = process.env.GITHUB_ACTIONS === "true";

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

if (expectVersion && expectVersion !== version) {
  console.error(`✗ package.json version is ${version}, expected ${expectVersion}`);
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`✗ refusing to publish non-semver version "${version}"`);
  process.exit(1);
}

function npm(argv, cwd = root, { silent = false } = {}) {
  const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", argv, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: silent ? "pipe" : "inherit",
  });
  return r;
}

function isPublished(name, ver) {
  const r = npm(["view", `${name}@${ver}`, "version"], root, { silent: true });
  return r.status === 0 && (r.stdout ?? "").trim() === ver;
}

function publishDir(dir, label) {
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (meta.version !== version) {
    throw new Error(`${meta.name}: version ${meta.version} != root ${version} — run scripts/set-version.mjs`);
  }
  if (isPublished(meta.name, version)) {
    console.log(`↷ ${meta.name}@${version} already published — skip`);
    return { name: meta.name, skipped: true };
  }
  const argv = ["publish", "--access", "public"];
  if (inCI) argv.push("--provenance");
  if (dryRun) argv.push("--dry-run");
  console.log(`\n→ ${meta.name}@${version} (${label})  [${argv.join(" ")}]`);
  const r = npm(argv, dir);
  if (r.status !== 0) throw new Error(`npm publish failed for ${meta.name}`);
  return { name: meta.name, skipped: false };
}

/* ---------- platform payload packages ---------- */
const pkgsDir = join(root, "packages");
const platformDirs = existsSync(pkgsDir)
  ? readdirSync(pkgsDir)
      .map((d) => join(pkgsDir, d))
      .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "package.json")))
      .sort()
  : [];

if (platformDirs.length === 0) {
  console.log("• no packages/ payloads found (publishing main package only)");
}

const published = [];
for (const dir of platformDirs) {
  published.push(publishDir(dir, "platform"));
}

/* ---------- main package ---------- */
if (!skipMain) {
  const hasBinary = existsSync(join(root, "dist", "bin")) &&
    readdirSync(join(root, "dist", "bin")).length > 0;
  if (hasBinary) {
    console.log("⚠ dist/bin present — the main tarball no longer ships binaries; it is ignored by `files`");
  }
  published.push(publishDir(root, "main"));
}

const done = published.filter((p) => !p.skipped).length;
console.log(
  `\n${dryRun ? "(dry-run) " : ""}✅ ${published.length} package(s) considered, ${done} published` +
    (published.some((p) => p.skipped) ? `, ${published.filter((p) => p.skipped).length} skipped` : "")
);
