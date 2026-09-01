#!/usr/bin/env node
/**
 * Release pipeline for usage-report
 *
 * 0) Worktree check: any uncommitted change is allowed ONLY if it is a
 *    version-number drift in package.json / package-lock.json (e.g. from a
 *    previous interrupted release or a manual `npm version`). The drift is
 *    picked up and committed at the end of the release. Any other change
 *    aborts.
 * 1) Bump version: patch | minor | major (default patch)
 * 2) npm run build → fresh dist/
 * 3) npm pack --dry-run → strict allowlist on tarball entries
 * 4) npm publish
 * 5) Commit version bump + annotated tag v<version>
 *
 * On any failure after the bump, the version edit is rolled back, so the
 * working tree never stays "dirty" because of version changes alone.
 *
 * Usage:
 *   node scripts/release.mjs [patch|minor|major]       # full release
 *   node scripts/release.mjs patch --dry-run           # everything except publish/commit/tag
 *   node scripts/release.mjs --check-only              # only validate tarball allowlist
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const otpArg = args.find((a) => a.startsWith("--otp="))?.split("=")[1] ?? process.env.NPM_PUBLISH_OTP;

console.log(`→ usage-report release [bump=${bump}${dryRun ? ", dry-run" : ""}${checkOnly ? ", check-only" : ""}]`);

/* ---------- helpers ---------- */

function run(cmd, argsList, opts = {}) {
  const r = spawnSync(cmd, argsList, {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    shell: isWin,
    ...(opts.silent ? { stdio: "pipe" } : { stdio: "inherit" }),
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const msg = `command failed (${r.status ?? "?"}): ${cmd} ${argsList.join(" ")}`;
    if (opts.silent && r.stderr) throw new Error(msg + "\n" + r.stderr.trim().slice(0, 2000));
    throw new Error(msg);
  }
  return r;
}

const versionOf = () => JSON.parse(readFileSync(pkgPath, "utf8")).version;
let prevVersion = versionOf(); // version present before this run
let bumped = false;
let committed = false;

function rollbackVersion() {
  if (bumped && !committed) {
    try {
      run("git", ["checkout", "--", "package.json", "package-lock.json"], { silent: true });
      console.log(`  ↺ reverted version bump to ${prevVersion}`);
    } catch {
      console.error("  ⚠ could not auto-revert version; run: git checkout -- package.json package-lock.json");
    }
    bumped = false;
  }
}

/* ---------- 0) worktree check (version drift allowed) ---------- */

function gitCheck() {
  // Parse changed paths without relying on porcelain column widths:
  // worktree vs index, index vs HEAD, and untracked (ignore-rule aware).
  const work = run("git", ["diff", "--name-only"], { silent: true }).stdout.split("\n").filter(Boolean);
  const staged = run("git", ["diff", "--cached", "--name-only"], { silent: true }).stdout.split("\n").filter(Boolean);
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], { silent: true }).stdout.split("\n").filter(Boolean);
  const all = [...new Set([...staged, ...work, ...untracked])].filter(Boolean);
  if (all.length === 0) return;

  const onlyVersionFiles = all.every((p) => p === "package.json" || p === "package-lock.json");
  if (!onlyVersionFiles) {
    console.error("✗ working tree has non-version changes. Commit or stash them first:");
    all.forEach((p) => console.error("   " + (staged.includes(p) ? "(staged) " : "") + (untracked.includes(p) ? "(untracked) " : "") + p));
    process.exit(1);
  }

  // Allow the drift only if the diff contains *just* version-number lines.
  const d =
    run("git", ["diff", "--", "package.json", "package-lock.json"], { silent: true }).stdout +
    "\n" +
    run("git", ["diff", "--cached", "--", "package.json", "package-lock.json"], { silent: true }).stdout;
  const changedLines = d.split("\n").filter((l) => /^[+-]/.test(l) && !/^[+-]{3}/.test(l));
  const versionOnly = changedLines.every((l) => /^[+-]\s*"version":\s*"/.test(l));
  if (!versionOnly) {
    console.error("✗ package.json / package-lock.json contain non-version changes. Revert or commit them:");
    changedLines.slice(0, 20).forEach((l) => console.error("   " + l));
    process.exit(1);
  }
  prevVersion = versionOf(); // pick up the drifted version as the baseline (do not re-bump from HEAD)
  console.log(`→ version drift detected (${versionOf()}), continuing; release will carry it forward`);
}

/* ---------- 1) version bump ---------- */

function bumpVersion() {
  if (dryRun || checkOnly) return;
  console.log(`\n→ npm version ${bump} (${versionOf()} → next)`);
  run(isWin ? "npm.cmd" : "npm", ["version", bump, "--no-git-tag-version"]);
  bumped = true;
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
    throw new Error("cannot parse npm pack output:\n" + (r.stdout ?? "").slice(0, 2000));
  }
  const files = (data[0]?.files ?? []).map((f) => f.path);
  const bad = files.filter((p) => !ALLOW.some((a) => (typeof a === "string" ? a === p : a.test(p))));
  if (bad.length > 0) {
    throw new Error(
      "tarball contains unexpected files:\n  " +
        bad.join("\n  ") +
        "\nRemove them from dist/ or tighten npm `files`."
    );
  }
  const bytes = data[0].unpackedSize ?? files.reduce((a, f) => a + (f.size ?? 0), 0);
  console.log(`✓ tarball OK: ${files.length} files, ${(bytes / 1024).toFixed(1)} KB`);
  files.forEach((p) => console.log("   " + p));
}

/* ---------- 4) publish ---------- */

function publish() {
  if (dryRun || checkOnly) return;
  const p = ["publish"];
  if (otpArg) p.push("--otp", otpArg);
  console.log(`\n→ npm publish${otpArg ? " (with --otp)" : ""}`);
  run(isWin ? "npm.cmd" : "npm", p);
}

/* ---------- 5) commit + tag ---------- */

function tagAndCommit() {
  if (dryRun || checkOnly) return;
  const v = versionOf();
  console.log(`\n→ git commit + tag v${v}`);
  run("git", ["add", "package.json", "package-lock.json"]);
  run("git", ["commit", "-m", `chore: version bump to v${v} (release)`]);
  committed = true;
  run("git", ["tag", "-a", `v${v}`, "-m", `usage-report v${v}`]);
  console.log(`✓ tagged v${v} — don't forget: git push && git push --tags`);
}

/* ---------- main ---------- */

try {
  if (!checkOnly) gitCheck();
  bumpVersion();
  build();
  checkTarball();
  publish();
  tagAndCommit();
  console.log("\n✅ done." + (dryRun ? " (dry-run: publish/commit/tag skipped)" : " — remember to push tags."));
} catch (e) {
  rollbackVersion();
  console.error("\n✗ release aborted: " + e.message);
  process.exit(1);
}