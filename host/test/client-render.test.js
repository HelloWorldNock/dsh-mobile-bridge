import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BridgeSettingsCard, DevicesCard, GroupCard, LogCard, UpdateCard } from '../client-src/components.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 面板渲染冒烟测试（R22 第四刀）。
 *
 * 面板是单文件 bundle、内部组件不导出，所以 bundle 末尾留了一个 `window.__DMB_TEST__`
 * 测试面（运行时无人访问）。这里用「假 React + 假 window」把 PanelBody 真跑一遍：
 * 不比对像素，只保证「渲染不抛、关键区块存在」——拆分/搬迁最容易破坏的正是这个。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(HERE, '..', 'lib', 'client.js')

/** 一个能跑一轮渲染的假 React：hooks 用一份按索引滚动的状态表模拟。 */
function makeReact() {
  let states = []
  let cursor = 0
  const effects = []

  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }
    setState() {}
  }

  const React = {
    Component,
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }]
    },
    useRef: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = { current: initial ?? null }
      return states[index]
    },
    useEffect: (fn) => {
      effects.push(fn)
    },
    useLayoutEffect: (fn) => {
      effects.push(fn)
    },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    createContext: (value) => ({ Provider: value, Consumer: value, _currentValue: value }),
    isValidElement: (value) => value !== null && typeof value === 'object' && 'type' in value,
    Children: { map: (children, fn) => (Array.isArray(children) ? children.map(fn) : []) }
  }
  React.default = React

  return {
    React,
    reset() {
      states = []
      cursor = 0
      effects.length = 0
    },
    /** 调一次组件函数（等价于 React 渲染一层），hooks 索引从 0 开始。 */
    render(component, props) {
      cursor = 0
      return component(props ?? {})
    }
  }
}

function loadBundle() {
  const code = readFileSync(BUNDLE, 'utf8')
  const react = makeReact()
  const registered = []
  const fakeWindow = {
    __ModuleLoader__: {
      load: (mod) => registered.push(mod)
    },
    addEventListener() {},
    removeEventListener() {},
    location: { origin: 'http://127.0.0.1:48123' }
  }
  const fakeDocument = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
    body: {}
  }
  const fakeRequire = (name) => {
    if (name === 'react') return react.React
    if (name === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${name}`)
  }
  const run = new Function('window', 'document', 'fetch', 'require', code)
  run(fakeWindow, fakeDocument, () => Promise.reject(new Error('offline')), fakeRequire)
  const module = registered[0]
  // __DMB_TEST__ 是在 factory 里挂的，光 load 不够，要真调一次 factory
  const exports = module.factory(fakeRequire)
  return { module, exports, react, fakeWindow }
}

/** 把返回的元素树摊平成文本片段，方便断言「某个区块渲染出来了」。 */
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

test('the bundle exposes its test surface only when a window exists', () => {
  const { fakeWindow, module } = loadBundle()
  assert.equal(module.id, 'dsh-mobile-bridge')
  assert.equal(typeof fakeWindow.__DMB_TEST__, 'object')
  for (const name of ['PanelBody', 'SidebarAction', 'SettingsCard']) {
    assert.equal(typeof fakeWindow.__DMB_TEST__[name], 'function', `${name} 没暴露出来`)
  }
})

test('PanelBody renders the offline state without throwing', () => {
  const { fakeWindow, react } = loadBundle()
  const { PanelBody } = fakeWindow.__DMB_TEST__
  react.reset()

  const tree = react.render(PanelBody, { embedded: false, onClose: () => {} })
  assert.ok(tree !== null && typeof tree === 'object', 'PanelBody 应当返回元素树')
  const text = flatten(tree).join(' ')
  // 骨架：标题 + 关闭 + 桥接状态；离线时给出「桥接未运行」而不是白屏
  assert.match(text, /手机远控/, `期望标题在树里，实际：${text.slice(0, 200)}`)
  assert.match(text, /桥接|离线|没有响应/, `期望桥接状态文案，实际：${text.slice(0, 200)}`)
})

test('SidebarAction renders the footer button', () => {
  const { fakeWindow, react } = loadBundle()
  const { SidebarAction } = fakeWindow.__DMB_TEST__
  react.reset()

  const tree = react.render(SidebarAction, {})
  const text = flatten(tree).join(' ')
  assert.match(text, /手机远控/)
})

test('SettingsCard respects the settings.plugins.tab filter', () => {
  const { fakeWindow, react } = loadBundle()
  const { SafeSettingsCard } = fakeWindow.__DMB_TEST__
  react.reset()

  // 别的插件的 tab：必须渲染成 null，不能抢别人的位置
  assert.equal(react.render(SafeSettingsCard, { only: 'other-plugin' }), null)
  // 自己的 tab：返回元素树
  react.reset()
  const tree = react.render(SafeSettingsCard, { only: 'dsh-mobile-bridge' })
  assert.ok(tree !== null && typeof tree === 'object')
})



test('DevicesCard renders the empty state and the list with revoke callback', () => {
  globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })
  globalThis.fmtTime = (iso) => (iso ? `t:${iso}` : '从未')
  try {
    const empty = DevicesCard({ devices: [], busy: '', onRevoke: () => {} })
    assert.equal(empty.type, 'div')
    assert.match(flatten(empty).join(' '), /还没有设备配对/)

    const revoked = []
    const card = DevicesCard({
      devices: [
        { id: 'd1', name: 'Pixel', model: 'Pixel 8', lastSeenAt: '2026-11-17T00:00:00Z' },
        { id: 'd2', name: '旧设备', revokedAt: '2026-11-01T00:00:00Z' }
      ],
      busy: '',
      onRevoke: (device) => revoked.push(device.id)
    })
    const text = flatten(card).join(' ')
    assert.match(text, /Pixel/)
    assert.match(text, /Pixel 8/)
    // 已撤销的设备不再出现在列表里
    assert.ok(!text.includes('旧设备'), `已撤销设备不该出现：${text}`)

    // 撤销按钮在树里，点它会回调
    // 注意：数组子节点是常态（map 出来的列表），要递归进去
    const findButtons = (node, out = []) => {
      if (node === null || typeof node !== 'object') return out
      if (Array.isArray(node)) {
        for (const child of node) findButtons(child, out)
        return out
      }
      if (node.type === 'button') out.push(node)
      for (const child of node.children ?? []) findButtons(child, out)
      return out
    }
    const buttons = findButtons(card)
    assert.equal(buttons.length, 1)
    buttons[0].props.onClick()
    assert.deepEqual(revoked, ['d1'])
  } finally {
    delete globalThis.h
    delete globalThis.fmtTime
  }
})


test('LogCard collapses, expands and wires its callbacks', () => {
  globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })
  try {
    const calls = []
    const base = {
      logsPath: '/tmp/bridge.log',
      onToggle: () => calls.push('toggle'),
      onCopy: () => calls.push('copy'),
      onRefresh: () => calls.push('refresh'),
      baseUrl: 'http://127.0.0.1:48123'
    }

    // 收起态：没有日志正文，导出链接指向 loopback 接口
    const collapsed = LogCard({ ...base, open: false, busy: false, text: '' })
    const collapsedText = flatten(collapsed).join(' ')
    assert.match(collapsedText, /运行日志/)
    assert.match(collapsedText, /bridge\.log/)
    assert.match(collapsedText, /<a|导出日志文件/)

    const find = (node, predicate, out = []) => {
      if (node === null || typeof node !== 'object') {
        if (predicate(node)) out.push(node)
        return out
      }
      if (predicate(node)) out.push(node)
      for (const child of node.children ?? []) find(child, predicate, out)
      return out
    }
    const link = find(collapsed, (n) => n && n.type === 'a')[0]
    assert.equal(link.props.href, 'http://127.0.0.1:48123/api/setup/logs?lines=800')
    assert.equal(link.props.download, 'dsh-remote-host.log')

    // 展开态：显示正文与「复制全部 / 刷新」
    const expanded = LogCard({ ...base, open: true, busy: false, text: 'line-1\nline-2' })
    const expandedText = flatten(expanded).join(' ')
    assert.match(expandedText, /line-1/)
    assert.match(expandedText, /复制全部/)
    const buttons = find(expanded, (n) => n && n.type === 'button')
    assert.equal(buttons.length, 3) // 收起/查看 + 复制全部 + 刷新
    buttons[1].props.onClick()
    buttons[2].props.onClick()
    assert.deepEqual(calls, ['copy', 'refresh'])

    // 读取中且没有正文
    const loading = flatten(LogCard({ ...base, open: true, busy: true, text: '' })).join(' ')
    assert.match(loading, /读取中/)
  } finally {
    delete globalThis.h
  }
})


test('UpdateCard covers every version branch and its callbacks', () => {
  globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })
  globalThis.fmtTime = () => '时间点'
  try {
    const text = (node) => flatten(node).join(' ')
    const base = { version: '0.9.11', busy: '', error: '', onCheck: () => {} }

    // 1) 还没查过
    assert.match(text(UpdateCard({ ...base, update: null })), /还没查过 GitHub 上的最新版本/)

    // 2) 查询失败：显示错误，不显示「已最新」
    const failed = text(UpdateCard({ ...base, update: { error: 'rate limited' } }))
    assert.match(failed, /rate limited/)
    assert.ok(!failed.includes('已是最新'))

    // 3) 有新版本：出现版本号、说明与发布页链接
    const found = UpdateCard({
      ...base,
      update: { hasUpdate: true, latest: '0.9.12', current: '0.9.11', url: 'https://example.test/rel', notes: '修了 X', checkedAt: 'now' }
    })
    const foundText = text(found)
    assert.match(foundText, /发现新版本 0\.9\.12/)
    assert.match(foundText, /修了 X/)
    const link = (function find(node, out = []) {
      if (node === null || typeof node !== 'object') return out
      if (node.type === 'a') out.push(node)
      for (const child of node.children ?? []) find(child, out)
      return out
    })(found)[0]
    assert.equal(link.props.href, 'https://example.test/rel')

    // 4) 已是最新：底部给更新包地址
    const latest = text(UpdateCard({ ...base, update: { hasUpdate: false, url: 'https://example.test/latest', checkedAt: 'now' } }))
    assert.match(latest, /已是最新版本/)
    assert.match(latest, /更新包/)

    // 5) 检查中：按钮禁用且改文案；错误条单独出现
    let checked = 0
    const busyCard = UpdateCard({ ...base, update: null, busy: 'update', error: '出错了', onCheck: () => { checked += 1 } })
    const buttons = (function find(node, out = []) {
      if (node === null) return out
      if (Array.isArray(node)) { for (const c of node) find(c, out); return out }
      if (typeof node !== 'object') return out
      if (node.type === 'button') out.push(node)
      for (const child of node.children ?? []) find(child, out)
      return out
    })(busyCard)
    assert.equal(buttons[0].props.disabled, true)
    assert.match(text(busyCard), /检查中/)
    assert.match(text(busyCard), /出错了/)
    buttons[0].props.onClick()
    assert.equal(checked, 1)
  } finally {
    delete globalThis.h
    delete globalThis.fmtTime
  }
})


test('BridgeSettingsCard patches only the touched field, in the right units', () => {
  globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })
  try {
    const patches = []
    let saves = 0
    const form = {
      phoneFirst: true,
      discovery: false,
      approvalTimeoutMs: 120_000,
      questionTimeoutMs: 120_000,
      planReviewTimeoutMs: 180_000,
      collabWorkspaceId: '',
      collabRoot: '',
      workspaceRoot: ''
    }
    const card = BridgeSettingsCard({
      workspaces: [
        { id: 'w1', title: '项目 A', path: 'F:\\work\\a' },
        { id: 'w2', title: '项目 B', path: 'F:\\work\\b' }
      ],
      form,
      error: '保存失败：网络不通',
      busy: '',
      saved: '已保存',
      onPatch: (patch) => patches.push(patch),
      onSave: () => { saves += 1 }
    })

    const text = flatten(card).join(' ')
    for (const label of ['桥接设置', '手机优先审批', '局域网发现', '审批等待', '提问等待', '计划审阅等待', '协作工作区', '默认工作区目录']) {
      assert.match(text, new RegExp(label), `缺少区块：${label}`)
    }
    assert.match(text, /保存失败/)
    assert.match(text, /已保存/)

    const find = (node, predicate, out = []) => {
      if (node === null || typeof node !== 'object') return out
      if (Array.isArray(node)) { for (const c of node) find(c, predicate, out); return out }
      if (predicate(node)) out.push(node)
      for (const child of node.children ?? []) find(child, predicate, out)
      return out
    }

    // 勾选框：只 patch 自己那个字段
    const checkboxes = find(card, (n) => n.type === 'input' && n.props.type === 'checkbox')
    assert.equal(checkboxes.length, 2)
    checkboxes[0].props.onChange({ target: { checked: false } })
    assert.deepEqual(patches[0], { phoneFirst: false })

    // 数字框：秒 → 毫秒
    const numbers = find(card, (n) => n.type === 'input' && n.props.type === 'number')
    assert.equal(numbers.length, 3)
    assert.equal(numbers[0].props.value, 120)
    numbers[0].props.onChange({ target: { value: '90' } })
    assert.deepEqual(patches[1], { approvalTimeoutMs: 90_000 })

    // 协作工作区下拉：选到某个工作区时连带把路径填进去
    const select = find(card, (n) => n.type === 'select')[0]
    select.props.onChange({ target: { value: 'w2' } })
    assert.deepEqual(patches[2], { collabWorkspaceId: 'w2', collabRoot: 'F:\\work\\b' })

    // 保存按钮
    const saveButton = find(card, (n) => n.type === 'button')[0]
    saveButton.props.onClick()
    assert.equal(saves, 1)

    // 保存中：按钮禁用且改文案
    const busyCard = BridgeSettingsCard({ ...{ workspaces: [], form, error: '', busy: 'save', saved: '', onPatch: () => {}, onSave: () => {} } })
    const busyButton = find(busyCard, (n) => n.type === 'button')[0]
    assert.equal(busyButton.props.disabled, true)
    assert.match(flatten(busyCard).join(' '), /保存中/)
  } finally {
    delete globalThis.h
  }
})


test('GroupCard renders both states and wires the five actions', () => {
  globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })
  globalThis.formatCode = (code) => String(code).replace(/(\d{3})(\d{3})/, '$1  $2')
  try {
    const calls = []
    const base = {
      busy: '',
      error: '',
      saved: '',
      url: '',
      code: '',
      onUrlChange: (v) => calls.push(['url', v]),
      onCodeChange: (v) => calls.push(['code', v]),
      onCreate: () => calls.push(['create']),
      onLeave: () => calls.push(['leave']),
      onInvite: () => calls.push(['invite']),
      onForget: (peer) => calls.push(['forget', peer.deviceId]),
      onJoin: () => calls.push(['join'])
    }
    const find = (node, predicate, out = []) => {
      if (node === null || typeof node !== 'object') return out
      if (Array.isArray(node)) { for (const c of node) find(c, predicate, out); return out }
      if (predicate(node)) out.push(node)
      for (const child of node.children ?? []) find(child, predicate, out)
      return out
    }
    const text = (node) => flatten(node).join(' ')

    // 未加入：创建组 + 加入表单
    const out = GroupCard({ ...base, group: { group: null, peers: [], invite: null } })
    assert.match(text(out), /还没有绑定组/)
    assert.match(text(out), /加入别人的组/)
    assert.equal(find(out, (n) => n.type === 'button').length, 2)
    const inputs = find(out, (n) => n.type === 'input')
    inputs[0].props.onChange({ target: { value: 'http://10.0.0.2:48123' } })
    inputs[1].props.onChange({ target: { value: '123456' } })
    find(out, (n) => n.type === 'button')[0].props.onClick()
    find(out, (n) => n.type === 'button')[1].props.onClick()
    assert.deepEqual(calls, [['url', 'http://10.0.0.2:48123'], ['code', '123456'], ['create'], ['join']])

    // 已加入：组名、邀请码、组内 PC、移出/退出/换一个
    calls.length = 0
    const joined = GroupCard({
      ...base,
      group: {
        group: { id: 'grp1', name: '设计组' },
        peers: [
          { deviceId: 'HOSTB', name: 'PC-B', status: 'online', baseUrl: 'http://10.0.0.3:48123' },
          { deviceId: 'HOSTC', status: 'offline', baseUrl: 'http://10.0.0.4:48123' }
        ],
        invite: { code: '123456' }
      }
    })
    const joinedText = text(joined)
    assert.match(joinedText, /设计组/)
    assert.match(joinedText, /grp1 · 2 台协作 PC/)
    assert.match(joinedText, /邀请码 123  456/)
    assert.match(joinedText, /PC-B/)
    assert.match(joinedText, /在线/)
    assert.match(joinedText, /离线/)

    const buttons = find(joined, (n) => n.type === 'button')
    // 退出 / 换一个 / 移出 ×2
    assert.equal(buttons.length, 4)
    buttons[0].props.onClick()
    buttons[1].props.onClick()
    buttons[3].props.onClick()
    assert.deepEqual(calls, [['leave'], ['invite'], ['forget', 'HOSTC']])

    // 错误与提示
    const withMessages = GroupCard({ ...base, group: null, error: '加入失败：地址不可达', saved: '已加入绑定组' })
    const messageText = text(withMessages)
    assert.match(messageText, /加入失败/)
    assert.match(messageText, /已加入绑定组/)

    // 忙碌：按钮禁用且文案变化
    const busyCard = GroupCard({ ...base, group: null, busy: 'group-join' })
    const busyButton = find(busyCard, (n) => n.type === 'button')[1]
    assert.equal(busyButton.props.disabled, true)
    assert.match(text(busyCard), /加入中/)
  } finally {
    delete globalThis.h
    delete globalThis.formatCode
  }
})
