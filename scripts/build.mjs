#!/usr/bin/env node
/**
 * Build:
 * 1) tsc → compile extensions/*.ts to dist/extensions/*.js (pi extension)
 * 2) tauri build (runs vite → src-tauri/web)
 * 3) copy release exe → dist/pi-usage-monitor(.exe)
 * 4) write dist/BUILD_INFO.json
 *
 * dist/ is self-contained: the compiled extension + the desktop binary.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = platform() === "win32";

function run(cmd, args, cwd = root) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: isWin });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const distDir = join(root, "dist");

// 1) Compile the pi extension (TypeScript → JS) into dist/extensions
console.log("== compile extension → dist/extensions ==");
run(isWin ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.build.json"]);

// 2) Tauri desktop build (beforeBuildCommand → vite → src-tauri/web)
console.log("== tauri build (runs beforeBuildCommand → vite → src-tauri/web) ==");
run(isWin ? "npx.cmd" : "npx", ["tauri", "build"]);

const binName = isWin ? "pi-usage-monitor.exe" : "pi-usage-monitor";
const releaseBin = join(root, "src-tauri", "target", "release", binName);
mkdirSync(distDir, { recursive: true });

// 3) Copy release binary → dist/
if (!existsSync(releaseBin)) {
  console.error("release binary missing:", releaseBin);
  const rel = join(root, "src-tauri", "target", "release");
  if (existsSync(rel)) console.error("release contains:", readdirSync(rel).slice(0, 40));
  process.exit(1);
}

const outBin = join(distDir, binName);
cpSync(releaseBin, outBin);
const bytes = statSync(outBin).size;

const extEntries = existsSync(join(distDir, "extensions"))
  ? readdirSync(join(distDir, "extensions"))
      .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
      .sort()
  : [];

// 4) Build metadata
writeFileSync(
  join(distDir, "BUILD_INFO.json"),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      platform: platform(),
      binary: binName,
      engine: "tauri2",
      frontendDist: "src-tauri/web",
      bytes,
      extensions: extEntries,
    },
    null,
    2
  ) + "\n"
);

console.log(`\n✅ ${outBin} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`   extension: ${join(distDir, "extensions")}`);
console.log(`   frontend:  src-tauri/web`);
