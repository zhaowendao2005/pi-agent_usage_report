//! Read-only queries against ~/.pi/agent/usage.db

use chrono::{Local, TimeZone};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenDataPoint {
    pub time: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub tps_total: f64,
    pub tps_gen: f64,
    pub total_cost: f64,
    pub ttft_ms: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read: i64,
    pub cost: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerSummary {
    pub avg_latency: i64,
    pub call_count: i64,
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_read: i64,
    pub total_cache_write: i64,
    pub total_cost: f64,
    pub cache_hit_rate: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub ok: bool,
    pub db_path: String,
    pub rows: i64,
}

pub fn db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("agent").join("usage.db")
}

fn open_ro() -> Result<Connection, String> {
    let path = db_path();
    if !path.exists() {
        // Empty DB is fine — return error only on open failure of existing file.
        // Create empty schema so first open works.
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
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
            "#,
        )
        .map_err(|e| e.to_string())?;
        return Ok(conn);
    }

    Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .or_else(|_| {
        // WAL may need write handle for shared memory on some systems; open normal
        Connection::open(&path)
    })
    .map_err(|e| format!("open db {}: {e}", path.display()))
}

fn format_local(ms: i64) -> String {
    match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        _ => ms.to_string(),
    }
}

/// Parse start/end: epoch ms number, or "YYYY-MM-DD HH:mm:ss" local string.
pub fn parse_time(v: &serde_json::Value, fallback: i64) -> i64 {
    match v {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(fallback),
        serde_json::Value::String(s) => {
            if let Ok(n) = s.parse::<i64>() {
                return n;
            }
            // local datetime
            let s2 = s.replace(' ', "T");
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&s2, "%Y-%m-%dT%H:%M:%S") {
                if let Some(local) = Local.from_local_datetime(&dt).single() {
                    return local.timestamp_millis();
                }
            }
            fallback
        }
        _ => fallback,
    }
}

pub fn health() -> Result<Health, String> {
    let path = db_path();
    let path_str = path.display().to_string();
    let conn = open_ro()?;
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM llm_calls", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);
    Ok(Health {
        ok: true,
        db_path: path_str,
        rows,
    })
}

pub fn series(start: i64, end: i64) -> Result<Vec<TokenDataPoint>, String> {
    let conn = open_ro()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT c.started_at, m.model,
                   c.input_tokens, c.output_tokens, c.cache_read, c.cache_write,
                   c.tps_total, c.tps_gen, c.cost_usd, c.ttft_ms, c.duration_ms
            FROM llm_calls c
            JOIN models m ON m.id = c.model_int
            WHERE c.started_at >= ?1 AND c.started_at < ?2
            ORDER BY c.started_at ASC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![start, end], |r| {
            let started_at: i64 = r.get(0)?;
            let cost_usd: i64 = r.get(8)?;
            Ok(TokenDataPoint {
                time: format_local(started_at),
                model: r.get::<_, String>(1).unwrap_or_else(|_| "unknown".into()),
                input_tokens: r.get(2)?,
                output_tokens: r.get(3)?,
                cache_read: r.get(4)?,
                cache_write: r.get(5)?,
                tps_total: r.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                tps_gen: r.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                total_cost: (cost_usd as f64) / 1_000_000.0,
                ttft_ms: r.get(9)?,
                duration_ms: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn models(start: i64, end: i64) -> Result<Vec<ModelUsage>, String> {
    let conn = open_ro()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT m.model,
                   SUM(c.input_tokens), SUM(c.output_tokens),
                   SUM(c.cache_read), SUM(c.cost_usd)
            FROM llm_calls c
            JOIN models m ON m.id = c.model_int
            WHERE c.started_at >= ?1 AND c.started_at < ?2
            GROUP BY m.model
            ORDER BY SUM(c.cost_usd) DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![start, end], |r| {
            let cost_usd: i64 = r.get::<_, Option<i64>>(4)?.unwrap_or(0);
            Ok(ModelUsage {
                model: r.get::<_, String>(0).unwrap_or_else(|_| "unknown".into()),
                input_tokens: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                output_tokens: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                cache_read: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                cost: (cost_usd as f64) / 1_000_000.0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn summary(start: i64, end: i64) -> Result<ServerSummary, String> {
    let conn = open_ro()?;
    conn.query_row(
        r#"
        SELECT
          COUNT(*) AS call_count,
          COALESCE(AVG(duration_ms), 0) AS avg_latency,
          COALESCE(SUM(input_tokens), 0),
          COALESCE(SUM(output_tokens), 0),
          COALESCE(SUM(cache_read), 0),
          COALESCE(SUM(cache_write), 0),
          COALESCE(SUM(cost_usd), 0)
        FROM llm_calls
        WHERE started_at >= ?1 AND started_at < ?2
        "#,
        rusqlite::params![start, end],
        |r| {
            let call_count: i64 = r.get(0)?;
            let avg_latency: f64 = r.get(1)?;
            let total_input: i64 = r.get(2)?;
            let total_output: i64 = r.get(3)?;
            let total_cache_read: i64 = r.get(4)?;
            let total_cache_write: i64 = r.get(5)?;
            let total_cost_usd: i64 = r.get(6)?;
            let cache_hit_rate = if total_input + total_cache_read > 0 {
                (total_cache_read as f64) / ((total_input + total_cache_read) as f64) * 100.0
            } else {
                0.0
            };
            Ok(ServerSummary {
                avg_latency: avg_latency.round() as i64,
                call_count,
                total_input,
                total_output,
                total_cache_read,
                total_cache_write,
                total_cost: (total_cost_usd as f64) / 1_000_000.0,
                cache_hit_rate: (cache_hit_rate * 10.0).round() / 10.0,
            })
        },
    )
    .map_err(|e| e.to_string())
}
