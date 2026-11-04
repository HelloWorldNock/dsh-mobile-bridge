const GITHUB_SITE = 'https://github.com'
const GITHUB_API = 'https://api.github.com'
const FETCH_TIMEOUT_MS = 8_000
const DEFAULT_TTL_MS = 6 * 3600_000
const DEFAULT_INTERVAL_MS = 6 * 3600_000
const FIRST_CHECK_DELAY_MS = 5_000
const NOTES_LIMIT = 1_200
const MAX_ASSETS = 12

export const GITHUB_REPO = 'HelloWorldNock/dsh-mobile-bridge'

/** `v0.8.2`、`0.8.2`、`0.8.2-debug` 都拆成可比较的数字段。 */
export function versionParts(value) {
  if (typeof value !== 'string') return []
  const core = value.trim().replace(/^v/i, '').split(/[-+]/)[0]
  if (core === '') return []
  return core.split('.').map((piece) => {
    const digits = piece.match(/^\d+/)
    return digits === null ? 0 : Number.parseInt(digits[0], 10)
  })
}

/** 数字段逐个比较，返回 -1 / 0 / 1；缺的段按 0 处理。 */
export function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  const size = Math.max(left.length, right.length)
  for (let index = 0; index < size; index += 1) {
    const one = left[index] ?? 0
    const other = right[index] ?? 0
    if (one !== other) return one > other ? 1 : -1
  }
  return 0
}

/** 面板只显示一小段更新说明，长 release notes 会挤爆卡片。 */
export function cleanNotes(value, limit = NOTES_LIMIT) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\r\n/g, '\n').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** 只留能直接点的下载地址，HTML 里的其它字段不放出来。 */
export function readAssets(payload) {
  const list = Array.isArray(payload?.assets) ? payload.assets : []
  const out = []
  for (const asset of list.slice(0, MAX_ASSETS)) {
    if (typeof asset?.name !== 'string' || typeof asset?.browser_download_url !== 'string') continue
    out.push({
      name: asset.name,
      url: asset.browser_download_url,
      size: Number.isFinite(asset.size) ? asset.size : null
    })
  }
  return out
}

/**
 * 把 GitHub 的 release 响应收敛成面板/手机能直接用的结构。
 * `latest` 取 tag_name，去掉前缀 v 后与本地版本比较。
 */
export function parseRelease(payload, current) {
  const tag = typeof payload?.tag_name === 'string' ? payload.tag_name.trim() : ''
  const latest = tag.replace(/^v/i, '')
  if (latest === '') throw new Error('发布记录缺少 tag_name')
  return {
    current: typeof current === 'string' ? current : '',
    latest,
    tag,
    hasUpdate: compareVersions(latest, current) > 0,
    url: typeof payload?.html_url === 'string' ? payload.html_url : '',
    name: typeof payload?.name === 'string' && payload.name.trim() !== '' ? payload.name.trim() : tag,
    notes: cleanNotes(payload?.body),
    publishedAt: typeof payload?.published_at === 'string' ? payload.published_at : null,
    prerelease: payload?.prerelease === true,
    assets: readAssets(payload)
  }
}

/** 从重定向后的最终地址里挖出 tag：/releases/tag/v0.8.3 → v0.8.3。 */
export function tagFromReleaseUrl(finalUrl) {
  const text = String(finalUrl ?? '')
  const match = text.match(/\/releases\/tag\/([^/?#]+)/)
  if (match === null) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function friendlyError(error) {
  const name = typeof error?.name === 'string' ? error.name : ''
  const message = String(error?.message ?? error)
  if (name === 'AbortError' || name === 'TimeoutError') return '连接 GitHub 超时，检查网络或代理后重试'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|other side closed/i.test(message)) {
    return `连不上 GitHub：${message}`
  }
  return `检查更新失败：${message}`
}

/**
 * 查 GitHub 上的最新 release。只「查」，不自动下载、不自动安装。
 *
 * 主路径走网页的 /releases/latest 重定向（不需要 token、不受 API 限流），
 * 拿到 tag 之后再尽力取一次 API 补更新说明和附件；API 被限流也只是少几行字，
 * 不影响「有没有新版本」这个结论。
 */
export function createUpdater({
  version,
  repo = GITHUB_REPO,
  fetchImpl = globalThis.fetch,
  logger = null,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  firstDelayMs = FIRST_CHECK_DELAY_MS
}) {
  let cached = null
  let inflight = null
  let timer = null
  let firstTimer = null
  let disposed = false

  const releasesUrl = `${GITHUB_SITE}/${repo}/releases`
  const headers = { 'user-agent': `dsh-mobile-bridge/${version}` }

  function snapshot() {
    if (cached === null) return null
    return { ...cached, stale: now() - cached.checkedAt > ttlMs }
  }

  async function resolveTag() {
    const response = await fetchImpl(`${GITHUB_SITE}/${repo}/releases/latest`, {
      headers: { ...headers, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    const finalUrl = String(response.url ?? '')
    const tag = tagFromReleaseUrl(finalUrl)
    if (tag !== '') return { tag, url: finalUrl.split(/[?#]/)[0] }
    if (response.status === 404) throw new Error(`找不到 ${repo} 的发布页，仓库可能是私有的`)
    throw new Error('仓库还没有发布版本')
  }

  async function resolveDetails(tag) {
    try {
      const response = await fetchImpl(`${GITHUB_API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
        headers: { ...headers, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      if (!response.ok) return null
      return await response.json()
    } catch {
      // 更新说明只是锦上添花，取不到就算了。
      return null
    }
  }

  async function run() {
    const checkedAt = now()
    const base = { current: version, repo, checkedAt, error: null }
    if (typeof fetchImpl !== 'function') {
      return { ...base, latest: null, hasUpdate: false, url: releasesUrl, error: '当前运行时不支持网络请求' }
    }
    try {
      const { tag, url } = await resolveTag()
      const latest = tag.replace(/^v/i, '')
      const details = await resolveDetails(tag)
      let parsed = null
      if (details !== null) {
        try {
          parsed = parseRelease(details, version)
        } catch {
          parsed = null
        }
      }
      return {
        ...base,
        latest,
        tag,
        name: parsed?.name ?? tag,
        hasUpdate: compareVersions(latest, version) > 0,
        url: parsed?.url || url,
        notes: parsed?.notes ?? '',
        publishedAt: parsed?.publishedAt ?? null,
        prerelease: parsed?.prerelease ?? false,
        assets: parsed?.assets ?? []
      }
    } catch (error) {
      logger?.warn?.(`[mobile-bridge] update check failed: ${String(error?.message ?? error)}`)
      return { ...base, latest: null, hasUpdate: false, url: releasesUrl, error: friendlyError(error) }
    }
  }

  async function check({ force = false } = {}) {
    if (cached !== null && force !== true && now() - cached.checkedAt <= ttlMs) return snapshot()
    if (inflight !== null) return inflight
    inflight = run()
      .then((result) => {
        cached = result
        return snapshot()
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  function start() {
    if (disposed || typeof fetchImpl !== 'function') return
    const tick = () => {
      if (disposed) return
      void check({ force: true }).catch(() => {})
    }
    firstTimer = setTimeout(tick, Math.max(0, firstDelayMs))
    firstTimer.unref?.()
    timer = setInterval(tick, Math.max(60_000, intervalMs))
    timer.unref?.()
  }

  function dispose() {
    disposed = true
    if (firstTimer !== null) {
      clearTimeout(firstTimer)
      firstTimer = null
    }
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return { version, repo, snapshot, check, start, dispose }
}
