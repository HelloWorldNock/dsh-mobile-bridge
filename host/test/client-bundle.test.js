import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fmtTime, formatCode, parseGroupUrl } from '../client-src/helpers.mjs'

/**
 * 面板（R22）：`lib/client.js` 是由 `client-src/` 片段生成的单文件 bundle，
 * DSH 的加载器只认包名、不认相对路径，所以运行时不能拆成多个文件。
 *
 * 这里守住三件事：
 *   1. 纯函数的边界（面板上最容易出错的那部分）；
 *   2. bundle 没有过期（源码改了但忘记重新生成）；
 *   3. bundle 能被真实加载器那样载入，`apply` 会注册两个插槽。
 */

const HOST = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(HOST, 'lib', 'client.js')

/** 一个刚好够用的假 React：bundle 里只用到 createElement / hooks / Component。 */
function fakeReact() {
  class Component {
    constructor(props) {
      this.props = props ?? {}
    }
    setState() {}
  }
  const React = {
    Component,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (initial) => ({ current: initial ?? null }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    createContext: (value) => ({ Provider: value, Consumer: value }),
    Fragment: 'fragment',
    Children: { map: (children, fn) => (Array.isArray(children) ? children.map(fn) : []) },
    isValidElement: () => false
  }
  React.default = React
  return React
}

function loadBundle() {
  const code = readFileSync(BUNDLE, 'utf8')
  const registered = { current: null }
  const fakeWindow = {
    __ModuleLoader__: {
      load: (mod) => {
        registered.current = mod
      }
    }
  }
  const fakeRequire = (name) => {
    if (name === 'react') return fakeReact()
    if (name === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${name}`)
  }
  // 用 Function 而不是 import：bundle 是给 window 用的脚本，不是 ESM。
  const run = new Function('window', 'require', code)
  run(fakeWindow, fakeRequire)
  return { module: registered.current, fakeRequire }
}

test('pure helpers: fmtTime', () => {
  assert.equal(fmtTime(null), '从未')
  assert.equal(fmtTime(''), '从未')
  assert.equal(fmtTime('not-a-date'), '—')
  assert.match(fmtTime('2026-11-17T00:00:00.000Z'), /\d{4}/)
})

test('pure helpers: parseGroupUrl normalizes what people paste', () => {
  assert.deepEqual(parseGroupUrl('192.168.1.10:48123'), { url: 'http://192.168.1.10:48123', error: '' })
  assert.deepEqual(parseGroupUrl('  192.168.1.10:48123/  '), { url: 'http://192.168.1.10:48123', error: '' })
  assert.deepEqual(parseGroupUrl('http://pc.local:48123'), { url: 'http://pc.local:48123', error: '' })
  assert.deepEqual(parseGroupUrl('https://100.100.1.7:48123'), { url: 'https://100.100.1.7:48123', error: '' })
  // 带 path/query 时只保留协议 + host
  assert.deepEqual(parseGroupUrl('192.168.1.10:48123/api/info'), { url: 'http://192.168.1.10:48123', error: '' })
})

test('pure helpers: parseGroupUrl explains what is wrong', () => {
  assert.match(parseGroupUrl('').error, /先填/)
  assert.match(parseGroupUrl('http://192.168.1.10').error, /端口/)
  assert.match(parseGroupUrl('ftp://192.168.1.10:48123').error, /地址看不懂/)
  assert.match(parseGroupUrl('http://user:pass@192.168.1.10:48123').error, /用户名密码/)
})

test('pure helpers: formatCode groups the pairing code', () => {
  assert.equal(formatCode('123456'), '123  456')
  assert.equal(formatCode('123 456'), '123  456')
  assert.equal(formatCode('12'), '12')
  assert.equal(formatCode(null), '------')
  assert.equal(formatCode(''), '------')
})

test('the committed bundle is up to date with client-src', () => {
  const result = spawnSync(process.execPath, [join(HOST, '..', 'tools', 'build-client.mjs'), '--check'], {
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, `bundle 过期：${result.stderr || result.stdout}\n跑 node tools/build-client.mjs 重新生成`)
})

test('the bundle loads like the DSH loader does and registers both slots', () => {
  const { module, fakeRequire } = loadBundle()
  assert.equal(module.id, 'dsh-mobile-bridge')
  assert.equal(typeof module.factory, 'function')

  const exported = module.factory(fakeRequire)
  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(exported.inject, ['slots'])

  const injections = []
  const registrations = []
  const ctx = {
    slots: {
      inject: (name, fn) => {
        injections.push(name)
        // 面板把 register 放在 inject 回调里，这里触发一次确认它不抛
        fn()
      },
      register: (meta, component) => {
        registrations.push({ name: meta.name, id: meta.id, hasComponent: typeof component !== 'undefined' })
      }
    }
  }
  exported.apply(ctx)
  assert.deepEqual(injections, ['sidebar.footer.action', 'settings.plugins.tab'])
  assert.equal(registrations.length, 2)
  // 两个插槽各自带后缀的 id，组件都必须传进去。
  assert.deepEqual(
    registrations.map((entry) => entry.id).sort(),
    ['dsh-mobile-bridge', 'dsh-mobile-bridge-sidebar']
  )
  for (const entry of registrations) assert.equal(entry.hasComponent, true)
})
