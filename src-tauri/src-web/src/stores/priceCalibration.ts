import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface ProviderStat {
  provider: string
  callCount: number
  totalCost: number
}

export interface CalibrationScript {
  provider: string
  script: string
  updatedAt: number
}

export interface ProviderGroup {
  id: number
  groupName: string
  members: string[]
  createdAt: number
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export const usePriceCalibrationStore = defineStore('priceCalibration', () => {
  const providers = ref<ProviderStat[]>([])
  const scripts = ref<Record<string, CalibrationScript>>({})
  const groups = ref<ProviderGroup[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')
  const currentPage = ref(1)
  const pageSize = ref(12)
  const draggedProvider = ref<string | null>(null)

  const filteredProviders = computed(() => {
    if (!searchQuery.value) return providers.value
    const query = searchQuery.value.toLowerCase()
    return providers.value.filter(p => p.provider.toLowerCase().includes(query))
  })

  const totalPages = computed(() => Math.ceil(filteredProviders.value.length / pageSize.value))

  const pagedProviders = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    const end = start + pageSize.value
    return filteredProviders.value.slice(start, end)
  })

  async function fetchProviders() {
    loading.value = true
    error.value = null
    try {
      if (isTauri()) {
        providers.value = await tauriInvoke<ProviderStat[]>('get_providers')
      } else {
        // Fallback: HTTP API (if needed)
        const res = await fetch('/api/providers')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        providers.value = await res.json()
      }
    } catch (err) {
      error.value = String(err)
      console.error('[priceCalibration] fetch providers failed:', err)
    } finally {
      loading.value = false
    }
  }

  async function fetchAllScripts() {
    try {
      if (isTauri()) {
        const list = await tauriInvoke<CalibrationScript[]>('get_all_calibration_scripts')
        scripts.value = {}
        list.forEach(s => {
          scripts.value[s.provider] = s
        })
      }
    } catch (err) {
      console.error('[priceCalibration] fetch scripts failed:', err)
    }
  }

  async function fetchScript(provider: string) {
    try {
      if (isTauri()) {
        const result = await tauriInvoke<CalibrationScript | null>('get_calibration_script', { provider })
        if (result) {
          scripts.value[provider] = result
        } else {
          delete scripts.value[provider]
        }
      }
    } catch (err) {
      console.error(`[priceCalibration] fetch script for ${provider} failed:`, err)
    }
  }

  async function saveScript(provider: string, script: string) {
    try {
      if (isTauri()) {
        await tauriInvoke('save_calibration_script', { provider, script })
        await fetchScript(provider)
      }
    } catch (err) {
      console.error(`[priceCalibration] save script for ${provider} failed:`, err)
      throw err
    }
  }

  async function deleteScript(provider: string) {
    try {
      if (isTauri()) {
        await tauriInvoke('delete_calibration_script', { provider })
        delete scripts.value[provider]
      }
    } catch (err) {
      console.error(`[priceCalibration] delete script for ${provider} failed:`, err)
      throw err
    }
  }

  function setSearchQuery(query: string) {
    searchQuery.value = query
    currentPage.value = 1
  }

  function setPage(page: number) {
    currentPage.value = Math.max(1, Math.min(page, totalPages.value))
  }

  async function fetchAllGroups() {
    try {
      if (isTauri()) {
        groups.value = await tauriInvoke<ProviderGroup[]>('get_all_provider_groups')
      }
    } catch (err) {
      console.error('[priceCalibration] fetch groups failed:', err)
    }
  }

  async function createGroup(groupName: string, members: string[]) {
    try {
      if (isTauri()) {
        await tauriInvoke<number>('create_provider_group', { groupName, members })
        await fetchAllGroups()
        await fetchProviders()
      }
    } catch (err) {
      console.error('[priceCalibration] create group failed:', err)
      throw err
    }
  }

  async function addToGroup(groupId: number, provider: string) {
    try {
      if (isTauri()) {
        await tauriInvoke('add_to_provider_group', { groupId, provider })
        await fetchAllGroups()
        await fetchProviders()
      }
    } catch (err) {
      console.error('[priceCalibration] add to group failed:', err)
      throw err
    }
  }

  async function removeFromGroup(groupId: number, provider: string) {
    try {
      if (isTauri()) {
        await tauriInvoke('remove_from_provider_group', { groupId, provider })
        await fetchAllGroups()
        await fetchProviders()
      }
    } catch (err) {
      console.error('[priceCalibration] remove from group failed:', err)
      throw err
    }
  }

  async function deleteGroup(groupId: number) {
    try {
      if (isTauri()) {
        await tauriInvoke('delete_provider_group', { groupId })
        await fetchAllGroups()
        await fetchProviders()
      }
    } catch (err) {
      console.error('[priceCalibration] delete group failed:', err)
      throw err
    }
  }

  async function findGroupByProvider(provider: string) {
    try {
      if (isTauri()) {
        return await tauriInvoke<ProviderGroup | null>('find_group_by_provider', { provider })
      }
      return null
    } catch (err) {
      console.error('[priceCalibration] find group failed:', err)
      return null
    }
  }

  async function init() {
    await Promise.all([fetchProviders(), fetchAllScripts(), fetchAllGroups()])
  }

  return {
    providers,
    scripts,
    groups,
    loading,
    error,
    searchQuery,
    currentPage,
    pageSize,
    draggedProvider,
    filteredProviders,
    pagedProviders,
    totalPages,
    fetchProviders,
    fetchAllScripts,
    fetchAllGroups,
    fetchScript,
    saveScript,
    deleteScript,
    createGroup,
    addToGroup,
    removeFromGroup,
    deleteGroup,
    findGroupByProvider,
    setSearchQuery,
    setPage,
    init,
  }
})
