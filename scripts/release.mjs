#!/usr/bin/env node
/**
 * Trigger a cloud release.
 *
 * The single source of truth for the version is package.json. This script never
 * changes it — it only proves that the current commit is publishable, then pushes
 * an annotated tag, which starts .github/workflows/release.yml:
 *
 *   guard (tag == package.json, version unpublished)
 *     → build (matrix: darwin universal / win32-x64 / linux-x64, artifacts only)
 *       → publish (manual approval gate → npm: platform packages, then main)
 *         → GitHub Release (same binaries, used as download fallback)
 *
 * Usage:
 *   node scripts/release.mjs                 # preflight + tag + push tag
 *   node scripts/release.mjs --dry-run       # preflight only
 *   node scripts/release.mjs --watch         # ... and follow the workflow (needs gh)
 *   node scripts/release.mjs --no-check      # skip the tarball allowlist check
 *   node scripts/release.mjs --publish-only v0.2.0
 *                                            # re-publish an existing tag without rebuilding
 *
 * Typical loop:
 *   1. edit code, bump package.json (e.g. `pnpm set-version 0.2.0`), commit, push
 *   2. pnpm release
 *   3. approve the `npm-publish` environment in GitHub Actions
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const watch = args.includes("--watch");
const skipCheck = args.includes("--no-check");
const publishOnlyIdx = args.indexOf("--publish-only");
const publishOnly = publishOnlyIdx >= 0 ? args[publishOnlyIdx + 1] : null;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m✓\x1b[0m ${s}`,
  warn: (s) => `\x1b[33m!\x1b[0m ${s}`,
  fail: (s) => `\x1b[31m✗\x1b[0m ${s}`,
  step: (s) => `\n\x1b[36m→ ${s}\x1b[0m`,
};

function die(msg, hint) {
  console.error(c.fail(msg));
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function sh(cmd, cmdArgs, { silent = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: silent ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
  if (r.error) die(`${cmd}: ${r.error.message}`);
  return r;
}

function out(cmd, cmdArgs) {
  const r = sh(cmd, cmdArgs, { silent: true });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim();
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;

function repoSlug() {
  const url = out("git", ["remote", "get-url", "origin"]) ?? "";
  const m = url.match(/github\.com[:/]+([^/]+\/[^/.]+)(?:\.git)?$/);
  return m ? m[1] : null;
}
const slug = repoSlug();
const actionsUrl = slug ? `https://github.com/${slug}/actions/workflows/release.yml` : "(no github remote)";

/* ---------------------------------------------------------------- retry path */
if (publishOnly) {
  const t = publishOnly.startsWith("v") ? publishOnly : `v${publishOnly}`;
  if (dryRun) {
    console.log(c.dim(`gh workflow run publish-retry.yml -f tag=${t}`));
    process.exit(0);
  }
  if (!out("gh", ["--version"])) die("gh CLI not found", "brew install gh");
  console.log(c.step(`re-publishing ${t} from its existing build artifacts (no rebuild)`));
  sh("gh", ["workflow", "run", "publish-retry.yml", "-f", `tag=${t}`]);
  console.log(c.ok(`dispatched — ${slug ? `https://github.com/${slug}/actions/workflows/publish-retry.yml` : ""}`));
  process.exit(0);
}

/* ---------------------------------------------------------------- preflight */
console.log(c.step(`release ${tag}  (version from package.json)`));
console.log(c.dim(`   ${dryRun ? "dry-run: nothing will be pushed" : "will tag + push, then CI builds and (after approval) publishes"}`));

console.log(c.step("preflight"));

const insideGit = out("git", ["rev-parse", "--is-inside-work-tree"]) === "true";
if (!insideGit) die("not a git repository");

const branch = out("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = (out("git", ["status", "--porcelain"]) ?? "").split("\n").filter(Boolean);
if (dirty.length > 0) {
  die(
    `working tree is not clean (${dirty.length} path(s))`,
    "commit or stash first — CI builds exactly what is pushed:\n     " + dirty.slice(0, 8).join("\n     ")
  );
}
console.log(c.ok(`clean tree on ${branch}`));

const ahead = out("git", ["rev-list", "--count", `origin/${branch}..HEAD`]);
if (ahead === null) {
  die(`no upstream origin/${branch}`, "git push -u origin " + branch);
}
if (Number(ahead) > 0) {
  die(`${ahead} commit(s) not pushed yet`, `git push origin ${branch}  — CI must build the pushed commit, not a local one`);
}
console.log(c.ok(`HEAD == origin/${branch}`));

sh("git", ["fetch", "--tags", "--quiet", "origin"], { silent: true });
const localTag = out("git", ["tag", "-l", tag]);
const remoteTag = out("git", ["ls-remote", "--tags", "origin", tag]);
if (localTag || remoteTag) {
  die(
    `tag ${tag} already exists`,
    `npm versions are immutable — bump package.json first:\n     pnpm set-version ${bumpPatch(version)}`
  );
}
console.log(c.ok(`tag ${tag} is free`));

const npmView = sh("npm", ["view", `usage-report@${version}`, "version"], { silent: true });
if (npmView.status === 0) {
  die(`usage-report@${version} is already on npm`, `bump package.json: pnpm set-version ${bumpPatch(version)}`);
}
if (npmView.error || npmView.status === null) {
  console.log(c.warn("could not reach the npm registry — skipping the published-version check"));
} else {
  console.log(c.ok(`usage-report@${version} is unpublished`));
}

if (!skipCheck) {
  console.log(c.step("tarball allowlist (npm pack --dry-run)"));
  const r = sh("npm", ["pack", "--dry-run", "--json"], { silent: true });
  if (r.status !== 0) die("npm pack --dry-run failed");
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    die("cannot parse npm pack output");
  }
  const files = (data[0]?.files ?? []).map((f) => f.path);
  const ALLOW = [
    "package.json",
    "README.md",
    "dist/BUILD_INFO.json",
    /^dist\/extensions\/[^/]+\.js$/,
    "scripts/postinstall.mjs",
    "scripts/lib/platform.mjs",
  ];
  const bad = files.filter((p) => !ALLOW.some((a) => (typeof a === "string" ? a === p : a.test(p))));
  if (bad.length > 0) die("tarball contains unexpected files:\n   " + bad.join("\n   "), "tighten package.json `files`");
  const bytes = data[0]?.unpackedSize ?? 0;
  console.log(c.ok(`tarball OK: ${files.length} files, ${(bytes / 1024).toFixed(1)} KB`));
}

function bumpPatch(v) {
  const [maj, min, pat] = v.split("-")[0].split(".").map(Number);
  return `${maj}.${min}.${pat + 1}`;
}

/* ---------------------------------------------------------------- go */
if (dryRun) {
  console.log(c.step("dry-run — would now:"));
  console.log(`   git tag -a ${tag} -m "usage-report ${tag}"`);
  console.log(`   git push origin ${tag}`);
  console.log(c.dim(`   → ${actionsUrl}`));
  process.exit(0);
}

console.log(c.step(`tagging + pushing ${tag}`));
sh("git", ["tag", "-a", tag, "-m", `usage-report ${tag}`]);
sh("git", ["push", "origin", tag]);

console.log(c.ok(`pushed ${tag} — CI is building now`));
console.log(`   ${c.dim(actionsUrl)}`);
console.log(
  `\n${c.warn("the npm publish job waits for approval")}: review the run, then approve the "npm-publish" environment.`
);

if (watch) {
  if (!out("gh", ["--version"])) {
    console.log(c.warn("gh CLI not installed — open the URL above to follow the run"));
  } else {
    const r = spawnSync("gh", ["run", "watch", "--workflow", "release.yml"], { cwd: root, stdio: "inherit" });
    process.exit(r.status ?? 0);
  }
}
