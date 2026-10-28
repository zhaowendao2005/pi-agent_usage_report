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

/// Parses full session JSONL into hierarchical tree nodes with accurate depth and branching.
pub fn parse_session_tree(file_path: &str) -> Result<SessionTreeResult, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("Session file not found: {}", file_path));
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut raw_entries: Vec<Value> = Vec::new();
    let mut session_id = String::new();
    let mut cwd = String::new();

    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            let t = v.get("type").and_then(|s| s.as_str()).unwrap_or("");
            if t == "session" {
                if let Some(id) = v.get("id").and_then(|s| s.as_str()) {
                    session_id = id.to_string();
                }
                if let Some(c) = v.get("cwd").and_then(|s| s.as_str()) {
                    cwd = c.to_string();
                }
            }
            raw_entries.push(v);
        }
    }

    // Build children mapping: parent_id -> list of child_ids
    let mut children_map: HashMap<Option<String>, Vec<String>> = HashMap::new();
    let mut node_map: HashMap<String, Value> = HashMap::new();
    let mut id_order: Vec<String> = Vec::new();

    for entry in &raw_entries {
        let entry_type = entry.get("type").and_then(|s| s.as_str()).unwrap_or("");
        if entry_type == "session" {
            // Header is not in the tree itself
            continue;
        }
        let id = match entry.get("id").and_then(|s| s.as_str()) {
            Some(i) => i.to_string(),
            None => continue,
        };
        let parent_id = entry.get("parentId").and_then(|s| s.as_str()).map(|s| s.to_string());

        node_map.insert(id.clone(), entry.clone());
        id_order.push(id.clone());
        children_map.entry(parent_id).or_default().push(id);
    }

    // Determine root IDs (parent_id is None, or parent not present in node_map)
    let root_ids: Vec<String> = id_order
        .iter()
        .filter(|id| {
            if let Some(entry) = node_map.get(*id) {
                let pid = entry.get("parentId").and_then(|s| s.as_str());
                pid.is_none() || !node_map.contains_key(pid.unwrap())
            } else {
                false
            }
        })
        .cloned()
        .collect();

    // Turn-based Hierarchical Tree Construction:
    // 1. User prompts (`role: "user"`) are Turn Roots at Depth 0.
    // 2. Execution steps inside a turn (thinking, bash, read, edit, assistant, toolResult) are at Depth 1 (single VS Code indent guide).
    // 3. Pre-session items (model_change, thinking_level, system prompt) are at Depth 0.
    let mut nodes: Vec<SessionTreeNode> = Vec::new();
    let mut current_turn_user_idx: Option<usize> = None;
    let mut current_turn_child_ids: Vec<String> = Vec::new();

    for id in &id_order {
        let entry = match node_map.get(id) {
            Some(e) => e,
            None => continue,
        };

        let entry_type = entry.get("type").and_then(|s| s.as_str()).unwrap_or("unknown");
        let timestamp = entry.get("timestamp").and_then(|s| s.as_str()).map(|s| s.to_string());
        let orig_parent_id = entry.get("parentId").and_then(|s| s.as_str()).map(|s| s.to_string());

        let (summary, status, role, duration_ms, tokens, cost) = build_node_summary(entry, entry_type);

        let is_user = role.as_deref() == Some("user");

        let role_label = if let Some(ref r) = role {
            r.clone()
        } else {
            entry_type.to_string()
        };

        // Extract lightweight metadata for cold-loaded tree
        let model = if entry_type == "model_change" {
            entry.get("modelId").and_then(|s| s.as_str()).map(|s| s.to_string())
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

        if is_user {
            // Finalize previous turn's children
            if let Some(prev_idx) = current_turn_user_idx {
                nodes[prev_idx].children_ids = current_turn_child_ids.clone();
                nodes[prev_idx].has_children = !current_turn_child_ids.is_empty();
                nodes[prev_idx].is_leaf = current_turn_child_ids.is_empty();
            }

            // Start new Turn
            current_turn_child_ids.clear();
            let new_node_idx = nodes.len();
            current_turn_user_idx = Some(new_node_idx);

            nodes.push(SessionTreeNode {
                id: id.clone(),
                parent_id: orig_parent_id,
                depth: 0,
                is_branch_point: false,
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
                is_leaf: true, // updated when children are finalized
                has_children: false,
                children_ids: Vec::new(),
            });
        } else if let Some(turn_idx) = current_turn_user_idx {
            // Execution step inside current Turn (single clean depth = 1)
            let turn_user_id = nodes[turn_idx].id.clone();
            current_turn_child_ids.push(id.clone());

            nodes.push(SessionTreeNode {
                id: id.clone(),
                parent_id: Some(turn_user_id),
                depth: 1,
                is_branch_point: true,
                branch_kind,
                entry_type: entry_type.to_string(),
                timestamp,
                role,
                role_label,
                summary,
                model,
                tool_name,
                char_count,
                detail: Value::Null, // Cold load
                status,
                duration_ms,
                tokens,
                cost,
                is_leaf: true,
                has_children: false,
                children_ids: Vec::new(),
            });
        } else {
            // Pre-turn initial configuration (model, thinking level, system prompt)
            nodes.push(SessionTreeNode {
                id: id.clone(),
                parent_id: orig_parent_id,
                depth: 0,
                is_branch_point: false,
                branch_kind,
                entry_type: entry_type.to_string(),
                timestamp,
                role,
                role_label,
                summary,
                model,
                tool_name,
                char_count,
                detail: Value::Null, // Cold load
                status,
                duration_ms,
                tokens,
                cost,
                is_leaf: true,
                has_children: false,
                children_ids: Vec::new(),
            });
        }
    }

    // Finalize last turn
    if let Some(last_idx) = current_turn_user_idx {
        nodes[last_idx].children_ids = current_turn_child_ids;
        nodes[last_idx].has_children = !nodes[last_idx].children_ids.is_empty();
        nodes[last_idx].is_leaf = nodes[last_idx].children_ids.is_empty();
    }

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
                            // Verify single indent level (depth <= 1)
                            assert!(n.depth <= 1);
                        }
                    }
                    Err(e) => println!("  Parse err: {}", e),
                }
            }
        }
    }

    #[test]
    fn test_session_telemetry_isolation() {
        // Requesting telemetry for a non-existent / inactive session ID must NEVER leak active status from another session
        let tel = get_active_telemetry(Some("isolated_inactive_session_99999".to_string()), None);
        assert!(!tel.is_active);
        assert_eq!(tel.session_id.as_deref(), Some("isolated_inactive_session_99999"));
    }
}

