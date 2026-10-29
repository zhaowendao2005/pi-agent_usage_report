#!/usr/bin/env node
/**
 * prepublishOnly guard.
 *
 * The supported release path is: `pnpm release` → tag → GitHub Actions → npm.
 * Publishing straight from a laptop bypasses the build matrix, ships whatever
 * happens to be in dist/, and can leave npm with 6 packages from 2 different
 * commits. So `npm publish` / `pnpm publish` is refused here unless we are
 * inside GitHub Actions (the real pipeline) or the user explicitly opts out.
 *
 *   ALLOW_LOCAL_PUBLISH=1 pnpm publish   # intentional one-off (e.g. emergency patch)
 */

const inCI = process.env.GITHUB_ACTIONS === "true";
const forced = process.env.ALLOW_LOCAL_PUBLISH === "1";

if (inCI || forced) {
  if (forced && !inCI) {
    console.warn("[guard-publish] local publish forced via ALLOW_LOCAL_PUBLISH=1");
  }
  process.exit(0);
}

console.error(`
✗ refusing to publish from this machine.

  This repo publishes through GitHub Actions so that all six packages
  (usage-report + 5 platform payloads) come from one commit and one build:

      pnpm release            # preflight → tag → push → CI builds & publishes

  If you really need a manual publish (emergency, mac-only):

      node scripts/publish.mjs              # uses the same order/idempotency rules
      ALLOW_LOCAL_PUBLISH=1 pnpm publish    # bypass this guard
`);
process.exit(1);
