<template>
  <div class="h-full flex flex-col p-4 space-y-4 overflow-y-auto bg-background text-xs select-none">
    <div v-if="!node" class="py-20 text-center text-muted-foreground">
      <FileSearchIcon class="w-8 h-8 mx-auto mb-2 opacity-40 text-primary" />
      <p>未选择任何节点</p>
      <p class="text-[11px] text-muted-foreground/70 mt-1">请在「执行节点树」中单击任一行节点以查看深层调用报文</p>
    </div>

    <div v-else class="space-y-4">
      <!-- Node Header Summary -->
      <div class="p-3 rounded-lg border border-border bg-card/60 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span
            class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase"
            :class="[
              node.role === 'user' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
              node.role === 'assistant' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
              'bg-sky-500/20 text-sky-400 border border-sky-500/30'
            ]"
          >
            {{ node.roleLabel }}
          </span>
          <span class="font-mono text-[11px] text-muted-foreground">ID: {{ node.id }}</span>
        </div>

        <div class="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span v-if="node.durationMs">耗时: {{ node.durationMs }}ms</span>
          <span v-if="node.tokens">Token: {{ node.tokens }}</span>
          <span v-if="node.timestamp">{{ formatTimestamp(node.timestamp) }}</span>
        </div>
      </div>

      <!-- Node Content Section -->
      <div class="rounded-lg border border-border bg-card/60 overflow-hidden">
        <div class="px-3 py-2 border-b border-border bg-card/40 flex items-center justify-between font-semibold">
          <span>正文与内容解析 (Payload Content)</span>
          <button
            @click="copyContent"
            class="text-[10px] text-primary hover:underline"
          >
            {{ copied ? '已复制 ✓' : '复制全文' }}
          </button>
        </div>
        <div class="p-3 font-sans text-xs whitespace-pre-wrap break-words leading-relaxed text-foreground/90 max-h-96 overflow-y-auto bg-background/50">
          {{ formattedContentText }}
        </div>
      </div>

      <!-- Raw JSON Details Viewer -->
      <div class="rounded-lg border border-border bg-card/60 overflow-hidden">
        <div class="px-3 py-2 border-b border-border bg-card/40 flex items-center justify-between font-semibold">
          <span class="font-mono text-[11px]">原始数据报文 (Raw JSON Entry)</span>
          <span class="text-[10px] text-muted-foreground font-mono">{{ node.entryType }}</span>
        </div>
        <pre class="p-3 font-mono text-[11px] text-muted-foreground/90 whitespace-pre-wrap break-all overflow-x-auto max-h-80 bg-background/50">{{ JSON.stringify(node.detail, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { FileSearchIcon } from 'lucide-vue-next'
import { useMonitorStore, type SessionTreeNode } from '@/stores/monitor'

const monitorStore = useMonitorStore()
const node = computed<SessionTreeNode | null>(() => monitorStore.selectedNode)
const copied = ref(false)

const formattedContentText = computed(() => {
  if (!node.value) return ''
  const d = node.value.detail
  if (d.message?.content) {
    if (typeof d.message.content === 'string') return d.message.content
    if (Array.isArray(d.message.content)) {
      return d.message.content
        .map((item: any) => {
          if (item.type === 'text') return item.text
          if (item.type === 'thinking') return `[Thinking 思维链]\n${item.thinking}`
          if (item.type === 'toolCall') return `[工具调用: ${item.name}]\n参数: ${JSON.stringify(item.arguments, null, 2)}`
          return JSON.stringify(item)
        })
        .join('\n\n')
    }
  }
  return node.value.summary
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
    await navigator.clipboard.writeText(formattedContentText.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // ignore
  }
}
</script>
