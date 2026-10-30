/**
 * 流式分片（SSE / JSON delta）聚合与还原工具。
 *
 * 背景：模型在 `tool_call` 阶段输出的是「JSON 参数字符串」的逐 token 切片，
 * 例如 `{"command": "cd \"$HOME\" && mv ..."}` 会被拆成
 * `\"$`、`f`、`.tmp`、`\"`、`&&`、`mv` … 这样的碎片。
 * 直接按碎片逐行渲染会得到「一列散落的转义符号」，本模块负责：
 *   1. 按 JSON 文档边界把碎片重新分组成一次工具调用；
 *   2. 对转义序列（\" \\ \n \uXXXX）做增量解码，得到可读文本；
 *   3. 兼容「流式中、JSON 尚未闭合」的中间态（容错解析，不抛异常）。
 */

export interface StreamChunkLike {
  seq: number
  phase: string
  text: string
}

export interface ToolCallField {
  key: string
  value: string
}

export interface ToolCallGroup {
  id: string
  fromSeq: number
  toSeq: number
  fragmentCount: number
  rawChars: number
  /** 原始碎片拼接（未解码转义） */
  raw: string
  /** JSON 是否已完整闭合且可解析 */
  complete: boolean
  args: Record<string, unknown> | null
  /** 展示用标题：Shell 命令 / 调用参数 / 流式片段 … */
  title: string
  /** 已解码、可直接成段展示的正文 */
  display: string
  /** 代码高亮语言提示（仅用于等宽呈现，不做真实高亮） */
  lang: 'bash' | 'json' | 'text'
  fields: ToolCallField[]
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/** 解码 JSON 字符串内的转义序列；容忍流式中途截断（孤立的反斜杠 / 半个 \uXXXX）。 */
export function decodeJsonEscapes(raw: string): string {
  if (!raw.includes('\\')) return raw
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[i + 1]
    if (next === undefined) break // 尾部孤立反斜杠：等下一个分片
    if (next === 'u') {
      const hex = raw.slice(i + 2, i + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16))
        i += 5
        continue
      }
      if (/^[0-9a-fA-F]{0,3}$/.test(hex)) break // 未完成的 \uXXXX
      out += next
      i += 1
      continue
    }
    const mapped = SIMPLE_ESCAPES[next]
    if (mapped !== undefined) {
      out += mapped
      i += 1
      continue
    }
    out += next
    i += 1
  }
  return out
}

interface JsonStringBody {
  value: string
  closed: boolean
  end: number
}

/** 从 `raw[start]`（指向开引号之后）读取一个 JSON 字符串体，返回已解码的 value。 */
function readJsonStringBody(raw: string, start: number): JsonStringBody {
  let i = start
  let value = ''
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\\') {
      const next = raw[i + 1]
      if (next === undefined) return { value, closed: false, end: i }
      if (next === 'u') {
        const hex = raw.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
        if (/^[0-9a-fA-F]{0,3}$/.test(hex)) return { value, closed: false, end: i }
        value += next
        i += 2
        continue
      }
      const mapped = SIMPLE_ESCAPES[next]
      value += mapped !== undefined ? mapped : next
      i += 2
      continue
    }
    if (ch === '"') return { value, closed: true, end: i + 1 }
    value += ch
    i += 1
  }
  return { value, closed: false, end: i }
}

const KEY_STRING_RE = /"([^"\\\n]{1,80})"\s*:\s*"/g
const KEY_SCALAR_RE = /"([^"\\\n]{1,80})"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)/g

/**
 * 容错提取 JSON 对象里的键值对。
 * 即使整体 JSON 尚未闭合（流式中），也能拿到已到达的字段，用于「边流边成段」。
 */
export function extractJsonFields(raw: string): { fields: ToolCallField[]; closed: boolean } {
  const fields: ToolCallField[] = []
  const seen = new Set<string>()
  let closed = false

  KEY_STRING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = KEY_STRING_RE.exec(raw)) !== null) {
    const key = m[1]
    const bodyStart = m.index + m[0].length
    const body = readJsonStringBody(raw, bodyStart)
    seen.add(key)
    const existed = fields.findIndex((f) => f.key === key)
    const field = { key, value: body.value }
    if (existed >= 0) fields[existed] = field
    else fields.push(field)
    // 已闭合的字符串可继续向后扫描下一个键；未闭合说明到了流式尾端
    if (!body.closed) break
    KEY_STRING_RE.lastIndex = body.end
  }

  KEY_SCALAR_RE.lastIndex = 0
  while ((m = KEY_SCALAR_RE.exec(raw)) !== null) {
    const key = m[1]
    if (seen.has(key)) continue
    seen.add(key)
    fields.push({ key, value: m[2] })
  }

  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed)
      closed = true
    } catch {
      closed = false
    }
  }
  return { fields, closed }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const DISPLAY_TITLES = new Map<string, { title: string; lang: 'bash' | 'json' | 'text' }>([
  ['bash', { title: 'Shell 命令', lang: 'bash' }],
  ['sh', { title: 'Shell 命令', lang: 'bash' }],
])

/** 历史会话重建格式：`[toolCall: name] {…args…}` */
const HISTORICAL_TOOL_RE = /^\[toolCall:\s*([^\]]+)\]\s*([\s\S]*)$/

const COMMAND_KEYS = ['command', 'cmd', 'script']
const TEXT_KEYS = ['content', 'newText', 'new_text', 'text', 'patch', 'diff']

function buildDisplay(
  args: Record<string, unknown> | null,
  fields: ToolCallField[],
  complete: boolean,
  raw: string,
): Pick<ToolCallGroup, 'display' | 'lang' | 'title'> {
  const map = new Map(fields.map((f) => [f.key, f.value]))

  for (const key of COMMAND_KEYS) {
    const value = map.get(key) ?? (args && typeof args[key] === 'string' ? (args[key] as string) : undefined)
    if (value && value.trim()) {
      const titled = DISPLAY_TITLES.get(key)
      return {
        display: value.replace(/\s+$/, ''),
        lang: titled?.lang ?? 'bash',
        title: titled?.title ?? 'Shell 命令',
      }
    }
  }

  for (const key of TEXT_KEYS) {
    const value = map.get(key) ?? (args && typeof args[key] === 'string' ? (args[key] as string) : undefined)
    if (value && value.trim()) return { display: value, lang: 'text', title: '文本内容' }
  }

  if (args) {
    const keys = Object.keys(args)
    if (keys.length === 1 && typeof args[keys[0]] === 'string') {
      return { display: String(args[keys[0]]), lang: 'text', title: '调用参数' }
    }
    return { display: JSON.stringify(args, null, 2), lang: 'json', title: '调用参数' }
  }

  if (fields.length > 0) {
    return {
      display: fields.map((f) => `${f.key}: ${f.value}`).join('\n'),
      lang: 'text',
      title: complete ? '调用参数' : '流式参数（未完成）',
    }
  }

  return {
    display: decodeJsonEscapes(raw),
    lang: 'text',
    title: complete ? '调用参数' : '流式片段',
  }
}

function makeGroup(
  id: string,
  fromSeq: number,
  toSeq: number,
  fragmentCount: number,
  raw: string,
): ToolCallGroup {
  // 历史会话存档：`[toolCall: read] {…}` 已经是完整记录，直接按工具名展示
  const historical = HISTORICAL_TOOL_RE.exec(raw.trim())
  if (historical) {
    const name = historical[1].trim()
    const body = historical[2].trim()
    const bodyArgs = tryParseJson(body)
    const bodyFields = extractJsonFields(body).fields
    return {
      id,
      fromSeq,
      toSeq,
      fragmentCount,
      rawChars: raw.length,
      raw,
      complete: true,
      args: bodyArgs,
      fields: bodyFields,
      title: `${name} 调用参数`,
      lang: bodyArgs ? 'json' : 'text',
      display: bodyArgs ? JSON.stringify(bodyArgs, null, 2) : body,
    }
  }

  const args = tryParseJson(raw)
  const { fields, closed } = extractJsonFields(raw)
  const complete = closed || args !== null
  const display = buildDisplay(args, fields, complete, raw)
  return {
    id,
    fromSeq,
    toSeq,
    fragmentCount,
    rawChars: raw.length,
    raw,
    complete,
    args,
    fields,
    ...display,
  }
}

/**
 * 把连续的 `tool_call` 碎片按 JSON 文档边界分组成一次工具调用，并还原为可读文本。
 * 非 tool_call 阶段会切断分组；JSON 一旦闭合，后续碎片自动开启新的一组。
 */
export function groupToolCallChunks(chunks: StreamChunkLike[]): ToolCallGroup[] {
  const groups: ToolCallGroup[] = []
  let buf: string[] = []
  let fromSeq = 0
  let toSeq = 0
  let count = 0

  const flush = () => {
    if (!buf.length) return
    const raw = buf.join('')
    groups.push(makeGroup(`tc-${fromSeq}-${toSeq}`, fromSeq, toSeq, count, raw))
    buf = []
    count = 0
  }

  for (const chunk of chunks) {
    if (chunk.phase !== 'tool_call') {
      flush()
      continue
    }
    if (buf.length > 0) {
      // 上一组 JSON 已闭合 → 当前碎片属于下一次调用
      const parsed = tryParseJson(buf.join(''))
      if (parsed !== null) flush()
    }
    if (buf.length === 0) fromSeq = chunk.seq
    toSeq = chunk.seq
    count += 1
    buf.push(chunk.text)
  }
  flush()

  return groups.filter((g) => g.raw.trim().length > 0)
}

/**
 * 把一段文本切成若干个「完整/半完整」的 JSON 文档。
 * 用于累计参数（多次 toolCall 拼接成 `{…}{…}`）以及被裁剪的分包残片。
 */
export function splitJsonDocuments(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (start < 0) {
      if (ch === '{' || ch === '[') {
        start = i
        depth = 1
        inString = false
        escaped = false
      }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth <= 0) {
        out.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  if (start >= 0) out.push(text.slice(start))
  return out
}

/**
 * 解析「整段」tool_call 参数（来自 collector 的 toolCallText，或历史会话重建的
 * `[toolCall: name] {...}` 文本），返回可直接成段渲染的分组。
 */
export function parseToolCallText(text: string): ToolCallGroup[] {
  const src = (text ?? '').trim()
  if (!src) return []

  // 历史会话格式：`[toolCall: read] {…}` 以空行分隔
  if (src.includes('[toolCall:')) {
    return src
      .split(/\n[ \t]*\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((part, idx) => makeGroup(`tc-hist-${idx}`, 0, 0, 0, part))
  }

  const docs = splitJsonDocuments(src)
  if (docs.length === 0) return [makeGroup('tc-text', 0, 0, 0, src)]
  const groups = docs.map((doc, idx) => makeGroup(`tc-doc-${idx}`, 0, 0, 0, doc))
  // 分包被裁剪时可能残留「半截 JSON + 完整 JSON」，保留前半截，避免丢信息
  const firstDocAt = src.search(/[{[]/)
  if (firstDocAt > 0) {
    const prefix = src.slice(0, firstDocAt).trim()
    if (prefix) groups.unshift(makeGroup('tc-prefix', 0, 0, 0, prefix))
  }
  return groups
}

export type StreamBlockKind = 'thinking' | 'text' | 'tool_call'

export interface StreamBlock {
  key: string
  kind: StreamBlockKind
  text: string
  chars: number
  fromSeq: number
  toSeq: number
  fragmentCount: number
  /** 无分包日志时由累计文本合成 */
  synthetic: boolean
}

function toBlockKind(phase: string): StreamBlockKind {
  if (phase === 'thinking') return 'thinking'
  if (phase === 'tool_call') return 'tool_call'
  return 'text'
}

function makeBlock(
  kind: StreamBlockKind,
  text: string,
  fromSeq: number,
  toSeq: number,
  fragmentCount: number,
  synthetic: boolean,
): StreamBlock {
  return {
    key: `${kind}-${fromSeq}-${toSeq}-${fragmentCount}-${synthetic ? 's' : 'r'}`,
    kind,
    text,
    chars: text.length,
    fromSeq,
    toSeq,
    fragmentCount,
    synthetic,
  }
}

/** 按到达顺序把连续同阶段的 delta 合并为一段（不重排、不跨段合并）。 */
export function mergeChunksIntoBlocks(chunks: StreamChunkLike[]): StreamBlock[] {
  const blocks: StreamBlock[] = []
  let current: StreamBlock | null = null
  for (const chunk of chunks) {
    const kind = toBlockKind(chunk.phase)
    if (current && current.kind === kind) {
      current.text += chunk.text
      current.chars = current.text.length
      current.toSeq = chunk.seq
      current.fragmentCount += 1
      continue
    }
    current = makeBlock(kind, chunk.text, chunk.seq, chunk.seq, 1, false)
    blocks.push(current)
  }
  return blocks
}

/**
 * 生成渲染用的有序段落列表，**严格保持分片到达顺序**（thinking / text / tool_call 三者可交错）。
 *
 * 数据优先级：
 *   1. `blocks`：collector 维护的顺序日志（不受 200 条分包裁剪影响），最准确；
 *   2. `chunks`：最近若干条分包，阶段顺序仍准确，但可能缺开头；
 *   3. 无日志时由 accumulatedText / thinkingText 合成。
 */
export function resolveStreamBlocks(input: {
  blocks?: StreamChunkLike[] | null
  chunks?: StreamChunkLike[] | null
  accumulatedText?: string
  thinkingText?: string
}): StreamBlock[] {
  const accumulatedText = input.accumulatedText ?? ''
  const thinkingText = input.thinkingText ?? ''
  const blockLog = input.blocks ?? []
  const chunkList = input.chunks ?? []
  const usingChunks = blockLog.length === 0 && chunkList.length > 0
  const result = mergeChunksIntoBlocks(blockLog.length > 0 ? blockLog : chunkList)

  // 完全没有记录（历史会话 / 旧版本插件）时用累计文本按「思考 → 正文」合成
  if (result.length === 0) {
    if (thinkingText) result.push(makeBlock('thinking', thinkingText, 0, 0, 0, true))
    if (accumulatedText) result.push(makeBlock('text', accumulatedText, 0, 0, 0, true))
    return result
  }

  if (!usingChunks) return result

  // 分包回退：只有最近 200 条，正文可能被裁掉或被截断，用累计正文补齐。
  // 注意：仅在没有工具调用交错时才用累计正文替换（否则会破坏先后顺序）。
  const textBlocks = result.filter((b) => b.kind === 'text')
  const hasTool = result.some((b) => b.kind === 'tool_call')
  if (
    textBlocks.length === 1 &&
    !hasTool &&
    accumulatedText.length > textBlocks[0].text.length
  ) {
    const idx = result.indexOf(textBlocks[0])
    result[idx] = { ...textBlocks[0], text: accumulatedText, chars: accumulatedText.length, synthetic: true }
  } else if (textBlocks.length === 0 && accumulatedText) {
    const firstTool = result.findIndex((b) => b.kind === 'tool_call')
    const insertAt = firstTool >= 0 ? firstTool : result.length
    result.splice(insertAt, 0, makeBlock('text', accumulatedText, 0, 0, 0, true))
  }
  if (thinkingText && !result.some((b) => b.kind === 'thinking')) {
    result.unshift(makeBlock('thinking', thinkingText, 0, 0, 0, true))
  }
  return result
}

/**
 * 把一段长文本按空行切分成「段」，用于成段渲染（保留段内换行）。
 * 最多返回 `maxParagraphs` 段，超出部分合并进最后一段，避免极长文本产生海量节点。
 */
export function splitParagraphs(text: string, maxParagraphs = 120): string[] {
  if (!text) return []
  const parts = text.split(/\n[ \t]*\n+/).filter((p) => p.trim().length > 0)
  if (parts.length <= maxParagraphs) return parts
  return [...parts.slice(0, maxParagraphs - 1), parts.slice(maxParagraphs - 1).join('\n\n')]
}
