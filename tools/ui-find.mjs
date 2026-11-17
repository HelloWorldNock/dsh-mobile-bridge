/**
 * 从 uiautomator XML 里找带文字/描述的节点，输出中心的设备坐标。
 * 用法：node .tmp/ui-find.mjs <xml> <关键词1> [关键词2 ...]
 */
import { readFileSync } from 'node:fs'

const [file, ...keywords] = process.argv.slice(2)
const xml = readFileSync(file, 'utf8')

const nodes = []
for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
  const tag = match[0]
  const get = (name) => {
    const found = tag.match(new RegExp(`${name}="([^"]*)"`))
    return found === null ? '' : found[1]
  }
  const text = get('text') || get('content-desc') || get('hint')
  if (text.trim() === '') continue
  const bounds = tag.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  if (bounds === null) continue
  const [x1, y1, x2, y2] = bounds.slice(1).map(Number)
  nodes.push({ text: text.trim(), cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2), clickable: get('clickable') })
}

const hits = keywords.length === 0 ? nodes : nodes.filter((node) => keywords.some((keyword) => node.text.includes(keyword)))
for (const hit of hits.slice(0, 40)) console.log(`${hit.cx},${hit.cy}\t${hit.clickable === 'true' ? '可点' : '    '}\t${hit.text.slice(0, 60)}`)
if (hits.length === 0) console.log('（没有匹配的节点；当前界面文字：）')
if (hits.length === 0) for (const node of nodes.slice(0, 25)) console.log(`  ${node.text.slice(0, 50)}`)
