/**
 * Shared platform helpers.
 *
 * A "target" is `<process.platform>-<process.arch>`, e.g. `darwin-arm64`,
 * `win32-x64`, `linux-x64`. It is used for three things:
 *   1. the per-target folder inside dist/ (`dist/bin/<target>/`)
 *   2. the optional npm package name (`@<scope>/usage-report-<target>`)
 *   3. the GitHub release asset name (`pi-usage-monitor-<target>[.exe]`)
 *
 * Platform payload packages are SCOPED on purpose. That is what esbuild
 * (@esbuild/darwin-arm64), swc (@swc/core-darwin-arm64), rollup
 * (@rollup/rollup-darwin-arm64) and sharp (@img/sharp-darwin-arm64) all do:
 * a scoped name is bound to an account/organisation, so npm's anti-abuse
 * heuristics don't treat a burst of similar new names as name squatting.
 * Publishing five unscoped `usage-report-<target>` packages within 30s got the
 * fourth one rejected with "Package name triggered spam detection".
 */

import { arch, platform } from "node:os";

export const TARGET = `${platform()}-${arch()}`;

export const isWin = platform() === "win32";

/** Desktop binary file name for a given target (defaults to the running one). */
export function binName(target = TARGET) {
  return target.startsWith("win32-") ? "pi-usage-monitor.exe" : "pi-usage-monitor";
}

/** npm scope that owns the payload packages. */
export const NPM_SCOPE = process.env.PI_USAGE_NPM_SCOPE ?? "zhaowendao2005";

/** Scoped npm package that carries the binary for a target. */
export function platformPackageName(target = TARGET) {
  return `@${NPM_SCOPE}/usage-report-${target}`;
}

/**
 * Directory name under packages/ — deliberately unscoped so artifact globs and
 * tarball paths stay flat (`packages/usage-report-darwin-arm64`, not
 * `packages/@scope/usage-report-darwin-arm64`).
 */
export function platformDirName(target = TARGET) {
  return `usage-report-${target}`;
}

/** Split a target into the npm `os` / `cpu` fields. */
export function osCpu(target = TARGET) {
  const [os, cpu] = target.split("-");
  return { os, cpu };
}

/** Every target we intend to ship binaries for. */
export const ALL_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "linux-x64",
  "linux-arm64",
];

/** GitHub release asset URL for a given version + target. */
export function releaseAssetUrl(version, target = TARGET, base = process.env.PI_USAGE_DOWNLOAD_BASE) {
  const root =
    base ??
    `https://github.com/zhaowendao2005/pi-agent_usage_report/releases/download/v${version}`;
  return `${root.replace(/\/$/, "")}/${binName(target)}-${target}`;
}
