<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-foreground flex items-center gap-2">
          <CalibrationIcon class="w-5 h-5 text-muted-foreground" />
          价格校准
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5">
          为每个提供商编写自定义价格计算脚本 · 配置存储在数据库 · 拖拽卡片可合并分组
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
          @click="authenticate"
        >
          鉴权
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
          @click="refresh"
          :disabled="loading"
        >
          <span v-if="loading">刷新中...</span>
          <span v-else>刷新</span>
        </button>
      </div>
    </div>

    <!-- Search bar -->
    <div class="flex items-center gap-3">
      <div class="relative flex-1 max-w-sm">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索提供商..."
          class="w-full px-3 py-2 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          @input="onSearch"
        />
      </div>
      <span class="text-xs text-muted-foreground">
        共 {{ filteredProviders.length }} 个提供商
      </span>
    </div>

    <!-- Provider cards grid -->
    <div v-if="loading && providers.length === 0" class="text-center py-10 text-sm text-muted-foreground">
      加载中...
    </div>

    <div v-else-if="error" class="text-center py-10 text-sm text-red-600">
      加载失败: {{ error }}
    </div>

    <div v-else-if="pagedProviders.length === 0" class="text-center py-10 text-sm text-muted-foreground">
      暂无数据
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      <!-- Group Cards -->
      <ProviderCard
        v-for="group in displayGroups"
        :key="'group-' + group.id"
        :group="group"
        :all-providers="providers"
        :has-script="hasScript(group.groupName)"
        :provider-color="providerColor(group.groupName)"
        @edit-script="openScriptEditor"
        @merge="onMerge"
        @delete-group="onDeleteGroup"
        @remove-member="onRemoveMember"
      />

      <!-- Individual Provider Cards -->
      <ProviderCard
        v-for="provider in displayProviders"
        :key="provider.provider"
        :provider="provider"
        :all-providers="providers"
        :has-script="hasScript(provider.provider)"
        :provider-color="providerColor(provider.provider)"
        @edit-script="openScriptEditor"
        @merge="onMerge"
      />
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-2">
      <button
        type="button"
        class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="currentPage === 1"
        @click="prevPage"
      >
        上一页
      </button>

      <div class="flex items-center gap-1">
        <button
          v-for="page in visiblePages"
          :key="page"
          type="button"
          class="px-2.5 py-1.5 text-xs rounded transition-colors"
          :class="page === currentPage
            ? 'bg-accent text-foreground font-medium'
            : 'hover:bg-accent/50 text-muted-foreground'"
          @click="goToPage(page)"
        >
          {{ page }}
        </button>
      </div>

      <button
        type="button"
        class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="currentPage === totalPages"
        @click="nextPage"
      >
        下一页
      </button>
    </div>

    <!-- Script Editor Drawer -->
    <ScriptEditorDrawer
      v-if="editorOpen"
      :provider="currentProvider"
      :initial-script="currentScript"
      @close="closeEditor"
      @save="onSaveScript"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePriceCalibrationStore } from '@/stores/priceCalibration'
import ProviderCard from '@/components/ProviderCard.vue'
import ScriptEditorDrawer from '@/components/ScriptEditorDrawer.vue'
import CalibrationIcon from '@/components/icons/CalibrationIcon.vue'
import { useMessage } from '@/lib/message'

const message = useMessage()

const store = usePriceCalibrationStore()
const { 
  providers, 
  scripts,
  groups,
  loading, 
  error, 
  pagedProviders, 
  filteredProviders,
  currentPage, 
  totalPages 
} = storeToRefs(store)

const searchQuery = ref('')
const editorOpen = ref(false)
const currentProvider = ref('')
const currentScript = ref('')

// Compute which providers are in groups
const providersInGroups = computed(() => {
  const set = new Set<string>()
  groups.value.forEach(g => g.members.forEach(m => set.add(m)))
  return set
})

// Display groups that match search
const displayGroups = computed(() => {
  if (!searchQuery.value) return groups.value
  const query = searchQuery.value.toLowerCase()
  return groups.value.filter(g => 
    g.groupName.toLowerCase().includes(query) ||
    g.members.some(m => m.toLowerCase().includes(query))
  )
})

// Display individual providers (not in any group) that match search and pagination
const displayProviders = computed(() => {
  return pagedProviders.value.filter(p => !providersInGroups.value.has(p.provider))
})

const MODEL_COLORS = [
  '#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#14b8a6',
]

function providerColor(provider: string) {
  let h = 0
  for (let i = 0; i < provider.length; i++) h = (h * 31 + provider.charCodeAt(i)) >>> 0
  return MODEL_COLORS[h % MODEL_COLORS.length]
}

function hasScript(provider: string) {
  return !!scripts.value[provider]
}

function openScriptEditor(provider: string) {
  currentProvider.value = provider
  currentScript.value = scripts.value[provider]?.script || ''
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
  currentProvider.value = ''
  currentScript.value = ''
}

async function onSaveScript(provider: string, script: string) {
  try {
    await store.saveScript(provider, script)
    message.success(`脚本已保存: ${provider}`)
  } catch (err) {
    message.error('保存失败: ' + String(err))
  }
  closeEditor()
}

function onSearch(e: Event) {
  const target = e.target as HTMLInputElement
  store.setSearchQuery(target.value)
}

const visiblePages = computed(() => {
  const pages: number[] = []
  const total = totalPages.value
  const current = currentPage.value

  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push(-1) // ellipsis
    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (current < total - 2) pages.push(-1) // ellipsis
    pages.push(total)
  }

  return pages
})

function goToPage(page: number) {
  if (page > 0) store.setPage(page)
}

function prevPage() {
  store.setPage(currentPage.value - 1)
}

function nextPage() {
  store.setPage(currentPage.value + 1)
}

async function onMerge(source: string, target: string) {
  try {
    // Check if target is a group
    const targetGroup = groups.value.find(g => g.groupName === target)

    if (targetGroup) {
      // Add source to existing group
      await store.addToGroup(targetGroup.id, source)
      message.success(`已将 ${source} 合并到分组 ${target}`)
    } else {
      // Check if source is already in a group
      const sourceGroup = await store.findGroupByProvider(source)
      if (sourceGroup) {
        message.error('源提供商已在分组中，请先将其移出分组')
        return
      }

      // Check if target is in a group
      const targetInGroup = await store.findGroupByProvider(target)
      if (targetInGroup) {
        // Add source to target's group
        await store.addToGroup(targetInGroup.id, source)
        message.success(`已将 ${source} 合并到分组 ${targetInGroup.groupName}`)
      } else {
        // Create new group with both
        const groupName = `${target}-group`
        await store.createGroup(groupName, [target, source])
        message.success(`已创建分组 ${groupName}`)
      }
    }
  } catch (err) {
    message.error('合并失败: ' + String(err))
  }
}

async function onDeleteGroup(groupId: number) {
  try {
    await store.deleteGroup(groupId)
    message.success('分组已解散')
  } catch (err) {
    message.error('解散失败: ' + String(err))
  }
}

async function onRemoveMember(groupId: number, member: string) {
  try {
    await store.removeFromGroup(groupId, member)
    message.success(`已将 ${member} 移出分组`)
  } catch (err) {
    message.error('移出失败: ' + String(err))
  }
}

async function refresh() {
  await store.init()
}

function authenticate() {
  // TODO: 实现OAuth授权逻辑
  console.log('鉴权按钮被点击')
}

onMounted(() => {
  store.init()
})
</script>
