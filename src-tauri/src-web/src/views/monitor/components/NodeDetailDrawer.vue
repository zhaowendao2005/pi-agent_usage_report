<template>
  <div class="h-full flex flex-col overflow-hidden bg-background text-xs select-none">
    <div v-if="!node" class="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
      <FileSearchIcon class="w-7 h-7 mb-2 opacity-40 text-primary" />
      <p class="font-medium text-foreground/80">未选择任何执行节点</p>
      <p class="text-[11px] text-muted-foreground/70 mt-1">请在「执行节点树」中单击或双击任一节点以按需冷加载完整调用报文</p>
    </div>

    <template v-else>
      <!-- Top Structural Meta Strip (Swiss Modernist Grid) -->
      <div class="shrink-0 border-b border-border px-5 py-3 flex items-center justify-between gap-4 bg-secondary/15">
        <div class="flex items-center gap-3 min-w-0">
          <span
            class="px-2 py-0.5 border text-[10px] font-mono font-semibold uppercase shrink-0"
            :class="[
              node.role === 'user'
                ? 'border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400'
                : node.role === 'assistant'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
            ]"
          >
            {{ node.roleLabel }}
          </span>
          <span class="font-mono text-xs text-foreground font-semibold truncate">NODE #{{ node.id }}</span>
          <span v-if="node.model" class="font-mono text-[11px] text-muted-foreground truncate">
            · {{ node.model }}
          </span>
        </div>

        <div class="flex items-center gap-4 font-mono text-[11px] text-muted-foreground shrink-0">
          <span v-if="node.durationMs">LATENCY: <strong class="text-foreground">{{ node.durationMs }}ms</strong></span>
          <span v-if="node.tokens">TOKENS: <strong class="text-foreground">{{ node.tokens }}</strong></span>
          <span v-if="node.charCount">CHARS: <strong class="text-foreground">{{ node.charCount.toLocaleString() }}</strong></span>
          <span v-if="node.timestamp">{{ formatTimestamp(node.timestamp) }}</span>
        </div>
      </div>

      <!-- Loading State for On-Demand Cold Fetch -->
      <div v-if="monitorStore.isLoadingNodeDetail" class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <Loader2Icon class="w-4 h-4 animate-spin mb-2 text-primary" />
        <span>正在按需读取节点完整报文...</span>
      </div>

      <!-- Two-Column Open Structural Grid: Left Parsed Content / Right Raw JSON -->
      <div v-else class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">
        <!-- Left (7 cols): Parsed Payload Content -->
        <div class="lg:col-span-7 flex flex-col min-h-0 overflow-hidden">
          <div class="h-8 shrink-0 border-b border-border px-4 flex items-center justify-between bg-background">
            <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-semibold">
              PAYLOAD CONTENT / 正文与指令内容解析 ({{ fullContentText.length.toLocaleString() }} 字符)
            </span>
            <button
              @click="copyContent"
              class="text-[11px] text-primary hover:underline cursor-pointer"
            >
              {{ copied ? '已复制 ✓' : '复制全文' }}
            </button>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-foreground/90 select-text">
            {{ displayedContentText }}
            <div v-if="isContentTruncated && !expandFullContent" class="mt-3 pt-2 border-t border-border/50">
              <button
                @click="expandFullContent = true"
                class="px-3 py-1 border border-border bg-secondary/40 text-[11px] text-primary hover:bg-accent cursor-pointer font-sans"
              >
                展开剩余 {{ (fullContentText.length - MAX_RENDER_CHARS).toLocaleString() }} 字符完整正文...
              </button>
            </div>
          </div>
        </div>

        <!-- Right (5 cols): Raw JSON Entry (Cold-Loaded & Lazy Truncated) -->
        <div class="lg:col-span-5 flex flex-col min-h-0 overflow-hidden">
          <div class="h-8 shrink-0 border-b border-border px-4 flex items-center justify-between bg-background">
            <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-semibold">
              RAW JSON ENTRY / 原始数据报文 ({{ node.entryType }})
            </span>
            <button
              @click="copyJson"
              class="text-[11px] text-primary hover:underline cursor-pointer"
            >
              {{ copiedJson ? '已复制 JSON ✓' : '复制 JSON' }}
            </button>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto p-4 bg-secondary/10 select-text">
            <pre class="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">{{ displayedJsonText }}</pre>
            <div v-if="isJsonTruncated && !expandFullJson" class="mt-3 pt-2 border-t border-border/50">
              <button
                @click="expandFullJson = true"
                class="px-3 py-1 border border-border bg-background text-[11px] text-primary hover:bg-accent cursor-pointer font-sans"
              >
                按需展开完整 JSON ({{ fullJsonText.length.toLocaleString() }} 字符)...
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { FileSearchIcon, Loader2Icon } from 'lucide-vue-next'
import { useMonitorStore, type SessionTreeNode } from '@/stores/monitor'

const monitorStore = useMonitorStore()
const node = computed<SessionTreeNode | null>(() => monitorStore.selectedNode)
const copied = ref(false)
const copiedJson = ref(false)
const expandFullContent = ref(false)
const expandFullJson = ref(false)

const MAX_RENDER_CHARS = 20000

onMounted(() => {
  if (node.value) {
    monitorStore.fetchNodeDetailOnDemand(node.value)
  }
})

watch(
  () => node.value?.id,
  () => {
    expandFullContent.value = false
    expandFullJson.value = false
    if (node.value) {
      monitorStore.fetchNodeDetailOnDemand(node.value)
    }
  }
)

const effectiveDetail = computed(() => {
  return monitorStore.selectedNodeDetail ?? node.value?.detail ?? {}
})

const fullContentText = computed(() => {
  if (!node.value) return ''
  const d = effectiveDetail.value
  if (d?.message?.content) {
    if (typeof d.message.content === 'string') return d.message.content
    if (Array.isArray(d.message.content)) {
      return d.message.content
        .map((item: any) => {
          if (item.type === 'text') return item.text
          if (item.type === 'thinking') return `[Thinking 思维链]\n${item.thinking}`
          if (item.type === 'toolCall') return `[工具调用: ${item.name}]\n参数: ${JSON.stringify(item.arguments, null, 2)}`
          return JSON.stringify(item, null, 2)
        })
        .join('\n\n')
    }
  }
  if (typeof d?.content === 'string') return d.content
  return node.value.summary
})

const isContentTruncated = computed(() => fullContentText.value.length > MAX_RENDER_CHARS)

const displayedContentText = computed(() => {
  if (expandFullContent.value || !isContentTruncated.value) {
    return fullContentText.value
  }
  return fullContentText.value.slice(0, MAX_RENDER_CHARS)
})

const fullJsonText = computed(() => {
  try {
    return JSON.stringify(effectiveDetail.value, null, 2) || '{}'
  } catch {
    return '{}'
  }
})

const isJsonTruncated = computed(() => fullJsonText.value.length > MAX_RENDER_CHARS)

const displayedJsonText = computed(() => {
  if (expandFullJson.value || !isJsonTruncated.value) {
    return fullJsonText.value
  }
  return fullJsonText.value.slice(0, MAX_RENDER_CHARS)
})

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString()
  } catch {
    return ts
  }
}

async function copyContent() {
  try {
    await navigator.clipboard.writeText(fullContentText.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // ignore
  }
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(fullJsonText.value)
    copiedJson.value = true
    setTimeout(() => {
      copiedJson.value = false
    }, 2000)
  } catch {
    // ignore
  }
}
</script>
