import { reactive } from 'vue'

export type MessageType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: number
  type: MessageType
  content: string
  duration: number
}

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  /** 危险操作（删除等）时按钮显示红色 */
  danger?: boolean
}

interface ConfirmState {
  show: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
}

/** 全局消息状态（模块级单例，可在任意位置导入使用） */
const toasts = reactive<ToastItem[]>([])
const confirmState = reactive<ConfirmState>({
  show: false,
  title: '确认',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})

let toastSeq = 0
let confirmResolve: ((value: boolean) => void) | null = null

function toast(content: string, type: MessageType = 'info', duration = 3000): number {
  const id = ++toastSeq
  toasts.push({ id, type, content, duration })
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration)
  }
  return id
}

function dismissToast(id: number) {
  const index = toasts.findIndex(t => t.id === id)
  if (index >= 0) toasts.splice(index, 1)
}

function success(content: string, duration?: number) {
  return toast(content, 'success', duration)
}

function error(content: string, duration?: number) {
  return toast(content, 'error', duration)
}

function info(content: string, duration?: number) {
  return toast(content, 'info', duration)
}

function warning(content: string, duration?: number) {
  return toast(content, 'warning', duration)
}

/** 弹出确认对话框，返回 Promise<boolean>（用户确认 → true，取消 → false） */
function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options

  confirmState.title = opts.title ?? '确认'
  confirmState.message = opts.message
  confirmState.confirmText = opts.confirmText ?? '确定'
  confirmState.cancelText = opts.cancelText ?? '取消'
  confirmState.danger = opts.danger ?? false
  confirmState.show = true

  return new Promise<boolean>(resolve => {
    confirmResolve = resolve
  })
}

/** 由 AppMessage.vue 调用，落定当前确认结果 */
function resolveConfirm(value: boolean) {
  confirmState.show = false
  confirmResolve?.(value)
  confirmResolve = null
}

export function useMessage() {
  return {
    toasts,
    confirmState,
    toast,
    success,
    error,
    info,
    warning,
    dismissToast,
    confirm,
    resolveConfirm,
  }
}