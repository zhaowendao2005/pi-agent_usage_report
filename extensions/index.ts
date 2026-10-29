/**
 * usage-report — Pi extension
 *
 * Collects per-LLM-call token/cost/TTFT metrics into ~/.pi/pi-usage-report-store/usage.db
 * and opens a live dashboard via /usage.
 *
 * Dev/prod coordination:
 *   A locally loaded development build (`pi -e ./dist`, `pi install ./repo`,
 *   pnpm link) always wins over the npm-installed production copy when both are
 *   loaded in the same pi process. The loser registers no commands and attaches
 *   no collector, so metrics are written exactly once. See ./env.ts.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { collector } from "./collector.js";
import { openDashboard } from "./spawn.js";
import { DB_PATH } from "./db.js";
import {
  describeInstances,
  detectRuntimeEnv,
  disposeInstance,
  electLeader,
  registerInstance,
  type InstanceRecord,
  type RuntimeEnv,
} from "./env.js";

const env: RuntimeEnv = detectRuntimeEnv();
const self: InstanceRecord = registerInstance(env);

let activated = false;
let commandRegistered = false;

function activate(pi: ExtensionAPI, ctx?: ExtensionContext): void {
  if (activated) return;
  activated = true;

  collector.attach(pi);
  if (ctx) collector.onSessionStart(ctx);

  if (!commandRegistered) {
    commandRegistered = true;

    pi.registerCommand("usage", {
      description: "Open Pi token usage dashboard",
      handler: async (_args, cmdCtx) => {
        cmdCtx.ui.notify(
          env.mode === "dev" ? "Starting usage dashboard (dev mode)…" : "Starting usage dashboard…",
          "info"
        );
        const result = await openDashboard();
        cmdCtx.ui.notify(result.message, result.ok ? "info" : "error");
      },
    });

    pi.registerCommand("usage-db", {
      description: "Show usage database path and runtime mode",
      handler: async (_args, cmdCtx) => {
        const leader = electLeader();
        const role = leader === self ? "leader" : "suspended";
        cmdCtx.ui.notify(
          `Usage DB: ${DB_PATH}\nmode: ${env.mode} (${env.reason})\nrole: ${role}\nroot: ${env.packageRoot}\ninstances: ${describeInstances()}`,
          "info"
        );
      },
    });
  }

  console.error(
    `[usage-report] ${env.mode} instance active (${env.reason}): ${env.packageRoot}${env.version ? ` v${env.version}` : ""}`
  );
}

function settle(pi: ExtensionAPI, ctx?: ExtensionContext): void {
  const leader = electLeader();
  if (leader === self) {
    activate(pi, ctx);
    return;
  }
  const by = leader ? `${leader.mode} instance at ${leader.packageRoot}` : "another instance";
  console.error(
    `[usage-report] ${env.mode} instance suspended — ${by} is active (dev builds take precedence): ${env.packageRoot}`
  );
}

export default function (pi: ExtensionAPI) {
  const settleWithContext = (ctx?: ExtensionContext) => settle(pi, ctx);

  let fallback: ReturnType<typeof setTimeout> | null = null;
  const clearFallback = () => {
    if (fallback) {
      clearTimeout(fallback);
      fallback = null;
    }
  };

  // All extensions are loaded before `session_start`, so at this point the
  // registry contains every copy that pi -e / installed packages contributed.
  pi.on("session_start", (_event, ctx) => {
    clearFallback();
    settleWithContext(ctx);
  });

  // Fallback for hosts that never emit `session_start` (headless probes).
  fallback = setTimeout(() => settleWithContext(), 1500);
  fallback.unref?.();

  pi.on("session_shutdown", () => {
    clearFallback();
    disposeInstance(self);
  });
}
