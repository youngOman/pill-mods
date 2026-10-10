# pill-mods

三個 Claude Code mod（需要 Claude Code 2.1.291 以上；終端字型用 Nerd Font，膠囊圓角和複製圖示會用到）：

| mod | 效果 |
|---|---|
| pill-steps | 每輪結束後，輸入框上方一列一個繁中「下一步」膠囊。空白輸入框按 1～3 帶入、0 略過，也可以用滑鼠點；hover 會變亮。每輪多一次 Haiku 呼叫（上限 200 token） |
| pill-copy | 回答裡每個區塊（code、表格、清單、引用）右上角一個複製圖示，點了複製並顯示 ✓ Copied! |
| image-peek | 貼圖後在輸入框上方顯示縮圖（修正原版 image-view 在新版 Claude Code 找不到圖的問題） |

## 安裝

```
claude plugin marketplace add youngOman/pill-mods
claude plugin install pill-steps@pill-mods --scope user
claude plugin install pill-copy@pill-mods --scope user
claude plugin install image-peek@pill-mods --scope user
```

裝完重開 Claude Code session（`/exit`，再照畫面印出的 `claude --resume …` 接回）。

有裝原版 next-steps、copy-band、image-view 的話先停用，免得重複顯示：

```
claude plugin disable next-steps@claude-code-mods
claude plugin disable copy-band@claude-mods
claude plugin disable image-view@claude-image-view
```

## 更新

```
claude plugin marketplace update pill-mods
claude plugin update pill-steps@pill-mods
claude plugin update pill-copy@pill-mods
claude plugin update image-peek@pill-mods
```

## 來源

改自 hamzafer/claude-code-mods 的 next-steps、yash-gadodia/claude-mods 的 copy-band、jarrodwatts/claude-image-view（MIT）。
