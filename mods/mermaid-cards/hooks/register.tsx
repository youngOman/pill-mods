import type { EngineInterface, ElementTable, Register, RenderElement, RenderSurface } from 'claude-code'

import type { Cell, Diagram } from './diagram'
import { P, buildDiagram } from './diagram'

type Segment = { kind: 'markdown'; text: string } | { kind: 'mermaid'; source: string; fenced: string }

// 依 ```mermaid 區塊把回覆切段；其他段落原樣保留
export const splitSegments = (text: string): Segment[] => {
  const out: Segment[] = []
  const lines = text.split('\n')
  let buf: string[] = []
  const flush = () => {
    if (buf.join('\n').trim()) out.push({ kind: 'markdown', text: buf.join('\n') })
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*mermaid\s*$/i.exec(lines[i]!)
    if (!open) {
      buf.push(lines[i]!)
      continue
    }
    const fence = open[2]!
    let j = i + 1
    while (j < lines.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(lines[j]!)) j++
    if (j >= lines.length) {
      buf.push(...lines.slice(i))
      break
    }
    flush()
    out.push({ kind: 'mermaid', source: lines.slice(i + 1, j).join('\n'), fenced: lines.slice(i, j + 1).join('\n') })
    i = j
  }
  flush()
  return out
}

// 同一列內樣式相同的格子合併成一段 Text
const drawRow = ({ Text }: ElementTable, row: Cell[], key: string): RenderElement => {
  const parts: RenderElement[] = []
  let at = 0
  while (at < row.length) {
    const a = row[at]!
    let end = at + 1
    while (end < row.length && row[end]!.fg === a.fg && row[end]!.bg === a.bg && row[end]!.bold === a.bold && row[end]!.italic === a.italic) end++
    const text = row.slice(at, end).map(c => c.ch).join('')
    parts.push(<Text key={`${key}.${at}`} color={a.fg} backgroundColor={a.bg} bold={a.bold} italic={a.italic}>{text}</Text>)
    at = end
  }
  return <Text key={key}>{parts.length ? parts : ' '}</Text>
}

const drawCard = ($: EngineInterface, el: ElementTable, d: Diagram, source: string, key: string): RenderElement => {
  const { Box, Text, Button } = el
  const copy = (text: string, done: string) => (press: { surface?: RenderSurface }) => {
    $.ui.copy({ text, surface: press.surface })
      .then(r => $.ui.toast(r.isCopied ? done : `複製失敗：${r.reason}`))
      .catch(() => $.ui.toast('複製失敗'))
  }
  return (
    <Box key={key} flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={P.frame} paddingX={2}>
      <Box flexDirection="row" columnGap={3}>
        <Text>
          <Text color={P.accent}>◆ </Text>
          <Text bold color={P.text}>{d.title}</Text>
          <Text color={P.sub}>{`  ${d.meta}`}</Text>
        </Text>
        <Box flexGrow={1} />
        <Button key={`${key}.src`} plain label="⧉ 原始碼" onPress={copy(source, '已複製 mermaid 原始碼')} />
        <Button key={`${key}.art`} plain label="⧉ 文字圖" onPress={copy(d.art, '已複製文字圖')} />
      </Box>
      <Text color={P.frame}> </Text>
      {d.rows.map((row, i) => drawRow(el, row, `${key}.r${i}`))}
    </Box>
  )
}

const markdown = (el: ElementTable, text: string, key: string): RenderElement => <el.Markdown key={key} text={text} />

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!/^\s*(`{3,}|~{3,})\s*mermaid\s*$/im.test(e.props.text)) return next(e)
    const columns = Math.max(20, (e.viewport?.columns ?? 100) - 4)
    const room = columns - 2 - 6 // 左側圓點 2 格，卡片框線與內距 6 格
    const segments = splitSegments(e.props.text)
    const diagrams = segments.map(s => (s.kind === 'mermaid' ? buildDiagram(s.source, room) : null))
    if (!diagrams.some(Boolean)) return next(e)

    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const parts = await Promise.all(
      segments.map(async (s, i) => {
        const d = diagrams[i]
        if (s.kind === 'mermaid' && d) return drawCard($, el, d, s.source, `mc${i}`)
        // 不支援的圖（xychart 等）或一般段落用引擎內建的 Markdown 畫
        return markdown(el, s.kind === 'mermaid' ? s.fenced : s.text, `md${i}`)
      }),
    )
    return (
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color={P.accent}>{e.props.isFirstOfReply ? '●' : ' '}</Text>
        </Box>
        <Box flexDirection="column" rowGap={1} flexGrow={1}>
          {parts}
        </Box>
      </Box>
    )
  })
}
