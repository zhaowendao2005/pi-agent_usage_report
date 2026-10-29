#!/usr/bin/env node
/**
 * postinstall — best effort, never fails the install.
 *
 * npm/pnpm drop the executable bit often enough that we normalise it here, and
 * report whether a binary for this platform is actually available.
 *
 * Note: npm 11+ / pnpm 10+ skip lifecycle scripts unless approved, so this is a
 * convenience only. `extensions/spawn.ts` re-checks and can download the binary
 * on first `/usage` anyway.
 */

import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGET, binName, platformPackageName } from "./lib/platform.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = binName();

function fromPlatformPackage() {
  try {
    const req = createRequire(join(root, "package.json"));
    const pkgJson = req.resolve(`${platformPackageName()}/package.json`);
    return join(dirname(pkgJson), "bin", BIN);
  } catch {
    return null;
  }
}

const candidates = [
  join(root, "dist", "bin", TARGET, BIN),
  join(root, "dist", BIN),
  fromPlatformPackage(),
].filter(Boolean);

const hit = candidates.find((p) => existsSync(p));
if (hit) {
  try {
    chmodSync(hit, 0o755);
  } catch {
    /* read-only store, ignore */
  }
  console.log(`[usage-report] dashboard binary ready for ${TARGET}: ${hit}`);
} else if (process.env.PI_USAGE_SKIP_DOWNLOAD === "1") {
  console.log(`[usage-report] no binary for ${TARGET} (download disabled by PI_USAGE_SKIP_DOWNLOAD)`);
} else {
  console.log(
    `[usage-report] no bundled binary for ${TARGET}. The extension downloads it on first "/usage",` +
      ` or run "pnpm build" in a source checkout.`
  );
}
