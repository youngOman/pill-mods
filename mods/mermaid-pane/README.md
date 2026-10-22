# mermaid-pane

A Claude Code mod that draws mermaid diagrams **right in the conversation**: any ` ```mermaid ` block in Claude's reply is replaced by a picture, so you see the architecture instead of raw `flowchart` text.

- Dark theme that matches the terminal; Chinese labels render correctly.
- Rendered once per diagram (cached by content) in about 2 s; shows "Drawing diagram…" while it works.
- Pictures use the kitty graphics protocol, so you need a terminal that has it (Ghostty, kitty, cmux).

## Setup

Needs Node and Google Chrome (macOS path `/Applications/Google Chrome.app`). Install the renderer once for fast draws: `PUPPETEER_SKIP_DOWNLOAD=1 npm i -g @mermaid-js/mermaid-cli`. Without it the first render goes through `npx` and takes about 30 s.

```
/plugin marketplace add youngOman/pill-mods
/plugin install mermaid-pane@pill-mods
/reload-plugins
```

Pictures and their sources are kept in `~/.claude/mermaid-pane/`.
