// Next Steps: after each turn, 2 or 3 likely next prompts above the input.
// In an empty prompt, 1 to 3 drafts one (nothing sends on its own) and 0 dismisses.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextSteps } from '../types'

const MODEL = 'haiku'
const MAX_ITEMS = 3
const MAX_CHARS = 60 // what the model is asked for
const MAX_KEPT = 120 // a longer line is dropped, never cut: a cut draft would send half a prompt
const MIN_ANSWER = 20 // a reply shorter than this is not worth a model call

// Held by the host, so the list survives a hot reload of this file.
const steps = atom({ plugin: 'pill-steps', key: 'steps' } as const, null as NextSteps | null)
// True while the list is on screen. where-am-i reads it and leaves out its own "next" meanwhile.
const active = atom({ plugin: 'pill-steps', key: 'active' } as const, false)

export const register: Register = on => {
  // The turn a suggestion may still be shown for. A submit or a new turn moves it on.
  let latest = ''
  let submits = 0
  // A survey answers bare digits in the band: leave them to it.
  let hasSurvey = false

  on('prompt.submit', async ($, e, next) => {
    latest = `submit-${++submits}`
    await setSteps($, () => null)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    latest = e.turnId
    await setSteps($, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r // a subagent's turn, not the person's
    latest = e.turnId // also for a turn that raised no turn.start, and after a hot reload
    if (e.reason !== 'answer' || e.answer.trim().length < MIN_ANSWER) return r
    void suggest($, e.turnId, e.answer, () => latest).catch(() => {}) // in the background, so the turn ends at once
    return r
  })

  // A digit typed into an empty prompt picks a suggestion instead of landing as text.
  // A paste carries no key, so a pasted "1" lands as typed.
  on('prompt.edit', async ($, e, next) => {
    if (hasSurvey || !e.key || e.key.ctrl || e.key.meta || e.text !== '' || e.start !== 0 || e.end !== 0 || !/^[0-9]$/.test(e.inputText)) return next(e)
    const s = await read($, steps)
    if (!s) return next(e)
    if (e.inputText === '0') {
      await setSteps($, () => null)
      return { text: '', cursor: 0 } // consumed: the box stays empty
    }
    const pick = s.items[Number(e.inputText) - 1]
    if (!pick) return next(e)
    return next({ ...e, inputText: pick }) // a draft: the person edits it or presses Enter
  })

  // 點膠囊：數字或文字都把那句放進輸入框當草稿（不會直接送出）；點「略過」收起
  on('ui.press', { plugin: 'pill-steps' }, async ($, e, next) => {
    const m = /^step:(\d+)(?::text)?$/.exec(e.element)
    if (e.element === 'step:dismiss' || e.element === 'step:dismiss:text') {
      await setSteps($, () => null)
      return { element: e.element }
    }
    if (!m) return next(e)
    const s = await read($, steps)
    const pick = s?.items[Number(m[1])]
    if (!pick) return next(e)
    await $.prompt.fill({ text: pick })
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    hasSurvey = e.props.hasSurvey
    const s = await read($, steps)
    if (e.props.hasSurvey || e.props.isWorking || !s || s.items.length === 0) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    // 圓角膠囊（Nerd Font 的  ）：Claude 橘的數字＋深墨底米白字；滑鼠移上去整顆變亮
    const ORANGE = '#D97757'
    const ORANGE_HI = '#EE9677'
    const INK_HI = '#454860'
    const GREY = '#5B5F6E'
    const GREY_HI = '#7A7F90'
    // 一列一個：數字是小圓角膠囊，文字不上底色（疊起來才不會黏成一塊）；滑鼠移上去整列亮起
    const row = (id: string, key: string, text: string, dim = false) => {
      const head = dim ? GREY : ORANGE
      const headHi = dim ? GREY_HI : ORANGE_HI
      return (
        <Box key={`row:${id}`} flexDirection="row">
          <Text color={head} hover={{ color: headHi }}>{'\uE0B6'}</Text>
          <Box backgroundColor={head} hover={{ backgroundColor: headHi }}>
            <Button key={`step:${id}`} plain label={key} hover={{ bold: true }} onPress={() => undefined} />
          </Box>
          <Text color={head} hover={{ color: headHi }}>{'\uE0B4'}</Text>
          <Box paddingX={1} hover={{ backgroundColor: INK_HI }}>
            <Button key={`step:${id}:text`} plain dimColor={dim} label={text} hover={{ bold: true }} onPress={() => undefined} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1} columnGap={2}>
          <Text color={ORANGE} bold>{'✻ 下一步'}</Text>
          <Box flexDirection="column">
            {s.items.map((t, i) => row(String(i), String(i + 1), t))}
            {row('dismiss', '0', '略過', true)}
          </Box>
        </Box>
        {rest}
      </Box>
    )
  })
}

// Writes the list, then whether it shows, for where-am-i.
async function setSteps($: EngineInterface, fn: (before: NextSteps | null) => NextSteps | null) {
  const after = await update($, steps, fn)
  const showing = after !== null && after.items.length > 0
  if ((await read($, active)) !== showing) await update($, active, () => showing)
}

// The whole list on one row, or one suggestion per row when it would not fit.
// 中文字在終端占 2 格；每顆膠囊另有兩端圓角、數字段與內距約 8 格，標籤與「略過」約 20 格
const cells = (s: string) => [...s].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0)
export function fitsOnOneLine(items: string[], columns: number) {
  return items.reduce((n, s) => n + cells(s) + 11, 20) <= columns
}

async function suggest($: EngineInterface, turnId: string, answer: string, current: () => string) {
  // Wait for background agents: the main agent picks up again once they finish.
  const agents = await $.agent.list().catch(() => [])
  if (agents.some(a => a.status === 'running')) return

  const all = (await $.session.messages().catch(() => [])).filter(m => m.text.trim() !== '')
  if (all.at(-1)?.role === 'assistant') all.pop() // the latest reply goes in on its own below
  const messages = all.slice(-6)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 200,
    timeoutMs: 20_000,
    system:
      'You predict what a person will type next to their coding assistant, after reading a transcript of their session. ' +
      'Give 2 or 3 short, concrete follow-up prompts, each an instruction in the imperative, written in Traditional Chinese (Taiwan usage, 繁體中文), ' +
      'at most 24 Chinese characters each; keep file names, commands and code identifiers as they are. ' +
      'Specific to what just happened (name the file, test or feature). No em dashes, no numbering, no quotes. ' +
      'One per line and nothing else. If nothing sensible follows, reply with the single word NONE.\n' +
      'Example reply:\n再跑一次登入測試\n把同樣的檢查加到 signup.ts\n開一個 draft PR',
    prompt: [
      `<transcript>\n${messages.map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, 800)}`).join('\n')}\n</transcript>`,
      `<latest_reply>\n${answer.slice(0, 2000)}\n</latest_reply>`,
      'Write the follow-up prompts the person is likely to send next: the lines only, not a reply to the transcript.',
    ].join('\n\n'),
  })
  if (!r.isAnswered) return
  const items = parseSteps(r.text)
  // Checked inside the write, so a submit or a new turn that lands meanwhile always wins.
  await setSteps($, before => (current() !== turnId ? before : items.length > 0 ? { turnId, items } : null))
}

// The model's lines, cleaned: no fences, bullets, numbers or em dashes; at most three.
// A preamble, a "nothing to add" or a line too long to draft whole is dropped.
export function parseSteps(text: string): string[] {
  const body = text.replace(/```[a-z]*\n?/gi, '').trim()
  let lines = body.split('\n')
  if (body.startsWith('[') || body.startsWith('{')) {
    try {
      const o = JSON.parse(body) as unknown
      const arr = Array.isArray(o) ? o : Object.values(o as Record<string, unknown>).find(Array.isArray)
      lines = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      // not JSON after all: read it as lines
    }
  }
  const out: string[] = []
  for (const line of lines) {
    const clean = line
      .replace(/\*\*/g, '')
      .replace(/^\s*(?:[-*•]|\d+[.):])\s*/, '')
      .replace(/^["'`]+|["'`,]+$/g, '')
      .replace(/\s*\u2014\s*/g, ', ')
      .replace(/\.$/, '')
      .trim()
    if (clean === '' || clean.endsWith(':') || clean.length > MAX_KEPT) continue
    if (/^(none|no |nothing|here are|here's|sure)/i.test(clean) || /^[[\]{}]$/.test(clean)) continue
    if (!out.some(o => o.toLowerCase() === clean.toLowerCase())) out.push(clean)
    if (out.length === MAX_ITEMS) break
  }
  return out
}
