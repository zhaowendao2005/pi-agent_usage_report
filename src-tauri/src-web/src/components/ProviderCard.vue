<template>
  <div
    class="bg-card border rounded-lg p-4 hover:shadow-md transition-all select-none"
    :class="{
      'border-border': !isGroup && !isDragOver,
      'border-2 border-blue-500 bg-blue-50/10': isDragOver,
      'border-2 border-purple-500': isGroup,
      'opacity-50 cursor-grabbing': isDragging,
      'cursor-grab': !isDragging,
    }"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Group Badge -->
    <div v-if="isGroup" class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-2">
        <span
          class="px-2 py-1 rounded text-xs font-mono font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
        >
          📦 {{ displayName }}
        </span>
        <button
          type="button"
          class="text-xs text-muted-foreground hover:text-foreground"
          @click.stop="toggleExpanded"
        >
          {{ expanded ? '▼' : '▶' }} {{ group.members.length }} 个
        </button>
      </div>
      <button
        type="button"
        class="text-xs text-red-600 hover:text-red-700"
        @click.stop="onDeleteGroup"
        title="解散分组"
      >
        ✕
      </button>
    </div>

    <!-- Normal Provider Badge -->
    <div v-else class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-2">
        <span
          class="px-2 py-1 rounded text-xs font-mono font-medium"
          :style="{ background: providerColor + '22', color: providerColor }"
        >
          {{ displayName }}
        </span>
        <span
          v-if="hasScript"
          class="w-2 h-2 rounded-full bg-green-500"
          title="已配置脚本"
        />
      </div>
    </div>

    <!-- Expanded Members List (for groups) -->
    <div v-if="isGroup && expanded" class="mb-3 pl-3 border-l-2 border-purple-300 space-y-1">
      <div
        v-for="member in group.members"
        :key="member"
        class="flex items-center justify-between text-xs"
      >
        <span class="text-muted-foreground font-mono">{{ member }}</span>
        <button
          type="button"
          class="text-red-600 hover:text-red-700"
          @click.stop="onRemoveMember(member)"
          title="移出分组"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="space-y-1.5 mb-3 text-xs text-muted-foreground">
      <div class="flex items-center justify-between">
        <span>调用次数</span>
        <span class="font-mono text-foreground">{{ totalCalls.toLocaleString() }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span>总费用</span>
        <span class="font-mono text-foreground">${{ totalCost.toFixed(4) }}</span>
      </div>
    </div>

    <!-- Action Button -->
    <button
      type="button"
      class="w-full px-3 py-2 text-xs font-medium rounded transition-colors"
      :class="hasScript
        ? 'bg-accent text-foreground hover:bg-accent/80'
        : 'border border-border hover:bg-accent'"
      @click.stop="onEditScript"
    >
      {{ hasScript ? '📝 编辑脚本' : '➕ 添加脚本' }}
    </button>

    <!-- Drag Hint -->
    <div v-if="isDragOver" class="absolute inset-0 flex items-center justify-center bg-blue-500/10 rounded-lg pointer-events-none">
      <span class="text-sm font-medium text-blue-600">松开以合并</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProviderStat, ProviderGroup } from '@/stores/priceCalibration'

const props = defineProps<{
  provider?: ProviderStat
  group?: ProviderGroup
  allProviders: ProviderStat[]
  hasScript: boolean
  providerColor: string
}>()

const emit = defineEmits<{
  editScript: [provider: string]
  merge: [source: string, target: string]
  deleteGroup: [groupId: number]
  removeMember: [groupId: number, member: string]
}>()

const isDragging = ref(false)
const isDragOver = ref(false)
const expanded = ref(false)

const isGroup = computed(() => !!props.group)

const displayName = computed(() => {
  if (props.group) return props.group.groupName
  return props.provider?.provider || 'unknown'
})

const totalCalls = computed(() => {
  if (props.group) {
    return props.allProviders
      .filter(p => props.group!.members.includes(p.provider))
      .reduce((sum, p) => sum + p.callCount, 0)
  }
  return props.provider?.callCount || 0
})

const totalCost = computed(() => {
  if (props.group) {
    return props.allProviders
      .filter(p => props.group!.members.includes(p.provider))
      .reduce((sum, p) => sum + p.totalCost, 0)
  }
  return props.provider?.totalCost || 0
})

function onDragStart(e: DragEvent) {
  isDragging.value = true
  const name = isGroup.value ? props.group!.groupName : props.provider!.provider
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', name)
  e.dataTransfer!.setData('application/x-provider', name)
  e.dataTransfer!.setData('application/x-is-group', isGroup.value ? 'true' : 'false')
}

function onDragEnd() {
  isDragging.value = false
}

function onDragOver(e: DragEvent) {
  const sourceIsGroup = e.dataTransfer!.types.includes('application/x-is-group') &&
    e.dataTransfer!.getData('application/x-is-group') === 'true'
  
  // Groups cannot be merged into other groups
  if (sourceIsGroup && isGroup.value) {
    e.dataTransfer!.dropEffect = 'none'
    return
  }
  
  e.dataTransfer!.dropEffect = 'move'
  isDragOver.value = true
}

function onDragLeave() {
  isDragOver.value = false
}

function onDrop(e: DragEvent) {
  isDragOver.value = false
  const source = e.dataTransfer!.getData('application/x-provider')
  const target = displayName.value
  
  if (source && source !== target) {
    emit('merge', source, target)
  }
}

function onEditScript() {
  emit('editScript', displayName.value)
}

function toggleExpanded() {
  expanded.value = !expanded.value
}

function onDeleteGroup() {
  if (props.group && confirm(`确定要解散分组"${props.group.groupName}"吗？成员将恢复为独立提供商。`)) {
    emit('deleteGroup', props.group.id)
  }
}

function onRemoveMember(member: string) {
  if (props.group && confirm(`确定将"${member}"移出分组吗？`)) {
    emit('removeMember', props.group.id, member)
  }
}
</script>
