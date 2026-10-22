# mermaid-cards

A Claude Code mod that draws ` ```mermaid ` flowcharts and sequence diagrams in the conversation as colored cards, in plain text (selectable, no image support needed).

- **Vertical by default**: `flowchart LR` / `RL` are redrawn top-down so the diagram stays large and readable.
- **Colors from the cmux theme** (GitHub Dark High Contrast): bright borders, tinted node fills, high-contrast text. Edit `P` and `TONES` in `hooks/diagram.ts` to match another theme.
- Each card has `⧉ 原始碼` (mermaid source) and `⧉ 文字圖` (plain-text art) copy buttons.
- Chinese labels line up (full-width characters are measured as two cells).

Based on mermaid-cards (xian); layout uses the MIT-licensed mermaid-text from prismantis (see `hooks/vendor/LICENSE-prismantis`). No prismantis plugin is required.

```
/plugin marketplace add youngOman/pill-mods
/plugin install mermaid-cards@pill-mods
/reload-plugins
```
