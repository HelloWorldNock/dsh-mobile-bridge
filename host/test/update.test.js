import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, parseRelease, createUpdater, tagFromReleaseUrl, versionParts } from '../lib/update.js'

const TAG_PAGE = 'https://github.com/HelloWorldNock/dsh-mobile-bridge/releases/tag/'

function release(overrides = {}) {
  return {
    tag_name: 'v0.8.3',
    name: 'v0.8.3',
    html_url: `${TAG_PAGE}v0.8.3`,
    body: '面板可以检查更新了',
    published_at: '2026-11-04T12:00:00Z',
    prerelease: false,
    assets: [
      { name: 'dsh-mobile-bridge-0.8.3.tgz', browser_download_url: 'https://example.test/plugin.tgz', size: 1024 },
      { name: 'TS7-DSH-Remote-0.8.3-debug.apk', browser_download_url: 'https://example.test/app.apk', size: 2048 }
    ],
    ...overrides
  }
}

function fakeGitHub({ tag = 'v0.8.3', api = release(), apiStatus = 200 } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) {
      return { ok: true, status: 200, url: `${TAG_PAGE}${tag}` }
    }
    if (url.includes('/releases/tags/')) {
      return {
        ok: apiStatus === 200,
        status: apiStatus,
        async json() {
          return api
        }
      }
    }
    throw new Error(`unexpected url ${url}`)
  }
  return { fetchImpl, calls }
}

test('compares dotted versions and ignores the v prefix and build suffixes', () => {
  assert.deepEqual(versionParts('v0.8.3'), [0, 8, 3])
  assert.deepEqual(versionParts('1.2-debug'), [1, 2])
  assert.equal(compareVersions('0.8.3', '0.8.2'), 1)
  assert.equal(compareVersions('v0.8.10', '0.8.9'), 1)
  assert.equal(compareVersions('0.8.3', '0.8.3-debug'), 0)
  assert.equal(compareVersions('0.9', '1.0'), -1)
  assert.equal(compareVersions('1.0.0', '1'), 0)
})

test('reads the tag out of the redirected release url', () => {
  assert.equal(tagFromReleaseUrl(`${TAG_PAGE}v0.8.3`), 'v0.8.3')
  assert.equal(tagFromReleaseUrl(`${TAG_PAGE}v0.8.3?expanded=true`), 'v0.8.3')
  assert.equal(tagFromReleaseUrl('https://github.com/o/r/releases'), '')
  assert.equal(tagFromReleaseUrl(''), '')
})

test('turns a GitHub release into what the panel needs', () => {
  const parsed = parseRelease(release(), '0.8.2')
  assert.equal(parsed.latest, '0.8.3')
  assert.equal(parsed.tag, 'v0.8.3')
  assert.equal(parsed.hasUpdate, true)
  assert.equal(parsed.assets.length, 2)
  assert.equal(parsed.assets[1].name, 'TS7-DSH-Remote-0.8.3-debug.apk')
  assert.equal(parsed.publishedAt, '2026-11-04T12:00:00Z')

  const same = parseRelease(release({ tag_name: 'v0.8.2' }), '0.8.2')
  assert.equal(same.hasUpdate, false)
  assert.throws(() => parseRelease({}, '0.8.2'), /tag_name/)
})

test('checks the release page once and serves the cache until forced', async () => {
  const { fetchImpl, calls } = fakeGitHub()
  const updater = createUpdater({ version: '0.8.2', fetchImpl })

  assert.equal(updater.snapshot(), null)
  const first = await updater.check()
  assert.equal(first.latest, '0.8.3')
  assert.equal(first.hasUpdate, true)
  assert.equal(first.notes, '面板可以检查更新了')
  assert.equal(first.assets.length, 2)
  assert.deepEqual(calls, [
    'https://github.com/HelloWorldNock/dsh-mobile-bridge/releases/latest',
    'https://api.github.com/repos/HelloWorldNock/dsh-mobile-bridge/releases/tags/v0.8.3'
  ])

  const cached = await updater.check()
  assert.equal(cached.latest, '0.8.3')
  assert.equal(cached.stale, false)
  assert.equal(calls.length, 2)

  await updater.check({ force: true })
  assert.equal(calls.length, 4)
  updater.dispose()
})

test('still reports a new version when the API is rate limited', async () => {
  const { fetchImpl, calls } = fakeGitHub({ apiStatus: 403 })
  const updater = createUpdater({ version: '0.8.2', fetchImpl })
  const result = await updater.check()
  assert.equal(result.latest, '0.8.3')
  assert.equal(result.hasUpdate, true)
  assert.equal(result.error, null)
  assert.equal(result.notes, '')
  assert.deepEqual(result.assets, [])
  assert.equal(calls.length, 2)
  updater.dispose()
})

test('reports unusable answers instead of throwing', async () => {
  const empty = createUpdater({
    version: '0.8.2',
    fetchImpl: async () => ({ ok: true, status: 200, url: 'https://github.com/HelloWorldNock/dsh-mobile-bridge/releases' })
  })
  const noReleases = await empty.check()
  assert.equal(noReleases.hasUpdate, false)
  assert.match(noReleases.error, /还没有发布版本/)
  assert.equal(noReleases.url, 'https://github.com/HelloWorldNock/dsh-mobile-bridge/releases')

  const offline = createUpdater({
    version: '0.8.2',
    fetchImpl: async () => {
      throw new Error('fetch failed')
    }
  })
  const failed = await offline.check()
  assert.equal(failed.latest, null)
  assert.match(failed.error, /连不上 GitHub/)
})
