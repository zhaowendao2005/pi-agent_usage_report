/**
 * Calibrate and clean historical data in ~/.pi/pi-usage-report-store/usage.db
 * - Backs up ~/.pi/pi-usage-report-store/usage.db before modifications
 * - Fixes corrupted/microsecond durations for OAuth / buffered responses
 * - Calibrates zero-cost records with market equivalent pricing
 * - Recomputes tps_total and tps_gen with RMT-TPS robust model bounds
 *
 * Usage: node scripts/calibrate-existing-db.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DB_PATH = join(homedir(), ".pi", "pi-usage-report-store", "usage.db");

if (!existsSync(DB_PATH)) {
  console.error(`[Calibrate] Database not found at ${DB_PATH}`);
  process.exit(1);
}

// 1. Safe Backup
const backupPath = `${DB_PATH}.bak_${Date.now()}`;
copyFileSync(DB_PATH, backupPath);
console.log(`[Calibrate] Safe backup created at: ${backupPath}`);

// 2. Open DB
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

function estimateCostMicroUsd(
  _provider,
  model,
  input,
  output,
  cacheRead,
  cacheWrite
) {
  const m = (model || "").toLowerCase();
  let inP = 1.0, outP = 3.0, crP = 0.25, cwP = 1.25;

  if (m.includes("haiku")) {
    inP = 0.8; outP = 4.0; crP = 0.08; cwP = 1.0;
  } else if (m.includes("opus")) {
    inP = 15.0; outP = 75.0; crP = 1.5; cwP = 18.75;
  } else if (m.includes("sonnet") || m.includes("claude")) {
    inP = 3.0; outP = 15.0; crP = 0.3; cwP = 3.75;
  } else if (m.includes("flash") || m.includes("gemini")) {
    inP = 0.10; outP = 0.40; crP = 0.025; cwP = 0.10;
  } else if (m.includes("gpt-4o-mini") || m.includes("mini")) {
    inP = 0.15; outP = 0.60; crP = 0.075; cwP = 0.15;
  } else if (m.includes("gpt-4o") || m.includes("gpt-5") || m.includes("codex") || m.includes("sol") || m.includes("terra")) {
    inP = 2.50; outP = 10.0; crP = 1.25; cwP = 2.50;
  } else if (m.includes("deepseek")) {
    inP = 0.14; outP = 0.28; crP = 0.014; cwP = 0.14;
  } else if (m.includes("grok")) {
    inP = 2.00; outP = 10.0; crP = 0.50; cwP = 2.00;
  }

  const usd = (input * inP + output * outP + cacheRead * crP + cacheWrite * cwP) / 1_000_000;
  return Math.round(usd * 1_000_000);
}

function computeRmtTps(output, durationMs, ttftMs) {
  let tpsTotal = null;
  let tpsGen = null;
  if (durationMs != null && durationMs > 0 && output > 0) {
    const rawTotal = output / (durationMs / 1000);
    tpsTotal = Math.min(Math.max(rawTotal, 0.1), 800);

    const genMs = Math.max(1, durationMs - (ttftMs ?? 0));
    if (genMs < 150 || output < 3) {
      tpsGen = durationMs < 150 ? tpsTotal : Math.min(output / (durationMs / 1000), 800);
    } else {
      const rawGen = output / (genMs / 1000);
      tpsGen = Math.min(Math.max(rawGen, 0.1), 800);
    }
  }
  return { tpsTotal, tpsGen };
}

// 3. Query all calls
const calls = db.prepare(`
  SELECT c.id, c.started_at, c.finished_at, c.duration_ms, c.ttft_ms,
         c.input_tokens, c.output_tokens, c.cache_read, c.cache_write,
         c.cost_usd, m.provider, m.model
  FROM llm_calls c
  JOIN models m ON m.id = c.model_int
`).all();

console.log(`[Calibrate] Processing ${calls.length} historical LLM calls...`);

const updateStmt = db.prepare(`
  UPDATE llm_calls
  SET started_at = ?,
      duration_ms = ?,
      ttft_ms = ?,
      cost_usd = ?,
      tps_total = ?,
      tps_gen = ?
  WHERE id = ?
`);

let fixedDurationCount = 0;
let fixedTtftCount = 0;
let fixedCostCount = 0;
let recomputedTpsCount = 0;

db.exec("BEGIN;");

for (const row of calls) {
  let durationMs = row.duration_ms;
  let startedAt = row.started_at;
  let finishedAt = row.finished_at || (startedAt + (durationMs || 0));
  let ttftMs = row.ttft_ms;
  let costUsd = row.cost_usd;
  const input = row.input_tokens || 0;
  const output = row.output_tokens || 0;
  const cacheRead = row.cache_read || 0;
  const cacheWrite = row.cache_write || 0;

  let changed = false;

  // 1. 修复异常过小的物理耗时 (如 OAuth / 丢失 t0 导致的 <= 100ms)
  if (output > 0 && (durationMs == null || durationMs < 100)) {
    durationMs = Math.max(200, Math.round((output / 45) * 1000));
    startedAt = finishedAt - durationMs;
    fixedDurationCount++;
    changed = true;
  }

  // 2. 修复 TTFT 异常 (如 ttft >= duration，或 buffer 集中下发导致 ttft 与 duration 仅差 1ms)
  if (durationMs != null && durationMs > 0 && output > 0) {
    if (ttftMs == null || ttftMs <= 0) {
      if (durationMs > 300) {
        ttftMs = Math.round(durationMs * 0.3);
        fixedTtftCount++;
        changed = true;
      }
    } else if (ttftMs >= durationMs || (durationMs - ttftMs < 100 && output > 100)) {
      // 估算流式生成耗时
      const estGenMs = Math.min(Math.round((output / 50) * 1000), Math.round(durationMs * 0.7));
      ttftMs = Math.max(50, durationMs - estGenMs);
      fixedTtftCount++;
      changed = true;
    }
  }

  // 3. 回填 OAuth 零费用记录
  if (costUsd === 0 && (input > 0 || output > 0)) {
    costUsd = estimateCostMicroUsd(row.provider, row.model, input, output, cacheRead, cacheWrite);
    fixedCostCount++;
    changed = true;
  }

  // 4. 重算 TPS (含截断与门控)
  const { tpsTotal, tpsGen } = computeRmtTps(output, durationMs, ttftMs);
  recomputedTpsCount++;

  updateStmt.run(startedAt, durationMs, ttftMs, costUsd, tpsTotal, tpsGen, row.id);
}

db.exec("COMMIT;");

console.log(`\n=== 校准完成统计 ===`);
console.log(`• 处理记录总数: ${calls.length}`);
console.log(`• 修复微秒级/异常耗时: ${fixedDurationCount} 条`);
console.log(`• 修复 TTFT 奇异时间: ${fixedTtftCount} 条`);
console.log(`• 回填 OAuth 等效费用: ${fixedCostCount} 条`);
console.log(`• 全量重算并截断 TPS: ${recomputedTpsCount} 条`);

// 校验校准后数据库状态
const provSummary = db.prepare(`
  SELECT 
    m.provider,
    COUNT(*) as calls,
    ROUND(AVG(c.duration_ms), 1) as avg_dur_ms,
    ROUND(AVG(c.ttft_ms), 1) as avg_ttft_ms,
    ROUND(AVG(c.cost_usd) / 1000000.0, 4) as avg_cost_usd,
    ROUND(AVG(c.tps_total), 1) as avg_tps_total,
    ROUND(AVG(c.tps_gen), 1) as avg_tps_gen,
    ROUND(MAX(c.tps_total), 1) as max_tps_total,
    ROUND(MAX(c.tps_gen), 1) as max_tps_gen
  FROM llm_calls c
  JOIN models m ON m.id = c.model_int
  GROUP BY m.provider
`).all();

console.log("\n=== 校准后各渠道数据概览 ===");
console.table(provSummary);

db.close();
