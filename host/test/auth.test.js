import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultState } from '../lib/state.js'
import { createAuth, BridgeError } from '../lib/auth.js'

function harness() {
  let clock = 1_000_000
  const state = createDefaultState()
  const auth = createAuth({
    state,
    save: async () => undefined,
    settings: state.settings,
    logger: { warn() {}, info() {} },
    now: () => clock
  })
  return {
    state,
    auth,
    advance(ms) {
      clock += ms
    },
    now: () => clock
  }
}

test('pairs with the current code and authenticates the issued token', async () => {
  const { auth } = harness()
  const code = auth.currentCode().code
  const result = auth.pair({ code, installId: 'install-1', deviceName: 'Pixel', model: 'Pixel 8', appVersion: '0.1.0', ip: '192.168.1.5' })
  assert.match(result.token, /^dshm_[A-Za-z0-9_-]{40,}$/)
  assert.equal(result.device.name, 'Pixel')
  assert.equal(auth.authenticate(result.token)?.id, result.device.id)
  assert.equal(auth.authenticate('dshm_wrong'), undefined)
})

test('rejects a wrong code and locks after five failures', async () => {
  const { auth } = harness()
  auth.currentCode()
  for (let index = 0; index < 5; index += 1) {
    assert.throws(() => auth.pair({ code: '000000', installId: 'i', ip: '10.0.0.1' }), (error) => {
      assert.ok(error instanceof BridgeError)
      assert.equal(error.code, 'pair/bad-code')
      return true
    })
  }
  assert.throws(() => auth.pair({ code: '000000', installId: 'i', ip: '10.0.0.1' }), (error) => error.code === 'pair/locked')
})

test('rotates an expired code', async () => {
  const { auth, advance } = harness()
  const first = auth.currentCode().code
  advance(121_000)
  const second = auth.currentCode().code
  assert.notEqual(first, second)
})

test('revokes a device and refuses its token', async () => {
  const { auth } = harness()
  const paired = auth.pair({ code: auth.currentCode().code, installId: 'i', deviceName: 'Phone', ip: '10.0.0.2' })
  assert.equal(auth.revoke(paired.device.id), true)
  assert.equal(auth.authenticate(paired.token), undefined)
  assert.equal(auth.revoke('missing'), false)
})
