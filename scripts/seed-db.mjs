/**
 * Seed ~/.pi/agent/usage.db with sample rows for local dashboard testing.
 * Run: node scripts/seed-db.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DB_PATH = join(homedir(), ".pi", "agent", "usage.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL UNIQUE,
  session_file TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
  UNIQUE(provider, model)
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY,
  session_int INTEGER NOT NULL,
  model_int INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ttft_ms INTEGER,
  duration_ms INTEGER,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd INTEGER NOT NULL,
  tps_total REAL,
  tps_gen REAL,
  http_status INTEGER,
  stop_reason TEXT,
  error_message TEXT,
  UNIQUE(session_int, message_id)
);
CREATE INDEX IF NOT EXISTS idx_calls_started ON llm_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_calls_model ON llm_calls(model_int);
CREATE INDEX IF NOT EXISTS idx_calls_status ON llm_calls(http_status);
`);

// migrate legacy DBs
const cols = new Set(db.prepare("PRAGMA table_info(llm_calls)").all().map((c) => c.name));
for (const [name, ddl] of [
  ["http_status", "ALTER TABLE llm_calls ADD COLUMN http_status INTEGER"],
  ["stop_reason", "ALTER TABLE llm_calls ADD COLUMN stop_reason TEXT"],
  ["error_message", "ALTER TABLE llm_calls ADD COLUMN error_message TEXT"],
]) {
  if (!cols.has(name)) db.exec(ddl);
}

const now = Date.now();
const sessionId = "seed-session-001";
db.prepare(
  `INSERT INTO sessions (session_id, session_file, first_seen, last_seen)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen`
).run(sessionId, null, now - 6 * 3600_000, now);

const sid = db.prepare("SELECT id FROM sessions WHERE session_id = ?").get(sessionId).id;

// Empty provider "" simulates legacy / missing-provider rows (API exposes as null)
const MODELS = [
  ["anthropic", "claude-sonnet-4-5"],
  ["anthropic", "claude-opus-4-5"],
  ["openai", "gpt-4o"],
  ["deepseek", "deepseek-v3"],
  ["", "legacy-model-no-provider"],
];

const modelIds = {};
for (const [provider, model] of MODELS) {
  db.prepare(
    `INSERT INTO models (provider, model) VALUES (?, ?)
     ON CONFLICT(provider, model) DO NOTHING`
  ).run(provider, model);
  const key = `${provider}\0${model}`;
  modelIds[key] = db.prepare("SELECT id FROM models WHERE provider=? AND model=?").get(provider, model).id;
}

const insert = db.prepare(`
  INSERT OR IGNORE INTO llm_calls (
    session_int, model_int, message_id, started_at, finished_at, ttft_ms, duration_ms,
    input_tokens, output_tokens, cache_read, cache_write, cost_usd, tps_total, tps_gen,
    http_status, stop_reason, error_message
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

db.exec("BEGIN");
let n = 0;
for (let i = 0; i < 80; i++) {
  const t = now - (80 - i) * 4 * 60_000; // every 4 min
  const [provider, model] = MODELS[i % MODELS.length];
  const mid = modelIds[`${provider}\0${model}`];
  // ~12% failures (400/429/500)
  const failRoll = Math.random();
  const isFail = failRoll < 0.12;
  let httpStatus = 200;
  let stopReason = "stop";
  let errorMessage = null;
  let input = 2000 + Math.round(Math.random() * 12000);
  let output = 400 + Math.round(Math.random() * 3000);
  let cacheRead = Math.round(input * (0.2 + Math.random() * 0.5));
  let cacheWrite = Math.round(input * 0.3);
  let ttft = 200 + Math.round(Math.random() * 1500);
  let duration = ttft + 800 + Math.round(Math.random() * 8000);
  if (isFail) {
    if (failRoll < 0.05) {
      httpStatus = 400;
      errorMessage = "400 Bad Request: invalid model mapping";
    } else if (failRoll < 0.09) {
      httpStatus = 429;
      errorMessage = "429 Too Many Requests: rate limited";
    } else {
      httpStatus = 500;
      errorMessage = "500 Internal Server Error";
    }
    stopReason = "error";
    input = 0;
    output = 0;
    cacheRead = 0;
    cacheWrite = 0;
    ttft = null;
    duration = 800 + Math.round(Math.random() * 4000);
  }
  const cost = Math.round((input * 0.000003 + output * 0.000015 + cacheRead * 0.0000003) * 1e6);
  let tpsTotal = null;
  let tpsGen = null;
  if (duration > 0 && output > 0) {
    tpsTotal = Math.min(Math.max(output / (duration / 1000), 0.1), 800);
    const genMs = Math.max(1, duration - (ttft ?? 0));
    if (genMs < 150 || output < 3) {
      tpsGen = duration < 150 ? tpsTotal : Math.min(output / (duration / 1000), 800);
    } else {
      tpsGen = Math.min(Math.max(output / (genMs / 1000), 0.1), 800);
    }
  }
  insert.run(
    sid,
    mid,
    `seed_${i}_${t}`,
    t,
    t + duration,
    ttft,
    duration,
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
    tpsTotal,
    tpsGen,
    httpStatus,
    stopReason,
    errorMessage
  );
  n++;
}
db.exec("COMMIT");
db.close();
console.log(`Seeded ${n} rows into ${DB_PATH}`);
