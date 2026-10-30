<template>
  <div class="h-full flex flex-col overflow-hidden bg-background select-none">
    <!-- Main 12-Column Swiss Open Grid -->
    <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">
      <!-- Left Column (8 cols): LLM Output Stream / Chunks (Full Height) -->
      <div class="lg:col-span-8 flex flex-col min-h-0 overflow-hidden">
        <!-- Minimalist Single Toolbar -->
        <div class="h-10 shrink-0 border-b border-border px-5 flex items-center justify-between gap-4 bg-background">
          <div class="flex items-center gap-4 min-w-0">
            <!-- Segmented Tab Toggle -->
            <div class="flex items-center gap-1 bg-secondary/50 p-0.5 text-xs">
              <button
                @click="streamViewMode = 'stream'"
                class="px-3 py-1 transition-colors cursor-pointer"
                :class="streamViewMode === 'stream'
                  ? 'bg-background text-foreground font-medium shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'"
              >
                实时输出流
              </button>
              <button
                @click="streamViewMode = 'chunks'"
                class="px-3 py-1 transition-colors cursor-pointer font-mono"
                :class="streamViewMode === 'chunks'
                  ? 'bg-background text-foreground font-medium shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'"
              >
                分包明细 ({{ curTel.chunks.length }})
              </button>
            </div>

            <!-- Subtle Phase Tag -->
            <span
              class="px-2 py-0.5 text-[11px] font-mono border"
              :class="getPhaseBadgeClass"
            >
              {{ formatPhaseLabel(curTel.phase, curTel.isActive) }}
            </span>
          </div>

          <!-- Right Actions -->
          <div class="flex items-center gap-4 shrink-0 text-xs">
            <button
              v-if="curTel.thinkingText && streamViewMode === 'stream'"
              @click="showThinkingFull = !showThinkingFull"
              class="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {{ showThinkingFull ? '收起思维链' : `展开思维链 (${curTel.thinkingText.length}字)` }}
            </button>
            <button
              v-if="hasToolCalls && streamViewMode === 'stream'"
              @click="rawToolFragments = !rawToolFragments"
              class="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="在「原始 token 碎片」与「还原后的成段文本」之间切换"
            >
              {{ rawToolFragments ? '还原成段' : '查看原始碎片' }}
            </button>
            <button
              v-if="curTel.totalChars > 0"
              @click="copyAccumulatedText"
              class="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {{ copiedFull ? '已复制 ✓' : '复制全文' }}
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-if="!curTel.isActive && curTel.totalChars === 0 && curTel.chunks.length === 0 && !hasToolCalls"
          class="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12 text-center"
        >
          <RadioIcon class="w-6 h-6 mb-3 opacity-30 text-foreground" />
          <p class="text-sm font-medium text-foreground/80">暂无 LLM 输出流数据</p>
          <p class="text-xs text-muted-foreground/70 mt-1.5 max-w-md leading-relaxed">
            当前会话（{{ monitorStore.activeSession?.id?.slice(0, 8) || '未选择' }}）处于待命状态。当模型开始流式生成 Token 时，此处将实时呈现接收到的输出内容。
          </p>
        </div>

        <!-- Mode 1: Full-Height Clean LLM Output Stream（严格按分片到达顺序渲染） -->
        <div
          v-else-if="streamViewMode === 'stream'"
          class="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6 select-text"
        >
          <!-- 原始碎片调试视图：保留到达顺序，逐条展示 -->
          <div
            v-if="rawToolFragments"
            class="max-w-4xl border border-border/60 bg-secondary/10 max-h-[70vh] overflow-y-auto"
          >
            <div class="sticky top-0 z-10 flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-secondary/40 font-mono text-[11px] text-muted-foreground">
              <span>原始 token 碎片 · 按到达顺序</span>
              <span>{{ rawFragments.length }} 条</span>
            </div>
            <div
              v-for="frag in rawFragments"
              :key="frag.seq"
              class="flex items-baseline gap-3 px-3 py-0.5 font-mono text-[11px] hover:bg-accent/30"
            >
              <span class="w-12 shrink-0 text-right text-muted-foreground/60">#{{ frag.seq }}</span>
              <span class="w-14 shrink-0 text-[10px]" :class="getChunkPhaseClass(frag.phase)">{{ formatChunkPhase(frag.phase) }}</span>
              <span class="whitespace-pre-wrap break-all text-foreground/80">{{ frag.text }}</span>
            </div>
          </div>

          <!-- 成段视图：thinking / text / tool_call 按原始到达顺序交错渲染 -->
          <template v-else>
            <template v-for="(block, blockIdx) in streamBlocks" :key="block.key">
              <!-- 思维链 -->
              <div
                v-if="block.kind === 'thinking'"
                class="border-l-2 border-violet-500/40 pl-4 py-0.5 space-y-2 max-w-4xl"
              >
                <div
                  @click="showThinkingFull = !showThinkingFull"
                  class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none"
                >
                  <span class="font-medium text-violet-600 dark:text-violet-400">思维链推理</span>
                  <span class="font-mono text-[11px] opacity-75">· {{ block.chars.toLocaleString() }} 字</span>
                  <span class="text-[11px] opacity-60">{{ showThinkingFull ? '▾' : '▸' }}</span>
                </div>
                <p
                  v-if="showThinkingFull"
                  class="text-muted-foreground whitespace-pre-wrap break-words text-xs leading-relaxed font-mono"
                >
                  {{ previewThinking(block.text) }}
                </p>
              </div>

              <!-- 正文段落 -->
              <div v-else-if="block.kind === 'text'" class="max-w-4xl space-y-3">
                <div v-if="block.synthetic" class="text-[11px] font-sans text-muted-foreground/70">
                  累计正文（早期分包已滚出缓冲，位置仅为近似）
                </div>
                <div class="space-y-3 text-foreground text-[13px] leading-7">
                  <p
                    v-for="(para, idx) in blockParagraphs(block)"
                    :key="idx"
                    class="whitespace-pre-wrap break-words font-mono"
                  >
                    {{ para }}<span
                      v-if="idx === blockParagraphs(block).length - 1 && blockIdx === streamBlocks.length - 1 && curTel.isActive && curTel.phase === 'text'"
                      class="inline-block w-1.5 h-4 ml-0.5 align-middle bg-emerald-500 animate-pulse"
                    />
                  </p>
                </div>
                <button
                  v-if="isBlockTruncated(block.text) && !expandFullAccumulated"
                  @click="expandFullAccumulated = true"
                  class="px-3 py-1.5 border border-border bg-secondary/30 text-xs text-primary hover:bg-accent cursor-pointer"
                >
                  展开剩余 {{ (block.text.length - MAX_PREVIEW_CHARS).toLocaleString() }} 字符...
                </button>
              </div>

              <!-- 工具调用参数：逐 token 的 JSON 碎片还原成成段文本 -->
              <div v-else class="max-w-4xl space-y-3">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                  <WrenchIcon class="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span class="font-medium text-foreground">工具调用参数</span>
                  <span class="font-mono text-[11px] text-muted-foreground">
                    {{ toolCallsOf(block).length }} 次调用 ·
                    {{ block.fragmentCount }} 个流式片段 ·
                    {{ block.text.length.toLocaleString() }} 字符
                    <template v-if="!block.synthetic">· 全量累计</template>
                  </span>
                </div>
                <div class="space-y-3">
                  <article
                    v-for="call in toolCallsOf(block)"
                    :key="call.id"
                    class="border border-border/70 bg-secondary/15"
                  >
                    <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-1.5 border-b border-border/60 font-mono text-[11px] text-muted-foreground">
                      <span class="px-1.5 py-0.5 border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        {{ call.title }}
                      </span>
                      <span v-if="call.fromSeq > 0">#{{ call.fromSeq }}–#{{ call.toSeq }} · {{ call.fragmentCount }} 分包</span>
                      <span>{{ call.rawChars.toLocaleString() }} 字符</span>
                      <span v-if="call.fields.length" class="text-muted-foreground/70 truncate max-w-[16rem]" :title="call.fields.map((f) => f.key).join(', ')">
                        字段: {{ call.fields.map((f) => f.key).join(', ') }}
                      </span>
                      <span
                        class="ml-auto"
                        :class="call.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'"
                      >
                        {{ call.complete ? 'JSON 完整' : '拼装中…' }}
                      </span>
                    </header>
                    <pre class="px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground/90">{{ call.display }}</pre>
                  </article>
                </div>
              </div>
            </template>
          </template>
        </div>

        <!-- Mode 2: Full-Height Virtualized Chunk List -->
        <div
          v-else
          class="flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          <!-- Table Header -->
          <div class="h-8 shrink-0 border-b border-border bg-secondary/15 px-5 grid grid-cols-12 items-center text-[11px] text-muted-foreground font-mono">
            <span class="col-span-1">序号</span>
            <span class="col-span-2">类型</span>
            <span class="col-span-2 text-right">增量 / 累计</span>
            <span class="col-span-7 pl-4">输出 Token 片段内容</span>
          </div>

          <!-- Virtual Scroll Chunk Viewport -->
          <div
            ref="chunkViewportEl"
            class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative font-mono text-xs"
            @scroll="onChunkScroll"
          >
            <div v-if="reversedChunks.length === 0" class="py-12 text-center text-xs text-muted-foreground font-sans">
              暂无分包明细记录
            </div>

            <div
              v-else
              :style="{ height: `${chunkTotalHeight}px`, position: 'relative' }"
            >
              <div
                class="absolute left-0 right-0 top-0 flex flex-col"
                :style="{ transform: `translateY(${chunkOffsetY}px)` }"
              >
                <div
                  v-for="chunk in visibleChunks"
                  :key="chunk.seq"
                  @click="selectedChunk = selectedChunk?.seq === chunk.seq ? null : chunk"
                  class="grid grid-cols-12 items-center px-5 border-b border-border/30 cursor-pointer transition-colors hover:bg-accent/40"
                  :class="selectedChunk?.seq === chunk.seq ? 'bg-primary/10 text-foreground' : ''"
                  :style="{ height: `${CHUNK_ROW_HEIGHT}px` }"
                >
                  <span class="col-span-1 text-[11px] text-muted-foreground">
                    #{{ chunk.seq }}
                  </span>
                  <span class="col-span-2">
                    <span
                      class="text-[10px] px-1.5 py-0.5 border"
                      :class="getChunkPhaseClass(chunk.phase)"
                    >
                      {{ formatChunkPhase(chunk.phase) }}
                    </span>
                  </span>
                  <span class="col-span-2 text-right text-[11px]">
                    <span class="text-emerald-600 dark:text-emerald-400 font-medium">+{{ chunk.chars }}</span>
                    <span class="text-muted-foreground/60"> / {{ chunk.totalChars }}</span>
                  </span>
                  <span class="col-span-7 pl-4 truncate text-xs text-foreground/90" :title="chunk.text">
                    {{ chunk.text.replace(/\s+/g, ' ') }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Selected Chunk Inspector -->
          <div
            v-if="selectedChunk"
            class="shrink-0 border-t border-border bg-secondary/15 px-5 py-3 max-h-40 overflow-y-auto font-mono text-xs select-text"
          >
            <div class="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
              <span>
                分包 <strong class="text-foreground">#{{ selectedChunk.seq }}</strong> ·
                {{ formatChunkPhase(selectedChunk.phase) }} ·
                单次 <strong class="text-emerald-500">+{{ selectedChunk.chars }} 字</strong> ·
                累计 <strong class="text-foreground">{{ selectedChunk.totalChars }} 字</strong>
              </span>
              <button
                @click="selectedChunk = null"
                class="text-muted-foreground hover:text-foreground cursor-pointer font-sans"
              >
                关闭 ×
              </button>
            </div>
            <pre class="whitespace-pre-wrap break-all text-xs text-foreground leading-relaxed">{{ selectedChunkDisplay }}</pre>
          </div>
        </div>
      </div>

      <!-- Right Column (4 cols): Low-Density Swiss Telemetry Panel -->
      <div class="lg:col-span-4 flex flex-col divide-y divide-border overflow-y-auto bg-background">
        <!-- 1. Silence Gap & Stream Heartbeat -->
        <div class="p-6 space-y-5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-muted-foreground">静默间隔</span>
            <span
              class="text-xs font-medium flex items-center gap-1.5"
              :class="curTel.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'"
            >
              <span
                class="size-1.5 rounded-full"
                :class="curTel.isActive ? 'bg-emerald-500 animate-ping' : 'bg-muted-foreground/40'"
              />
              {{ curTel.isActive ? '正在接收 LLM 输出' : '空闲待命' }}
            </span>
          </div>

          <div class="flex items-baseline gap-2">
            <span class="text-4xl font-light font-mono tracking-tight" :class="getSilenceColorClass">
              {{ curTel.isActive ? formatSeconds(curTel.silenceDurationMs) : '0.0' }}
            </span>
            <span class="text-xs text-muted-foreground font-mono">s</span>
          </div>

          <div class="space-y-2">
            <div class="w-full h-1 bg-secondary overflow-hidden">
              <div
                class="h-full transition-all duration-300"
                :class="getSilenceBarClass"
                :style="{
                  width: curTel.isActive
                    ? `${Math.min(100, (curTel.silenceDurationMs / (monitorStore.idleDangerSec * 1000)) * 100)}%`
                    : '0%'
                }"
              />
            </div>
            <div class="flex justify-between text-[11px] text-muted-foreground/70 font-mono">
              <span>0s</span>
              <span>{{ monitorStore.idleWarningSec }}s 警戒</span>
              <span>{{ monitorStore.idleDangerSec }}s 断流</span>
            </div>
          </div>

          <p
            v-if="curTel.isActive && curTel.silenceDurationMs > 3000"
            class="text-xs leading-relaxed pt-1"
            :class="curTel.silenceDurationMs > monitorStore.idleWarningSec * 1000 ? 'text-amber-500' : 'text-muted-foreground'"
          >
            {{ curTel.diagnosticVerdict }}
          </p>
        </div>

        <!-- 2. Core 2x2 Metrics Grid -->
        <div class="grid grid-cols-2 divide-x divide-y divide-border">
          <div class="p-5 space-y-1.5">
            <span class="text-xs text-muted-foreground block">接收输出 Token</span>
            <span class="text-2xl font-semibold font-mono text-foreground block">
              {{ curTel.totalTokensEst.toLocaleString() }}
            </span>
            <span class="text-[11px] text-muted-foreground/70 font-mono block">
              {{ curTel.totalChars.toLocaleString() }} 字符
            </span>
          </div>

          <div class="p-5 space-y-1.5">
            <span class="text-xs text-muted-foreground block">实时吞吐率</span>
            <span class="text-2xl font-semibold font-mono text-emerald-600 dark:text-emerald-400 block">
              {{ curTel.tpsCurrent.toFixed(1) }}
            </span>
            <span class="text-[11px] text-muted-foreground/70 font-mono block">
              tokens / sec
            </span>
          </div>

          <div class="p-5 space-y-1.5">
            <span class="text-xs text-muted-foreground block">首字延迟 (TTFT)</span>
            <span class="text-2xl font-semibold font-mono text-foreground block">
              {{ curTel.ttftMs ? `${curTel.ttftMs}` : '—' }}
            </span>
            <span class="text-[11px] text-muted-foreground/70 font-mono block">
              {{ curTel.ttftMs ? 'ms' : '等待首包' }}
            </span>
          </div>

          <div class="p-5 space-y-1.5">
            <span class="text-xs text-muted-foreground block">持续耗时</span>
            <span class="text-2xl font-semibold font-mono text-foreground block">
              {{ formatSeconds(curTel.activeDurationMs) }}
            </span>
            <span class="text-[11px] text-muted-foreground/70 font-mono block">
              seconds
            </span>
          </div>
        </div>

        <!-- 3. Model Metadata -->
        <div class="p-6 space-y-2">
          <span class="text-xs text-muted-foreground block">当前模型</span>
          <div class="font-mono text-xs text-foreground truncate" :title="curTel.model || ''">
            {{ curTel.model || '未记录' }}
          </div>
          <div class="font-mono text-[11px] text-muted-foreground truncate">
            {{ curTel.provider || '默认提供商' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { RadioIcon, WrenchIcon } from 'lucide-vue-next'
import { useMonitorStore, type TelemetryChunk } from '@/stores/monitor'
import {
  decodeJsonEscapes,
  parseToolCallText,
  resolveStreamBlocks,
  splitParagraphs,
  type StreamBlock,
} from '@/lib/streamText'

const monitorStore = useMonitorStore()
const curTel = computed(() => monitorStore.currentSessionTelemetry)

const streamViewMode = ref<'stream' | 'chunks'>('stream')
const showThinkingFull = ref(true)
const expandFullAccumulated = ref(false)
const copiedFull = ref(false)
const selectedChunk = ref<TelemetryChunk | null>(null)
const rawToolFragments = ref(false)

const MAX_PREVIEW_CHARS = 24000

/**
 * 渲染用有序段落：thinking / text / tool_call 严格按分片到达顺序交错。
 * 优先使用 collector 的顺序日志（blocks），其次最近分包（chunks），最后用累计文本合成。
 */
const streamBlocks = computed(() =>
  resolveStreamBlocks({
    blocks: curTel.value.blocks,
    chunks: curTel.value.chunks,
    accumulatedText: curTel.value.accumulatedText,
    thinkingText: curTel.value.thinkingText,
  }),
)

/** 原始碎片调试视图：按到达顺序的最近分包 */
const rawFragments = computed(() => curTel.value.chunks)

const hasToolCalls = computed(() => {
  const text = curTel.value.toolCallText
  return (!!text && text.trim().length > 0) || streamBlocks.value.some((b) => b.kind === 'tool_call')
})

function toolCallsOf(block: StreamBlock) {
  return parseToolCallText(block.text)
}

function previewText(text: string): string {
  if (!text) return ''
  if (expandFullAccumulated.value || text.length <= MAX_PREVIEW_CHARS) return text
  return text.slice(0, MAX_PREVIEW_CHARS) + '\n...[已折叠超长尾部，点击下方按钮展开]...'
}

function previewThinking(text: string): string {
  if (!text) return ''
  if (text.length <= MAX_PREVIEW_CHARS) return text
  return text.slice(0, MAX_PREVIEW_CHARS) + '\n...[思维链超长已截断预览]...'
}

function isBlockTruncated(text: string): boolean {
  return !!text && text.length > MAX_PREVIEW_CHARS
}

function blockParagraphs(block: StreamBlock): string[] {
  return splitParagraphs(previewText(block.text))
}

/** 复制全文：同样保持到达顺序 */
const fullStreamText = computed(() =>
  streamBlocks.value
    .map((block) => {
      if (block.kind === 'thinking') return `[Thinking]\n${block.text}`
      if (block.kind === 'text') return block.text
      return toolCallsOf(block)
        .map((call) => `[${call.title}]\n${call.display}`)
        .join('\n\n')
    })
    .filter(Boolean)
    .join('\n\n'),
)

const selectedChunkDisplay = computed(() => {
  const chunk = selectedChunk.value
  if (!chunk) return ''
  if (chunk.phase !== 'tool_call') return chunk.text
  return decodeJsonEscapes(chunk.text)
})

// Virtual Scroll for Chunk List
const CHUNK_ROW_HEIGHT = 32
const CHUNK_OVERSCAN = 10
const chunkViewportEl = ref<HTMLElement | null>(null)
const chunkScrollTop = ref(0)
const chunkViewportHeight = ref(480)
let chunkResizeObserver: ResizeObserver | null = null

function updateChunkViewportHeight() {
  if (chunkViewportEl.value) {
    chunkViewportHeight.value = chunkViewportEl.value.clientHeight || 480
  }
}

function onChunkScroll(e: Event) {
  const target = e.target as HTMLElement
  chunkScrollTop.value = target.scrollTop
}

onMounted(() => {
  updateChunkViewportHeight()
  if (typeof ResizeObserver !== 'undefined' && chunkViewportEl.value) {
    chunkResizeObserver = new ResizeObserver(() => updateChunkViewportHeight())
    chunkResizeObserver.observe(chunkViewportEl.value)
  }
})

onUnmounted(() => {
  chunkResizeObserver?.disconnect()
})

watch(streamViewMode, () => {
  setTimeout(() => updateChunkViewportHeight(), 0)
})

watch(
  () => monitorStore.activeSession?.id,
  () => {
    selectedChunk.value = null
    expandFullAccumulated.value = false
    rawToolFragments.value = false
    chunkScrollTop.value = 0
  }
)

const reversedChunks = computed(() => {
  return [...curTel.value.chunks].reverse()
})

const chunkTotalHeight = computed(() => reversedChunks.value.length * CHUNK_ROW_HEIGHT)

const chunkStartIndex = computed(() => Math.max(0, Math.floor(chunkScrollTop.value / CHUNK_ROW_HEIGHT) - CHUNK_OVERSCAN))

const chunkEndIndex = computed(() => {
  const count = Math.ceil(chunkViewportHeight.value / CHUNK_ROW_HEIGHT) + CHUNK_OVERSCAN * 2
  return Math.min(reversedChunks.value.length, chunkStartIndex.value + count)
})

const chunkOffsetY = computed(() => chunkStartIndex.value * CHUNK_ROW_HEIGHT)

const visibleChunks = computed(() => reversedChunks.value.slice(chunkStartIndex.value, chunkEndIndex.value))

async function copyAccumulatedText() {
  try {
    const full = fullStreamText.value
    await navigator.clipboard.writeText(full)
    copiedFull.value = true
    setTimeout(() => {
      copiedFull.value = false
    }, 2000)
  } catch {
    // ignore
  }
}

function formatSeconds(ms: number): string {
  if (!ms || ms <= 0) return '0.0'
  return (ms / 1000).toFixed(1)
}

function formatPhaseLabel(phase: string, isActive: boolean): string {
  if (!isActive) return '最新响应快照'
  switch (phase) {
    case 'waiting_ttft':
      return '等待首包 TTFT'
    case 'thinking':
      return '推理生成中'
    case 'text':
      return '正文输出中'
    case 'tool_call':
      return '工具指令生成中'
    default:
      return '流式传输中'
  }
}

function formatChunkPhase(phase: string): string {
  switch (phase) {
    case 'thinking':
      return '推理'
    case 'tool_call':
      return '工具指令'
    default:
      return '正文'
  }
}

function getChunkPhaseClass(phase: string): string {
  switch (phase) {
    case 'thinking':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-500'
    case 'tool_call':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
    default:
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }
}

const getPhaseBadgeClass = computed(() => {
  if (!curTel.value.isActive) {
    return 'border-border bg-secondary/40 text-muted-foreground'
  }
  switch (curTel.value.phase) {
    case 'thinking':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-500'
    case 'text':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'tool_call':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-500'
    case 'waiting_ttft':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-500'
    default:
      return 'border-border bg-secondary text-muted-foreground'
  }
})

const getSilenceColorClass = computed(() => {
  if (!curTel.value.isActive) return 'text-muted-foreground/40'
  const sec = curTel.value.silenceDurationMs / 1000
  if (sec > monitorStore.idleDangerSec) return 'text-rose-500'
  if (sec > monitorStore.idleWarningSec) return 'text-amber-500'
  if (sec > 3) return 'text-violet-500'
  return 'text-foreground'
})

const getSilenceBarClass = computed(() => {
  const sec = curTel.value.silenceDurationMs / 1000
  if (sec > monitorStore.idleDangerSec) return 'bg-rose-500'
  if (sec > monitorStore.idleWarningSec) return 'bg-amber-500'
  if (sec > 3) return 'bg-violet-500'
  return 'bg-emerald-500'
})
</script>
