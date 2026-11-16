/**
 * 与 HTTP 无关的小格式规则（R21 第一刀）。
 *
 * 从 `server.js` 搬出来的纯函数：文件名清理、路径比较、时间归一化、日志行数夹取、
 * 时间戳。它们原本只在整条路由里被间接覆盖，现在可以单独钉住边界。
 */
import { resolve } from 'node:path'

/** `YYYYMMDD-HHmmss`，用于导出文件名。 */
export function fileStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 日志导出行数：20–1500，非法值回落。 */
export function clampLogLines(value, fallback = 400) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1_500, Math.max(20, Math.round(n)))
}

/**
 * 桌面端工作区记录里的 updatedAt 可能是 Date、ISO 字符串或毫秒数；
 * 统一成毫秒数，避免手机端把工作区列表整段解析失败。
 */
export function toEpochMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : undefined
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const time = Date.parse(value)
    return Number.isFinite(time) ? time : undefined
  }
  return undefined
}

/** 同一路径判定：Windows 下大小写不敏感。 */
export function samePath(left, right) {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * 手机端提交的文件夹名：去掉 Windows 非法字符与控制字符，裁到 60 字。
 * 返回 null 表示不可用（空、`.`、`..`、或全是非法字符）。
 */
export function cleanFolderName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+$/g, '')
    .slice(0, 60)
    .trim()
  if (name === '' || name === '.' || name === '..') return null
  return name
}
