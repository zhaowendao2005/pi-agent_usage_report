<template>
  <div class="fixed inset-0 z-50 flex items-center justify-end">
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/50 backdrop-blur-sm"
      @click="emit('close')"
    />

    <!-- Drawer -->
    <div
      class="relative bg-background border-l border-border h-full flex flex-col shadow-2xl animate-slide-in transition-all duration-300 ease-in-out"
      :style="{ width: showAgent ? '90vw' : '70vw', maxWidth: showAgent ? '1600px' : '1200px' }"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h3 class="text-base font-semibold text-foreground">价格校准脚本</h3>
          <p class="text-xs text-muted-foreground mt-0.5">
            编辑 <span class="font-mono">{{ provider }}</span> 的自定义脚本
          </p>
        </div>
        <div class="flex items-center gap-3">
          <!-- AI Agent Toggle Button -->
          <button
            type="button"
            class="text-muted-foreground hover:text-accent hover:bg-muted/50 transition-all p-1.5 rounded-lg flex items-center justify-center border border-transparent"
            :class="{ 'text-accent bg-accent/10 border-accent/20': showAgent }"
            title="AI 价格计算助手"
            @click="toggleAgent"
          >
            <!-- Cloud rounded-corner SVG icon -->
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.48 0-.96.06-1.4.17A5.5 5.5 0 0 0 4.5 13a4 4 0 0 0 .5 7.87Z" />
            </svg>
          </button>

          <button
            type="button"
            class="text-muted-foreground hover:text-foreground transition-colors p-1"
            @click="emit('close')"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Main Content Row -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Left: Code Editor and Actions -->
        <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
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
                class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors inline-flex items-center gap-1.5"
                @click="runDebug"
              >
                <BugIcon class="w-3.5 h-3.5 shrink-0" />
                调试
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors inline-flex items-center gap-1.5"
                @click="formatCode"
              >
                <SparklesIcon class="w-3.5 h-3.5 shrink-0" />
                格式化
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors inline-flex items-center gap-1.5"
                @click="insertTemplate"
              >
                <ClipboardListIcon class="w-3.5 h-3.5 shrink-0" />
                插入模板
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
                @click="clearCode"
              >
                <Trash2Icon class="w-3.5 h-3.5 shrink-0" />
                清空
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

        <!-- Right: Agent Sub-drawer -->
        <div
          v-if="showAgent"
          class="w-[400px] border-l border-border flex flex-col h-full bg-card animate-slide-in-right relative shrink-0"
        >
          <!-- Agent Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-accent/15 text-accent">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.48 0-.96.06-1.4.17A5.5 5.5 0 0 0 4.5 13a4 4 0 0 0 .5 7.87Z" />
                </svg>
              </div>
              <div>
                <h4 class="text-xs font-semibold text-foreground">AI 价格计算助手</h4>
                <p class="text-[10px] text-muted-foreground">帮您快速定制并优化价格校准脚本</p>
              </div>
            </div>
            
            <div class="flex items-center gap-1.5">
              <!-- Clear chat history button -->
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50 transition-colors"
                title="清空聊天记录"
                @click="clearChat"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              
              <!-- Close Agent Panel button -->
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50 transition-colors"
                title="关闭助手"
                @click="showAgent = false"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Chat Messages Area -->
          <div
            ref="chatMessagesRef"
            class="flex-1 overflow-y-auto p-4 space-y-4"
          >
            <div
              v-for="msg in messages"
              :key="msg.id"
              class="flex flex-col gap-1"
              :class="msg.role === 'user' ? 'items-end' : 'items-start'"
            >
              <!-- Avatar + Username + Time -->
              <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1" :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'">
                <span class="font-medium" :class="msg.role === 'user' ? 'text-foreground' : 'text-accent'">
                  {{ msg.role === 'user' ? '您' : 'AI 助手' }}
                </span>
                <span>•</span>
                <span>{{ msg.timestamp }}</span>
              </div>
              
              <!-- Message bubble -->
              <div
                class="max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed"
                :class="msg.role === 'user' 
                  ? 'bg-accent text-accent-foreground rounded-tr-none' 
                  : 'bg-muted/60 text-foreground rounded-tl-none border border-border/40'"
              >
                <!-- Rendered Html Content -->
                <div v-html="formatMessage(msg.content)" class="space-y-1 break-words max-w-none"></div>
                
                <!-- If contains code snippet, show recommendation and "Apply Code" button -->
                <div v-if="msg.codeSnippet" class="mt-3 p-2.5 rounded-lg bg-background/85 border border-border/70 flex flex-col gap-2 shadow-inner">
                  <div class="flex items-center justify-between text-[10px] font-mono border-b border-border/60 pb-1 text-muted-foreground">
                    <span class="flex items-center gap-1">
                      <svg class="w-3 h-3 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                      推荐代码
                    </span>
                    <button
                      type="button"
                      class="px-2 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-medium border border-accent/20"
                      @click="applyCode(msg.codeSnippet)"
                    >
                      应用代码
                    </button>
                  </div>
                  <pre class="text-[10px] font-mono max-h-48 overflow-y-auto bg-black/5 p-1.5 rounded text-foreground/90 whitespace-pre scrollbar-thin">{{ msg.codeSnippet }}</pre>
                </div>
              </div>
            </div>
            
            <!-- Typing Indicator -->
            <div v-if="isTyping" class="flex flex-col gap-1 items-start">
              <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
                <span class="font-medium text-accent">AI 助手</span>
                <span>•</span>
                <span>正在输入...</span>
              </div>
              <div class="bg-muted/60 text-muted-foreground rounded-2xl rounded-tl-none border border-border/40 px-4 py-2.5 text-xs flex items-center gap-1">
                <span class="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                <span class="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                <span class="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
              </div>
            </div>
          </div>

          <!-- Chat Input Area -->
          <div class="p-3 border-t border-border bg-muted/10 flex flex-col gap-2">
            <!-- Model Selector Row -->
            <div class="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
              <span class="flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                已连接 AI 服务
              </span>
              
              <!-- Model Selector Dropdown -->
              <div ref="modelMenuContainer" class="relative">
                <button
                  ref="modelTriggerRef"
                  type="button"
                  class="flex items-center gap-1.5 px-2 py-1 rounded bg-background border border-border hover:bg-muted transition-colors text-foreground text-[10px] font-medium shadow-sm"
                  @click.stop="toggleModelMenu"
                >
                  <span class="text-accent">⚡</span>
                  {{ selectedModel }}
                  <svg class="w-3 h-3 text-muted-foreground transition-transform" :class="{ 'rotate-180': showModelMenu }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                <!-- Dropdown Popover (teleported to body) -->
                <Teleport to="body">
                  <div
                    v-if="showModelMenu"
                    class="fixed z-[70] w-44 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg py-1 animate-in fade-in slide-in-from-bottom-2 duration-150"
                    :style="modelMenuStyle"
                    @click.stop
                  >
                    <div class="px-2 py-1 text-[9px] font-semibold text-muted-foreground border-b border-border/50 mb-1">选择 AI 模型</div>
                    <button
                      v-for="model in availableModels"
                      :key="model.value"
                      type="button"
                      class="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-muted/80 flex items-center justify-between transition-colors"
                      :class="{ 'text-accent bg-accent/5 font-semibold': selectedModel === model.label }"
                      @click="selectModel(model)"
                    >
                      <span>{{ model.label }}</span>
                      <span v-if="selectedModel === model.label" class="text-accent text-[10px]">✓</span>
                    </button>
                  </div>
                </Teleport>
              </div>
            </div>

            <form @submit.prevent="sendMessage" class="relative flex items-center bg-background rounded-lg border border-border focus-within:ring-1 focus-within:ring-accent transition-all overflow-hidden pl-1 pr-1.5 py-1">
              <input
                v-model="userInput"
                type="text"
                placeholder="在此输入您的问题..."
                class="flex-1 bg-transparent px-2.5 py-1.5 text-xs text-foreground focus:outline-none min-w-0"
                @keydown.enter.prevent="sendMessage"
              />
              <button
                type="submit"
                class="p-1.5 rounded-md bg-accent text-accent-foreground hover:bg-accent/90 transition-all shrink-0 inline-flex items-center justify-center"
                :disabled="!userInput.trim() || isTyping"
              >
                <!-- Send SVG Icon -->
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import {
  BugIcon,
  ClipboardListIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { useMessage } from '@/lib/message'

const message = useMessage()

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

// AI Agent State
const showAgent = ref(false)
const userInput = ref('')
const isTyping = ref(false)
const chatMessagesRef = ref<HTMLElement | null>(null)

// Model Selector State
const showModelMenu = ref(false)
const selectedModel = ref('DeepSeek-Chat')
const modelMenuContainer = ref<HTMLElement | null>(null)
const modelTriggerRef = ref<HTMLElement | null>(null)
const modelMenuStyle = ref({ right: '0px', bottom: '0px' })

const availableModels = [
  { value: 'deepseek-chat', label: 'DeepSeek-Chat' },
  { value: 'deepseek-coder', label: 'DeepSeek-Coder' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
]

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  codeSnippet?: string
}

const messages = ref<Message[]>([
  {
    id: '1',
    role: 'assistant',
    content: `你好！我是你的 **AI 价格脚本助手** ☁️。
我可以帮助你为 **${props.provider || '当前 Provider'}** 编写、优化或重构价格校准脚本。

你可以尝试问我：
1. "如何为这个服务商编写一个基础的计费脚本？"
2. "如何实现基于缓存读取（Cache Read）的优惠折扣？"
3. "怎么处理阶梯价格（Tiered Pricing）？"`,
    timestamp: new Date(Date.now() - 500000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  },
  {
    id: '2',
    role: 'user',
    content: '能给我一个包含缓存折扣和阶梯优惠的模板吗？',
    timestamp: new Date(Date.now() - 400000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  },
  {
    id: '3',
    role: 'assistant',
    content: `没问题！这里有一个为 **${props.provider || '当前 Provider'}** 量身定制的高级计费脚本模板。

该脚本包含：
- **基础 Token 计费**：输入 $0.01/1k，输出 $0.03/1k
- **缓存命中折价**：缓存读取（Cache Read）享受 50% 折扣
- **阶梯优惠**：如果总 Token 数量较大，给予相应比例 of 折扣

你可以直接点击下方的 **"应用代码"** 按钮，将此模板一键同步到左侧编辑器中。`,
    codeSnippet: `// ${props.provider || '当前'} 自定义价格校准脚本
const config = {
  baseURL: 'https://api.example.com/v1',
  apiKey: 'your-key-here',
  timeout: 30000
};

/**
 * 价格计算函数
 * @param {Object} usage - 使用量数据
 * @param {number} usage.inputTokens - 输入 token 数
 * @param {number} usage.outputTokens - 输出 token 数
 * @param {number} usage.cacheRead - 缓存读取 token 数
 * @param {number} usage.cacheWrite - 缓存写入 token 数
 */
function calculatePrice(usage) {
  const inputPrice = 0.01 / 1000;   // 每 1000 token $0.01
  const outputPrice = 0.03 / 1000;  // 每 1000 token $0.03
  const cacheDiscount = 0.5;        // 缓存命中 5 折优惠
  
  // 1. 计算基础输入输出成本
  const inputCost = usage.inputTokens * inputPrice;
  const outputCost = usage.outputTokens * outputPrice;
  
  // 2. 缓存读取优惠计算
  const cacheCost = usage.cacheRead * inputPrice * cacheDiscount;
  
  let totalCost = inputCost + cacheCost + outputCost;
  
  // 3. 额外阶梯优惠（若总 Token 消耗 > 1,000,000，享受 9 折）
  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (totalTokens > 1000000) {
    totalCost *= 0.9;
  }
  
  return totalCost;
}

export { config, calculatePrice };`,
    timestamp: new Date(Date.now() - 300000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
])

onMounted(() => {
  code.value = props.initialScript
  window.addEventListener('click', closeModelMenu)
})

onUnmounted(() => {
  window.removeEventListener('click', closeModelMenu)
})

function closeModelMenu(e: MouseEvent) {
  if (modelMenuContainer.value && !modelMenuContainer.value.contains(e.target as Node)) {
    showModelMenu.value = false
  }
}

function toggleModelMenu() {
  if (!showModelMenu.value) {
    // Position the teleported popover relative to the trigger button
    const rect = modelTriggerRef.value?.getBoundingClientRect()
    if (rect) {
      modelMenuStyle.value = {
        right: `${window.innerWidth - rect.right}px`,
        bottom: `${window.innerHeight - rect.top + 6}px`, // 6px gap above trigger
      }
    }
  }
  showModelMenu.value = !showModelMenu.value
}

function selectModel(model: { value: string; label: string }) {
  selectedModel.value = model.label
  showModelMenu.value = false
  
  messages.value.push({
    id: Date.now().toString(),
    role: 'assistant',
    content: `已成功为您切换至 **${model.label}** 智能引擎 🚀。
我会基于当前模型的能力为您提供更具有针对性、更高效的自定义脚本编写和代码审查建议！`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })
  scrollToBottom()
}

function save() {
  emit('save', props.provider, code.value)
}

function toggleAgent() {
  showAgent.value = !showAgent.value
  if (showAgent.value) {
    scrollToBottom()
  }
}

async function clearChat() {
  const ok = await message.confirm({
    title: '清空聊天历史',
    message: '确定要清空与 AI 助手的全部聊天记录吗？',
    confirmText: '清空',
    cancelText: '取消',
    danger: true,
  })
  if (ok) {
    messages.value = [
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: `你好！我是你的 **AI 价格脚本助手** ☁️。
你已清空历史，可以随时向我提问关于自定义脚本的任何问题。例如：“如何计算缓存读取优惠？”`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatMessagesRef.value) {
      chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight
    }
  })
}

async function applyCode(snippet: string) {
  if (code.value) {
    const ok = await message.confirm({
      title: '应用推荐代码',
      message: '确定要将 AI 推荐的代码应用到编辑器吗？这会覆盖当前编辑区的所有内容。',
      confirmText: '应用',
      cancelText: '取消',
    })
    if (!ok) return
  }
  code.value = snippet
  debugOutput.value = `✓ 已应用 AI 助手（基于 ${selectedModel.value}）推荐的脚本代码`
  debugError.value = false
}

function formatMessage(content: string) {
  let escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Replace code blocks: ```javascript\n(.*?)\n``` or ```(.*?)```
  escaped = escaped.replace(/```(?:javascript|js|json)?\n([\s\S]*?)```/g, '<pre class="bg-black/10 p-2 rounded border border-border text-xs font-mono my-2 overflow-x-auto whitespace-pre">$1</pre>')

  // Replace inline code: `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted font-mono text-[11px] text-accent border border-border/50 font-bold">$1</code>')

  // Replace bold: **text**
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-foreground">$1</strong>')

  // Replace newlines
  escaped = escaped.replace(/\n/g, '<br>')

  return escaped
}

function sendMessage() {
  if (!userInput.value.trim() || isTyping.value) return
  
  const userText = userInput.value.trim()
  messages.value.push({
    id: Date.now().toString(),
    role: 'user',
    content: userText,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })
  userInput.value = ''
  
  isTyping.value = true
  scrollToBottom()
  
  // Simulate AI response
  setTimeout(() => {
    isTyping.value = false
    
    let replyContent = ''
    let replyCode = ''
    
    const text = userText.toLowerCase()
    if (text.includes('格式') || text.includes('format')) {
      replyContent = `您可以点击左下角 **"格式化"** 按钮进行自动排布。
或者您也可以直接将复杂的逻辑交给我（${selectedModel.value}），我会为您优化缩进、提取冗余配置项并确保代码整洁规范。`
    } else if (text.includes('阶梯') || text.includes('优惠') || text.includes('tier') || text.includes('discount')) {
      replyContent = `我是您的助手 ${selectedModel.value}。针对复杂的**阶梯计费优惠**需求，我强烈建议您使用如下代码结构：`
      replyCode = `function calculatePrice(usage) {
  const total = usage.inputTokens;
  let cost = 0;
  
  // 基于用量的阶梯式价格累进（单位：每百万 Tokens 的单价）
  if (total <= 1000000) {
    cost += total * (10 / 1000000); // 10 美元/百万 tokens
  } else if (total <= 5000000) {
    cost += 1000000 * (10 / 1000000) + (total - 1000000) * (8 / 1000000); // 8 美元/百万 tokens
  } else {
    cost += 1000000 * (10 / 1000000) + 4000000 * (8 / 1000000) + (total - 5000000) * (6 / 1000000); // 6 美元/百万 tokens
  }
  
  return cost + usage.outputTokens * (15 / 1000000);
}`
    } else if (text.includes('清除') || text.includes('清空') || text.includes('clear')) {
      replyContent = `如果您想整理对话窗口，直接点击右上角清空聊天历史 🧹 即可。这能帮助我快速遗忘之前的上下文，从而更好地解答新任务！`
    } else if (text.includes('调试') || text.includes('bug') || text.includes('debug')) {
      replyContent = `在左侧编辑器下方点击 **"调试"** 按钮即可通过沙箱直接验证您的计算函数。
作为 ${selectedModel.value}，我的分析表面，目前常见的逻辑 Bug 主要是未做 null 检查和 Token 数量精度丢失，建议您在计算前对 inputTokens、outputTokens 赋默认值 0，如：\`const input = usage.inputTokens || 0;\``
    } else {
      replyContent = `收到！使用 **${selectedModel.value}** 引擎为您分析中。针对您提出的 \`"${userText}"\`，我已经结合 \`${props.provider}\` 的服务机制做了评估。

通常情况下，一个健壮的计算逻辑可以采用如下形式封装：
\`\`\`javascript
function calculatePrice(usage) {
  // ${selectedModel.value} 推荐写法
  const inputRate = 0.01 / 1000;
  const outputRate = 0.03 / 1000;
  return (usage.inputTokens || 0) * inputRate + (usage.outputTokens || 0) * outputRate;
}
\`\`\`
请继续告诉我您服务商的更具体的阶梯折扣或者时段，我来实时帮您补全！`
    }
    
    messages.value.push({
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: replyContent,
      codeSnippet: replyCode || undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    })
    
    scrollToBottom()
  }, 1200)
}

async function clearCode() {
  const ok = await message.confirm({
    title: '清空脚本',
    message: '确定要清空脚本吗？',
    confirmText: '清空',
    cancelText: '取消',
    danger: true,
  })
  if (ok) {
    code.value = ''
    debugOutput.value = ''
    debugError.value = false
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

async function insertTemplate() {
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

  if (code.value) {
    const ok = await message.confirm({
      title: '插入模板',
      message: '当前有内容，确定要插入模板吗？插入后将覆盖现有脚本。',
      confirmText: '插入',
      cancelText: '取消',
    })
    if (!ok) return
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

@keyframes slide-in-right {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.animate-slide-in-right {
  animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Custom scrollbar to look sleek */
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 2px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground));
}
</style>
