# Return Headings

An Obsidian plugin that introduces heading-return markers — a lightweight syntax for re-entering a previous heading depth without creating duplicate visible headings.

---

> **Vibe-coded disclaimer**
>
> This plugin was built with significant AI assistance (Claude Sonnet 4.6 via Claude Code). The ideas, architecture decisions, and review are human; the implementation was generated iteratively and has not been exhaustively tested in production vaults. Use with care, keep backups, and feel free to file issues or open PRs.

---

## Credits

This plugin builds directly on the work of the following projects:

| Project | Author | What we used |
|---------|--------|--------------|
| [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) | Obsidian | Fork base: project scaffold, build system, ESLint config |
| [obsidian-sticky-headings](https://github.com/zhouhua/obsidian-sticky-headings) | zhouhua | Sticky heading bar concept; dual-mode scroll-tracking pattern |
| [obsidian-floating-toc-plugin](https://github.com/pkm-er/obsidian-floating-toc-plugin) | pkm-er | Floating TOC concept; DOM injection strategy; binary-search scroll highlight; per-leaf panel lifecycle |

All three are MIT-licensed. This plugin is also MIT-licensed.

The core intellectual contribution — the heading-return marker syntax and its virtual heading stack semantics — is original to this project.

---

## The problem

Markdown headings create a strictly linear outline. Once you descend to `### H3`, the only native way to return to `## H2` is to write another `## H2` heading. This causes redundant headings or structural workarounds:

```markdown
## Kant
### Space
Notes about space.
### Time
Notes about time.

## Hegel
Notes about Hegel.

### Space       ← is this a new section, or a continuation?
More notes about space under Hegel.
```

---

## The solution

Return Headings introduces two marker syntaxes that adjust the structural context without creating a new visible heading.

### Absolute return — `---hN`

Jump to a specific heading level:

```markdown
# Main Topic

## A
### A1
Text inside A1.

---h2

Text here is now structurally under A, not A1.
```

### Relative return — `---h-N`

Move up N heading levels from the current depth:

```markdown
# Main Topic

## A
### A1
Text inside A1.

---h-1

Text here is back at H2 depth (under A).
```

Both forms are valid plain text outside Obsidian — the note remains readable even without the plugin.

---

## Features

### v0.1 — Marker UX

- **Parser** — recognises `---hN` (absolute) and `---h-N` (relative) on standalone lines
- **Live Preview** — markers are replaced with a faint `↩ H2` label when the cursor is elsewhere; raw syntax is shown when editing the line; invalid markers are highlighted in red
- **Reading View** — markers are hidden (or shown as a faint label, configurable)
- **Validation** — warns on `---h7` (out of range) and `---h-5` inside an H2 (impossible return)
- **Commands** — insert any marker from the command palette

### v0.2 — Semantic Outline pane

- Custom side pane that builds a **virtual heading tree** aware of return markers
- Return markers appear as `↩ H2` sibling nodes within the heading they re-enter
- Click any item to jump to that line
- Auto-refreshes on file switch and document edit

### v0.3 — Sticky heading bar

- Breadcrumb bar at the **top of the editor** showing the current virtual heading context as you scroll
- Powered by the same virtual heading stack as the outline pane — scrolling past a `---h2` updates the breadcrumb to reflect structural re-entry
- Adapted from the sticky-heading concept in [obsidian-sticky-headings](https://github.com/zhouhua/obsidian-sticky-headings); replaces `metadataCache.headings` with our virtual stack

### v0.4 — Floating TOC panel

- Floating panel on the right edge of the editor; **hover to expand**, **pin to keep open**
- Indicator dots visible in collapsed state; full heading text shown on hover/pin
- Scroll tracking highlights the current heading using binary search on precomputed boundaries (O(log n) per frame)
- Return markers shown as square-dot siblings in the tree
- One panel per open leaf — works correctly with split panes
- Adapted from [obsidian-floating-toc-plugin](https://github.com/pkm-er/obsidian-floating-toc-plugin); heading source replaced with `buildVirtualTree()`

---

## What this plugin does NOT do

- It does **not** modify Obsidian's native metadata cache, `metadataCache.headings`, or the native Outline pane
- It does **not** affect folding, backlinks, Dataview queries, or graph view
- It does **not** modify export output (HTML, PDF, Pandoc)
- The semantic structure is visible only within the plugin's own UI (outline pane, floating TOC, sticky bar)

Native Obsidian tooling sees the raw Markdown structure. The markers are notation — structurally meaningful within this plugin, plain text everywhere else.

---

## Installation

Build from source:

```bash
git clone https://github.com/112345brian/return-headings
cd return-headings
npm install
npm run build
```

Copy the output files to your vault:

```
YourVault/.obsidian/plugins/return-headings/main.js
YourVault/.obsidian/plugins/return-headings/styles.css
YourVault/.obsidian/plugins/return-headings/manifest.json
```

Then enable the plugin in **Settings → Community Plugins**.

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Hide markers in Reading View | on | `---h2` and `---h-1` lines are invisible when reading |
| Show subtle markers in Live Preview | on | Replace raw syntax with `↩ H2` label while cursor is elsewhere |
| Validate impossible returns | on | Track heading depth and flag unresolvable markers |
| Warn on invalid returns | on | Highlight out-of-range markers (e.g. `---h7`) in red |
| Sticky heading bar | on | Breadcrumb bar at the top of the editor |
| Floating TOC | on | Floating TOC panel on the right edge of the editor |

---

## Commands

All commands are available via the command palette (`Ctrl/Cmd+P`):

**Insertion:**
- Insert return to H1 / H2 / H3 / H4 / H5 / H6
- Insert return up 1 heading
- Insert return up 2 headings
- Insert return up 3 headings

**Toggle:**
- Toggle visibility of return markers
- Toggle sticky heading bar
- Toggle floating TOC
- Open Return Headings outline

---

## Architecture

```
src/
├── parser.ts          Syntax: parseMarker(), validateMarker(), resolveDepth(), getDisplayLabel()
├── utils.ts           Scroll utilities: HeadingBoundary, computeHeadingBoundaries(),
│                        findContextAtBoundaries() (binary search), getFirstVisibleLineNum()
├── virtual-tree.ts    Tree builder: buildVirtualTree() → OutlineNode[]
├── live-preview.ts    CM6 ViewPlugin: decorates marker lines in editor
├── reading-view.ts    MarkdownPostProcessor: hides/labels markers in Reading View
├── sticky-headings.ts CM6 showPanel: sticky breadcrumb bar
├── floating-toc.ts    FloatingTocPanel: hover-to-expand side panel
├── outline-view.ts    ItemView: semantic outline side pane
├── settings.ts        ReturnHeadingsSettings interface + settings tab
└── main.ts            Plugin entry point; lifecycle and event wiring
```

**Key data flow:**

```
Document text
  → parser.ts             (line-by-line marker detection)
  → virtual-tree.ts       (tree structure for outline pane + floating TOC)
  → utils.ts              (flat boundary list for O(log n) scroll tracking)
  → live-preview.ts       (CM6 decorations)
  → sticky-headings.ts    (CM6 panel)
  → floating-toc.ts       (DOM overlay panel)
  → outline-view.ts       (sidebar pane)
```

---

## Roadmap

| Version | Focus |
|---------|-------|
| **0.1** | Marker UX — parse, decorate, hide/show, commands, validation ✓ |
| **0.2** | Semantic Outline — virtual heading tree, click-to-jump ✓ |
| **0.3** | Sticky heading bar — return-marker-aware breadcrumb ✓ |
| **0.4** | Floating TOC — hover panel, binary-search highlight ✓ |
| **0.5** | Refactor tools — convert duplicate headings to return markers, bulk validation |
| **0.6** | Export support — transform markers for HTML/PDF/Pandoc output |

---

## Contributing

Issues and pull requests welcome. The vibe-coded origin means there are likely rough edges — especially around edge cases in the virtual tree traversal and DOM injection across Obsidian versions.

```bash
npm run dev    # watch mode
npm run build  # production build
npm run lint   # ESLint
```

---

## License

MIT — same as the sample plugin this was forked from.

---

## My Other Plugins

Like this plugin? I make a few others for Obsidian:

- [**Bread Trail**](https://github.com/112345brian/bread-trail) — enhanced Breadcrumbs navigation
- [**Breadbake**](https://github.com/112345brian/breadbake) — Breadcrumbs graph configuration
- [**Citation Suite**](https://github.com/112345brian/bripey-citation-suite) — enhanced citation tools
- [**Inherit**](https://github.com/112345brian/inherit) — frontmatter property inheritance
- [**Properties First**](https://github.com/112345brian/obsidian-properties-first) — move properties above the inline title

Want to install them all at once? Check out [**bripeys-extremely-opinionated-plugin-suite**](https://github.com/112345brian/bripeys-extremely-opinionated-plugin-suite).
