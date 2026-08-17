/**
 * Collects per-LLM-call metrics from pi extension events.
 * Batches writes via dual-threshold flush (16 rows OR 2s).
 * Captures successes and failures (HTTP status + stopReason + errorMessage).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { usageDb, type CallRow } from "./db.js";

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
 * TPS 仅按「输出 token」计算（不含 input / cache）。
 * - tpsTotal（含首字）：output / 全程 duration（含 TTFT）
 * - tpsGen（纯生成）：output / (duration - ttft)
 *   当生成时长 < 2s 时视作非流式，tpsGen = tpsTotal
 */
function computeTps(_input: number, output: number, durationMs: number | null, ttftMs: number | null) {
  let tpsTotal: number | null = null;
  let tpsGen: number | null = null;
  if (durationMs != null && durationMs > 0 && output > 0) {
    tpsTotal = output / (durationMs / 1000);
    const genMs = Math.max(1, durationMs - (ttftMs ?? 0));
    // 生成时长 < 2s 视作非流式，直接用 tpsTotal
    if (genMs < 2000) {
      tpsGen = tpsTotal;
    } else {
      tpsGen = output / (genMs / 1000);
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

function isTextDeltaEvent(ev: any): boolean {
  if (!ev) return false;
  // assistantMessageEvent shapes vary; accept common ones
  const t = ev.type ?? ev.event?.type;
  return t === "text_delta" || t === "text_start" || t === "content_block_delta";
}

function emptyPendingTurn(): PendingTurn {
  return { t0: null, ttftMs: null, firstDeltaSeen: false, lastHttpStatus: null };
}

export class UsageCollector {
  private pending: CallRow[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private turn: PendingTurn = emptyPendingTurn();
  private sessionId = "unknown";
  private sessionFile: string | null = null;
  private callSeq = 0;
  private flushErrorCount = 0;

  attach(pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, ctx) => {
      this.refreshSession(ctx);
      try {
        usageDb.open();
      } catch (err) {
        console.error("[usage-report] failed to open db:", err);
      }
      this.resetTurn();
    });

    pi.on("session_shutdown", async () => {
      this.flush(true);
      usageDb.close();
    });

    pi.on("turn_start", async () => {
      this.resetTurn();
    });

    pi.on("before_provider_request", async () => {
      // First request in the turn marks t0 (retries keep original t0)
      if (this.turn.t0 == null) {
        this.turn.t0 = Date.now();
      }
    });

    // HTTP status (incl. 4xx/5xx) before stream consume
    pi.on("after_provider_response", async (event) => {
      const status = Number((event as any).status);
      if (Number.isFinite(status) && status > 0) {
        this.turn.lastHttpStatus = Math.trunc(status);
      }
      if (this.turn.t0 == null) {
        this.turn.t0 = Date.now();
      }
    });

    pi.on("message_update", async (event) => {
      if (this.turn.firstDeltaSeen) return;
      const msg = (event as any).message;
      if (msg?.role && msg.role !== "assistant") return;
      const ame = (event as any).assistantMessageEvent;
      // Accept first streaming update as first-token signal if typed delta, or any update when t0 exists
      if (ame && !isTextDeltaEvent(ame) && ame.type && ame.type !== "text_delta" && ame.type !== "text_start") {
        // still allow unknown shapes after t0
        if (!this.turn.t0) return;
      }
      if (this.turn.t0 == null) {
        // stream started without before_provider_request — approximate
        this.turn.t0 = Date.now();
      }
      this.turn.ttftMs = Math.max(0, Date.now() - this.turn.t0);
      this.turn.firstDeltaSeen = true;
    });

    pi.on("message_end", async (event, ctx) => {
      const message = (event as any).message;
      if (!message || message.role !== "assistant") return;

      const stopReason = normalizeStopReason(message.stopReason);
      const errorMessage = normalizeErrorMessage(message.errorMessage);
      const httpStatus = resolveHttpStatus(this.turn.lastHttpStatus, errorMessage);
      const usage = message.usage;

      const isFailure =
        stopReason === "error" ||
        stopReason === "aborted" ||
        (httpStatus != null && (httpStatus < 200 || httpStatus >= 300));

      // Success without usage → skip (nothing useful). Failures always record.
      if (!usage && !isFailure) return;

      this.refreshSession(ctx);

      const finishedAt = Date.now();
      const startedAt = this.turn.t0 ?? message.timestamp ?? finishedAt;
      const durationMs = Math.max(0, finishedAt - startedAt);
      const ttftMs = this.turn.ttftMs;
      const inputTokens = Number(usage?.input ?? 0) || 0;
      const outputTokens = Number(usage?.output ?? 0) || 0;
      const cacheRead = Number(usage?.cacheRead ?? 0) || 0;
      const cacheWrite = Number(usage?.cacheWrite ?? 0) || 0;
      const costUsd = microUsd(usage?.cost?.total);
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
      this.resetTurn();
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

  private resetTurn(): void {
    this.turn = emptyPendingTurn();
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
