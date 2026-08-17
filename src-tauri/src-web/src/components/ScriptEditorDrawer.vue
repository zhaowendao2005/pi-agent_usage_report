<template>
  <div class="fixed inset-0 z-50 flex items-center justify-end">
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/50 backdrop-blur-sm"
      @click="emit('close')"
    />

    <!-- Drawer -->
    <div
      class="relative bg-background border-l border-border h-full flex flex-col shadow-2xl animate-slide-in"
      :style="{ width: '70vw', maxWidth: '1200px' }"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h3 class="text-base font-semibold text-foreground">价格校准脚本</h3>
          <p class="text-xs text-muted-foreground mt-0.5">
            编辑 <span class="font-mono">{{ provider }}</span> 的自定义脚本
          </p>
        </div>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground transition-colors"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Editor Area -->
      <div class="flex-1 overflow-hidden">
        <textarea
          v-model="code"
          class="w-full h-full p-4 font-mono text-sm bg-background text-foreground border-0 focus:outline-none resize-none"
          placeholder="// 在此编写 JavaScript 脚本&#10;// 示例：&#10;const config = {&#10;  baseURL: 'https://api.example.com/v1',&#10;  apiKey: 'your-key-here',&#10;  timeout: 30000&#10;};&#10;&#10;function calculatePrice(usage) {&#10;  // usage: { inputTokens, outputTokens, cacheRead, cacheWrite }&#10;  const inputPrice = 0.01 / 1000;  // per token&#10;  const outputPrice = 0.03 / 1000;&#10;  return usage.inputTokens * inputPrice + usage.outputTokens * outputPrice;&#10;}&#10;&#10;export { config, calculatePrice };"
          spellcheck="false"
        />
      </div>

      <!-- Debug Output -->
      <div
        v-if="debugOutput"
        class="border-t border-border bg-muted/30 px-4 py-3 max-h-32 overflow-y-auto"
      >
        <div class="text-xs text-muted-foreground mb-1">调试输出：</div>
        <pre class="text-xs font-mono whitespace-pre-wrap" :class="debugError ? 'text-red-600' : 'text-green-600'">{{ debugOutput }}</pre>
      </div>

      <!-- Footer Actions -->
      <div class="flex items-center justify-between px-6 py-4 border-t border-border bg-card/50">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
            @click="runDebug"
          >
            🐛 调试
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
            @click="formatCode"
          >
            ✨ 格式化
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
            @click="insertTemplate"
          >
            📋 插入模板
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors text-red-600 hover:bg-red-50"
            @click="clearCode"
          >
            🗑️ 清空
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-4 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            type="button"
            class="px-4 py-1.5 text-xs bg-accent text-foreground rounded hover:bg-accent/80 transition-colors font-medium"
            @click="save"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
  provider: string
  initialScript: string
}>()

const emit = defineEmits<{
  close: []
  save: [provider: string, script: string]
}>()

const code = ref('')
const debugOutput = ref('')
const debugError = ref(false)

onMounted(() => {
  code.value = props.initialScript
})

function save() {
  emit('save', props.provider, code.value)
}

function clearCode() {
  if (confirm('确定要清空脚本吗？')) {
    code.value = ''
  }
}

function formatCode() {
  // Simple formatting (basic indentation fix)
  try {
    const lines = code.value.split('\n')
    let indent = 0
    const formatted = lines.map(line => {
      const trimmed = line.trim()
      if (trimmed.endsWith('}') || trimmed.endsWith('];') || trimmed.endsWith(');')) {
        indent = Math.max(0, indent - 1)
      }
      const result = '  '.repeat(indent) + trimmed
      if (trimmed.endsWith('{') || trimmed.endsWith('[') || trimmed.endsWith('(')) {
        indent++
      }
      return result
    }).join('\n')
    code.value = formatted
    debugOutput.value = '✓ 格式化成功'
    debugError.value = false
  } catch (err) {
    debugOutput.value = '✗ 格式化失败: ' + String(err)
    debugError.value = true
  }
}

function insertTemplate() {
  const template = `// 示例配置
const config = {
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY || 'your-key-here',
  timeout: 30000
};

// 价格计算函数
function calculatePrice(usage) {
  // usage: { inputTokens, outputTokens, cacheRead, cacheWrite }
  const inputPrice = 0.01 / 1000;   // per token
  const outputPrice = 0.03 / 1000;  // per token
  const cacheDiscount = 0.5;        // 50% 折扣
  
  const inputCost = usage.inputTokens * inputPrice;
  const cacheCost = usage.cacheRead * inputPrice * cacheDiscount;
  const outputCost = usage.outputTokens * outputPrice;
  
  return inputCost + cacheCost + outputCost;
}

// 导出配置
export { config, calculatePrice };`

  if (code.value && !confirm('当前有内容，确定要插入模板吗？')) {
    return
  }
  code.value = template
  debugOutput.value = '✓ 模板已插入'
  debugError.value = false
}

function runDebug() {
  debugOutput.value = ''
  debugError.value = false

  try {
    // Create a sandboxed execution context
    const logs: string[] = []
    const mockConsole = {
      log: (...args: any[]) => logs.push(args.map(a => String(a)).join(' ')),
      error: (...args: any[]) => logs.push('ERROR: ' + args.map(a => String(a)).join(' ')),
      warn: (...args: any[]) => logs.push('WARN: ' + args.map(a => String(a)).join(' ')),
    }

    // Test data
    const testUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheRead: 200,
      cacheWrite: 100
    }

    // Execute the script
    const fn = new Function('console', 'usage', `
      ${code.value}
      
      // Try to call calculatePrice if defined
      if (typeof calculatePrice === 'function') {
        const result = calculatePrice(usage);
        console.log('calculatePrice result:', result);
        return result;
      } else {
        console.warn('calculatePrice function not found');
        return null;
      }
    `)

    const result = fn(mockConsole, testUsage)

    let output = '✓ 执行成功\n\n'
    output += '测试数据:\n'
    output += JSON.stringify(testUsage, null, 2) + '\n\n'
    
    if (result !== null && result !== undefined) {
      output += '计算结果: $' + Number(result).toFixed(6) + '\n\n'
    }
    
    if (logs.length > 0) {
      output += '控制台输出:\n' + logs.join('\n')
    }

    debugOutput.value = output
    debugError.value = false
  } catch (err) {
    debugOutput.value = '✗ 执行失败:\n' + String(err)
    debugError.value = true
  }
}
</script>

<style scoped>
@keyframes slide-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.animate-slide-in {
  animation: slide-in 0.3s ease-out;
}
</style>
