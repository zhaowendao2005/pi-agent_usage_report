#!/usr/bin/env node
/**
 * Build pipeline:
 *   1) tsc                     → dist/extensions/*.js        (pi extension)
 *   2) tauri build             → src-tauri/target/<…>/release (native app + bundles)
 *   3) stage binary            → dist/bin/<target>/<bin>     (plugin payload)
 *                              → dist/<bin>                  (legacy / compat, host only)
 *   4) emit platform package   → packages/usage-report-<target>/  (publish later)
 *   5) write dist/BUILD_INFO.json
 *
 * Flags:
 *   --extension-only  only compile the pi extension + BUILD_INFO (no native build).
 *                     Used by the publish job: the JS payload must come from the
 *                     tag, while binaries come from the build jobs' artifacts.
 *   --skip-tauri    reuse the existing release binary (fast, no cargo)
 *   --no-platform   do not emit packages/usage-report-<target>
 *   --universal     macOS only: build one universal binary and stage it for both
 *                   darwin-arm64 and darwin-x64 (needs `rustup target add x86_64-apple-darwin`)
 *   --intel         macOS only: build/stage for darwin-x64 only
 *
 * macOS signing (for a stable TCC identity across rebuilds):
 *   APPLE_SIGNING_IDENTITY="PiUsage Dev Signing" pnpm build
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ALL_TARGETS, TARGET, binName, isWin, osCpu, platformPackageName } from "./lib/platform.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skipTauri = args.includes("--skip-tauri");
const extensionOnly = args.includes("--extension-only");
const noPlatform = args.includes("--no-platform");
const universal = args.includes("--universal") && process.platform === "darwin";
const intel = args.includes("--intel") && process.platform === "darwin";

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const BIN = binName();

/* tauri --target (also selects the cargo output dir) */
const tauriTarget = universal ? "universal-apple-darwin" : intel ? "x86_64-apple-darwin" : null;
const releaseDir = tauriTarget
  ? join(root, "src-tauri", "target", tauriTarget, "release")
  : join(root, "src-tauri", "target", "release");

/* which platform payloads this run produces */
const stageTargets = universal ? ["darwin-arm64", "darwin-x64"] : intel ? ["darwin-x64"] : [TARGET];

function run(cmd, cmdArgs, cwd = root) {
  console.log(`\n> ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: isWin });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/* ---------- 1) extension ---------- */
console.log("== compile extension → dist/extensions ==");
run(isWin ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.build.json"]);

/* ---------- extension-only short circuit ---------- */
if (extensionOnly) {
  const extDirOnly = join(root, "dist", "extensions");
  const entries = existsSync(extDirOnly)
    ? readdirSync(extDirOnly).filter((f) => f.endsWith(".js")).sort()
    : [];
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(
    join(root, "dist", "BUILD_INFO.json"),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        version: pkg.version,
        kind: "extension-only",
        engine: "tauri2",
        frontendDist: "src-tauri/web",
        note: "native binaries ship as usage-report-<target> packages, see their BUILD_INFO",
        shippingTargets: ALL_TARGETS,
        extensions: entries,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`\n✅ extension-only payload ready (${entries.length} files) → ${extDirOnly}`);
  process.exit(0);
}

/* ---------- 2) tauri ---------- */
if (skipTauri) {
  console.log("\n== tauri build (skipped via --skip-tauri) ==");
} else {
  const label = tauriTarget ?? TARGET;
  console.log(`\n== tauri build (${label}) ==`);
  run(isWin ? "npx.cmd" : "npx", ["tauri", "build", ...(tauriTarget ? ["--target", tauriTarget] : [])]);
}

/* ---------- 3) stage binary ---------- */
const releaseBin = join(releaseDir, BIN);
if (!existsSync(releaseBin)) {
  console.error("✗ release binary missing:", releaseBin);
  if (existsSync(releaseDir)) {
    console.error("  release/ contains:", readdirSync(releaseDir).slice(0, 40).join(", "));
  }
  process.exit(1);
}

const sha256 = createHash("sha256").update(readFileSync(releaseBin)).digest("hex");

for (const target of stageTargets) {
  const dir = join(root, "dist", "bin", target);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, BIN);
  cpSync(releaseBin, dest);
  chmodSync(dest, 0o755);
  // sidecar consumed by the runtime downloader (see extensions/spawn.ts)
  writeFileSync(`${dest}.sha256`, `${sha256}  ${binName(target)}-${target}\n`);
  console.log(`→ staged ${target}: ${dest}`);
}

// legacy single-target location (kept for older extension builds)
const compat = join(root, "dist", BIN);
cpSync(releaseBin, compat);
chmodSync(compat, 0o755);

/* ---------- bundles produced by tauri ---------- */
function findBundles() {
  const out = { app: null, dmg: null, installer: null };
  const pick = (sub, ext) => {
    const dir = join(releaseDir, "bundle", sub);
    if (!existsSync(dir)) return null;
    const f = readdirSync(dir).find((n) => n.endsWith(ext));
    return f ? join(dir, f) : null;
  };
  if (process.platform === "darwin") {
    out.app = pick("macos", ".app");
    out.dmg = pick("dmg", ".dmg");
  } else if (process.platform === "win32") {
    out.installer = pick("nsis", ".exe");
  }
  return out;
}
const bundles = findBundles();

/* ---------- 4) platform npm packages ---------- */
if (!noPlatform) {
  for (const target of stageTargets) {
    const dir = join(root, "packages", platformPackageName(target));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "bin"), { recursive: true });
    const dest = join(dir, "bin", binName(target));
    cpSync(releaseBin, dest);
    chmodSync(dest, 0o755);
    writeFileSync(`${dest}.sha256`, `${sha256}  ${binName(target)}-${target}\n`);

    const { os, cpu } = osCpu(target);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: platformPackageName(target),
          version: pkg.version,
          description: `Pi Usage Monitor desktop binary (${target}) — installed automatically by usage-report`,
          license: pkg.license,
          repository: pkg.repository,
          os: [os],
          cpu: [cpu],
          // our linux builds link glibc; without this Alpine/musl users would get
          // a binary that cannot start
          ...(os === "linux" ? { libc: ["glibc"] } : {}),
          files: ["bin/"],
          // No "bin" field: this package is a payload, not a CLI.
        },
        null,
        2
      ) + "\n"
    );
    writeFileSync(
      join(dir, "README.md"),
      `# ${platformPackageName(target)}\n\nPlatform payload for [\`${pkg.name}\`](https://www.npmjs.com/package/${pkg.name}).\n\n` +
        `Contains the \`${binName(target)}\` desktop binary for \`${target}\`. Installed automatically as an\n` +
        `optional dependency — do not depend on it directly.\n`
    );
    console.log(`→ platform package: ${dir}`);
  }
}

/* ---------- 5) metadata ---------- */
const extDir = join(root, "dist", "extensions");
const extEntries = existsSync(extDir)
  ? readdirSync(extDir)
      .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
      .sort()
  : [];

const bytes = statSync(join(root, "dist", "bin", stageTargets[0], BIN)).size;
writeFileSync(
  join(root, "dist", "BUILD_INFO.json"),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      version: pkg.version,
      target: stageTargets[0],
      targets: stageTargets,
      universal,
      platform: process.platform,
      arch: process.arch,
      binary: BIN,
      binaryPaths: stageTargets.map((t) => `bin/${t}/${BIN}`),
      engine: "tauri2",
      frontendDist: "src-tauri/web",
      bytes,
      sha256,
      signingIdentity: process.env.APPLE_SIGNING_IDENTITY ?? null,
      platformPackages: noPlatform ? [] : stageTargets.map(platformPackageName),
      shippingTargets: ALL_TARGETS,
      bundles,
      extensions: extEntries,
    },
    null,
    2
  ) + "\n"
);

console.log(`\n✅ ${(bytes / 1024 / 1024).toFixed(2)} MB binary → ${stageTargets.join(", ")}`);
console.log(`   extension:   ${extDir}`);
if (!noPlatform) console.log(`   npm payload: ${join(root, "packages")}`);
if (bundles.app) console.log(`   .app:        ${bundles.app}`);
if (bundles.dmg) console.log(`   .dmg:        ${bundles.dmg}`);
if (bundles.installer) console.log(`   installer:   ${bundles.installer}`);
if (process.platform === "darwin" && !process.env.APPLE_SIGNING_IDENTITY) {
  console.log(
    `\n⚠ .app is ad-hoc signed (DR = cdhash → new identity on every rebuild).\n` +
      `   For a stable identity: APPLE_SIGNING_IDENTITY="<cert CN>" pnpm build`
  );
}
