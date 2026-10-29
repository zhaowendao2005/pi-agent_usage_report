#!/usr/bin/env node
/**
 * Set the version everywhere it must stay in sync:
 *   - package.json                          version
 *   - package.json                          optionalDependencies usage-report-<target>
 *   - packages/usage-report-<target>/package.json
 *
 * Usage: node scripts/set-version.mjs 0.2.0
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_TARGETS, platformPackageName } from "./lib/platform.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
  console.error("usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
pkg.optionalDependencies = Object.fromEntries(ALL_TARGETS.map((t) => [platformPackageName(t), version]));
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const pkgsDir = join(root, "packages");
if (existsSync(pkgsDir)) {
  for (const dir of readdirSync(pkgsDir)) {
    const file = join(pkgsDir, dir, "package.json");
    if (!existsSync(file)) continue;
    const p = JSON.parse(readFileSync(file, "utf8"));
    p.version = version;
    writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
  }
}

console.log(`✓ version → ${version} (package.json + ${ALL_TARGETS.length} platform packages)`);
