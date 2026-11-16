import assert from 'node:assert/strict'
import test from 'node:test'
import { bridgeEndpoints, classifyAddress, isTailnetHost } from '../lib/endpoints.js'

test('classifies Tailscale by interface name and CGNAT range', () => {
  assert.equal(classifyAddress('Tailscale', '100.104.185.37'), 'tailscale')
  assert.equal(classifyAddress('Ethernet', '100.101.2.3'), 'tailscale')
  assert.equal(classifyAddress('Ethernet', '192.168.1.20'), 'lan')
})

test('ignores virtual, link-local and internal addresses', () => {
  assert.equal(classifyAddress('VMware Network Adapter VMnet8', '192.168.16.1'), null)
  assert.equal(classifyAddress('vEthernet (WSL)', '172.20.0.1'), null)
  assert.equal(classifyAddress('Ethernet', '169.254.10.2'), null)
})

test('orders LAN before Tailscale and dedupes addresses', () => {
  const endpoints = bridgeEndpoints(48123, {
    'VMware Network Adapter VMnet8': [
      { family: 'IPv4', address: '192.168.16.1', internal: false }
    ],
    Tailscale: [{ family: 'IPv4', address: '100.104.185.37', internal: false }],
    Ethernet: [{ family: 'IPv4', address: '192.168.1.105', internal: false }],
    WiFi: [
      { family: 'IPv4', address: '192.168.1.105', internal: false },
      { family: 'IPv4', address: '127.0.0.1', internal: true }
    ]
  })
  assert.deepEqual(endpoints, [
    { kind: 'lan', address: '192.168.1.105', url: 'http://192.168.1.105:48123' },
    { kind: 'tailscale', address: '100.104.185.37', url: 'http://100.104.185.37:48123' }
  ])
})

test('supports an empty interface table', () => {
  assert.deepEqual(bridgeEndpoints(48123, {}), [])
})

test('tells tailnet addresses apart from LAN ones', () => {
  assert.equal(isTailnetHost('100.121.110.95:48123'), true)
  assert.equal(isTailnetHost('http://100.72.230.94:48123'), true)
  assert.equal(isTailnetHost('dsh-g3rntsw6.taildf7bc8.ts.net:48123'), true)
  assert.equal(isTailnetHost('192.168.1.108:48123'), false)
  assert.equal(isTailnetHost('172.20.0.1:48123'), false)
  assert.equal(isTailnetHost(''), false)
  assert.equal(isTailnetHost(null), false)
  assert.equal(isTailnetHost('不是地址'), false)
})
