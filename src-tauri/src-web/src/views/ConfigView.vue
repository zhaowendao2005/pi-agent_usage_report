<template>
  <div class="space-y-4">
    <div class="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground text-sm">
      <p class="mb-2 text-2xl">⚙️</p>
      <p>配置面板 — 可在此设置 API Key、数据源、告警阈值等</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 class="text-sm font-semibold text-foreground">告警阈值</h3>
        <div v-for="item in thresholds" :key="item.label" class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">{{ item.label }}</span>
          <div class="flex items-center gap-2">
            <input
              v-model="item.value"
              type="number"
              class="w-24 bg-background border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span class="text-muted-foreground">{{ item.unit }}</span>
          </div>
        </div>
      </div>
      <div class="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 class="text-sm font-semibold text-foreground">图表性能与 LOD 优化</h3>
        <div class="space-y-3 text-xs">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-foreground">自适应视口 LOD 降采样</div>
              <div class="text-muted-foreground text-[11px] mt-0.5">大跨度全景聚合为 ~100 点，放大视口时自动无缝还原原始点</div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                :checked="lodEnabled"
                @change="setLodEnabled(($event.target as HTMLInputElement).checked)"
                class="sr-only peer"
              />
              <div class="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-border/50">
            <div>
              <div class="font-medium text-foreground">开启 LOD 调试日志 (Console Log)</div>
              <div class="text-muted-foreground text-[11px] mt-0.5">在开发者控制台实时输出视口缩放范围、分桶点数与耗时</div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                :checked="logEnabled"
                @change="setLogEnabled(($event.target as HTMLInputElement).checked)"
                class="sr-only peer"
              />
              <div class="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      </div>
      <div class="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 class="text-sm font-semibold text-foreground">数据源</h3>
        <div class="text-xs text-muted-foreground space-y-2">
          <div class="flex items-center justify-between">
            <span>数据端点</span>
            <span class="font-mono text-foreground">Tauri invoke / SQLite</span>
          </div>
          <div class="flex items-center justify-between">
            <span>数据文件</span>
            <span class="font-mono text-green-600">~/.pi/agent/usage.db</span>
          </div>
          <div class="flex items-center justify-between">
            <span>UI 配置</span>
            <span class="font-mono text-green-600">~/.pi/agent/usage_config.yaml</span>
          </div>
          <div class="flex items-center justify-between">
            <span>壳</span>
            <span class="flex items-center gap-1 text-green-600">
              <span class="w-1.5 h-1.5 rounded-full bg-green-500" />
              Tauri 2 + WebView2
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const store = useUsageStore()
const { lodEnabled, logEnabled } = storeToRefs(store)
const { setLodEnabled, setLogEnabled } = store

const thresholds = reactive([
  { label: '输入 Token / 请求', value: 100000, unit: 'tokens' },
  { label: '输出 Token / 请求', value: 50000,  unit: 'tokens' },
  { label: '单次费用上限',       value: 1,      unit: 'USD' },
  { label: '缓存命中率警告线',   value: 20,     unit: '%' },
])
</script>
