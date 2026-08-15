<template>
  <div class="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg flex-wrap">
    <!-- Time presets -->
    <div class="flex items-center gap-1">
      <button
        v-for="p in presets"
        :key="p.value"
        @click="applyTimePreset(p.value)"
        class="px-2 py-1 text-xs rounded transition-colors"
        :class="activePreset === p.value
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
      >{{ p.label }}</button>
    </div>

    <div class="w-px h-5 bg-border mx-1" />

    <!-- DateTime range picker (@vuepic/vue-datepicker) — 自带日历图标，外层不再重复 -->
    <div class="flex items-center gap-1.5 text-xs min-w-0">
      <VueDatePicker
        v-model="rangeModel"
        :range="{ partialRange: false }"
        :time-config="{ enableSeconds: true, is24: true }"
        :input-attrs="{ clearable: false }"
        :config="{ closeOnAutoApply: false }"
        :auto-apply="false"
        :formats="{ input: formatRangeDisplay, preview: formatPreview }"
        :max-date="maxDate"
        :locale="zhCN"
        :action-row="{ selectBtnLabel: '确定', cancelBtnLabel: '取消' }"
        placeholder="选择监控区间"
        class="dp-control"
        @open="onPickerOpen"
        @range-end="onRangeEndPicked"
        @update:model-value="onRangeConfirm"
        @closed="onPickerClosed"
      >
        <template #left-sidebar="{ presetDate }">
          <div class="flex flex-col gap-0.5 p-1.5 border-r border-border h-full">
            <button
              v-for="p in pickerPresets"
              :key="p.label"
              type="button"
              class="text-xs text-left px-2 py-1.5 rounded hover:bg-accent text-muted-foreground whitespace-nowrap transition-colors"
              @click="onPickerPreset(p.value, presetDate)"
            >{{ p.label }}</button>
          </div>
        </template>
        <template #action-extra>
          <label
            class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none px-1 py-0.5 rounded hover:bg-accent/60"
            @click.stop
          >
            <input
              v-model="draftEndLive"
              type="checkbox"
              class="rounded border-border text-primary focus:ring-ring w-3.5 h-3.5"
            />
            <span>结束时间跟随当前时刻</span>
          </label>
        </template>
      </VueDatePicker>

      <button
        type="button"
        @click="toggleEndLive"
        class="flex items-center gap-1 px-2 py-1 rounded transition-colors whitespace-nowrap border"
        :class="endIsLive
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'text-muted-foreground border-border hover:text-foreground hover:bg-accent'"
        :title="endIsLive ? '结束时间跟随实时（点击改为固定终点）' : '结束时间为固定值（点击改为实时）'"
      >
        <span
          class="w-1.5 h-1.5 rounded-full"
          :class="endIsLive ? 'bg-primary animate-pulse' : 'bg-muted-foreground'"
        />
        {{ endIsLive ? '实时' : '固定' }}
      </button>
    </div>

    <div class="w-px h-5 bg-border mx-1" />

    <!-- Refresh interval -->
    <div class="flex items-center gap-1.5 text-xs">
      <RefreshCwIcon class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span class="text-muted-foreground whitespace-nowrap">刷新间隔</span>
      <div class="flex items-center gap-1">
        <button
          v-for="iv in intervalPresets"
          :key="iv.value"
          @click="onIntervalPreset(iv.value)"
          class="px-2 py-1 rounded transition-colors whitespace-nowrap"
          :class="refreshInterval === iv.value && !customDraftDirty
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        >{{ iv.label }}</button>
      </div>
      <div class="flex items-center gap-1">
        <input
          v-model.number="customIntervalDraft"
          type="number"
          min="1"
          step="1"
          placeholder="秒"
          class="w-14 bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          @keydown.enter.prevent="confirmCustomInterval"
        />
        <button
          type="button"
          class="px-2 py-1 rounded text-xs border transition-colors whitespace-nowrap"
          :class="canConfirmCustom
            ? 'bg-primary text-primary-foreground border-primary hover:opacity-90'
            : 'text-muted-foreground border-border opacity-50 cursor-not-allowed'"
          :disabled="!canConfirmCustom"
          title="确认自定义刷新间隔（秒）"
          @click="confirmCustomInterval"
        >确定</button>
      </div>
    </div>

    <div class="w-px h-5 bg-border mx-1" />

    <!-- Live toggle -->
    <button
      type="button"
      @click="toggleLive"
      class="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all"
      :class="isLive
        ? 'bg-green-500/15 text-green-600 border border-green-500/30'
        : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'"
    >
      <span
        class="w-1.5 h-1.5 rounded-full"
        :class="isLive ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'"
      />
      {{ isLive ? 'LIVE' : '手动' }}
    </button>

    <!-- Manual refresh -->
    <button
      type="button"
      @click="refreshData"
      class="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="立即刷新"
    >
      <RefreshCwIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': spinning }" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RefreshCwIcon } from 'lucide-vue-next'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { zhCN } from 'date-fns/locale'
import '@vuepic/vue-datepicker/dist/main.css'
import { parseDatetime } from '@/lib/utils'
import { useUsageStore } from '@/stores/usage'

const store = useUsageStore()
const {
  startTime,
  endTime,
  endIsLive,
  refreshInterval,
  isLive,
  activePreset,
} = storeToRefs(store)

const presets = [
  { label: '当天', value: 'today' },
  { label: '15m', value: '15m' },
  { label: '1h',  value: '1h'  },
  { label: '6h',  value: '6h'  },
  { label: '24h', value: '24h' },
  { label: '7d',  value: '7d'  },
  { label: '14d', value: '14d' },
  { label: '30d', value: '30d' },
]

const intervalPresets = [
  { label: '5s',  value: 5   },
  { label: '15s', value: 15  },
  { label: '30s', value: 30  },
  { label: '1m',  value: 60  },
  { label: '5m',  value: 300 },
]

const customIntervalDraft = ref<number | ''>('')
const spinning = ref(false)
/** 弹层内草稿：是否结束跟随实时（点确定后才写回） */
const draftEndLive = ref(endIsLive.value)
/** 禁止选择未来时间 */
const maxDate = new Date()

const presetValues = new Set(intervalPresets.map((p) => p.value))

const customDraftDirty = computed(() => {
  const n = Number(customIntervalDraft.value)
  return Number.isFinite(n) && n >= 1 && !presetValues.has(n)
})

const canConfirmCustom = computed(() => {
  const n = Number(customIntervalDraft.value)
  return Number.isFinite(n) && n >= 1 && n !== refreshInterval.value
})

watch(
  refreshInterval,
  (v) => {
    if (!presetValues.has(v)) {
      customIntervalDraft.value = v
    } else if (!canConfirmCustom.value) {
      // keep draft empty when on preset unless user is editing
      if (customIntervalDraft.value === '' || presetValues.has(Number(customIntervalDraft.value))) {
        customIntervalDraft.value = ''
      }
    }
  },
  { immediate: true },
)

function toDate(s: string): Date {
  return parseDatetime(s) ?? new Date()
}

const rangeModel = ref<Date[]>([toDate(startTime.value), toDate(endTime.value)])

watch([startTime, endTime], () => {
  rangeModel.value = [toDate(startTime.value), toDate(endTime.value)]
})

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatRangeDisplay(dates: Date | Date[]) {
  if (!dates || !Array.isArray(dates) || !dates[0]) return ''
  const start = fmtDate(dates[0])
  if (endIsLive.value) return `${start} → 实时`
  if (!dates[1]) return start
  return `${start} → ${fmtDate(dates[1])}`
}

function formatPreview(dates: Date | Date[]) {
  if (!dates || !Array.isArray(dates) || !dates[0]) return ''
  const start = fmtDate(dates[0])
  if (draftEndLive.value) return `${start} → 实时`
  if (!dates[1]) return start
  return `${start} → ${fmtDate(dates[1])}`
}

const pickerPresets = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  return [
    { label: '当天', value: [startOfToday, now] },
    { label: '近 15 分钟', value: [new Date(now.getTime() - 15 * 60 * 1000), now] },
    { label: '近 1 小时', value: [new Date(now.getTime() - 60 * 60 * 1000), now] },
    { label: '近 6 小时', value: [new Date(now.getTime() - 6 * 60 * 60 * 1000), now] },
    { label: '近 24 小时', value: [new Date(now.getTime() - 24 * 60 * 60 * 1000), now] },
    { label: '近 7 天', value: [new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), now] },
    { label: '近 14 天', value: [new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), now] },
    { label: '近 30 天', value: [new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now] },
  ]
})

function onPickerOpen() {
  draftEndLive.value = endIsLive.value
  rangeModel.value = [toDate(startTime.value), toDate(endTime.value)]
}

function onPickerPreset(value: Date | Date[], presetDate: (v: Date | Date[]) => void) {
  draftEndLive.value = true
  presetDate(value)
}

/** 用户在日历上手动点了结束日 → 视为固定终点 */
function onRangeEndPicked() {
  draftEndLive.value = false
}

function onRangeConfirm(val: Date[] | null) {
  if (!val || !val[0] || !val[1]) return
  const endLive = draftEndLive.value
  const end = endLive ? new Date() : val[1]
  store.setTimeRange(val[0], end, { endLive, preset: '' })
}

function onPickerClosed() {
  draftEndLive.value = endIsLive.value
  rangeModel.value = [toDate(startTime.value), toDate(endTime.value)]
}

function toggleEndLive() {
  const next = !endIsLive.value
  draftEndLive.value = next
  store.setEndIsLive(next)
}

function applyTimePreset(preset: string) {
  store.applyTimePreset(preset)
}

function onIntervalPreset(seconds: number) {
  customIntervalDraft.value = ''
  store.setRefreshInterval(seconds)
}

function confirmCustomInterval() {
  const n = Number(customIntervalDraft.value)
  if (!Number.isFinite(n) || n < 1) return
  store.setRefreshInterval(Math.floor(n))
}

function toggleLive() {
  store.setLive(!isLive.value)
}

async function refreshData() {
  spinning.value = true
  await store.refreshData()
  setTimeout(() => (spinning.value = false), 600)
}
</script>

<style scoped>
/* 让 vue-datepicker 输入框贴合 ControlBar 高度与主题 */
:deep(.dp-control) {
  --dp-font-size: 12px;
  --dp-input-padding: 4px 28px 4px 8px;
  --dp-border-radius: 0.375rem;
  --dp-border-color: hsl(var(--border));
  --dp-border-color-hover: hsl(var(--ring));
  --dp-background-color: hsl(var(--background));
  --dp-text-color: hsl(var(--foreground));
  --dp-hover-color: hsl(var(--accent));
  --dp-hover-text-color: hsl(var(--foreground));
  --dp-primary-color: hsl(var(--primary));
  --dp-primary-text-color: hsl(var(--primary-foreground));
  --dp-secondary-color: hsl(var(--muted-foreground));
  --dp-menu-border-color: hsl(var(--border));
  --dp-success-color: hsl(var(--primary));
  --dp-icon-color: hsl(var(--muted-foreground));
  --dp-disabled-color: hsl(var(--muted));
  --dp-scroll-bar-background: hsl(var(--muted));
  --dp-scroll-bar-color: hsl(var(--border));
  --dp-range-between-dates-background-color: hsl(var(--primary) / 0.12);
  --dp-range-between-dates-text-color: hsl(var(--foreground));
  --dp-range-between-border-radius: 0;
  width: 20.5rem;
}

:deep(.dp__input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  height: 28px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  border-color: hsl(var(--border));
}

:deep(.dp__input:hover),
:deep(.dp__input:focus) {
  border-color: hsl(var(--ring));
}

:deep(.dp__menu) {
  font-size: 12px;
  z-index: 60;
}

:deep(.dp__action_row) {
  padding: 6px 8px;
}

:deep(.dp__action_buttons .dp__action_select) {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

:deep(.dp__action_cancel) {
  color: hsl(var(--muted-foreground));
}

:deep(.dp__preset_ranges) {
  max-height: 280px;
  overflow: auto;
  border-right: 1px solid hsl(var(--border));
  padding: 6px;
}

:deep(.dp__preset_range) {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

:deep(.dp__preset_range:hover) {
  background: hsl(var(--accent));
}
</style>
