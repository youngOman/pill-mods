import type { EngineInterface, Register } from 'claude-code'

import type { Rendered } from '../types'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MAX_ROWS = 70
// 配色對齊深色終端：深藍底、cyan 邊框、淺灰線。
const THEME = {
  theme: 'base',
  themeVariables: {
    background: 'transparent',
    primaryColor: '#1E2D4A',
    primaryBorderColor: '#7DD3FC',
    primaryTextColor: '#FFFFFF',
    secondaryColor: '#1E2D4A',
    tertiaryColor: 'transparent',
    lineColor: '#CBD5E1',
    textColor: '#FFFFFF',
    edgeLabelBackground: 'transparent',
    clusterBkg: 'transparent',
    clusterBorder: '#64748B',
    titleColor: '#FFFFFF',
    fontSize: '20px',
    fontFamily: 'PingFang TC, Noto Sans TC, sans-serif',
  },
  flowchart: { nodeSpacing: 40, rankSpacing: 50, padding: 16, curve: 'basis', htmlLabels: true },
}
// 改樣式時遞增，舊快取的圖才會重畫。
const STYLE = 'v4'

// 以 mermaid 原始碼的雜湊為鍵：同一張圖只畫一次。繪圖階段不准寫 $.state，所以只用模組變數。
const cache = new Map<string, Rendered>()
const inflight = new Map<string, Promise<Rendered>>()
let dir: string | undefined

/** Width and height from a PNG's IHDR chunk, or null when the bytes aren't a PNG. */
function pngSize(base64: string): { width: number; height: number } | null {
  const head = Uint8Array.from(atob(base64.slice(0, 32)), char => char.charCodeAt(0))
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (head.length < 24 || signature.some((byte, i) => head[i] !== byte)) return null
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : null
}

function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

type Part = { kind: 'text'; text: string } | { kind: 'mermaid'; code: string }

/** Splits a reply into prose and ```mermaid blocks, in order. */
function split(text: string): Part[] {
  const parts: Part[] = []
  let last = 0
  for (const m of text.matchAll(/^[ \t]*```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) })
    parts.push({ kind: 'mermaid', code: (m[1] ?? '').trim() })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

async function outDir($: EngineInterface): Promise<string> {
  if (dir) return dir
  const { stdout } = await $.process.run([
    'sh', '-c', 'mkdir -p "$HOME/.claude/mermaid-pane" && printf %s "$HOME/.claude/mermaid-pane"',
  ])
  dir = stdout.trim()
  await $.fs.write(`${dir}/theme.json`, JSON.stringify(THEME))
  await $.fs.write(`${dir}/chrome.json`, JSON.stringify({ executablePath: CHROME, args: ['--no-sandbox'] }))
  return dir
}

/** Renders one mermaid source to a PNG; mmdc if installed, else npx (slower the first time). */
async function render($: EngineInterface, key: string, code: string): Promise<Rendered> {
  const base = await outDir($)
  const input = `${base}/${key}.mmd`
  const output = `${base}/${key}.png`
  if (await $.fs.exists(output)) {
    const size = await $.fs.read(output, { as: 'bytes' }).then(({ base64 }) => pngSize(base64), () => null)
    return { file: output, size }
  }
  await $.fs.write(input, prepare(code))
  const run = await $.process.run(
    [
      'sh', '-c',
      'M=$(command -v mmdc || echo "npx -y @mermaid-js/mermaid-cli"); ' +
        'PUPPETEER_SKIP_DOWNLOAD=1 $M -q -i "$1" -o "$2" -p "$3" -c "$4" -s 2 -b transparent',
      'sh', input, output, `${base}/chrome.json`, `${base}/theme.json`,
    ],
    { timeoutMs: 180_000 },
  ).catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  if (run.exitCode !== 0) {
    await $.fs.write(`${base}/${key}.err`, `exit ${run.exitCode}\n${run.stderr}\n${run.stdout}`).catch(() => undefined)
  }
  if (run.exitCode !== 0) return { file: null, size: null, error: (run.stderr || run.stdout || 'render failed').trim().slice(-200) }
  const size = await $.fs.read(output, { as: 'bytes' }).then(({ base64 }) => pngSize(base64), () => null)
  return { file: output, size }
}

/** 存一份到 ~/Downloads（同名不覆蓋，自動加序號），回報最後檔名。 */
async function download($: EngineInterface, file: string, key: string): Promise<void> {
  const { stdout, exitCode } = await $.process.run([
    'sh', '-c',
    'mkdir -p "$HOME/Downloads"; n="$HOME/Downloads/mermaid-$2.png"; i=1; ' +
      'while [ -e "$n" ]; do i=$((i+1)); n="$HOME/Downloads/mermaid-$2-$i.png"; done; cp "$1" "$n" && printf %s "$n"',
    'sh', file, key,
  ])
  if (exitCode === 0) void $.ui.toast(`已存到 ${stdout.trim().replace(/^.*\/Downloads\//, '~/Downloads/')}`)
  else void $.ui.toast('下載失敗')
}

/** 把圖片放進剪貼簿（macOS），可直接貼到簡報、聊天。 */
async function copyImage($: EngineInterface, file: string): Promise<void> {
  const { exitCode } = await $.process.run([
    'osascript', '-e', `set the clipboard to (read (POSIX file "${file}") as «class PNGf»)`,
  ])
  void $.ui.toast(exitCode === 0 ? '已複製圖片' : '複製失敗')
}

/** 流程圖：LR／RL 改垂直（橫的會被擠小）。其他圖種原樣。 */
function prepare(code: string): string {
  return code.replace(/^(\s*(?:flowchart|graph))\s+(?:LR|RL)\b/m, '$1 TD')
}

/** 渲染一張圖（同一張只跑一次）；只能在不會被取消的 hook（turn.complete）裡呼叫。 */
function ensure($: EngineInterface, code: string): Promise<Rendered> {
  const key = hash(STYLE + code)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  let job = inflight.get(key)
  if (!job) {
    job = render($, key, code).then(value => {
      inflight.delete(key)
      if (value.file) cache.set(key, value)
      return value
    })
    inflight.set(key, job)
  }
  return job
}

const spawned = new Set<string>()
const polls = new Map<string, number>()

/**
 * 背景啟動渲染（shell 立刻返回，所以不會被引擎取消），再用計時器輪詢重繪。
 * 這是 turn.complete 之外的保險：舊訊息、重載後、別的 hook 沒畫到的圖都靠它。
 */
async function kick($: EngineInterface, code: string): Promise<void> {
  const key = hash(STYLE + code)
  const tries = polls.get(key) ?? 0
  if (tries >= 15) return
  polls.set(key, tries + 1)
  if (!spawned.has(key)) {
    spawned.add(key)
    const base = await outDir($)
    await $.fs.write(`${base}/${key}.mmd`, prepare(code))
    await $.process.run([
      'sh', '-c',
      'M=$(command -v mmdc || echo "npx -y @mermaid-js/mermaid-cli"); ' +
        '( PUPPETEER_SKIP_DOWNLOAD=1 nohup $M -q -i "$1" -o "$2" -p "$3" -c "$4" -s 2 -b transparent >"$5" 2>&1 ) >/dev/null 2>&1 &',
      'sh', `${base}/${key}.mmd`, `${base}/${key}.png`, `${base}/chrome.json`, `${base}/theme.json`, `${base}/${key}.log`,
    ])
  }
  $.clock.after(2000, () => $.ui.invalidate('ui.render'))
}

/** 繪圖階段只讀：快取沒有就看磁碟上有沒有已畫好的 PNG。 */
async function lookup($: EngineInterface, code: string): Promise<Rendered | undefined> {
  const key = hash(STYLE + code)
  const hit = cache.get(key)
  if (hit) return hit
  const base = dir ?? (await $.process.run(['sh', '-c', 'printf %s "$HOME/.claude/mermaid-pane"'])).stdout.trim()
  const file = `${base}/${key}.png`
  if (!(await $.fs.exists(file))) return undefined
  const size = await $.fs.read(file, { as: 'bytes' }).then(({ base64 }) => pngSize(base64), () => null)
  const value: Rendered = { file, size }
  cache.set(key, value)
  return value
}

export const register: Register = on => {
  // 回合結束時把這次回覆裡的 mermaid 區塊畫好（這個 hook 不會被重畫取消），再叫畫面重繪。
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const codes = split(e.answer).flatMap(p => (p.kind === 'mermaid' ? [p.code] : []))
    if (codes.length > 0) {
      await Promise.all(codes.map(code => ensure($, code)))
      $.ui.invalidate('ui.render')
    }
    return done
  })

  // 助理訊息裡的 ```mermaid 區塊，在對話中直接換成圖片（原文字不顯示）。
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !/^[ \t]*```mermaid/m.test(e.props.text)) return next(e)
    const parts = split(e.props.text)
    if (!parts.some(p => p.kind === 'mermaid')) return next(e)

    const results: Record<string, Rendered> = {}
    for (const part of parts) {
      if (part.kind !== 'mermaid') continue
      const value = await lookup($, part.code)
      if (value) results[hash(STYLE + part.code)] = value
      else await kick($, part.code)
    }

    const { Box, Text, Markdown, Image, Button } = $.ui.resolve(e)
    const width = Math.max(20, (e.viewport?.columns ?? 100) - 4)

    return (
      <Box flexDirection="column">
        {parts.map(part => {
          if (part.kind === 'text') return part.text.trim() ? <Markdown text={part.text} /> : null
          const key = hash(STYLE + part.code)
          const result = results[key]
          if (result?.error) return <Text color="red">Mermaid render failed: {result.error}</Text>
          if (!result || result.file === null) return <Text dimColor>⏳ Drawing diagram…</Text>
          const size = result.size ?? { width: 16, height: 9 }
          let columns = Math.min(width, 170)
          let rows = Math.round((columns * size.height) / (2 * size.width))
          if (rows > MAX_ROWS) {
            rows = MAX_ROWS
            columns = Math.round((rows * 2 * size.width) / size.height)
          }
          const file = result.file
          return (
            <Box flexDirection="column">
              <Box key={`mermaid-actions-${key}`} flexDirection="row" justifyContent="flex-end" columnGap={1}>
                <Button key={`mermaid-dl-${key}`} variant="primary" label={'\u{F01DA}'} hover={{ bold: true }} onPress={() => void download($, file, key)} />
                <Button key={`mermaid-cp-${key}`} variant="primary" label={'\u{F018F}'} hover={{ bold: true }} onPress={() => void copyImage($, file)} />
              </Box>
              <Image
                key={`mermaid-${key}`}
                source={{ file, format: 'png' }}
                columns={Math.max(4, Math.min(255, columns))}
                rows={Math.max(1, Math.min(255, rows))}
                alt="mermaid diagram"
              />
            </Box>
          )
        })}
      </Box>
    )
  })
}
