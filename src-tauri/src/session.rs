//! Pi Agent session scanner, JSONL parser, and real-time telemetry.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub cwd: String,
    pub title: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: i64,
    pub file_size: u64,
    pub entry_count: usize,
    pub is_live: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    pub id: String,
    pub path: String,
    pub session_count: usize,
    pub last_active_at: i64,
    pub sessions: Vec<SessionSummary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionTreeNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub depth: usize,
    pub is_branch_point: bool,
    pub branch_kind: String, // "user", "thinking", "tool", "assistant", "error", "system"
    pub entry_type: String,
    pub timestamp: Option<String>,
    pub role: Option<String>,
    pub role_label: String,
    pub summary: String,
    pub model: Option<String>,
    pub tool_name: Option<String>,
    pub char_count: usize,
    pub detail: Value,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub tokens: Option<i64>,
    pub cost: Option<f64>,
    pub is_leaf: bool,
    pub has_children: bool,
    pub children_ids: Vec<String>,
    // --- rewind / branch grouping (see parse_session_tree) ---
    /// Owning turn/rewind segment (nearest user prompt / branch_summary / root).
    pub segment_id: String,
    /// For rewound (nested) segments: the segment they branch out of.
    pub parent_segment_id: Option<String>,
    /// True when this segment starts an alternative (rewind/fork) branch.
    pub is_rewind: bool,
    /// Entry this rewind branched from (the DAG parent).
    pub rewind_from_id: Option<String>,
    /// 1-based position among sibling user prompts (1 = original continuation).
    pub branch_index: Option<usize>,
    pub branch_count: Option<usize>,
    /// Part of the root → current leaf path.
    pub is_on_active_path: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionTreeResult {
    pub session_id: String,
    pub cwd: String,
    pub root_ids: Vec<String>,
    pub nodes: Vec<SessionTreeNode>,
    pub total_nodes: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TelemetryChunk {
    pub seq: usize,
    pub timestamp: i64,
    pub phase: String,
    pub chars: usize,
    pub total_chars: usize,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct ActiveRequestTelemetry {
    pub is_active: bool,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub phase: String, // "waiting_ttft", "thinking", "text", "tool_call", "idle"
    pub current_delta_snippet: String,
    pub accumulated_text: String,
    pub thinking_text: String,
    pub chunks: Vec<TelemetryChunk>,
    pub total_chars: usize,
    pub total_tokens_est: usize,
    pub started_at: Option<i64>,
    pub last_chunk_at: Option<i64>,
    pub silence_duration_ms: i64,
    pub active_duration_ms: i64,
    pub ttft_ms: Option<i64>,
    pub tps_current: f64,
    pub health_status: String, // "healthy", "waiting", "warning", "danger"
    pub diagnostic_verdict: String,
}

impl Default for ActiveRequestTelemetry {
    fn default() -> Self {
        Self {
            is_active: false,
            session_id: None,
            model: None,
            provider: None,
            phase: "idle".to_string(),
            current_delta_snippet: String::new(),
            accumulated_text: String::new(),
            thinking_text: String::new(),
            chunks: Vec::new(),
            total_chars: 0,
            total_tokens_est: 0,
            started_at: None,
            last_chunk_at: None,
            silence_duration_ms: 0,
            active_duration_ms: 0,
            ttft_ms: None,
            tps_current: 0.0,
            health_status: "healthy".to_string(),
            diagnostic_verdict: "当前会话无活跃请求，系统处于待命状态。".to_string(),
        }
    }
}

pub fn sessions_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("agent").join("sessions")
}

pub fn active_turn_file() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("pi-usage-report-store").join("active_turn.json")
}

pub fn active_turns_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("pi-usage-report-store").join("active_turns")
}

fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fallback_decode_workspace_name(name: &str) -> String {
    let trimmed = name.trim_matches('-');
    let parts: Vec<&str> = trimmed.split("--").collect();
    if parts.len() >= 2 && parts[0].len() == 1 {
        // Drive letter style: "D" + "code-Large-scale..."
        let drive = parts[0];
        let rest = parts[1..].join("\\").replace('-', "\\");
        format!("{}:\\{}", drive, rest)
    } else {
        trimmed.replace("--", "\\").replace('-', "\\")
    }
}

/// Reads the first line of a session file to extract session metadata and real cwd.
fn peek_session_header(path: &Path) -> Option<(String, String, Option<String>)> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    if let Some(Ok(first_line)) = lines.next() {
        if let Ok(v) = serde_json::from_str::<Value>(&first_line) {
            let id = v.get("id").and_then(|s| s.as_str()).unwrap_or("unknown").to_string();
            let cwd = v.get("cwd").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let timestamp = v.get("timestamp").and_then(|s| s.as_str()).map(|s| s.to_string());
            return Some((id, cwd, timestamp));
        }
    }
    None
}

/// Quick peek for title (first user message or session_info)
fn peek_session_title(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().flatten().take(30) {
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            let entry_type = v.get("type").and_then(|s| s.as_str()).unwrap_or("");
            if entry_type == "session_info" {
                if let Some(name) = v.get("name").and_then(|s| s.as_str()) {
                    if !name.trim().is_empty() {
                        return Some(name.to_string());
                    }
                }
            } else if entry_type == "message" {
                if let Some(msg) = v.get("message") {
                    if msg.get("role").and_then(|s| s.as_str()) == Some("user") {
                        if let Some(content) = msg.get("content") {
                            if let Some(s) = content.as_str() {
                                let trimmed = s.trim();
                                if !trimmed.is_empty() {
                                    let preview = trimmed.chars().take(60).collect::<String>();
                                    return Some(preview);
                                }
                            } else if let Some(arr) = content.as_array() {
                                for item in arr {
                                    if item.get("type").and_then(|s| s.as_str()) == Some("text") {
                                        if let Some(t) = item.get("text").and_then(|s| s.as_str()) {
                                            let trimmed = t.trim();
                                            if !trimmed.is_empty() {
                                                let preview = trimmed.chars().take(60).collect::<String>();
                                                return Some(preview);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Scans workspaces and their session files.
pub fn scan_workspaces(
    limit_workspaces: Option<usize>,
    limit_sessions: Option<usize>,
) -> Result<Vec<WorkspaceItem>, String> {
    let root = sessions_dir();
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut workspaces = Vec::new();
    let now_ms = Utc::now().timestamp_millis();

    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let session_files = match fs::read_dir(&path) {
            Ok(files) => files,
            Err(_) => continue,
        };

        let mut sessions: Vec<SessionSummary> = Vec::new();
        let mut real_cwd: Option<String> = None;
        let mut ws_last_active = 0i64;

        for sf in session_files.flatten() {
            let spath = sf.path();
            if spath.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }

            let file_name = sf.file_name().to_string_lossy().to_string();
            let mtime = mtime_ms(&spath);
            if mtime > ws_last_active {
                ws_last_active = mtime;
            }

            let file_size = sf.metadata().map(|m| m.len()).unwrap_or(0);
            let header_info = peek_session_header(&spath);
            let title = peek_session_title(&spath);

            let (id, cwd, created_at) = if let Some((hid, hcwd, hts)) = header_info {
                if real_cwd.is_none() && !hcwd.is_empty() {
                    real_cwd = Some(hcwd.clone());
                }
                (hid, hcwd, hts)
            } else {
                let id = file_name
                    .split('_')
                    .last()
                    .unwrap_or(&file_name)
                    .trim_end_matches(".jsonl")
                    .to_string();
                (id, String::new(), None)
            };

            let is_live = (now_ms - mtime).abs() < 25_000; // updated in last 25s

            sessions.push(SessionSummary {
                id,
                file_name,
                file_path: spath.to_string_lossy().to_string(),
                cwd,
                title,
                created_at,
                updated_at: mtime,
                file_size,
                entry_count: 0,
                is_live,
            });
        }

        if sessions.is_empty() {
            continue;
        }

        // Sort sessions by updated_at descending
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        let total_session_count = sessions.len();
        let resolved_path = real_cwd.unwrap_or_else(|| fallback_decode_workspace_name(&folder_name));

        // Apply session limit per directory if given
        let bounded_sessions = if let Some(lim) = limit_sessions {
            sessions.into_iter().take(lim).collect()
        } else {
            sessions
        };

        workspaces.push(WorkspaceItem {
            id: folder_name,
            path: resolved_path,
            session_count: total_session_count,
            last_active_at: ws_last_active,
            sessions: bounded_sessions,
        });
    }

    // Sort workspaces by last_active_at descending
    workspaces.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));

    if let Some(lim) = limit_workspaces {
        workspaces.truncate(lim);
    }

    Ok(workspaces)
}

/// Fetch additional sessions for a specific workspace directory (pagination/expand).
pub fn fetch_workspace_sessions(
    workspace_id: &str,
    offset: usize,
    limit: usize,
) -> Result<Vec<SessionSummary>, String> {
    let ws_path = sessions_dir().join(workspace_id);
    if !ws_path.is_dir() {
        return Err(format!("Workspace directory not found: {}", workspace_id));
    }

    let files = fs::read_dir(&ws_path).map_err(|e| e.to_string())?;
    let mut sessions = Vec::new();
    let now_ms = Utc::now().timestamp_millis();

    for f in files.flatten() {
        let spath = f.path();
        if spath.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }

        let file_name = f.file_name().to_string_lossy().to_string();
        let mtime = mtime_ms(&spath);
        let file_size = f.metadata().map(|m| m.len()).unwrap_or(0);
        let header_info = peek_session_header(&spath);
        let title = peek_session_title(&spath);

        let (id, cwd, created_at) = if let Some((hid, hcwd, hts)) = header_info {
            (hid, hcwd, hts)
        } else {
            (file_name.trim_end_matches(".jsonl").to_string(), String::new(), None)
        };

        let is_live = (now_ms - mtime).abs() < 25_000;

        sessions.push(SessionSummary {
            id,
            file_name,
            file_path: spath.to_string_lossy().to_string(),
            cwd,
            title,
            created_at,
            updated_at: mtime,
            file_size,
            entry_count: 0,
            is_live,
        });
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let paged: Vec<SessionSummary> = sessions.into_iter().skip(offset).take(limit).collect();
    Ok(paged)
}

/// Helper to format single-line summary for tree node
fn build_node_summary(v: &Value, entry_type: &str) -> (String, String, Option<String>, Option<i64>, Option<i64>, Option<f64>) {
    let mut role = None;
    let mut status = "ok".to_string();
    let mut duration_ms = None;
    let mut tokens = None;
    let mut cost = None;
    let mut summary = String::new();

    match entry_type {
        "session" => {
            let cwd = v.get("cwd").and_then(|s| s.as_str()).unwrap_or("");
            summary = format!("Session initialized [cwd: {}]", cwd);
        }
        "message" => {
            if let Some(msg) = v.get("message") {
                let r = msg.get("role").and_then(|s| s.as_str()).unwrap_or("message");
                role = Some(r.to_string());
                duration_ms = msg.get("durationMs").and_then(|n| n.as_i64());

                if let Some(u) = msg.get("usage") {
                    let total_tok = u.get("totalTokens").and_then(|n| n.as_i64())
                        .or_else(|| {
                            let inp = u.get("input").and_then(|n| n.as_i64()).unwrap_or(0);
                            let out = u.get("output").and_then(|n| n.as_i64()).unwrap_or(0);
                            Some(inp + out)
                        });
                    tokens = total_tok;
                    cost = u.get("cost").and_then(|c| c.get("total")).and_then(|n| n.as_f64());
                }

                let stop_reason = msg.get("stopReason").and_then(|s| s.as_str());
                if stop_reason == Some("aborted") {
                    status = "aborted".to_string();
                } else if stop_reason == Some("error") || msg.get("errorMessage").is_some() {
                    status = "error".to_string();
                }

                match r {
                    "user" => {
                        let text = extract_content_text(msg.get("content"));
                        summary = format!("user: {}", text.replace('\n', " ").trim());
                    }
                    "assistant" => {
                        let mut text = extract_content_text(msg.get("content"));
                        if text.is_empty() {
                            if status == "aborted" {
                                text = "(aborted)".to_string();
                            } else if let Some(err) = msg.get("errorMessage").and_then(|s| s.as_str()) {
                                text = format!("Error: {}", err);
                            } else {
                                text = "(no content)".to_string();
                            }
                        }
                        summary = format!("assistant: {}", text.replace('\n', " ").trim());
                    }
                    "toolResult" => {
                        let tool_name = msg.get("toolName").and_then(|s| s.as_str()).unwrap_or("tool");
                        let is_err = msg.get("isError").and_then(|b| b.as_bool()).unwrap_or(false);
                        if is_err {
                            status = "error".to_string();
                        }
                        let text = extract_content_text(msg.get("content"));
                        let snippet = text.replace('\n', " ").chars().take(80).collect::<String>();
                        summary = format!("[{}: {}]", tool_name, snippet);
                    }
                    "bashExecution" => {
                        let cmd = msg.get("command").and_then(|s| s.as_str()).unwrap_or("");
                        summary = format!("[bash: {}]", cmd);
                    }
                    _ => {
                        summary = format!("[{}]: ...", r);
                    }
                }
            }
        }
        "model_change" => {
            let model_id = v.get("modelId").and_then(|s| s.as_str()).unwrap_or("unknown");
            summary = format!("[model: {}]", model_id);
        }
        "thinking_level_change" => {
            let lvl = v.get("thinkingLevel").and_then(|s| s.as_str()).unwrap_or("default");
            summary = format!("[thinking: {}]", lvl);
        }
        "compaction" => {
            let tokens_before = v.get("tokensBefore").and_then(|n| n.as_i64()).unwrap_or(0);
            summary = format!("[compaction: {}k tokens]", tokens_before / 1000);
        }
        "branch_summary" => {
            let s = v.get("summary").and_then(|sm| sm.as_str()).unwrap_or("");
            summary = format!("[branch summary]: {}", s);
        }
        "custom" => {
            let ct = v.get("customType").and_then(|s| s.as_str()).unwrap_or("extension");
            summary = format!("[custom: {}]", ct);
        }
        "custom_message" => {
            let ct = v.get("customType").and_then(|s| s.as_str()).unwrap_or("custom");
            let text = extract_content_text(v.get("content"));
            summary = format!("[{}]: {}", ct, text.replace('\n', " "));
        }
        "session_info" => {
            let name = v.get("name").and_then(|s| s.as_str()).unwrap_or("empty");
            summary = format!("[title: {}]", name);
        }
        "label" => {
            let lbl = v.get("label").and_then(|s| s.as_str()).unwrap_or("cleared");
            summary = format!("[label: {}]", lbl);
        }
        _ => {
            summary = format!("[{}]", entry_type);
        }
    }

    if summary.chars().count() > 140 {
        let truncated: String = summary.chars().take(139).collect();
        summary = format!("{}…", truncated);
    }

    (summary, status, role, duration_ms, tokens, cost)
}

fn extract_content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => {
            let mut buf = String::new();
            for item in arr {
                let t = item.get("type").and_then(|s| s.as_str()).unwrap_or("");
                if t == "text" {
                    if let Some(txt) = item.get("text").and_then(|s| s.as_str()) {
                        buf.push_str(txt);
                        buf.push(' ');
                    }
                } else if t == "thinking" {
                    if let Some(txt) = item.get("thinking").and_then(|s| s.as_str()) {
                        buf.push_str("[thinking] ");
                        buf.push_str(txt);
                        buf.push(' ');
                    }
                } else if t == "toolCall" {
                    let name = item.get("name").and_then(|s| s.as_str()).unwrap_or("tool");
                    buf.push_str(&format!("[call {}] ", name));
                }
            }
            buf
        }
        _ => String::new(),
    }
}

/// Maximum visual nesting for rewound branches. Side entries never add depth,
/// so this only grows with genuine rewind-of-rewind chains.
const MAX_TREE_DEPTH: usize = 8;

fn entry_type_of(v: &Value) -> &str {
    v.get("type").and_then(|s| s.as_str()).unwrap_or("unknown")
}

fn role_of_entry(v: &Value) -> Option<String> {
    v.get("message")
        .and_then(|m| m.get("role"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
}

/// Bookkeeping entries that must never start a branch or add an indent level.
/// Extensions (e.g. plannotator) append these as extra siblings of the real
/// continuation — treating them as branches is what produced the deep role
/// nesting seen in the old `/tree`-style viewers.
fn is_side_entry(entry_type: &str) -> bool {
    matches!(
        entry_type,
        "custom"
            | "custom_message"
            | "context_edit"
            | "model_change"
            | "thinking_level_change"
            | "label"
            | "session_info"
            | "usage"
    )
}

fn is_segment_root(entry_type: &str, role: Option<&str>) -> bool {
    role == Some("user") || entry_type == "branch_summary"
}

#[allow(clippy::too_many_arguments)]
fn build_tree_node(
    i: usize,
    depth: usize,
    ids: &[String],
    entries: &[Value],
    parents: &[Option<String>],
    dag_children: &[Vec<usize>],
    entry_types: &[String],
    branch_index: &[Option<usize>],
    branch_count: &[Option<usize>],
    segment_id: String,
    parent_segment_id: Option<String>,
    is_rewind: bool,
    rewind_from_id: Option<String>,
    is_on_active_path: bool,
) -> SessionTreeNode {
    let entry = &entries[i];
    let entry_type = entry_types[i].as_str();
    let timestamp = entry
        .get("timestamp")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    let (summary, status, role, duration_ms, tokens, cost) = build_node_summary(entry, entry_type);
    let is_user = role.as_deref() == Some("user");

    let role_label = role.clone().unwrap_or_else(|| entry_type.to_string());

    let model = if entry_type == "model_change" {
        entry
            .get("modelId")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
    } else {
        entry
            .get("message")
            .and_then(|m| m.get("model"))
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
    };

    let tool_name = entry
        .get("message")
        .and_then(|m| m.get("toolName"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            if role.as_deref() == Some("bashExecution") {
                Some("bash".to_string())
            } else {
                None
            }
        });

    let char_count = entry
        .get("message")
        .and_then(|m| m.get("content"))
        .map(|c| extract_content_text(Some(c)).chars().count())
        .unwrap_or_else(|| summary.chars().count());

    let branch_kind = if status == "error" || status == "aborted" {
        "error".to_string()
    } else if is_user {
        "user".to_string()
    } else if summary.contains("[thinking]") || entry_type == "thinking_level_change" {
        "thinking".to_string()
    } else if role.as_deref() == Some("toolResult") || role.as_deref() == Some("bashExecution") {
        "tool".to_string()
    } else if role.as_deref() == Some("assistant") {
        "assistant".to_string()
    } else {
        "system".to_string()
    };

    SessionTreeNode {
        id: ids[i].clone(),
        parent_id: parents[i].clone(),
        depth,
        is_branch_point: dag_children[i].len() > 1,
        branch_kind,
        entry_type: entry_type.to_string(),
        timestamp,
        role,
        role_label,
        summary,
        model,
        tool_name,
        char_count,
        detail: Value::Null, // Cold load: strip heavy detail from tree list
        status,
        duration_ms,
        tokens,
        cost,
        is_leaf: dag_children[i].is_empty(),
        has_children: false,
        children_ids: Vec::new(),
        segment_id,
        parent_segment_id,
        is_rewind,
        rewind_from_id: if is_rewind { rewind_from_id } else { None },
        branch_index: branch_index[i],
        branch_count: branch_count[i],
        is_on_active_path,
    }
}

/// Parses full session JSONL into a DAG-aware "chat branch" tree.
///
/// Model:
///   1. A *segment* starts at every user prompt, `branch_summary`, or root and
///      runs along the unique child chain. It is the collapsible turn unit.
///   2. Depth only changes at **rewinds**: a user prompt that is an alternative
///      sibling of the main continuation, or a `branch_summary`. Everything
///      inside a segment — user, assistant, thinking, tool results, extension
///      `custom` entries, context edits — shares the same depth.
///   3. Bookkeeping/extension entries never add a level, no matter how the DAG
///      nests them. This is the key difference to a raw parent/child indent:
///      "一个 rewind 内无论什么角色都不应该再缩进一个子级别".
pub fn parse_session_tree(file_path: &str) -> Result<SessionTreeResult, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("Session file not found: {}", file_path));
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut entries: Vec<Value> = Vec::new();
    let mut index_of: HashMap<String, usize> = HashMap::new();

    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        let v = match serde_json::from_str::<Value>(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = v.get("type").and_then(|s| s.as_str()).unwrap_or("");
        if t == "session" {
            if let Some(id) = v.get("id").and_then(|s| s.as_str()) {
                session_id = id.to_string();
            }
            if let Some(c) = v.get("cwd").and_then(|s| s.as_str()) {
                cwd = c.to_string();
            }
            continue;
        }
        if let Some(id) = v.get("id").and_then(|s| s.as_str()) {
            if !index_of.contains_key(id) {
                index_of.insert(id.to_string(), entries.len());
                entries.push(v);
            }
        }
    }

    let total_entries = entries.len();
    if total_entries == 0 {
        return Ok(SessionTreeResult {
            session_id,
            cwd,
            root_ids: Vec::new(),
            nodes: Vec::new(),
            total_nodes: 0,
        });
    }

    let ids: Vec<String> = entries
        .iter()
        .map(|e| {
            e.get("id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string()
        })
        .collect();
    let entry_types: Vec<String> = entries
        .iter()
        .map(|e| entry_type_of(e).to_string())
        .collect();

    let mut parents: Vec<Option<String>> = vec![None; total_entries];
    let mut dag_children: Vec<Vec<usize>> = vec![Vec::new(); total_entries];
    let mut roots: Vec<usize> = Vec::new();

    for i in 0..total_entries {
        let parent_idx = entries[i]
            .get("parentId")
            .and_then(|s| s.as_str())
            .and_then(|p| index_of.get(p).copied());
        match parent_idx {
            Some(parent_idx) => {
                parents[i] = Some(ids[parent_idx].clone());
                dag_children[parent_idx].push(i);
            }
            None => roots.push(i),
        }
    }

    // --- Active path: the last appended entry is the current leaf. ---------
    let mut active_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let leaf = (0..total_entries)
        .rev()
        .find(|&i| dag_children[i].is_empty());
    if let Some(mut cur) = leaf {
        loop {
            if !active_ids.insert(ids[cur].clone()) {
                break;
            }
            match parents[cur].as_ref().and_then(|p| index_of.get(p).copied()) {
                Some(parent_idx) => cur = parent_idx,
                None => break,
            }
        }
    }

    // --- Branch bookkeeping ------------------------------------------------
    // A branch point does not automatically indent its children: extensions
    // append bookkeeping entries (`custom`, `context_edit`, ...) as extra
    // siblings of the real continuation. Only a subtree that actually contains
    // a new turn/rewind record is treated as an alternative branch.
    //
    // Post-order DP ("does this subtree contain a prompt/summary?") using an
    // explicit stack, so it stays correct for hand-edited or reordered files
    // and never recurses.
    let mut has_segment_root: Vec<bool> = vec![false; total_entries];
    let mut seen = vec![false; total_entries];
    let mut visit: Vec<(usize, bool)> = Vec::with_capacity(total_entries * 2);
    for &root in roots.iter().rev() {
        visit.push((root, false));
    }
    while let Some((i, expanded)) = visit.pop() {
        if expanded {
            let own = is_segment_root(&entry_types[i], role_of_entry(&entries[i]).as_deref())
                || parents[i].is_none();
            has_segment_root[i] =
                own || dag_children[i].iter().any(|&c| has_segment_root[c]);
            continue;
        }
        if seen[i] {
            continue;
        }
        seen[i] = true;
        visit.push((i, true));
        for &child in dag_children[i].iter().rev() {
            visit.push((child, false));
        }
    }
    // Orphans / cycles: treat them as flat roots.
    for i in 0..total_entries {
        if !seen[i] {
            has_segment_root[i] =
                is_segment_root(&entry_types[i], role_of_entry(&entries[i]).as_deref())
                    || parents[i].is_none();
        }
    }

    let mut branch_index: Vec<Option<usize>> = vec![None; total_entries];
    let mut branch_count: Vec<Option<usize>> = vec![None; total_entries];
    for parent_idx in 0..total_entries {
        if dag_children[parent_idx].len() < 2 {
            continue;
        }
        let user_children: Vec<usize> = dag_children[parent_idx]
            .iter()
            .copied()
            .filter(|&c| role_of_entry(&entries[c]).as_deref() == Some("user"))
            .collect();
        let count = user_children.len();
        for (pos, &child) in user_children.iter().enumerate() {
            branch_index[child] = Some(pos + 1);
            branch_count[child] = Some(count);
        }
    }

    // --- DAG traversal -----------------------------------------------------
    struct Frame {
        idx: usize,
        depth: usize,
        parent_segment: Option<String>,
        /// Inside an alternative/rewind branch (even if this node itself is a
        /// bookkeeping row leading to the rewound prompt).
        nested: bool,
        /// Entry id of the branch point that produced this rewind branch.
        rewind_origin: Option<String>,
        /// This node opens a new segment (root or first row of a rewind
        /// branch). Bookkeeping rows that merely lead to a rewound prompt are
        /// included in that rewind segment so the whole branch stays flat.
        starts_segment: bool,
        /// `rewind_origin` has not been claimed by a segment root yet. Only the
        /// first segment of the branch is flagged as a rewind; later turns that
        /// continue inside the same rewound branch are ordinary turns.
        rewind_pending: bool,
    }

    let mut stack: Vec<Frame> = Vec::with_capacity(total_entries);
    for &root in roots.iter().rev() {
        stack.push(Frame {
            idx: root,
            depth: 0,
            parent_segment: None,
            nested: false,
            rewind_origin: None,
            starts_segment: true,
            rewind_pending: false,
        });
    }

    let mut visited = vec![false; total_entries];
    let mut nodes: Vec<SessionTreeNode> = Vec::with_capacity(total_entries);

    while let Some(frame) = stack.pop() {
        let i = frame.idx;
        if visited[i] {
            continue;
        }
        visited[i] = true;

        let entry_type = entry_types[i].as_str();
        let role = role_of_entry(&entries[i]);
        let seg_root = frame.starts_segment
            || is_segment_root(entry_type, role.as_deref())
            || parents[i].is_none();
        // Put the rewind badge on the first real turn/summary row of the
        // branch, not on bookkeeping rows that merely lead to it.
        let is_rewind = seg_root
            && frame.rewind_pending
            && (role.as_deref() == Some("user") || entry_type == "branch_summary");

        let segment_id = if seg_root {
            ids[i].clone()
        } else {
            frame
                .parent_segment
                .clone()
                .unwrap_or_else(|| ids[i].clone())
        };

        let parent_segment_id = if seg_root && (is_rewind || frame.nested) {
            frame.parent_segment.clone()
        } else {
            None
        };

        let on_active = active_ids.contains(&ids[i]);

        nodes.push(build_tree_node(
            i,
            frame.depth,
            &ids,
            &entries,
            &parents,
            &dag_children,
            &entry_types,
            &branch_index,
            &branch_count,
            segment_id.clone(),
            parent_segment_id,
            is_rewind,
            frame.rewind_origin.clone(),
            on_active,
        ));

        let child_idxs = &dag_children[i];
        // Main continuation: first non-bookkeeping child, falling back to the
        // first child when a chain consists solely of bookkeeping rows.
        let main_child = child_idxs
            .iter()
            .copied()
            .find(|&c| !is_side_entry(&entry_types[c]))
            .or_else(|| child_idxs.first().copied());

        for &child in child_idxs.iter().rev() {
            let is_summary = entry_types[child] == "branch_summary";
            // Non-main continuation that eventually reaches a new prompt is a
            // genuine rewind branch. Pure bookkeeping siblings stay flat.
            let alternative_branch =
                child_idxs.len() > 1 && Some(child) != main_child && has_segment_root[child];
            let child_rewind = is_summary || alternative_branch;

            let child_depth = if child_rewind {
                (frame.depth + 1).min(MAX_TREE_DEPTH)
            } else {
                frame.depth
            };
            let child_origin = if child_rewind {
                Some(ids[i].clone())
            } else {
                frame.rewind_origin.clone()
            };
            let child_pending = if child_rewind {
                true
            } else if is_rewind {
                false
            } else {
                frame.rewind_pending
            };

            stack.push(Frame {
                idx: child,
                depth: child_depth,
                parent_segment: Some(segment_id.clone()),
                nested: frame.nested || child_rewind,
                rewind_origin: child_origin,
                starts_segment: child_rewind,
                rewind_pending: child_pending,
            });
        }
    }

    // Safety net for orphans / cycles: show them flat at the end.
    for i in 0..total_entries {
        if visited[i] {
            continue;
        }
        let on_active = active_ids.contains(&ids[i]);
        nodes.push(build_tree_node(
            i,
            0,
            &ids,
            &entries,
            &parents,
            &dag_children,
            &entry_types,
            &branch_index,
            &branch_count,
            ids[i].clone(),
            None,
            false,
            None,
            on_active,
        ));
    }

    // --- Segment step lists (collapse + "N 步" badge) ----------------------
    let mut segment_children: HashMap<String, Vec<usize>> = HashMap::new();
    for (pos, node) in nodes.iter().enumerate() {
        if node.segment_id != node.id {
            segment_children
                .entry(node.segment_id.clone())
                .or_default()
                .push(pos);
        }
    }
    let segment_child_ids: HashMap<String, Vec<String>> = segment_children
        .iter()
        .map(|(seg, positions)| {
            (
                seg.clone(),
                positions.iter().map(|&p| nodes[p].id.clone()).collect(),
            )
        })
        .collect();

    for node in nodes.iter_mut() {
        if node.segment_id != node.id {
            continue;
        }
        // Only real turn/rewind roots are collapsible; pre-session bookkeeping
        // roots stay as flat rows so collapsing them can't hide the session.
        if node.role.as_deref() != Some("user") && !node.is_rewind {
            continue;
        }
        if let Some(child_ids) = segment_child_ids.get(&node.id) {
            node.children_ids = child_ids.clone();
            node.has_children = !node.children_ids.is_empty();
            node.is_leaf = node.children_ids.is_empty();
        }
    }

    let root_ids = roots.iter().map(|&i| ids[i].clone()).collect();
    let total_nodes = nodes.len();

    Ok(SessionTreeResult {
        session_id,
        cwd,
        root_ids,
        nodes,
        total_nodes,
    })
}

/// Cold-load single node detail on demand from session JSONL file.
pub fn get_session_node_detail(file_path: &str, node_id: &str) -> Result<Value, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("Session file not found: {}", file_path));
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    for line in reader.lines().flatten() {
        if line.trim().is_empty() || !line.contains(node_id) {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            if v.get("id").and_then(|s| s.as_str()) == Some(node_id) {
                return Ok(v);
            }
        }
    }

    Err(format!("Node {} not found in session file", node_id))
}

/// Extracts historical received chunks and accumulated text from a session file for on-demand inspection.
fn build_historical_session_telemetry(session_id: &str, file_path: &str) -> Option<ActiveRequestTelemetry> {
    let path = Path::new(file_path);
    if !path.exists() {
        return None;
    }

    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut chunks: Vec<TelemetryChunk> = Vec::new();
    let mut accumulated_text = String::new();
    let mut thinking_text = String::new();
    let mut total_chars = 0usize;
    let mut total_tokens = 0usize;
    let mut last_model: Option<String> = None;
    let mut last_provider: Option<String> = None;
    let mut seq = 0usize;

    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            let entry_type = v.get("type").and_then(|s| s.as_str()).unwrap_or("");
            if entry_type == "model_change" {
                if let Some(m) = v.get("modelId").and_then(|s| s.as_str()) {
                    last_model = Some(m.to_string());
                }
            } else if entry_type == "message" {
                if let Some(msg) = v.get("message") {
                    let role = msg.get("role").and_then(|s| s.as_str()).unwrap_or("");
                    if role == "user" {
                        // Start of a new user turn: only retain the latest turn's received LLM output
                        chunks.clear();
                        accumulated_text.clear();
                        thinking_text.clear();
                        total_chars = 0;
                        total_tokens = 0;
                        seq = 0;
                        continue;
                    }
                    if role != "assistant" {
                        continue;
                    }
                    if let Some(m) = msg.get("model").and_then(|s| s.as_str()) {
                        last_model = Some(m.to_string());
                    }
                    if let Some(p) = msg.get("provider").and_then(|s| s.as_str()) {
                        last_provider = Some(p.to_string());
                    }
                    if let Some(u) = msg.get("usage") {
                        let out_tok = u.get("output").and_then(|n| n.as_u64()).unwrap_or(0) as usize;
                        total_tokens += out_tok;
                    }

                    let ts_ms = v
                        .get("timestamp")
                        .and_then(|s| s.as_str())
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.timestamp_millis())
                        .unwrap_or(0);

                    if let Some(content) = msg.get("content") {
                        if let Some(s) = content.as_str() {
                            let chars = s.chars().count();
                            if chars > 0 {
                                total_chars += chars;
                                seq += 1;
                                if accumulated_text.len() < 120_000 {
                                    if !accumulated_text.is_empty() {
                                        accumulated_text.push_str("\n\n");
                                    }
                                    accumulated_text.push_str(s);
                                }
                                chunks.push(TelemetryChunk {
                                    seq,
                                    timestamp: ts_ms,
                                    phase: "text".to_string(),
                                    chars,
                                    total_chars,
                                    text: s.chars().take(600).collect(),
                                });
                            }
                        } else if let Some(arr) = content.as_array() {
                            for item in arr {
                                let itype = item.get("type").and_then(|s| s.as_str()).unwrap_or("");
                                if itype == "thinking" {
                                    if let Some(t) = item.get("thinking").and_then(|s| s.as_str()) {
                                        let chars = t.chars().count();
                                        if chars > 0 {
                                            total_chars += chars;
                                            seq += 1;
                                            if thinking_text.len() < 120_000 {
                                                if !thinking_text.is_empty() {
                                                    thinking_text.push_str("\n\n");
                                                }
                                                thinking_text.push_str(t);
                                            }
                                            chunks.push(TelemetryChunk {
                                                seq,
                                                timestamp: ts_ms,
                                                phase: "thinking".to_string(),
                                                chars,
                                                total_chars,
                                                text: t.chars().take(600).collect(),
                                            });
                                        }
                                    }
                                } else if itype == "text" {
                                    if let Some(t) = item.get("text").and_then(|s| s.as_str()) {
                                        let chars = t.chars().count();
                                        if chars > 0 {
                                            total_chars += chars;
                                            seq += 1;
                                            if accumulated_text.len() < 120_000 {
                                                if !accumulated_text.is_empty() {
                                                    accumulated_text.push_str("\n\n");
                                                }
                                                accumulated_text.push_str(t);
                                            }
                                            chunks.push(TelemetryChunk {
                                                seq,
                                                timestamp: ts_ms,
                                                phase: "text".to_string(),
                                                chars,
                                                total_chars,
                                                text: t.chars().take(600).collect(),
                                            });
                                        }
                                    }
                                } else if itype == "toolCall" {
                                    let name = item.get("name").and_then(|s| s.as_str()).unwrap_or("tool");
                                    let args_str = item
                                        .get("arguments")
                                        .map(|a| a.to_string())
                                        .unwrap_or_default();
                                    let text = format!("[toolCall: {}] {}", name, args_str);
                                    let chars = text.chars().count();
                                    total_chars += chars;
                                    seq += 1;
                                    chunks.push(TelemetryChunk {
                                        seq,
                                        timestamp: ts_ms,
                                        phase: "tool_call".to_string(),
                                        chars,
                                        total_chars,
                                        text: text.chars().take(600).collect(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let last_snippet = chunks.last().map(|c| c.text.clone()).unwrap_or_default();
    let est_tokens = if total_tokens > 0 {
        total_tokens
    } else {
        (total_chars as f64 / 3.5).round() as usize
    };

    Some(ActiveRequestTelemetry {
        is_active: false,
        session_id: Some(session_id.to_string()),
        model: last_model,
        provider: last_provider,
        phase: "idle".to_string(),
        current_delta_snippet: last_snippet,
        accumulated_text,
        thinking_text,
        chunks,
        total_chars,
        total_tokens_est: est_tokens,
        started_at: None,
        last_chunk_at: None,
        silence_duration_ms: 0,
        active_duration_ms: 0,
        ttft_ms: None,
        tps_current: 0.0,
        health_status: "healthy".to_string(),
        diagnostic_verdict: "当前会话处于待命状态（已加载本会话历史接收数据包记录）。".to_string(),
    })
}

/// Reads the active request telemetry file strictly isolated by `session_id`.
pub fn get_active_telemetry(
    session_id: Option<String>,
    file_path: Option<String>,
) -> ActiveRequestTelemetry {
    let now_ms = Utc::now().timestamp_millis();

    let mut matched_data: Option<ActiveRequestTelemetry> = None;

    // 1. If a target session_id is provided, first look up its dedicated file in active_turns/
    if let Some(ref target_sid) = session_id {
        let safe_sid: String = target_sid
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let per_session_file = active_turns_dir().join(format!("{}.json", safe_sid));
        if per_session_file.exists() {
            if let Ok(content) = fs::read_to_string(&per_session_file) {
                if let Ok(data) = serde_json::from_str::<ActiveRequestTelemetry>(&content) {
                    if data.session_id.as_deref() == Some(target_sid.as_str()) {
                        matched_data = Some(data);
                    }
                }
            }
        }

        // Fallback check on global active_turn.json ONLY if its session_id matches target_sid
        // (or if an un-restarted extension instance wrote "unknown" while this session file is actively being written)
        if matched_data.is_none() {
            let p = active_turn_file();
            if p.exists() {
                if let Ok(content) = fs::read_to_string(&p) {
                    if let Ok(mut data) = serde_json::from_str::<ActiveRequestTelemetry>(&content) {
                        let sid = data.session_id.as_deref().unwrap_or("");
                        if sid == target_sid.as_str() {
                            matched_data = Some(data);
                        } else if (sid.is_empty() || sid == "unknown") && data.is_active {
                            if let Some(ref fp) = file_path {
                                if let Ok(meta) = fs::metadata(fp) {
                                    if let Ok(modified) = meta.modified() {
                                        let mtime_ms = modified
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .map(|d| d.as_millis() as i64)
                                            .unwrap_or(0);
                                        if (now_ms - mtime_ms).abs() < 30_000 {
                                            data.session_id = Some(target_sid.clone());
                                            matched_data = Some(data);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        // No session filter specified: read global active_turn.json
        let p = active_turn_file();
        if p.exists() {
            if let Ok(content) = fs::read_to_string(&p) {
                if let Ok(data) = serde_json::from_str::<ActiveRequestTelemetry>(&content) {
                    matched_data = Some(data);
                }
            }
        }
    }

    if let Some(mut data) = matched_data {
        if data.is_active {
            let last_chunk = data
                .last_chunk_at
                .unwrap_or_else(|| data.started_at.unwrap_or(now_ms));
            data.silence_duration_ms = (now_ms - last_chunk).max(0);

            if let Some(t0) = data.started_at {
                data.active_duration_ms = (now_ms - t0).max(0);
            }

            let silence_sec = data.silence_duration_ms as f64 / 1000.0;
            // If a turn file was left active after an abnormal process exit (> 180s ago), mark it idle
            if silence_sec > 180.0 {
                data.is_active = false;
                data.phase = "idle".to_string();
                data.health_status = "healthy".to_string();
                data.diagnostic_verdict = "当前会话无活跃请求，系统处于待命状态。".to_string();
            } else if silence_sec > 45.0 {
                data.health_status = "danger".to_string();
                data.diagnostic_verdict = format!(
                    "严重停滞警告：距上次接收数据已过去 {:.1}s。上游服务可能已超时挂起或连接中断。",
                    silence_sec
                );
            } else if silence_sec > 15.0 {
                data.health_status = "warning".to_string();
                data.diagnostic_verdict = format!(
                    "疑似延迟或排队阻塞：已静默 {:.1}s，正在等待模型输出下一个数据块。",
                    silence_sec
                );
            } else if silence_sec > 3.0 {
                data.health_status = "waiting".to_string();
                data.diagnostic_verdict = format!(
                    "模型深度推理中：距上次更新 {:.1}s，链路保持正常。",
                    silence_sec
                );
            } else {
                data.health_status = "healthy".to_string();
                data.diagnostic_verdict = format!(
                    "正常高速流式中：实时吞吐率 {:.1} tok/s，数据流顺畅。",
                    data.tps_current
                );
            }
        }

        // If chunks/accumulated_text are empty on an idle turn, supplement from file_path if available
        if !data.is_active && data.chunks.is_empty() {
            if let (Some(ref sid), Some(ref fp)) = (&session_id, &file_path) {
                if let Some(hist) = build_historical_session_telemetry(sid, fp) {
                    return hist;
                }
            }
        }

        return data;
    }

    // If no active turn matched for this session, return historical packets for this session (with is_active = false)
    if let (Some(ref sid), Some(ref fp)) = (&session_id, &file_path) {
        if let Some(hist) = build_historical_session_telemetry(sid, fp) {
            return hist;
        }
    }

    ActiveRequestTelemetry {
        session_id,
        ..ActiveRequestTelemetry::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_large_session() {
        let ws = scan_workspaces(Some(5), Some(5)).unwrap();
        println!("Found {} workspaces", ws.len());
        for w in &ws {
            println!("Workspace: {} (sessions: {})", w.path, w.sessions.len());
            for s in &w.sessions {
                println!("Parsing session file: {}", s.file_path);
                let res = parse_session_tree(&s.file_path);
                match res {
                    Ok(tree) => {
                        println!("  Parsed ok: {} nodes", tree.total_nodes);
                        for n in &tree.nodes {
                            // Verify cold-load: tree nodes do not carry bulky detail JSON
                            assert!(n.detail.is_null());
                            // Rewind nesting is capped and always has a segment.
                            assert!(n.depth <= MAX_TREE_DEPTH);
                            assert!(!n.segment_id.is_empty());
                        }

                        // Invariant: everything inside one rewind/turn segment
                        // shares the same visual depth (no per-role nesting).
                        let mut segment_depth: HashMap<&str, usize> = HashMap::new();
                        for n in &tree.nodes {
                            match segment_depth.get(n.segment_id.as_str()) {
                                Some(&d) => assert_eq!(d, n.depth, "segment depth drift in {}", n.segment_id),
                                None => {
                                    segment_depth.insert(n.segment_id.as_str(), n.depth);
                                }
                            }
                        }

                        // Every node's parent segment (when set) must exist.
                        let ids: std::collections::HashSet<&str> =
                            tree.nodes.iter().map(|n| n.id.as_str()).collect();
                        for n in &tree.nodes {
                            if let Some(p) = &n.parent_segment_id {
                                assert!(ids.contains(p.as_str()), "dangling parent segment {p}");
                            }
                        }
                    }
                    Err(e) => println!("  Parse err: {}", e),
                }
            }
        }
    }

    #[test]
    fn test_rewind_segments_stay_flat() {
        // m1 (settings) -> u1 -> a1 -> t1 -> c1 (extension side entry)
        //                       \-> sc1 (side entry) -> u2 (rewind) -> a2 -> c2 -> bs1
        //                                                        \-> u3 -> a3
        let dir = std::env::temp_dir().join(format!("pi-usage-report-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("rewind.jsonl");
        let lines = [
            r#"{"type":"session","id":"s1","cwd":"/tmp"}"#,
            r#"{"type":"model_change","id":"m1","parentId":null,"modelId":"m"}"#,
            r#"{"type":"message","id":"u1","parentId":"m1","message":{"role":"user","content":"first"}}"#,
            r#"{"type":"message","id":"a1","parentId":"u1","message":{"role":"assistant","content":[{"type":"text","text":"resp1"}]}}"#,
            r#"{"type":"message","id":"t1","parentId":"a1","message":{"role":"toolResult","toolName":"bash","content":"ok"}}"#,
            r#"{"type":"custom","id":"c1","parentId":"t1","customType":"plannotator","data":{}}"#,
            r#"{"type":"custom","id":"sc1","parentId":"a1","customType":"plannotator","data":{}}"#,
            r#"{"type":"message","id":"u2","parentId":"sc1","message":{"role":"user","content":"rewound"}}"#,
            r#"{"type":"message","id":"a2","parentId":"u2","message":{"role":"assistant","content":[{"type":"text","text":"resp2"}]}}"#,
            r#"{"type":"custom","id":"c2","parentId":"a2","customType":"plannotator","data":{}}"#,
            r#"{"type":"branch_summary","id":"bs1","parentId":"a2","fromId":"c2","summary":"left branch"}"#,
            r#"{"type":"message","id":"u3","parentId":"bs1","message":{"role":"user","content":"after summary"}}"#,
            r#"{"type":"message","id":"a3","parentId":"u3","message":{"role":"assistant","content":[{"type":"text","text":"resp3"}]}}"#,
        ];
        std::fs::write(&file, lines.join("\n")).unwrap();

        let tree = parse_session_tree(file.to_str().unwrap()).unwrap();
        let by_id: HashMap<&str, &SessionTreeNode> =
            tree.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

        assert_eq!(by_id["m1"].depth, 0);
        assert_eq!(by_id["m1"].segment_id, "m1");
        for id in ["u1", "a1", "t1", "c1"] {
            assert_eq!(by_id[id].depth, 0, "{id} should stay flat");
            assert_eq!(by_id[id].segment_id, "u1", "{id} should belong to turn u1");
        }

        // sc1 is a bookkeeping sibling that leads to a rewound prompt: the
        // branch is flattened to depth 1, but the ⟲ badge stays on the prompt.
        assert_eq!(by_id["sc1"].depth, 1);
        assert_eq!(by_id["sc1"].segment_id, "sc1");
        assert!(!by_id["sc1"].is_rewind);
        assert_eq!(by_id["sc1"].parent_segment_id.as_deref(), Some("u1"));

        // u2 is an alternative user prompt behind sc1 -> a rewound segment.
        assert!(by_id["u2"].is_rewind);
        assert_eq!(by_id["u2"].depth, 1);
        assert_eq!(by_id["u2"].rewind_from_id.as_deref(), Some("a1"));
        // Every role in the rewound segment keeps the segment depth.
        assert_eq!(by_id["a2"].depth, 1);
        assert_eq!(by_id["c2"].depth, 1);
        assert_eq!(by_id["a2"].segment_id, "u2");

        // branch_summary is a rewind record and the following turn stays inside
        // its nested segment instead of nesting again. Because a2 already lives
        // inside the rewound segment u2, this is a rewind-of-rewind (+1 again).
        assert!(by_id["bs1"].is_rewind);
        assert_eq!(by_id["bs1"].depth, 2);
        assert_eq!(by_id["bs1"].rewind_from_id.as_deref(), Some("a2"));
        assert_eq!(by_id["u3"].depth, 2);
        assert_eq!(by_id["u3"].parent_segment_id.as_deref(), Some("bs1"));
        assert_eq!(by_id["a3"].depth, 2);

        // Turn/rewind roots expose their steps for collapse + badge counts.
        assert_eq!(by_id["u1"].children_ids, vec!["a1", "t1", "c1"]);
        assert_eq!(by_id["u2"].children_ids, vec!["a2", "c2"]);
        assert!(by_id["u1"].has_children);

        // Active path comes from the last entry (a3).
        assert!(by_id["a3"].is_on_active_path);
        assert!(by_id["u1"].is_on_active_path);
        assert!(!by_id["t1"].is_on_active_path);

        // Side entries never become collapsible parents.
        assert!(!by_id["c1"].has_children);
        assert!(!by_id["c2"].has_children);

        std::fs::remove_file(&file).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_session_telemetry_isolation() {
        // Requesting telemetry for a non-existent / inactive session ID must NEVER leak active status from another session
        let tel = get_active_telemetry(Some("isolated_inactive_session_99999".to_string()), None);
        assert!(!tel.is_active);
        assert_eq!(tel.session_id.as_deref(), Some("isolated_inactive_session_99999"));
    }
}

