/**
 * usage-report — Pi extension
 *
 * Collects per-LLM-call token/cost/TTFT metrics into ~/.pi/agent/usage.db
 * and opens a live dashboard via /usage.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collector } from "./collector.js";
import { openDashboard } from "./spawn.js";
import { DB_PATH } from "./db.js";

export default function (pi: ExtensionAPI) {
  collector.attach(pi);

  pi.registerCommand("usage", {
    description: "Open Pi token usage dashboard",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Starting usage dashboard…", "info");
      const result = await openDashboard();
      if (result.ok) {
        ctx.ui.notify(result.message, "info");
      } else {
        ctx.ui.notify(result.message, "error");
      }
    },
  });

  pi.registerCommand("usage-db", {
    description: "Show usage database path",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Usage DB: ${DB_PATH}`, "info");
    },
  });
}
