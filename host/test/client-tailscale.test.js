import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TailscaleCard } from '../client-src/components.mjs'

/**
 * 内嵌 Tailscale 节点卡片（R22 第十刀）。
 *
 * 只测「画得对 + 回调接得对」：状态文案、错误/授权链接、IP 胶囊、健康提示，
 * 以及开关/节点名/状态目录/密钥/重启/日志折叠这六个交互。
 */

function flatten(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node === 'object') {
    for (const child of node.children ?? []) flatten(child, out)
  }
  return out
}

function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

test('TailscaleCard renders node state and wires every write action', () => {
  const created = []
  // 假 React 要像 React 一样剥掉保留属性（key/ref 不会进 props）——之前没剥，
  // 所以「把业务字段命名成 key」这个 bug 一直没被测试抓到。
  globalThis.h = (type, props, ...children) => {
    const clean = { ...(props ?? {}) }
    delete clean.key
    delete clean.ref
    const node = { type, props: clean, children }
    created.push(node)
    return node
  }

  try {
    const calls = []
    const base = {
      ts: {
        hostname: 'dsh-bridge',
        stateDir: 'C:\\state',
        error: '节点被安全软件拦截',
        authUrl: 'https://login.example/abc',
        ip4: '100.100.1.7',
        tailnet: 'example.ts.net',
        listening: '0.0.0.0:41641',
        peers: 3,
        health: ['DNS 不可用', '未登录']
      },
      busy: '',
      phase: 'needs-login',
      enabled: true,
      host: 'dsh-bridge',
      dir: 'C:\\state',
      authKey: '',
      log: ['line-1', 'line-2'],
      open: false,
      hasKey: false,
      onToggle: (next) => calls.push(['toggle', next]),
      onHostChange: (value) => calls.push(['hostChange', value]),
      onHostCommit: () => calls.push(['hostCommit']),
      onDirChange: (value) => calls.push(['dirChange', value]),
      onDirCommit: () => calls.push(['dirCommit']),
      onKeyChange: (value) => calls.push(['keyChange', value]),
      onKeySave: () => calls.push(['keySave']),
      onRestart: () => calls.push(['restart']),
      onToggleLog: () => calls.push(['toggleLog'])
    }

    const card = TailscaleCard(base)
    const text = flatten(card).join(' ')
    assert.match(text, /内置 Tailscale 节点/)
    assert.match(text, /待登录/, 'phase 应当映射成中文文案')
    assert.match(text, /节点被安全软件拦截/)
    assert.match(text, /login\.example/)
    assert.match(text, /100\.100\.1\.7/)
    assert.match(text, /tailnet 3 台设备/)
    assert.match(text, /DNS 不可用/, 'health 应当合并显示')
    // 监听地址是 0.0.0.0 时不显示胶囊
    assert.equal(text.includes('0.0.0.0:41641'), false)

    const hostInput = findAll(card, (n) => n.type === 'input' && n.props.value === 'dsh-bridge')[0]
    hostInput.props.onChange({ target: { value: 'new-name' } })
    hostInput.props.onBlur()

    const dirInput = findAll(card, (n) => n.type === 'input' && n.props.value === 'C:\\state')[0]
    dirInput.props.onChange({ target: { value: 'D:\\state' } })
    dirInput.props.onBlur()

    const toggle = findAll(card, (n) => n.type === 'input' && n.props.type === 'checkbox')[0]
    toggle.props.onChange({ target: { checked: false } })

    // 密钥输入为空 → 「保存密钥」禁用
    const saveKey = findAll(card, (n) => n.type === 'button' && flatten(n).join(' ').includes('保存密钥'))[0]
    assert.equal(saveKey.props.disabled, true)

    findAll(card, (n) => n.type === 'button' && flatten(n).join(' ').includes('重启节点'))[0].props.onClick()
    findAll(card, (n) => n.type === 'button' && flatten(n).join(' ').includes('查看日志'))[0].props.onClick()

    assert.deepEqual(calls, [
      ['hostChange', 'new-name'],
      ['hostCommit'],
      ['dirChange', 'D:\\state'],
      ['dirCommit'],
      ['toggle', false],
      ['restart'],
      ['toggleLog']
    ])
  } finally {
    delete globalThis.h
  }
})

test('TailscaleCard expands the log, disables restart when off, and shows the saved-key hint', () => {
  globalThis.h = (type, props, ...children) => {
    const clean = { ...(props ?? {}) }
    delete clean.key
    delete clean.ref
    return { type, props: clean, children }
  }
  try {
    const props = {
      ts: { hostname: 'dsh-bridge', stateDir: '', health: [] },
      busy: '',
      phase: 'off',
      enabled: false,
      host: '',
      dir: '',
      authKey: 'tskey-auth-xyz',
      log: ['line-1', 'line-2'],
      open: true,
      hasKey: true,
      onToggle: () => {},
      onHostChange: () => {},
      onHostCommit: () => {},
      onDirChange: () => {},
      onDirCommit: () => {},
      onKeyChange: () => {},
      onKeySave: () => {},
      onRestart: () => {},
      onToggleLog: () => {}
    }
    const card = TailscaleCard(props)
    const text = flatten(card).join(' ')
    assert.match(text, /未启用/)
    assert.match(text, /line-2/, '展开时应当渲染日志尾部')
    assert.match(text, /已保存密钥，留空表示不修改/)

    const restart = findAll(card, (n) => n.type === 'button' && flatten(n).join(' ').includes('重启节点'))[0]
    assert.equal(restart.props.disabled, true, '未启用时重启按钮应禁用')

    // 有密钥内容时保存按钮可用
    const saveKey = findAll(card, (n) => n.type === 'button' && flatten(n).join(' ').includes('保存密钥'))[0]
    assert.equal(saveKey.props.disabled, false)
  } finally {
    delete globalThis.h
  }
})
