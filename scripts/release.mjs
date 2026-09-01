#!/usr/bin/env node
/**
 * Release pipeline for usage-report
 *
 * 0) Preconditions: clean git tree (no uncommitted changes)
 * 1) Bump version: patch | minor | major (default patch)
 * 2) npm run build → fresh dist/
 * 3) npm pack --dry-run → enforce allowlist on tarball entries
 *    (any unexpected file aborts the release and reverts the version bump)
 * 4) npm publish
 * 5) Commit version bump + create annotated tag v<version>
 *
 * Usage:
 *   node scripts/release.mjs [patch|minor|major]      # full release
 *   node scripts/release.mjs patch --dry-run          # everything except publish/commit/tag
 *   node scripts/release.mjs --check-only             # only validate tarball allowlist
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const isWin = platform() === "win32";

const args = process.argv.slice(2);
const bumpTypes = ["patch", "minor", "major"];
const bump = bumpTypes.find((t) => args.includes(t)) ?? "patch";
const dryRun = args.includes("--dry-run");
const checkOnly = args.includes("--check-only");

console.log(`→ usage-report release [bump=${bump}${dryRun ? ", dry-run" : ""}${checkOnly ? ", check-only" : ""}]`);

function run(cmd, argsList, opts = {}) {
  const r = spawnSync(cmd, argsList, {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    shell: isWin,
    ...(opts.silent ? { stdio: "pipe" } : { stdio: "inherit" }),
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    process.exit(r.status ?? 1);
  }
  return r;
}

/* ---------- 0) clean tree ---------- */
function gitClean() {
  const r = run("git", ["status", "--porcelain"], { silent: true });
  const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
  if (lines.length > 0) {
    console.error("✗ git tree is not clean. Commit or stash first:\n" + lines.join("\n"));
    process.exit(1);
  }
}

/* ---------- 1) version bump ---------- */
const prevVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;
function bumpVersion() {
  if (dryRun || checkOnly) return;
  console.log(`\n→ npm version ${bump} (${prevVersion} → next)`);
  run(isWin ? "npm.cmd" : "npm", ["version", bump, "--no-git-tag-version"]);
}

/* ---------- 2) build ---------- */
function build() {
  if (dryRun || checkOnly) {
    console.log("\n→ (skip build) npm run build");
    return;
  }
  console.log("\n→ npm run build");
  run(isWin ? "npm.cmd" : "npm", ["run", "build"]);
}

/* ---------- 3) tarball allowlist ---------- */
const ALLOW = [
  "package.json",
  "README.md",
  "dist/BUILD_INFO.json",
  /^dist\/pi-usage-monitor(\.exe)?$/, // platform binary name
  /^dist\/extensions\/[^/]+\.js$/, // compiled extension, no nested dirs
];

function checkTarball() {
  console.log("\n→ npm pack --dry-run --json (allowlist check)");
  const r = run(isWin ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], { silent: true });
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    console.error("✗ cannot parse npm pack output:\n" + (r.stdout ?? "").slice(0, 2000));
    process.exit(1);
  }
  const files = (data[0]?.files ?? []).map((f) => f.path);
  const bad = files.filter((p) => !ALLOW.some((a) => (typeof a === "string" ? a === p : a.test(p))));
  if (bad.length > 0) {
    console.error("✗ tarball contains unexpected files — release aborted:");
    bad.forEach((p) => console.error("   " + p));
    console.error("\n  Remove them from dist/ or adjust npm `files` whitelist.");
    if (!dryRun && !checkOnly) {
      console.error("  Reverting version bump...");
      const v = JSON.parse(readFileSync(pkgPath, "utf8")).version;
      run(isWin ? "git.exe" : "git", ["checkout", "--", "package.json", "package-lock.json"]);
      console.error(`  reverted ${v} → ${prevVersion}`);
    }
    process.exit(1);
  }
  const bytes = data[0].unpackedSize ?? files.reduce((a, f) => a + (f.size ?? 0), 0);
  console.log(`✓ tarball OK: ${files.length} files, ${(bytes / 1024).toFixed(1)} KB`);
  files.forEach((p) => console.log("   " + p));
}

/* ---------- 4) publish ---------- */
function publish() {
  if (dryRun || checkOnly) return;
  console.log("\n→ npm publish");
  run(isWin ? "npm.cmd" : "npm", ["publish"]);
}

/* ---------- 5) commit + tag ---------- */
function tagAndCommit(version) {
  if (dryRun || checkOnly) return;
  console.log(`\n→ git commit + tag v${version}`);
  run("git", ["add", "package.json", "package-lock.json"]);
  run("git", ["commit", "-m", `chore: version bump to v${version} (release)`]);
  run("git", ["tag", "-a", `v${version}`, "-m", `usage-report v${version}`]);
  console.log(`✓ tagged v${version} — don't forget: git push && git push --tags`);
}

/* ---------- main ---------- */
if (!checkOnly) gitClean();
bumpVersion();
build();
checkTarball();
publish();
const finalVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;
tagAndCommit(finalVersion);

console.log("\n✅ done." + (dryRun ? " (dry-run: publish/commit/tag skipped)" : " — remember to push tags."));