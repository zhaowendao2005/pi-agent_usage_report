//! Read-only queries against ~/.pi/agent/usage.db

use chrono::{Local, TimeZone};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenDataPoint {
    pub id: i64,
    pub time: String,
    /// null when missing / empty in DB (legacy rows without provider)
    pub provider: Option<String>,
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
    /// HTTP status if captured (null for legacy rows)
    pub http_status: Option<i64>,
    /// Assistant stopReason (stop/error/aborted/…)
    pub stop_reason: Option<String>,
    /// Truncated provider error text
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    /// null when missing / empty in DB (legacy rows without provider)
    pub provider: Option<String>,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read: i64,
    pub cache_write: i64,
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
    /// Calls with non-2xx http_status or stop_reason in (error, aborted)
    pub error_count: i64,
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
              http_status INTEGER,
              stop_reason TEXT,
              error_message TEXT,
              UNIQUE(session_int, message_id)
            );
            CREATE INDEX IF NOT EXISTS idx_calls_started ON llm_calls(started_at);
            CREATE INDEX IF NOT EXISTS idx_calls_model ON llm_calls(model_int);
            CREATE INDEX IF NOT EXISTS idx_calls_status ON llm_calls(http_status);
            CREATE TABLE IF NOT EXISTS price_calibration (
              id INTEGER PRIMARY KEY,
              provider TEXT NOT NULL UNIQUE,
              script TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_groups (
              id INTEGER PRIMARY KEY,
              group_name TEXT NOT NULL UNIQUE,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_group_members (
              id INTEGER PRIMARY KEY,
              group_id INTEGER NOT NULL,
              original_provider TEXT NOT NULL,
              added_at INTEGER NOT NULL,
              UNIQUE(group_id, original_provider),
              FOREIGN KEY(group_id) REFERENCES provider_groups(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_group_members_provider ON provider_group_members(original_provider);
            "#,
        )
        .map_err(|e| e.to_string())?;
        return Ok(conn);
    }

    // Database exists, ensure new tables exist (migration)
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .or_else(|_| Connection::open(&path))
    .map_err(|e| format!("open db {}: {e}", path.display()))?;

    // Ensure new tables exist (idempotent migration)
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS price_calibration (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL UNIQUE,
          script TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS provider_groups (
          id INTEGER PRIMARY KEY,
          group_name TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS provider_group_members (
          id INTEGER PRIMARY KEY,
          group_id INTEGER NOT NULL,
          original_provider TEXT NOT NULL,
          added_at INTEGER NOT NULL,
          UNIQUE(group_id, original_provider),
          FOREIGN KEY(group_id) REFERENCES provider_groups(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_group_members_provider ON provider_group_members(original_provider);
        "#,
    )
    .map_err(|e| e.to_string())?;

    // Re-open as read-only
    drop(conn);
    Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .or_else(|_| Connection::open(&path))
    .map_err(|e| format!("open db {}: {e}", path.display()))
}

fn format_local(ms: i64) -> String {
    match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        _ => ms.to_string(),
    }
}

/// Empty / whitespace provider is treated as missing (null) for API consumers.
fn normalize_provider(raw: Option<String>) -> Option<String> {
    match raw {
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => None,
    }
}

fn normalize_opt_text(raw: Option<String>) -> Option<String> {
    match raw {
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => None,
    }
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> bool {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let rows = stmt.query_map([], |r| r.get::<_, String>(1));
    let Ok(rows) = rows else {
        return false;
    };
    for row in rows.flatten() {
        if row == column {
            return true;
        }
    }
    false
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
    let has_status = table_has_column(&conn, "llm_calls", "http_status");
    let has_stop = table_has_column(&conn, "llm_calls", "stop_reason");
    let has_err = table_has_column(&conn, "llm_calls", "error_message");

    let sql = format!(
        r#"
            SELECT c.id, c.started_at, m.provider, m.model,
                   c.input_tokens, c.output_tokens, c.cache_read, c.cache_write,
                   c.tps_total, c.tps_gen, c.cost_usd, c.ttft_ms, c.duration_ms,
                   {http_status}, {stop_reason}, {error_message}
            FROM llm_calls c
            JOIN models m ON m.id = c.model_int
            WHERE c.started_at >= ?1 AND c.started_at < ?2
            ORDER BY c.started_at ASC
            "#,
        http_status = if has_status {
            "c.http_status"
        } else {
            "NULL"
        },
        stop_reason = if has_stop {
            "c.stop_reason"
        } else {
            "NULL"
        },
        error_message = if has_err {
            "c.error_message"
        } else {
            "NULL"
        },
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![start, end], |r| {
            let id: i64 = r.get(0)?;
            let started_at: i64 = r.get(1)?;
            let cost_usd: i64 = r.get(10)?;
            Ok(TokenDataPoint {
                id,
                time: format_local(started_at),
                provider: normalize_provider(r.get::<_, Option<String>>(2)?),
                model: r.get::<_, String>(3).unwrap_or_else(|_| "unknown".into()),
                input_tokens: r.get(4)?,
                output_tokens: r.get(5)?,
                cache_read: r.get(6)?,
                cache_write: r.get(7)?,
                tps_total: r.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
                tps_gen: r.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                total_cost: (cost_usd as f64) / 1_000_000.0,
                ttft_ms: r.get(11)?,
                duration_ms: r.get(12)?,
                http_status: r.get::<_, Option<i64>>(13)?,
                stop_reason: normalize_opt_text(r.get::<_, Option<String>>(14)?),
                error_message: normalize_opt_text(r.get::<_, Option<String>>(15)?),
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
            SELECT m.provider, m.model,
                   SUM(c.input_tokens), SUM(c.output_tokens),
                   SUM(c.cache_read), SUM(c.cache_write), SUM(c.cost_usd)
            FROM llm_calls c
            JOIN models m ON m.id = c.model_int
            WHERE c.started_at >= ?1 AND c.started_at < ?2
            GROUP BY m.provider, m.model
            ORDER BY SUM(c.cost_usd) DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![start, end], |r| {
            let cost_usd: i64 = r.get::<_, Option<i64>>(6)?.unwrap_or(0);
            Ok(ModelUsage {
                provider: normalize_provider(r.get::<_, Option<String>>(0)?),
                model: r.get::<_, String>(1).unwrap_or_else(|_| "unknown".into()),
                input_tokens: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                output_tokens: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                cache_read: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                cache_write: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
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
    let has_status = table_has_column(&conn, "llm_calls", "http_status");
    let has_stop = table_has_column(&conn, "llm_calls", "stop_reason");

    // error_count: non-2xx status OR stop_reason in (error, aborted)
    let error_expr = match (has_status, has_stop) {
        (true, true) => {
            r#"SUM(CASE
              WHEN http_status IS NOT NULL AND (http_status < 200 OR http_status >= 300) THEN 1
              WHEN stop_reason IN ('error', 'aborted') THEN 1
              ELSE 0
            END)"#
        }
        (true, false) => {
            r#"SUM(CASE
              WHEN http_status IS NOT NULL AND (http_status < 200 OR http_status >= 300) THEN 1
              ELSE 0
            END)"#
        }
        (false, true) => {
            r#"SUM(CASE
              WHEN stop_reason IN ('error', 'aborted') THEN 1
              ELSE 0
            END)"#
        }
        (false, false) => "0",
    };

    let sql = format!(
        r#"
        SELECT
          COUNT(*) AS call_count,
          COALESCE(AVG(duration_ms), 0) AS avg_latency,
          COALESCE(SUM(input_tokens), 0),
          COALESCE(SUM(output_tokens), 0),
          COALESCE(SUM(cache_read), 0),
          COALESCE(SUM(cache_write), 0),
          COALESCE(SUM(cost_usd), 0),
          COALESCE({error_expr}, 0) AS error_count
        FROM llm_calls
        WHERE started_at >= ?1 AND started_at < ?2
        "#
    );

    conn.query_row(&sql, rusqlite::params![start, end], |r| {
        let call_count: i64 = r.get(0)?;
        let avg_latency: f64 = r.get(1)?;
        let total_input: i64 = r.get(2)?;
        let total_output: i64 = r.get(3)?;
        let total_cache_read: i64 = r.get(4)?;
        let total_cache_write: i64 = r.get(5)?;
        let total_cost_usd: i64 = r.get(6)?;
        let error_count: i64 = r.get(7)?;
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
            error_count,
        })
    })
    .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStat {
    pub provider: String,
    pub call_count: i64,
    pub total_cost: f64,
}

pub fn get_providers() -> Result<Vec<ProviderStat>, String> {
    let conn = open_ro()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT m.provider,
                   COUNT(*) as call_count,
                   COALESCE(SUM(c.cost_usd), 0) as total_cost
            FROM llm_calls c
            JOIN models m ON m.id = c.model_int
            WHERE m.provider IS NOT NULL AND m.provider != ''
            GROUP BY m.provider
            ORDER BY total_cost DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            let total_cost_usd: i64 = r.get(2)?;
            Ok(ProviderStat {
                provider: r.get(0)?,
                call_count: r.get(1)?,
                total_cost: (total_cost_usd as f64) / 1_000_000.0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationScript {
    pub provider: String,
    pub script: String,
    pub updated_at: i64,
}

pub fn get_calibration_script(provider: &str) -> Result<Option<CalibrationScript>, String> {
    let conn = open_ro()?;
    conn.query_row(
        "SELECT provider, script, updated_at FROM price_calibration WHERE provider = ?1",
        [provider],
        |r| {
            Ok(CalibrationScript {
                provider: r.get(0)?,
                script: r.get(1)?,
                updated_at: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn get_all_calibration_scripts() -> Result<Vec<CalibrationScript>, String> {
    let conn = open_ro()?;
    let mut stmt = conn
        .prepare("SELECT provider, script, updated_at FROM price_calibration ORDER BY provider ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            Ok(CalibrationScript {
                provider: r.get(0)?,
                script: r.get(1)?,
                updated_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn save_calibration_script(provider: &str, script: &str) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().timestamp_millis();
    conn.execute(
        r#"
        INSERT INTO price_calibration (provider, script, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(provider) DO UPDATE SET
            script = excluded.script,
            updated_at = excluded.updated_at
        "#,
        rusqlite::params![provider, script, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_llm_call(id: i64) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM llm_calls WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_calibration_script(provider: &str) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM price_calibration WHERE provider = ?1",
        [provider],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ===== Provider Groups =====

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderGroup {
    pub id: i64,
    pub group_name: String,
    pub members: Vec<String>,
    pub created_at: i64,
}

pub fn get_all_provider_groups() -> Result<Vec<ProviderGroup>, String> {
    let conn = open_ro()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT g.id, g.group_name, g.created_at
            FROM provider_groups g
            ORDER BY g.group_name ASC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let groups = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for group in groups {
        let (id, name, created_at) = group.map_err(|e| e.to_string())?;
        let members = get_group_members(&conn, id)?;
        result.push(ProviderGroup {
            id,
            group_name: name,
            members,
            created_at,
        });
    }
    Ok(result)
}

fn get_group_members(conn: &Connection, group_id: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT original_provider FROM provider_group_members WHERE group_id = ?1 ORDER BY added_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let members = stmt
        .query_map([group_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for member in members {
        result.push(member.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

pub fn create_provider_group(group_name: &str, members: Vec<String>) -> Result<i64, String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().timestamp_millis();

    conn.execute(
        "INSERT INTO provider_groups (group_name, created_at) VALUES (?1, ?2)",
        rusqlite::params![group_name, now],
    )
    .map_err(|e| e.to_string())?;

    let group_id = conn.last_insert_rowid();

    for member in members {
        conn.execute(
            "INSERT INTO provider_group_members (group_id, original_provider, added_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![group_id, member, now],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(group_id)
}

pub fn add_to_provider_group(group_id: i64, provider: &str) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().timestamp_millis();

    conn.execute(
        "INSERT OR IGNORE INTO provider_group_members (group_id, original_provider, added_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![group_id, provider, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_from_provider_group(group_id: i64, provider: &str) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM provider_group_members WHERE group_id = ?1 AND original_provider = ?2",
        rusqlite::params![group_id, provider],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_provider_group(group_id: i64) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM provider_groups WHERE id = ?1",
        [group_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn find_group_by_provider(provider: &str) -> Result<Option<ProviderGroup>, String> {
    let conn = open_ro()?;
    let group_id: Option<i64> = conn
        .query_row(
            "SELECT group_id FROM provider_group_members WHERE original_provider = ?1",
            [provider],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(gid) = group_id {
        let (name, created_at): (String, i64) = conn
            .query_row(
                "SELECT group_name, created_at FROM provider_groups WHERE id = ?1",
                [gid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let members = get_group_members(&conn, gid)?;
        Ok(Some(ProviderGroup {
            id: gid,
            group_name: name,
            members,
            created_at,
        }))
    } else {
        Ok(None)
    }
}
