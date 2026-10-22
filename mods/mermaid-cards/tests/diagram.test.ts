import { expect, test } from 'claude-code/testing'

import { buildDiagram } from '../hooks/diagram'
import { splitSegments } from '../hooks/register'

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const cols = (s: string) => [...s].reduce((w, ch) => w + (WIDE.test(ch) ? 2 : 1), 0)

const SEQ = `sequenceDiagram
participant U as 使用者
participant G as Gateway
U->>G: 講話（期間沒有逐字稿）
Note over U,G: 講完後約 0.9 秒`

test('把 mermaid 區塊從回覆中切出來', async () => {
  const segs = splitSegments(`前言\n\n\`\`\`mermaid\n${SEQ}\n\`\`\`\n\n結尾`)
  expect(segs.map(s => s.kind)).toEqual(['markdown', 'mermaid', 'markdown'])
})

test('中文時序圖：每列框線右緣對齊，底部重複角色列已移除', async () => {
  const d = buildDiagram(SEQ, 200)
  expect(d?.kind).toBe('sequence')
  const lines = d!.art.split('\n')
  // 角色框的右邊框（╮ │ ╯）在終端機上同一欄
  const edge = (l: string, ch: string) => cols(l.slice(0, l.indexOf(ch)))
  expect(edge(lines[0]!, '╮')).toBe(edge(lines[2]!, '╯'))
  expect(lines.filter(l => l.includes('使用者')).length).toBe(1)
  expect(d!.meta).toBe('2 個角色')
})

test('不支援的圖與太寬的圖回傳 null，交還 prismantis', async () => {
  expect(buildDiagram('xychart-beta\n  bar [1, 2]', 200)).toBe(null)
  expect(buildDiagram(SEQ, 10)).toBe(null)
})

test('橫式 LR 會被改成垂直：圖比較高、不會很寬', () => {
  const d = buildDiagram('flowchart LR\n  A[\"開始\"] --> B[\"處理\"] --> C[\"結束\"]', 100)
  expect(d).not.toBeNull()
  expect(d!.rows.length).toBeGreaterThan(8)
  expect(d!.width).toBeLessThan(30)
})
