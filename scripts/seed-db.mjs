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
  UNIQUE(session_int, message_id)
);
CREATE INDEX IF NOT EXISTS idx_calls_started ON llm_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_calls_model ON llm_calls(model_int);
`);

const now = Date.now();
const sessionId = "seed-session-001";
db.prepare(
  `INSERT INTO sessions (session_id, session_file, first_seen, last_seen)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen`
).run(sessionId, null, now - 6 * 3600_000, now);

const sid = db.prepare("SELECT id FROM sessions WHERE session_id = ?").get(sessionId).id;

const MODELS = [
  ["anthropic", "claude-sonnet-4-5"],
  ["anthropic", "claude-opus-4-5"],
  ["openai", "gpt-4o"],
  ["deepseek", "deepseek-v3"],
];

const modelIds = {};
for (const [provider, model] of MODELS) {
  db.prepare(
    `INSERT INTO models (provider, model) VALUES (?, ?)
     ON CONFLICT(provider, model) DO NOTHING`
  ).run(provider, model);
  modelIds[model] = db.prepare("SELECT id FROM models WHERE provider=? AND model=?").get(provider, model).id;
}

const insert = db.prepare(`
  INSERT OR IGNORE INTO llm_calls (
    session_int, model_int, message_id, started_at, finished_at, ttft_ms, duration_ms,
    input_tokens, output_tokens, cache_read, cache_write, cost_usd, tps_total, tps_gen
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

db.exec("BEGIN");
let n = 0;
for (let i = 0; i < 80; i++) {
  const t = now - (80 - i) * 4 * 60_000; // every 4 min
  const model = MODELS[i % MODELS.length][1];
  const mid = modelIds[model];
  const input = 2000 + Math.round(Math.random() * 12000);
  const output = 400 + Math.round(Math.random() * 3000);
  const cacheRead = Math.round(input * (0.2 + Math.random() * 0.5));
  const cacheWrite = Math.round(input * 0.3);
  const ttft = 200 + Math.round(Math.random() * 1500);
  const duration = ttft + 800 + Math.round(Math.random() * 8000);
  const cost = Math.round((input * 0.000003 + output * 0.000015 + cacheRead * 0.0000003) * 1e6);
  const tokens = input + output;
  const tpsTotal = tokens / (duration / 1000);
  const tpsGen = tokens / (Math.max(1, duration - ttft) / 1000);
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
    tpsGen
  );
  n++;
}
db.exec("COMMIT");
db.close();
console.log(`Seeded ${n} rows into ${DB_PATH}`);
