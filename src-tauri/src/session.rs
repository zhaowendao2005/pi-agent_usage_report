//! Pi Agent session scanner, JSONL parser, and real-time telemetry.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
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
    pub entry_type: String,
    pub timestamp: Option<String>,
    pub role: Option<String>,
    pub role_label: String,
    pub summary: String,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRequestTelemetry {
    pub is_active: bool,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub phase: String, // "waiting_ttft", "thinking", "text", "tool_call", "idle"
    pub current_delta_snippet: String,
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
            total_chars: 0,
            total_tokens_est: 0,
            started_at: None,
            last_chunk_at: None,
            silence_duration_ms: 0,
            active_duration_ms: 0,
            ttft_ms: None,
            tps_current: 0.0,
            health_status: "healthy".to_string(),
            diagnostic_verdict: "当前无活跃请求，系统处于就绪状态。".to_string(),
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

    if summary.len() > 180 {
        summary = format!("{}…", &summary[..179]);
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

    // Flatten tree with DFS to calculate depths and branch points
    let mut nodes: Vec<SessionTreeNode> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();

    fn traverse(
        current_id: &str,
        depth: usize,
        is_branch: bool,
        node_map: &HashMap<String, Value>,
        children_map: &HashMap<Option<String>, Vec<String>>,
        visited: &mut HashSet<String>,
        nodes: &mut Vec<SessionTreeNode>,
    ) {
        if visited.contains(current_id) {
            return;
        }
        visited.insert(current_id.to_string());

        let entry = match node_map.get(current_id) {
            Some(e) => e,
            None => return,
        };

        let entry_type = entry.get("type").and_then(|s| s.as_str()).unwrap_or("unknown");
        let timestamp = entry.get("timestamp").and_then(|s| s.as_str()).map(|s| s.to_string());
        let parent_id = entry.get("parentId").and_then(|s| s.as_str()).map(|s| s.to_string());

        let (summary, status, role, duration_ms, tokens, cost) = build_node_summary(entry, entry_type);

        let children = children_map.get(&Some(current_id.to_string())).cloned().unwrap_or_default();
        let has_children = !children.is_empty();
        let multiple_children = children.len() > 1;

        let role_label = if let Some(ref r) = role {
            r.clone()
        } else {
            entry_type.to_string()
        };

        nodes.push(SessionTreeNode {
            id: current_id.to_string(),
            parent_id,
            depth,
            is_branch_point: is_branch,
            entry_type: entry_type.to_string(),
            timestamp,
            role,
            role_label,
            summary,
            detail: entry.clone(),
            status,
            duration_ms,
            tokens,
            cost,
            is_leaf: !has_children,
            has_children,
            children_ids: children.clone(),
        });

        // Traverse children
        for (idx, child_id) in children.iter().enumerate() {
            let child_is_branch = multiple_children && idx > 0;
            traverse(child_id, depth + 1, child_is_branch, node_map, children_map, visited, nodes);
        }
    }

    for root_id in &root_ids {
        traverse(root_id, 0, false, &node_map, &children_map, &mut visited, &mut nodes);
    }

    // Append any unvisited nodes as fallback
    for id in &id_order {
        if !visited.contains(id) {
            traverse(id, 0, false, &node_map, &children_map, &mut visited, &mut nodes);
        }
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

/// Reads the active request telemetry file or generates diagnostic status.
pub fn get_active_telemetry() -> ActiveRequestTelemetry {
    let p = active_turn_file();
    let now_ms = Utc::now().timestamp_millis();

    if p.exists() {
        if let Ok(content) = fs::read_to_string(&p) {
            if let Ok(mut data) = serde_json::from_str::<ActiveRequestTelemetry>(&content) {
                // Calculate dynamic elapsed and silence timings
                if data.is_active {
                    let last_chunk = data.last_chunk_at.unwrap_or_else(|| data.started_at.unwrap_or(now_ms));
                    data.silence_duration_ms = (now_ms - last_chunk).max(0);

                    if let Some(t0) = data.started_at {
                        data.active_duration_ms = (now_ms - t0).max(0);
                    }

                    // Dynamically diagnose health
                    let silence_sec = data.silence_duration_ms as f64 / 1000.0;
                    if silence_sec > 45.0 {
                        data.health_status = "danger".to_string();
                        data.diagnostic_verdict = format!(
                            "🚨 严重停滞警告！距上次接收数据已过去 {:.1}s。上游服务可能已超时挂起或连接中断。",
                            silence_sec
                        );
                    } else if silence_sec > 15.0 {
                        data.health_status = "warning".to_string();
                        data.diagnostic_verdict = format!(
                            "⚠️ 疑似延迟或排队阻塞。已静默 {:.1}s，正在等待模型输出下一个 Chunk。",
                            silence_sec
                        );
                    } else if silence_sec > 3.0 {
                        data.health_status = "waiting".to_string();
                        data.diagnostic_verdict = format!(
                            "⏳ 模型深度推理中。距上次更新 {:.1}s，链路保持正常。",
                            silence_sec
                        );
                    } else {
                        data.health_status = "healthy".to_string();
                        data.diagnostic_verdict = format!(
                            "🟢 正常高速流式中。实时吞吐率 {:.1} tok/s，数据流顺畅。",
                            data.tps_current
                        );
                    }
                }
                return data;
            }
        }
    }

    ActiveRequestTelemetry::default()
}
