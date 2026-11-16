/**
 * prompt / 标题 / 时区 的校验规则（R21 第一刀：把 server.js 里的纯规则搬出来）。
 *
 * 这些函数只依赖入参与常量，不碰 req/res，也不碰宿主——搬出 server.js 之后可以直接
 * 用单测钉住「多少张图、多大、什么 base64 才算合法」，不必每次都起一个 HTTP 服务。
 * 错误仍然抛 `BridgeError`，错误码与 HTTP 状态保持原样，调用方不需要改。
 */
import { BridgeError } from '../auth.js'

export const MAX_PROMPT_CHARS = 20_000
export const MAX_TITLE_CHARS = 200
export const MAX_IMAGES = 4
export const MAX_IMAGE_BYTES = 8_388_608
export const MAX_IMAGE_TOTAL_BYTES = 16_777_216
export const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** 只保留合法的 IANA 时区名；非法值直接丢掉（不让它把整次派发搞失败）。 */
export function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return undefined
  }
}

/**
 * 把 `{text, images}` 拼成宿主 prompt 的 content 数组。
 * 文本可以为空（纯图片），但整体不能既没文本也没图片——那个判断在路由里。
 */
export function promptContent(text, images) {
  const content = []
  if (text !== '') content.push({ type: 'text', text })
  if (images === undefined) return content
  if (!Array.isArray(images)) throw new BridgeError('prompt/image-invalid', '图片格式不正确', 400)
  if (images.length > MAX_IMAGES) throw new BridgeError('prompt/too-many-images', `最多发送 ${MAX_IMAGES} 张图片`, 400)
  let total = 0
  for (const image of images) {
    if (image === null || typeof image !== 'object') throw new BridgeError('prompt/image-invalid', '图片格式不正确', 400)
    const mediaType = image.mediaType
    if (typeof mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(mediaType)) {
      throw new BridgeError('prompt/image-invalid', '只支持 PNG、JPEG、WebP 或 GIF 图片', 400)
    }
    const data = image.data
    if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new BridgeError('prompt/image-invalid', '图片数据不是合法的 base64', 400)
    }
    const bytes = Buffer.byteLength(data, 'base64')
    if (bytes > MAX_IMAGE_BYTES) throw new BridgeError('prompt/image-too-large', '单张图片过大', 413)
    total += bytes
    if (total > MAX_IMAGE_TOTAL_BYTES) throw new BridgeError('prompt/image-too-large', '图片总大小过大', 413)
    const part = { type: 'image', mediaType, data }
    if (typeof image.name === 'string' && image.name.trim() !== '') part.name = image.name.trim().slice(0, 120)
    content.push(part)
  }
  return content
}

/** 标题：去控制字符、去首尾空白，长度 1–200。 */
export function cleanTitle(value) {
  if (typeof value !== 'string') throw new BridgeError('session/bad-title', '标题必须是字符串', 400)
  const title = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (title === '' || title.length > MAX_TITLE_CHARS) {
    throw new BridgeError('session/bad-title', `标题长度必须在 1–${MAX_TITLE_CHARS} 之间`, 400)
  }
  return title
}
