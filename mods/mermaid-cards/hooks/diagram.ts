// 排版沿用 prismantis 內附的 mermaid-text（MIT，見 vendor/LICENSE-prismantis），
// 這裡只負責：CJK 寬度修正、辨識節點／參與者／備註，再上卡片式配色。
import { renderMermaidAscii } from './vendor/mermaid-text.js'

export type Cell = { ch: string; fg?: string; bg?: string; bold?: boolean; italic?: boolean }
export type Diagram = { kind: 'sequence' | 'flowchart'; title: string; meta: string; rows: Cell[][]; art: string; width: number }

// 色票：取自 cmux 主題 GitHub Dark High Contrast（背景 #0a0c10、前景 #f0f3f6）。
// 節點底色是同色相壓暗的 tint，文字對比 ≥ 7:1（這個主題本來就是高對比）。
export const P = {
  frame: '#4b535d',
  line: '#9ea7b3',
  lifeline: '#4b535d',
  text: '#f0f3f6',
  sub: '#b8c0cc',
  arrow: '#ffffff',
  accent: '#71b7ff',
}
const TONES = [
  { fg: '#71b7ff', bg: '#203042' },
  { fg: '#4ae168', bg: '#1a3728' },
  { fg: '#f0b72f', bg: '#36301e' },
  { fg: '#cb9eff', bg: '#302b42' },
  { fg: '#56d4dd', bg: '#1c353c' },
  { fg: '#ff9492', bg: '#392a2f' },
]
// 由小到大的 [節點間距, 框內留白]
const GROW: [number, number][] = [[4, 1], [6, 1], [8, 1], [10, 1], [12, 1], [14, 1], [18, 1], [22, 1]]
const NOTE = { fg: '#f7c843', bg: '#373322' }

// vendor 把每個字都當 1 格；全形字後面墊一格佔位，輸出時再拿掉
const PAD = ''
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/g

const TL = /[┌╭◇]/
const TR = /[┐╮◇]/
const BL = /[└╰◇]/
const BR = /[┘╯◇]/
const H = /[─┬┴┼▲▼]/
const V = /[│├┤┼►◄]/
const ROUND: Record<string, string> = { '┌': '╭', '┐': '╮', '└': '╰', '┘': '╯' }
const ARROW = /[►◄▲▼]/
const LINE = /[─-╿]/

type Rect = { r: number; c: number; r2: number; c2: number; label: string }

const kindOf = (source: string): Diagram['kind'] | null => {
  const head = source.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('%%')) ?? ''
  if (/^sequenceDiagram\b/.test(head)) return 'sequence'
  if (/^(flowchart|graph)\b/.test(head)) return 'flowchart'
  return null
}

const findRects = (grid: string[][]): Rect[] => {
  const at = (r: number, c: number) => grid[r]?.[c] ?? ''
  const rects: Rect[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (!TL.test(at(r, c))) continue
      let c2 = c + 1
      while (H.test(at(r, c2))) c2++
      if (c2 === c + 1 || !TR.test(at(r, c2))) continue
      let r2 = r + 1
      while (V.test(at(r2, c))) r2++
      if (r2 === r + 1 || !BL.test(at(r2, c)) || !BR.test(at(r2, c2))) continue
      const label = grid.slice(r + 1, r2).map(row => row.slice(c + 1, c2).join('').replaceAll(PAD, '').trim()).filter(Boolean).join(' ')
      rects.push({ r, c, r2, c2, label })
    }
  }
  const inside = (a: Rect, b: Rect) => a !== b && b.r > a.r && b.r2 < a.r2 && b.c > a.c && b.c2 < a.c2
  return rects.filter(a => !rects.some(b => inside(a, b)))
}

export const buildDiagram = (source: string, maxWidth: number): Diagram | null => {
  if (source.length > 8000 || source.split('\n').length > 80) return null
  const kind = kindOf(source)
  if (!kind) return null
  let art: string
  try {
    const cleaned = source
      .replace(/^(\s*%%[^\n]*\n)+/, '')
      // 偏好垂直排列（橫的會被擠到很小）：LR／RL 一律改成 TD
      .replace(/^(\s*(?:flowchart|graph))\s+(?:LR|RL)\b/m, '$1 TD')
      .replace(/(-->|-\.->|==>|---|-\.-|===)[ \t]+\|/g, '$1|')
      .replace(WIDE, ch => ch + PAD)
    const draw = (px: number, bp: number) =>
      renderMermaidAscii(cleaned, { useAscii: false, colorMode: 'none', paddingX: px, paddingY: 1, boxBorderPadding: bp })
    art = draw(3, 1)
    // 流程圖：在放得下的前提下只把節點之間的水平間距逐級加大（框保持緊湊，和原版一樣），讓圖盡量撐滿寬度（不再縮在左邊一小條）
    if (kind === 'flowchart') {
      const target = Math.floor(maxWidth * 0.94)
      for (const [px, bp] of GROW) {
        const bigger = draw(px, bp)
        if (Math.max(...bigger.split('\n').map(l => l.length)) > target) break
        art = bigger
      }
    }
  } catch {
    return null
  }
  let lines = art.replace(/[ \t]+$/gm, '').split('\n')
  // 時序圖：拿掉只有生命線的空白列，圖更緊湊
  if (kind === 'sequence') lines = lines.filter(l => !/^[\s│]*$/.test(l))
  while (lines.length && !lines[0]!.trim()) lines.shift()
  while (lines.length && !lines.at(-1)!.trim()) lines.pop()
  let grid = lines.map(l => [...l.replace(/▶/g, '►').replace(/◀/g, '◄')])
  // 時序圖底部重複一排角色框，資訊重複，拿掉；生命線收在最後一則訊息下方
  if (kind === 'sequence') {
    const bottom = findRects(grid).filter(b => b.r2 === grid.length - 1)
    const top = Math.min(...bottom.map(b => b.r))
    if (bottom.length && top > 3) grid = grid.slice(0, top)
  }
  const width = Math.max(0, ...grid.map(row => row.length))
  if (width === 0 || width > maxWidth) return null

  const rects = findRects(grid)
  const cells: Cell[][] = grid.map(row => row.map(ch => ({ ch })))
  const owner: (number | undefined)[][] = grid.map(row => row.map(() => undefined))

  // 參與者（時序圖頂／底列的框）與節點各給一個色調；同名的框同色
  const tones = new Map<string, (typeof TONES)[number]>()
  const isActor = (b: Rect) => kind === 'sequence' && b.r === 0
  const actors = rects.filter(isActor)
  const toneFor = (b: Rect) => {
    if (kind === 'sequence' && !isActor(b)) return NOTE
    if (!tones.has(b.label)) tones.set(b.label, TONES[tones.size % TONES.length]!)
    return tones.get(b.label)!
  }
  rects.forEach((b, i) => {
    const tone = toneFor(b)
    for (let y = b.r; y <= b.r2; y++) {
      for (let x = b.c; x <= b.c2; x++) {
        const cell = cells[y]![x]
        if (!cell) continue
        owner[y]![x] = i
        const edge = y === b.r || y === b.r2 || x === b.c || x === b.c2
        if (edge) {
          cell.ch = ROUND[cell.ch] ?? cell.ch
          cell.fg = tone.fg
        } else {
          cell.bg = tone.bg
          cell.fg = tone.fg
          cell.bold = isActor(b) || kind === 'flowchart'
        }
      }
    }
  })

  // 時序圖：依參與者中心欄，替訊息箭頭上發送者的顏色
  const centers = kind === 'sequence'
    ? actors.map(b => ({ x: Math.round((b.c + b.c2) / 2), tone: toneFor(b) }))
    : []
  const nearest = (x: number) => centers.reduce((best, a) => (Math.abs(a.x - x) < Math.abs(best.x - x) ? a : best), centers[0]!)

  cells.forEach((row, y) => {
    // 先處理整段水平箭頭
    if (kind === 'sequence' && centers.length) {
      let x = 0
      while (x < row.length) {
        if (owner[y]![x] !== undefined || !/[─╌►◄]/.test(row[x]!.ch)) { x++; continue }
        let end = x
        while (end + 1 < row.length && owner[y]![end + 1] === undefined && /[─╌►◄┼]/.test(row[end + 1]!.ch)) end++
        if (end > x) {
          const tailAtLeft = row[end]!.ch === '►' || row[x]!.ch !== '◄'
          const sender = nearest(tailAtLeft ? x : end)
          for (let k = x; k <= end; k++) {
            const isHead = ARROW.test(row[k]!.ch)
            row[k]!.fg = isHead ? P.arrow : sender.tone.fg
            row[k]!.bold = isHead
          }
        }
        x = end + 1
      }
    }
    row.forEach((cell, x) => {
      if (owner[y]![x] !== undefined || cell.fg) return
      if (cell.ch === PAD || cell.ch === ' ') return
      if (kind === 'sequence' && cell.ch === '│') {
        cell.ch = '┆'
        cell.fg = P.lifeline
      } else if (ARROW.test(cell.ch)) {
        cell.fg = P.arrow
        cell.bold = true
      } else if (LINE.test(cell.ch)) {
        cell.ch = ROUND[cell.ch] ?? cell.ch
        cell.fg = P.line
      } else {
        // 連線上的標籤文字
        cell.fg = kind === 'flowchart' ? P.sub : P.text
        cell.italic = kind === 'flowchart'
      }
    })
  })

  const rows = cells.map(row => row.filter(cell => cell.ch !== PAD))
  const plain = rows.map(row => row.map(cell => cell.ch).join('').trimEnd()).join('\n')
  const title = kind === 'sequence' ? '時序圖' : '流程圖'
  const count = kind === 'sequence' ? actors.length : rects.length
  const meta = kind === 'sequence' ? `${count} 個角色` : `${count} 個節點`
  return { kind, title, meta, rows, art: plain, width }
}
