/* @jsx h */
import type { EngineInterface, Register } from 'claude-code'

// Every code block and quoted draft in the last answer, as a pressable button above the prompt.
//
// A press runs pbcopy in the plugin's own environment: no model turn, no tokens, no waiting for a
// reply that says "copied". Digits press from an empty composer, the mouse presses anywhere.
//
// The band only ever shows the last answer, so each block is also appended to a stash file that
// outlives the session; /stash lists it and /stash 7 puts an old one back on the clipboard, which is
// the part a clipboard manager cannot do (it holds what was copied, not what was offered).
//
// 0 toggles WhatsApp mode: the copy is wrapped in a triple-backtick fence, which Telegram renders
// as a native click-to-copy block and WhatsApp as monospace.

const MAX_BLOCKS = 9
const STASH_KEEP = 60
const LABEL_WIDTH = 20
const WA_KEY = 'pill-copy:wa'
// 複製提示停留的時間：夠看清楚就好，太長會一直擋在右上角
const TOAST_MS = 900

type Block = { label: string; text: string }

let blocks: Block[] = []
let wa = false
let stashPath: string | undefined
let stashed = 0

const clean = (text: string) => text.replace(/\s+$/, '').replace(/^\n+/, '')

// The first line says more than the language does, so the language is dropped unless the block had
// no fence to announce it (a quoted draft) or no first line worth reading.
const label = (text: string, lang: string) => {
  const first = (text.split('\n').find((l) => l.trim()) ?? '').trim()
  const shown = lang === '表格' ? first.replace(/^\|\s*/, '').split('|')[0]?.trim() ?? '' : lang === '清單' ? first.replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/\*\*/g, '') : first
  const head = lang === 'draft' || lang === '表格' || lang === '清單' || !first ? `${lang} ${shown}`.trim() : first
  return head.length > LABEL_WIDTH ? `${head.slice(0, LABEL_WIDTH - 1)}…` : head
}

// Fenced blocks of any language, plus runs of quoted lines, which is how a draft message arrives.
export const parse = (answer: string): Block[] => {
  const found: Block[] = []
  const add = (raw: string, lang: string) => {
    const text = clean(raw)
    if (text.length < 3) return
    if (found.some((b) => b.text === text)) return
    found.push({ label: label(text, lang), text })
  }

  let fence: string | undefined
  let lang = ''
  let body: string[] = []
  let quote: string[] = []
  // 表格與條列清單也各算一個區塊，讓每段都能複製
  let table: string[] = []
  let list: string[] = []
  const flushQuote = () => {
    if (quote.length) add(quote.join('\n'), 'draft')
    quote = []
    if (table.length >= 2) add(table.join('\n'), '表格')
    table = []
    if (list.length) add(list.join('\n'), '清單')
    list = []
  }

  for (const line of answer.split('\n')) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence !== undefined) {
      const mark = open?.[1]
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !(open?.[2] ?? '').trim()) {
        add(body.join('\n'), lang)
        fence = undefined
        body = []
        continue
      }
      body.push(line)
      continue
    }
    if (open?.[1]) {
      flushQuote()
      fence = open[1]
      lang = (open[2] ?? '').trim()
      body = []
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      quote.push(line.replace(/^\s*>\s?/, ''))
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!table.length) flushQuote()
      table.push(line)
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+\S/.test(line) || (list.length && /^\s{2,}\S/.test(line))) {
      if (!list.length) flushQuote()
      list.push(line)
      continue
    }
    flushQuote()
  }
  if (fence !== undefined) add(body.join('\n'), lang)
  flushQuote()

  return found.slice(0, MAX_BLOCKS)
}

const wrap = (text: string) => (wa ? `\`\`\`\n${text}\n\`\`\`` : text)

const copy = async ($: EngineInterface, block: Block): Promise<void> => {
  const payload = wrap(block.text)
  // 按下去的瞬間就先跳提示（pbcopy 通常在幾十毫秒內完成），失敗再補一則錯誤
  $.ui.toast(`✓ 已複製  ${block.label}${wa ? '（WhatsApp 格式）' : ''}`, { timeoutMs: TOAST_MS })
  const r = await $.process
    .run(['pbcopy'], { stdin: payload, timeoutMs: 5000 })
    .catch((err) => {
      $.ui.toast(`copy failed: ${err}`, { timeoutMs: 6000 })
      return undefined
    })
  if (!r || r.exitCode !== 0) return
}

// tee appends without a shell, so nothing here is quoted into one. One JSON object per line.
const stash = async ($: EngineInterface, entries: Block[]): Promise<void> => {
  if (!stashPath || !entries.length) return
  const at = await $.clock.now().catch(() => Date.now())
  const lines = entries.map((b) => JSON.stringify({ at, label: b.label, text: b.text })).join('\n')
  await $.process.run(['tee', '-a', stashPath], { stdin: `${lines}\n`, timeoutMs: 5000 }).catch((err) =>
    $.ui.log(`copy-band: stash write failed: ${err}`),
  )
}

const readStash = async ($: EngineInterface): Promise<Block[]> => {
  if (!stashPath) return []
  const r = await $.process.run(['tail', '-n', String(STASH_KEEP), stashPath], { timeoutMs: 5000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) return []
  const out: Block[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as { label?: unknown; text?: unknown }
      if (typeof entry.text === 'string' && typeof entry.label === 'string') out.push({ label: entry.label, text: entry.text })
    } catch {
      // A truncated line from a killed write is skipped rather than costing the whole stash.
    }
  }
  return out.reverse()
}

// The blocks of one transcript message, memoised: a render hook runs on every frame the message is
// drawn in, and parsing the same markdown each time would cost the scrollback its speed.
const inlineCache = new Map<string, Block[]>()
const inlineById = new Map<string, Block[]>()
const blocksFor = (text: string): Block[] => {
  const hit = inlineCache.get(text)
  if (hit) return hit
  const found = parse(text)
  if (inlineCache.size > 200) {
    inlineCache.clear()
    inlineById.clear()
  }
  inlineCache.set(text, found)
  inlineById.set(digest(text), found)
  return found
}

// A stable address for a Button drawn in the transcript, where many messages draw a row each and a
// repeated key would collide between them.
const digest = (text: string) => {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// The Button a press names, by its key: the band's `copy:N`, the transcript's `inline:<digest>:N`.
const blockAt = (element: string): Block | undefined => {
  const band = /^copy:(\d+)$/.exec(element)
  if (band) return blocks[Number(band[1])]
  const inline = /^inline:([^:]+):(\d+)$/.exec(element)
  if (inline) return inlineById.get(inline[1] ?? '')?.[Number(inline[2])]
  return undefined
}

// The status line under the prompt outlives a collapsed band, so the count of what is on offer
// stays on screen when the buttons do not.
// 底部只留給下一步：不顯示狀態列提示，也清掉舊版留下的
const status = ($: EngineInterface): void => {
  $.ui.status(undefined)
}

// The first thing anyone does when a mod misbehaves is try to turn it off. `CLAUDE_MODS_DISABLE=all`,
// or a comma list naming this mod, makes every hook here a pass-through and registers no command.
const MOD = 'pill-copy'
let disabled = false
const readDisabled = async ($: EngineInterface): Promise<boolean> => {
  const raw = (await $.env.get('CLAUDE_MODS_DISABLE').catch(() => undefined)) ?? ''
  disabled = raw
    .split(',')
    .map(v => v.trim())
    .some(v => v === 'all' || v === MOD)
  return disabled
}

// 把回答切成依序的段落：一般文字，以及 parse() 會認成區塊的段（code、引用、表格、清單）。
// copy 是該區塊複製出去的內容，與 parse() 的 text 相同，用來對回按鈕的編號。
type Segment = { md: string; copy?: string }
export const segments = (answer: string): Segment[] => {
  const out: Segment[] = []
  let prose: string[] = []
  let cur: { kind: 'fence' | 'quote' | 'table' | 'list'; lines: string[]; body: string[]; mark?: string } | undefined
  const flushProse = () => {
    if (prose.join('').trim()) out.push({ md: prose.join('\n') })
    prose = []
  }
  const flushCur = () => {
    if (!cur) return
    const md = cur.lines.join('\n')
    const copy = clean(cur.body.join('\n'))
    const isBlock = copy.length >= 3 && (cur.kind !== 'table' || cur.lines.length >= 2)
    if (isBlock) out.push({ md, copy })
    else prose.push(...cur.lines)
    cur = undefined
  }
  for (const line of answer.split('\n')) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (cur?.kind === 'fence') {
      cur.lines.push(line)
      const m = open?.[1]
      if (m && cur.mark && m[0] === cur.mark[0] && m.length >= cur.mark.length && !(open?.[2] ?? '').trim()) flushCur()
      else cur.body.push(line)
      continue
    }
    const kind = open?.[1] ? 'fence'
      : /^\s*>\s?/.test(line) ? 'quote'
      : /^\s*\|.*\|\s*$/.test(line) ? 'table'
      : /^\s*([-*+]|\d+[.)])\s+\S/.test(line) || (cur?.kind === 'list' && /^\s{2,}\S/.test(line)) ? 'list'
      : undefined
    if (kind && cur?.kind === kind) {
      cur.lines.push(line)
      cur.body.push(kind === 'quote' ? line.replace(/^\s*>\s?/, '') : line)
      continue
    }
    flushCur()
    if (!kind) { prose.push(line); continue }
    flushProse()
    cur = kind === 'fence'
      ? { kind, lines: [line], body: [], mark: open![1] }
      : { kind, lines: [line], body: [kind === 'quote' ? line.replace(/^\s*>\s?/, '') : line] }
  }
  flushCur()
  flushProse()
  return out
}

// 圓角膠囊（Nerd Font 的  ）：Claude 橘底、深色字
const ORANGE = '#D97757'
const INK = '#1B1B1F'
// 區塊外框：薄荷綠圓角卡片，讓每段重點跳出來
const FRAME = '#6EE7B7'
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if (await readDisabled($)) return r
    if ((await $.store.get(WA_KEY).catch(() => undefined)) === true) wa = true
    const home = await $.env.get('HOME').catch(() => undefined)
    if (home) {
      const dir = `${home}/.claude/copy-stash`
      const made = await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5000 }).catch(() => undefined)
      if (made?.exitCode === 0) {
        stashPath = `${dir}/stash.jsonl`
        stashed = (await readStash($)).length
      }
    }
    await $.command
      .register({
        name: 'stash',
        description: 'Copy a block from the stash: /stash lists, /stash 7 copies, /stash wa toggles the WhatsApp wrap (copy-band)',
        argumentHint: '[n | wa [n]]',
        immediate: true,
      })
      .catch((err) => $.ui.log(`copy-band: /stash not registered: ${err}`))
    return r
  })

  on('command.run', { command: 'stash' }, async ($, e) => {
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const toggle = args[0] === 'wa'
    const rest = toggle ? args.slice(1) : args

    if (toggle && !rest.length) {
      wa = !wa
      await $.store.set(WA_KEY, wa).catch(() => undefined)
      $.ui.invalidate('ui.render')
      return { text: `whatsapp wrap ${wa ? 'on' : 'off'} — copies are fenced with \`\`\`` }
    }

    const entries = await readStash($)
    if (!entries.length) return { text: 'copy stash is empty — it fills as answers come in' }

    const pick = rest[0]
    if (pick === undefined) {
      const list = entries
        .slice(0, 20)
        .map((b, i) => `${String(i + 1).padStart(2)}. ${b.label}${b.text.includes('\n') ? ` (${b.text.split('\n').length} lines)` : ''}`)
        .join('\n')
      return { text: `copy stash, newest first — /stash <n>${wa ? '' : ', /stash wa <n> to fence it'}\n${list}` }
    }

    const n = Number(pick)
    const block = Number.isInteger(n) ? entries[n - 1] : undefined
    if (!block) return { text: `copy-band: no stash entry ${pick} — /stash lists what there is` }

    const was = wa
    if (toggle) wa = true
    await copy($, block)
    wa = was
    return { text: `copied: ${block.label}` }
  })

  on('turn.complete', async ($, e, next) => {
    if (disabled) return next(e)
    const r = await next(e)
    // A subagent's turn carries an agentId and never reaches the person's screen.
    if (e.agentId) return r
    const found = parse(e.answer)
    if (!found.length) {
      if (blocks.length) {
        blocks = []
        status($)
        $.ui.invalidate('ui.render')
      }
      return r
    }
    blocks = found
    await stash($, found)
    stashed += found.length
    status($)
    $.ui.invalidate('ui.render')
    return r
  })

  // A press is answered here rather than in the Button closures: a closure handle belongs to one
  // drawing, and a press that lands during a redraw is dropped by core, while the hook still sees
  // the event and its key.
  on('ui.press', { plugin: MOD }, async ($, e, next) => {
    if (disabled) return next(e)
    if (e.element === 'copy:wa') {
      wa = !wa
      await $.store.set(WA_KEY, wa).catch(() => undefined)
      $.ui.invalidate('ui.render')
      return { element: e.element }
    }
    const block = blockAt(e.element)
    if (!block) return next(e)
    await copy($, block)
    return { element: e.element }
  })

  // 每個區塊在它自己的右上角放一顆複製膠囊：把回答切成段落，區塊段上方靠右畫膠囊，再用 Markdown 畫本體。
  // 只用滑鼠點（hotkey 在 band 以外會被拒）。畫失敗就退回引擎原本的畫法。
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (disabled) return next(e)
    if (e.surface !== 'terminal') return next(e)
    // 含 mermaid 區塊的訊息讓路：交給 mermaid-pane 畫成圖（它自己有下載／複製圖片按鈕），否則會被這裡整則畫成文字。
    if (/^[ \t]*```mermaid/m.test(e.props.text)) return next(e)
    const found = blocksFor(e.props.text)
    if (!found.length) return next(e)
    try {
      const { Box, Text, Button, Markdown } = await $.ui.resolve(e)
      const id = digest(e.props.text)
      const segs = segments(e.props.text)
      return (
        <Box flexDirection="column">
          {segs.map((s, k) => {
            const i = s.copy === undefined ? -1 : found.findIndex((b) => b.text === s.copy)
            if (i < 0) return <Markdown key={`seg:${id}:${k}`} text={s.md} />
            return (
              <Box key={`seg:${id}:${k}`} flexDirection="row" borderStyle="round" borderColor={FRAME} paddingX={1}>
                {/* 圖示跟內容同一列、靠右上角，不獨立佔一列（負邊距會讓它被裁掉，別用） */}
                <Box flexGrow={1} flexDirection="column">
                  <Markdown text={s.md} />
                </Box>
                <Box flexShrink={0} marginLeft={1} alignSelf="flex-start">
                  <Button key={`inline:${id}:${i}`} variant="primary" label={'\u{F018F}'} hover={{ bold: true }} onPress={() => undefined} />
                </Box>
              </Box>
            )
          })}
        </Box>
      )
    } catch (err) {
      $.ui.log(`pill-copy: inline render failed: ${err}`)
      return next(e)
    }
  })
}
