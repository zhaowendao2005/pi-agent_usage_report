/**
 * SQLite writer for usage metrics.
 * Path: ~/.pi/agent/usage.db
 * Runtime: Node 22.19+ node:sqlite (DatabaseSync)
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const DB_PATH = join(homedir(), ".pi", "agent", "usage.db");

export interface CallRow {
  messageId: string;
  startedAt: number;
  finishedAt: number;
  ttftMs: number | null;
  durationMs: number | null;
  sessionId: string;
  sessionFile: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number; // micro-USD
  tpsTotal: number | null;
  tpsGen: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY,
  session_id   TEXT    NOT NULL UNIQUE,
  session_file TEXT,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER
);

CREATE TABLE IF NOT EXISTS models (
  id       INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  model    TEXT NOT NULL,
  UNIQUE(provider, model)
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id            INTEGER PRIMARY KEY,
  session_int   INTEGER NOT NULL REFERENCES sessions(id),
  model_int     INTEGER NOT NULL REFERENCES models(id),
  message_id    TEXT    NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  ttft_ms       INTEGER,
  duration_ms   INTEGER,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  cache_write   INTEGER NOT NULL DEFAULT 0,
  cost_usd      INTEGER NOT NULL,
  tps_total     REAL,
  tps_gen       REAL,
  UNIQUE(session_int, message_id)
);

CREATE INDEX IF NOT EXISTS idx_calls_started ON llm_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_calls_model   ON llm_calls(model_int);
`;

export class UsageDb {
  private db: DatabaseSync | null = null;
  private sessionCache = new Map<string, number>();
  private modelCache = new Map<string, number>();
  private insertStmt: ReturnType<DatabaseSync["prepare"]> | null = null;

  open(): void {
    if (this.db) return;
    mkdirSync(dirname(DB_PATH), { recursive: true });
    this.db = new DatabaseSync(DB_PATH);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO llm_calls (
        session_int, model_int, message_id,
        started_at, finished_at, ttft_ms, duration_ms,
        input_tokens, output_tokens, cache_read, cache_write,
        cost_usd, tps_total, tps_gen
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // ignore
    }
    this.db = null;
    this.insertStmt = null;
    this.sessionCache.clear();
    this.modelCache.clear();
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  private ensureOpen(): DatabaseSync {
    if (!this.db) this.open();
    return this.db!;
  }

  private resolveSession(sessionId: string, sessionFile: string | null, now: number): number {
    const cached = this.sessionCache.get(sessionId);
    if (cached !== undefined) {
      // best-effort last_seen update (cheap, ignore failure)
      try {
        this.db!.prepare("UPDATE sessions SET last_seen = ?, session_file = COALESCE(?, session_file) WHERE id = ?")
          .run(now, sessionFile, cached);
      } catch {
        // ignore
      }
      return cached;
    }
    const db = this.ensureOpen();
    db.prepare(
      `INSERT INTO sessions (session_id, session_file, first_seen, last_seen)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         session_file = COALESCE(excluded.session_file, sessions.session_file)`
    ).run(sessionId, sessionFile, now, now);
    const row = db.prepare("SELECT id FROM sessions WHERE session_id = ?").get(sessionId) as
      | { id: number }
      | undefined;
    if (!row) throw new Error(`Failed to resolve session: ${sessionId}`);
    this.sessionCache.set(sessionId, row.id);
    return row.id;
  }

  private resolveModel(provider: string, model: string): number {
    const key = `${provider}\0${model}`;
    const cached = this.modelCache.get(key);
    if (cached !== undefined) return cached;
    const db = this.ensureOpen();
    db.prepare(
      `INSERT INTO models (provider, model) VALUES (?, ?)
       ON CONFLICT(provider, model) DO NOTHING`
    ).run(provider, model);
    const row = db.prepare("SELECT id FROM models WHERE provider = ? AND model = ?").get(provider, model) as
      | { id: number }
      | undefined;
    if (!row) throw new Error(`Failed to resolve model: ${provider}/${model}`);
    this.modelCache.set(key, row.id);
    return row.id;
  }

  /** Insert a batch in one transaction. Returns inserted count (ignores duplicates). */
  insertBatch(rows: CallRow[]): number {
    if (rows.length === 0) return 0;
    const db = this.ensureOpen();
    const stmt = this.insertStmt!;
    let inserted = 0;
    db.exec("BEGIN");
    try {
      for (const r of rows) {
        const sessionInt = this.resolveSession(r.sessionId, r.sessionFile, r.startedAt);
        const modelInt = this.resolveModel(r.provider || "unknown", r.model || "unknown");
        const info = stmt.run(
          sessionInt,
          modelInt,
          r.messageId,
          r.startedAt,
          r.finishedAt,
          r.ttftMs,
          r.durationMs,
          r.inputTokens,
          r.outputTokens,
          r.cacheRead,
          r.cacheWrite,
          r.costUsd,
          r.tpsTotal,
          r.tpsGen
        );
        // node:sqlite StatementResult has changes
        if ((info as { changes?: number }).changes && (info as { changes: number }).changes > 0) {
          inserted += 1;
        }
      }
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
    return inserted;
  }
}

export const usageDb = new UsageDb();
