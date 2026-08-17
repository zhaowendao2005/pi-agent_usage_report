<template>
  <div class="space-y-4">
    <div class="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground text-sm">
      <p class="mb-2 text-2xl">⚙️</p>
      <p>配置面板 — 可在此设置 API Key、数据源、告警阈值、中转站与鉴权等</p>
    </div>

    <!-- ===== 鉴权（中转站 + Edge 登录态）===== -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- 中转站地址 -->
      <div class="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 class="text-sm font-semibold text-foreground">中转站地址</h3>
        <p class="text-[11px] text-muted-foreground leading-relaxed">
          访问需登录的中转站 API 基地址，脚本将基于该地址发起请求；
          配合下方「Edge 登录态」使用浏览器 cookie 完成鉴权。
        </p>
        <div class="flex items-center gap-2">
          <input
            v-model="relayInput"
            type="text"
            placeholder="https://relay.example.com/v1"
            class="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded bg-accent text-foreground hover:bg-accent/80 transition-colors disabled:opacity-50"
            :disabled="auth.loading || !relayInput.trim()"
            @click="onSaveRelay"
          >
            保存
          </button>
        </div>
      </div>

      <!-- 鉴权状态：配置是否登录 -->
      <div class="bg-card border border-border rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-foreground">鉴权状态</h3>
          <span class="flex items-center gap-1.5 text-xs font-medium" :class="statusMeta.color">
            <span
              class="w-2 h-2 rounded-full"
              :class="[statusMeta.dot, { 'animate-pulse': auth.authStatus === 'logged_in' }]"
            />
            {{ statusMeta.label }}
          </span>
        </div>

        <!-- 配置是否登录（手动控制） -->
        <div class="flex items-center justify-between text-xs">
          <div>
            <div class="font-medium text-foreground">启用 Edge 登录态</div>
            <div class="text-muted-foreground text-[11px] mt-0.5">
              手动控制 · 使用用户 Edge profile 的登录 cookie 访问中转站
            </div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              :checked="auth.edgeAuthEnabled"
              :disabled="auth.loading"
              @change="onToggleEnabled(($event.target as HTMLInputElement).checked)"
              class="sr-only peer"
            />
            <div class="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <!-- 状态明细 -->
        <div class="text-[11px] text-muted-foreground space-y-1 border-t border-border/50 pt-2">
          <div class="flex items-center justify-between gap-2">
            <span class="shrink-0">中转站地址</span>
            <span class="font-mono text-foreground truncate">{{ auth.relayUrl || '未设置' }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="shrink-0">调试端口</span>
            <span class="font-mono text-foreground">{{ auth.bridgePort ?? '—' }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="shrink-0">状态说明</span>
            <span class="text-right truncate">{{ auth.message || '—' }}</span>
          </div>
        </div>

        <!-- 手动操作 -->
        <div class="flex items-center gap-2 pt-1">
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!auth.edgeAuthEnabled || auth.loading || auth.authStatus === 'logged_in'"
            @click="onConnect"
          >
            连接 Edge
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!auth.edgeAuthEnabled || auth.loading || auth.authStatus === 'logged_in'"
            @click="onMarkLoggedIn"
          >
            标记已登录
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!auth.edgeAuthEnabled || auth.loading || auth.authStatus === 'off' || auth.authStatus === 'disconnected'"
            @click="onDisconnect"
          >
            断开
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="auth.loading"
            @click="onRefresh"
          >
            {{ auth.loading ? '刷新中...' : '刷新状态' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ===== 原有配置 ===== -->
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
            <span>鉴权配置</span>
            <span class="font-mono text-green-600">~/.pi/agent/auth.db</span>
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
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import { useAuthStore, AUTH_STATUS_META } from '@/stores/auth'
import { useMessage } from '@/lib/message'

const store = useUsageStore()
const { lodEnabled, logEnabled } = storeToRefs(store)
const { setLodEnabled, setLogEnabled } = store

const auth = useAuthStore()
const message = useMessage()
const relayInput = ref('')

const statusMeta = computed(
  () => AUTH_STATUS_META[auth.authStatus] ?? AUTH_STATUS_META.off,
)

onMounted(async () => {
  await auth.load()
  relayInput.value = auth.relayUrl
})

async function onSaveRelay() {
  try {
    await auth.saveRelayUrl(relayInput.value)
    relayInput.value = auth.relayUrl
    message.success('中转站地址已保存')
  } catch (e) {
    message.error(`保存失败: ${e}`)
  }
}

async function onToggleEnabled(v: boolean) {
  try {
    await auth.setEnabled(v)
    message.success(v ? '已启用 Edge 登录态' : '已关闭 Edge 登录态')
  } catch (e) {
    message.error(`操作失败: ${e}`)
  }
}

async function onConnect() {
  try {
    await auth.connect()
    message.success('已连接 Edge 调试通道')
  } catch (e) {
    message.error(`连接失败: ${e}`)
  }
}

async function onMarkLoggedIn() {
  try {
    await auth.markLoggedIn()
    message.success('已标记为登录状态')
  } catch (e) {
    message.error(`操作失败: ${e}`)
  }
}

async function onDisconnect() {
  try {
    await auth.disconnect()
    message.success('已断开')
  } catch (e) {
    message.error(`断开失败: ${e}`)
  }
}

async function onRefresh() {
  try {
    await auth.refreshStatus()
  } catch (e) {
    message.error(`刷新失败: ${e}`)
  }
}

const thresholds = reactive([
  { label: '输入 Token / 请求', value: 100000, unit: 'tokens' },
  { label: '输出 Token / 请求', value: 50000,  unit: 'tokens' },
  { label: '单次费用上限',       value: 1,      unit: 'USD' },
  { label: '缓存命中率警告线',   value: 20,     unit: '%' },
])
</script>