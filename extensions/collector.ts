/**
 * Collects per-LLM-call metrics from pi extension events.
 * Batches writes via dual-threshold flush (16 rows OR 2s).
 * Captures successes and failures (HTTP status + stopReason + errorMessage).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { usageDb, type CallRow } from "./db.js";

export const ACTIVE_TURN_PATH = join(homedir(), ".pi", "pi-usage-report-store", "active_turn.json");
export const ACTIVE_TURNS_DIR = join(homedir(), ".pi", "pi-usage-report-store", "active_turns");

export interface LiveTelemetryChunk {
  seq: number;
  timestamp: number;
  phase: string;
  chars: number;
  totalChars: number;
  text: string;
}

const MAX_LIVE_CHUNKS = 200;
/** 顺序保真的合并段（thinking/text/tool_call 各一段，按到达顺序） */
const MAX_LIVE_BLOCKS = 400;
const MAX_ACCUMULATED_TEXT = 120_000;
const ACTIVE_TURN_SYNC_THROTTLE_MS = 500;

const FLUSH_MAX_ROWS = 16;
const FLUSH_INTERVAL_MS = 2000;
const PENDING_HARD_CAP = 512;
const ERROR_MSG_MAX = 500;

interface PendingTurn {
  t0: number | null;
  ttftMs: number | null;
  firstDeltaSeen: boolean;
  /** Latest HTTP status from after_provider_response in this turn (retries overwrite). */
  lastHttpStatus: number | null;
}

function microUsd(costTotal: number | undefined | null): number {
  if (typeof costTotal !== "number" || !Number.isFinite(costTotal)) return 0;
  return Math.round(costTotal * 1_000_000);
}

/**
 * 官方标准模型价格字典（单位：美元 / 1M Tokens）
 * [input, output, cacheRead, cacheWrite]
 * 当上游 API (如 OAuth / 免计费代理) 返回 cost = 0 时，自动回填等效市场估价
 */
function estimateCostMicroUsd(
  _provider: string | null,
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): number {
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

/**
 * TPS 仅按「输出 token」计算（不含 input / cache）。
 * 采用 RMT-TPS 鲁棒模型：
 * - tpsTotal（含首字）：output / 全程 duration（含 TTFT），物理范围 [0.1, 800]
 * - tpsGen（纯生成）：output / (duration - ttft)
 *   当生成时长 < 150ms 或 output < 3 时视作非流式/微小样本，回退到 tpsTotal
 */
function computeTps(_input: number, output: number, durationMs: number | null, ttftMs: number | null) {
  let tpsTotal: number | null = null;
  let tpsGen: number | null = null;
  if (durationMs != null && durationMs > 0 && output > 0) {
    const rawTotal = output / (durationMs / 1000);
    tpsTotal = Math.min(Math.max(rawTotal, 0.1), 800);

    const genMs = Math.max(1, durationMs - (ttftMs ?? 0));
    // 生成时长 < 150ms 或 output < 3 视作非流式/微小样本，回退到 tpsTotal
    if (genMs < 150 || output < 3) {
      tpsGen = durationMs < 150 ? tpsTotal : Math.min(output / (durationMs / 1000), 800);
    } else {
      const rawGen = output / (genMs / 1000);
      tpsGen = Math.min(Math.max(rawGen, 0.1), 800);
    }
  }
  return { tpsTotal, tpsGen };
}

function messageIdOf(message: any, fallbackSeed: string): string {
  if (message && typeof message.id === "string" && message.id.length > 0) return message.id;
  // fallback: stable-enough synthetic id
  return `syn_${fallbackSeed}`;
}

/** Missing / empty provider → null (legacy rows without the field read as null). */
function normalizeProvider(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function normalizeStopReason(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function normalizeErrorMessage(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.length > ERROR_MSG_MAX ? s.slice(0, ERROR_MSG_MAX) + "…" : s;
}

/** Prefer explicit status; else parse 4xx/5xx out of error text. */
function resolveHttpStatus(explicit: number | null, errorMessage: string | null): number | null {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);
  if (!errorMessage) return null;
  const m = errorMessage.match(/(?:HTTP\s*|status(?:\s*code)?\s*[:=]?\s*)([45]\d{2})\b/i)
    ?? errorMessage.match(/\b([45]\d{2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isAnyStreamDelta(ev: any): boolean {
  if (!ev) return false;
  const t = String(ev.type ?? ev.event?.type ?? "").toLowerCase();
  return (
    t.includes("delta") ||
    t.includes("start") ||
    t.includes("chunk") ||
    t === "thought" ||
    t === "thinking" ||
    t === "text"
  );
}

function emptyPendingTurn(): PendingTurn {
  return { t0: null, ttftMs: null, firstDeltaSeen: false, lastHttpStatus: null };
}

export class UsageCollector {
  private pending: CallRow[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private turn: PendingTurn = emptyPendingTurn();
  private sessionId = "unknown";
  private sessionFile: string | null = null;
  private callSeq = 0;
  private flushErrorCount = 0;
  private liveAccumulatedChars = 0;
  private liveOutputTokens = 0;
  private liveAccumulatedText = "";
  private liveThinkingText = "";
  /** tool_call 阶段的原始 JSON 参数累积（分包会被裁剪，这里保留全量以便还原） */
  private liveToolCallText = "";
  private liveChunks: LiveTelemetryChunk[] = [];
  /**
   * 按到达顺序合并的段（thinking / text / tool_call 的连续 delta 合并为一段）。
   * 分包列表只有最近 200 条，不能用于还原「文本 → 工具 → 文本」的先后顺序，
   * 因此单独维护这份顺序日志。
   */
  private liveBlocks: LiveTelemetryChunk[] = [];
  private liveBlockChars = 0;
  private chunkSeq = 0;
  private lastActiveSyncAt = 0;
  private lastPhase = "idle";
  private lastModel: string | null = null;
  private lastProvider: string | null = null;
  private attached = false;

  private writeActiveTurnPayload(state: {
    isActive: boolean;
    phase?: string;
    model?: string | null;
    provider?: string | null;
    currentDeltaSnippet?: string;
    totalChars?: number;
    outputTokens?: number;
    startedAt?: number | null;
    lastChunkAt?: number;
    ttftMs?: number | null;
  }): void {
    try {
      const now = Date.now();
      const totalChars = state.totalChars ?? this.liveAccumulatedChars;
      const startedAt = state.startedAt ?? this.turn.t0 ?? null;
      const elapsedSec = startedAt ? Math.max(0.1, (now - startedAt) / 1000) : 1;
      const totalTokensEst =
        state.outputTokens && state.outputTokens > 0
          ? state.outputTokens
          : this.liveOutputTokens > 0
            ? this.liveOutputTokens
            : Math.round(totalChars / 3.2);
      const tpsCurrent =
        state.isActive && totalTokensEst > 0
          ? Math.min(800, +(totalTokensEst / elapsedSec).toFixed(1))
          : 0;

      if (state.model) this.lastModel = state.model;
      if (state.provider) this.lastProvider = state.provider;

      const phase = state.phase ?? (state.isActive ? "waiting_ttft" : "idle");
      this.lastPhase = phase;

      const payload = {
        isActive: state.isActive,
        sessionId: this.sessionId,
        model: state.model ?? this.lastModel ?? null,
        provider: state.provider ?? this.lastProvider ?? null,
        phase,
        currentDeltaSnippet: state.currentDeltaSnippet ?? "",
        accumulatedText: this.liveAccumulatedText,
        thinkingText: this.liveThinkingText,
        toolCallText: this.liveToolCallText,
        blocks: this.liveBlocks,
        chunks: this.liveChunks,
        totalChars,
        totalTokensEst,
        startedAt,
        lastChunkAt: state.lastChunkAt ?? now,
        silenceDurationMs: 0,
        activeDurationMs: startedAt ? Math.max(0, now - startedAt) : 0,
        ttftMs: state.ttftMs ?? this.turn.ttftMs ?? null,
        tpsCurrent,
        healthStatus: "healthy",
        diagnosticVerdict: state.isActive ? "正在接收 LLM 输出流..." : "空闲",
      };
      const jsonStr = JSON.stringify(payload);
      writeFileSync(ACTIVE_TURN_PATH, jsonStr, "utf-8");

      if (this.sessionId && this.sessionId !== "unknown") {
        mkdirSync(ACTIVE_TURNS_DIR, { recursive: true });
        const safeSessionId = this.sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
        writeFileSync(join(ACTIVE_TURNS_DIR, `${safeSessionId}.json`), jsonStr, "utf-8");
      }
      this.lastActiveSyncAt = now;
    } catch {
      // ignore
    }
  }

  private syncActiveTurn(
    state: {
      isActive: boolean;
      phase?: string;
      model?: string | null;
      provider?: string | null;
      currentDeltaSnippet?: string;
      totalChars?: number;
      outputTokens?: number;
      startedAt?: number | null;
      lastChunkAt?: number;
      ttftMs?: number | null;
    },
    force = false
  ): void {
    const now = Date.now();
    const elapsed = now - this.lastActiveSyncAt;
    if (force || !this.lastActiveSyncAt || elapsed >= ACTIVE_TURN_SYNC_THROTTLE_MS) {
      if (this.activeSyncTimer) {
        clearTimeout(this.activeSyncTimer);
        this.activeSyncTimer = null;
      }
      this.writeActiveTurnPayload(state);
      return;
    }

    if (this.activeSyncTimer) {
      clearTimeout(this.activeSyncTimer);
    }
    const waitMs = Math.max(20, ACTIVE_TURN_SYNC_THROTTLE_MS - elapsed);
    this.activeSyncTimer = setTimeout(() => {
      this.activeSyncTimer = null;
      this.writeActiveTurnPayload(state);
    }, waitMs);
    this.activeSyncTimer.unref?.();
  }

  /**
   * Initialize state for the current session. Public so the extension entry
   * point can call it when the leader is elected during `session_start`
   * (the collector's own `session_start` handler is attached at that point and
   * must not rely on the in-flight event being re-dispatched).
   */
  onSessionStart(ctx: ExtensionContext): void {
    this.refreshSession(ctx);
    try {
      usageDb.open();
    } catch (err) {
      console.error("[usage-report] failed to open db:", err);
    }
    this.resetLiveStream();
    this.resetTurnTiming();
  }

  attach(pi: ExtensionAPI): void {
    if (this.attached) return;
    this.attached = true;

    pi.on("session_start", async (_event, ctx) => {
      this.onSessionStart(ctx);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
      this.refreshSession(ctx);
      this.syncActiveTurn({ isActive: false, phase: "idle" }, true);
      this.flush(true);
      usageDb.close();
    });

    pi.on("agent_start", async (_event, ctx) => {
      this.refreshSession(ctx);
      this.resetLiveStream();
      this.resetTurnTiming();
      this.turn.t0 = Date.now();
      this.syncActiveTurn({ isActive: true, phase: "waiting_ttft", startedAt: this.turn.t0 }, true);
    });

    pi.on("agent_end", async (_event, ctx) => {
      this.refreshSession(ctx);
      this.syncActiveTurn({ isActive: false, phase: "idle" }, true);
    });

    pi.on("turn_start", async (_event, ctx) => {
      this.refreshSession(ctx);
      if (this.lastPhase === "idle") {
        this.resetLiveStream();
      }
      this.resetTurnTiming();
      this.turn.t0 = Date.now();
      this.syncActiveTurn({ isActive: true, phase: "waiting_ttft", startedAt: this.turn.t0 }, true);
    });

    pi.on("context", async (_event, ctx) => {
      this.refreshSession(ctx);
      if (this.turn.t0 == null) {
        this.turn.t0 = Date.now();
      }
    });

    pi.on("before_provider_request", async (_event, ctx) => {
      this.refreshSession(ctx);
      // First request in the turn marks t0 (retries keep original t0)
      if (this.turn.t0 == null) {
        this.turn.t0 = Date.now();
      }
      this.syncActiveTurn({ isActive: true, phase: "waiting_ttft", startedAt: this.turn.t0 }, true);
    });

    // HTTP status (incl. 4xx/5xx) before stream consume
    pi.on("after_provider_response", async (event, ctx) => {
      this.refreshSession(ctx);
      const status = Number((event as any).status);
      if (Number.isFinite(status) && status > 0) {
        this.turn.lastHttpStatus = Math.trunc(status);
      }
      if (this.turn.t0 == null) {
        this.turn.t0 = Date.now();
      }
    });

    pi.on("message_start", async (event, ctx) => {
      this.refreshSession(ctx);
      const msg = (event as any).message;
      if (!msg || (msg.role && msg.role !== "assistant")) return;
      if (this.turn.t0 == null) {
        this.turn.t0 = Date.now();
      }
      this.syncActiveTurn(
        {
          isActive: true,
          phase: "waiting_ttft",
          model: msg?.model,
          provider: msg?.provider,
          startedAt: this.turn.t0,
        },
        true
      );
    });

    pi.on("message_update", async (event, ctx) => {
      this.refreshSession(ctx);
      const msg = (event as any).message;
      if (msg?.role && msg.role !== "assistant") return;
      const ame = (event as any).assistantMessageEvent;
      const now = Date.now();

      let forceSync = false;
      if (!this.turn.firstDeltaSeen) {
        if (!ame || isAnyStreamDelta(ame) || this.turn.t0) {
          if (this.turn.t0 == null) this.turn.t0 = now - 50;
          this.turn.ttftMs = Math.max(10, now - this.turn.t0);
          this.turn.firstDeltaSeen = true;
          forceSync = true;
        }
      }

      let snippet = "";
      let phase = this.lastPhase && this.lastPhase !== "idle" ? this.lastPhase : "text";

      if (ame) {
        const evType = String(ame.type ?? "");
        if (evType === "thinking_start" || evType === "thinking_delta" || evType === "thinking" || evType === "thought") {
          phase = "thinking";
        } else if (evType === "toolcall_start" || evType === "toolcall_delta" || evType === "toolcall_end") {
          phase = "tool_call";
        } else if (evType === "text_start" || evType === "text_delta" || evType === "text") {
          phase = "text";
        }

        if (phase !== this.lastPhase) {
          forceSync = true;
        }

        const isDeltaEvent =
          evType === "thinking_delta" ||
          evType === "text_delta" ||
          evType === "toolcall_delta" ||
          evType === "thinking" ||
          evType === "thought" ||
          evType === "text";

        const delta = isDeltaEvent ? (ame.delta ?? ame.text ?? ame.thinking ?? "") : "";
        if (typeof delta === "string" && delta.length > 0) {
          snippet = delta;
          this.liveAccumulatedChars += delta.length;
          if (phase === "thinking") {
            if (this.liveThinkingText.length < MAX_ACCUMULATED_TEXT) {
              this.liveThinkingText += delta;
            }
          } else if (phase === "text") {
            if (this.liveAccumulatedText.length < MAX_ACCUMULATED_TEXT) {
              this.liveAccumulatedText += delta;
            }
          } else if (phase === "tool_call") {
            if (this.liveToolCallText.length < MAX_ACCUMULATED_TEXT) {
              this.liveToolCallText += delta;
            }
          }
          this.chunkSeq += 1;
          this.liveChunks.push({
            seq: this.chunkSeq,
            timestamp: now,
            phase,
            chars: delta.length,
            totalChars: this.liveAccumulatedChars,
            text: delta,
          });
          if (this.liveChunks.length > MAX_LIVE_CHUNKS) {
            this.liveChunks.splice(0, this.liveChunks.length - MAX_LIVE_CHUNKS);
          }

          // 顺序日志：同阶段连续 delta 合并，阶段变化即新开一段
          if (this.liveBlockChars < MAX_ACCUMULATED_TEXT && this.liveBlocks.length <= MAX_LIVE_BLOCKS) {
            const lastBlock = this.liveBlocks[this.liveBlocks.length - 1];
            if (lastBlock && lastBlock.phase === phase) {
              lastBlock.text += delta;
              lastBlock.chars += delta.length;
              lastBlock.totalChars = this.liveAccumulatedChars;
              this.liveBlockChars += delta.length;
            } else if (this.liveBlocks.length < MAX_LIVE_BLOCKS) {
              this.liveBlocks.push({
                seq: this.liveBlocks.length + 1,
                timestamp: now,
                phase,
                chars: delta.length,
                totalChars: this.liveAccumulatedChars,
                text: delta,
              });
              this.liveBlockChars += delta.length;
            }
          }
        }
      }

      const partialMsg = ame?.partial ?? msg;
      const partialOut = Number(partialMsg?.usage?.output ?? 0);
      if (partialOut > 0) {
        this.liveOutputTokens = Math.max(this.liveOutputTokens, partialOut);
      }

      // 500ms 节流写入磁盘 + 首包/阶段切换立即同步 + 尾帧定时器保底
      this.syncActiveTurn(
        {
          isActive: true,
          phase,
          model: partialMsg?.model ?? msg?.model,
          provider: partialMsg?.provider ?? msg?.provider,
          currentDeltaSnippet: snippet,
          totalChars: this.liveAccumulatedChars,
          lastChunkAt: now,
          ttftMs: this.turn.ttftMs,
        },
        forceSync
      );
    });

    pi.on("message_end", async (event, ctx) => {
      const message = (event as any).message;
      // 严禁在 user 或 toolResult 的 message_end 上重置活跃状态！仅处理 assistant 响应结束。
      if (!message || message.role !== "assistant") return;

      this.refreshSession(ctx);

      const stopReason = normalizeStopReason(message.stopReason);
      const errorMessage = normalizeErrorMessage(message.errorMessage);
      const httpStatus = resolveHttpStatus(this.turn.lastHttpStatus, errorMessage);
      const usage = message.usage;
      const outputTokens = Number(usage?.output ?? 0) || 0;
      if (outputTokens > 0) {
        this.liveOutputTokens += outputTokens;
      }

      // 若 stopReason 为 toolUse，说明 Agent 仍在继续执行下一轮请求；否则标记为 idle
      const stillRunningTurn = stopReason === "toolUse";
      this.syncActiveTurn(
        {
          isActive: stillRunningTurn,
          phase: stillRunningTurn ? "waiting_ttft" : "idle",
          model: message.model,
          provider: message.provider,
          totalChars: this.liveAccumulatedChars,
          outputTokens: this.liveOutputTokens,
          lastChunkAt: Date.now(),
          ttftMs: this.turn.ttftMs,
        },
        true
      );

      const isFailure =
        stopReason === "error" ||
        stopReason === "aborted" ||
        (httpStatus != null && (httpStatus < 200 || httpStatus >= 300));

      // Success without usage → skip (nothing useful). Failures always record.
      if (!usage && !isFailure) {
        this.resetTurnTiming();
        return;
      }

      const finishedAt = Date.now();
      let startedAt = this.turn.t0 ?? message.timestamp ?? finishedAt;
      let durationMs = Math.max(0, finishedAt - startedAt);
      const inputTokens = Number(usage?.input ?? 0) || 0;
      const cacheRead = Number(usage?.cacheRead ?? 0) || 0;
      const cacheWrite = Number(usage?.cacheWrite ?? 0) || 0;

      // 物理保底防护：当有 outputTokens 时，若耗时异常过小 (<100ms) 则估算合理物理时间
      if (outputTokens > 0 && durationMs < 100) {
        durationMs = Math.max(200, Math.round((outputTokens / 45) * 1000));
        startedAt = finishedAt - durationMs;
      }

      let ttftMs = this.turn.ttftMs;
      if (ttftMs != null && ttftMs >= durationMs && outputTokens > 0) {
        ttftMs = Math.max(50, Math.round(durationMs * 0.3));
      }

      let costUsd = microUsd(usage?.cost?.total);
      // OAuth 零成本回填
      if (costUsd === 0 && (inputTokens > 0 || outputTokens > 0)) {
        costUsd = estimateCostMicroUsd(
          normalizeProvider(message.provider),
          String(message.model ?? "unknown"),
          inputTokens,
          outputTokens,
          cacheRead,
          cacheWrite
        );
      }

      const { tpsTotal, tpsGen } =
        inputTokens + outputTokens > 0
          ? computeTps(inputTokens, outputTokens, durationMs, ttftMs)
          : { tpsTotal: null, tpsGen: null };

      this.callSeq += 1;
      const mid = messageIdOf(message, `${this.sessionId}_${startedAt}_${this.callSeq}`);

      const row: CallRow = {
        messageId: mid,
        startedAt,
        finishedAt,
        ttftMs,
        durationMs,
        sessionId: this.sessionId,
        sessionFile: this.sessionFile,
        provider: normalizeProvider(message.provider),
        model: String(message.model ?? "unknown"),
        inputTokens,
        outputTokens,
        cacheRead,
        cacheWrite,
        costUsd,
        tpsTotal,
        tpsGen,
        httpStatus,
        stopReason,
        errorMessage,
      };

      this.enqueue(row);
      this.resetTurnTiming();
    });

    // Optional: tool nested LLM usage
    pi.on("tool_result", async (event, ctx) => {
      const usage = (event as any).usage;
      if (!usage) return;
      this.refreshSession(ctx);
      const finishedAt = Date.now();
      const startedAt = finishedAt; // no reliable t0 for nested tool usage
      const inputTokens = Number(usage.input ?? 0) || 0;
      const outputTokens = Number(usage.output ?? 0) || 0;
      if (inputTokens === 0 && outputTokens === 0) return;
      const cacheRead = Number(usage.cacheRead ?? 0) || 0;
      const cacheWrite = Number(usage.cacheWrite ?? 0) || 0;
      const costUsd = microUsd(usage.cost?.total);
      this.callSeq += 1;
      const toolName = String((event as any).toolName ?? "tool");
      const toolCallId = String((event as any).toolCallId ?? this.callSeq);
      const isError = !!(event as any).isError;
      const row: CallRow = {
        messageId: `tool_${toolCallId}_${this.callSeq}`,
        startedAt,
        finishedAt,
        ttftMs: null,
        durationMs: null,
        sessionId: this.sessionId,
        sessionFile: this.sessionFile,
        provider: "tool",
        model: toolName,
        inputTokens,
        outputTokens,
        cacheRead,
        cacheWrite,
        costUsd,
        tpsTotal: null,
        tpsGen: null,
        httpStatus: null,
        stopReason: isError ? "error" : "tool",
        errorMessage: null,
      };
      this.enqueue(row);
    });

    // Best-effort process exit flush
    const exitFlush = () => {
      try {
        this.flush(true);
      } catch {
        // ignore
      }
    };
    process.once("exit", exitFlush);
    process.once("SIGINT", exitFlush);
    process.once("SIGTERM", exitFlush);
  }

  private refreshSession(ctx: ExtensionContext): void {
    try {
      const sm = ctx.sessionManager as any;
      if (sm?.getSessionId) this.sessionId = String(sm.getSessionId() ?? this.sessionId);
      if (sm?.getSessionFile) {
        const f = sm.getSessionFile();
        this.sessionFile = f == null ? null : String(f);
      }
    } catch {
      // keep previous
    }
  }

  private resetTurnTiming(): void {
    this.turn = emptyPendingTurn();
  }

  private resetLiveStream(): void {
    if (this.activeSyncTimer) {
      clearTimeout(this.activeSyncTimer);
      this.activeSyncTimer = null;
    }
    this.liveAccumulatedChars = 0;
    this.liveOutputTokens = 0;
    this.liveAccumulatedText = "";
    this.liveThinkingText = "";
    this.liveToolCallText = "";
    this.liveChunks = [];
    this.liveBlocks = [];
    this.liveBlockChars = 0;
    this.chunkSeq = 0;
    this.lastActiveSyncAt = 0;
    this.lastPhase = "idle";
  }

  private enqueue(row: CallRow): void {
    this.pending.push(row);
    if (this.pending.length >= FLUSH_MAX_ROWS || this.pending.length >= PENDING_HARD_CAP) {
      this.flush(true);
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush(false);
    }, FLUSH_INTERVAL_MS);
    // Don't keep process alive solely for flush timer
    this.flushTimer.unref?.();
  }

  flush(force: boolean): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0) return;
    if (!force && this.pending.length === 0) return;

    const batch = this.pending;
    this.pending = [];
    try {
      if (!usageDb.isOpen()) usageDb.open();
      usageDb.insertBatch(batch);
      this.flushErrorCount = 0;
    } catch (err) {
      this.flushErrorCount += 1;
      console.error("[usage-report] flush failed:", err);
      // put back once (avoid infinite growth)
      if (this.flushErrorCount <= 1 && batch.length < PENDING_HARD_CAP) {
        this.pending = batch.concat(this.pending).slice(0, PENDING_HARD_CAP);
        this.scheduleFlush();
      }
    }
  }
}

export const collector = new UsageCollector();
