# Return Headings

An Obsidian plugin that introduces lightweight structural markers for re-entering a previous heading depth without creating a duplicate visible heading.

## Syntax

**Absolute return** — jump to a specific heading level:

```
---h2
---h3
```

**Relative return** — move up N heading levels:

```
---h-1
---h-2
```

Example:

```markdown
## Kant
### Space
Notes about space.
### Time
Notes about time.
## Hegel
Notes about Hegel.
---h2
### Space
More notes about space, resumed under Hegel rather than as a new top-level section.
```

## What this version does

v0.2 adds a **Semantic Outline pane** that builds a virtual heading tree from return markers, making the structural intent of your document visible and navigable.

**Syntax + decoration (since v0.1):**
- Parses `---hN` and `---h-N` marker lines
- Hides markers in Reading View (or shows a faint `↩ H2` label)
- Replaces markers in Live Preview with a styled label while the cursor is elsewhere; shows raw syntax on the active line
- Highlights invalid markers (e.g. `---h7`, or `---h-5` inside an H2) in red when validation is enabled
- Commands to insert any marker from the command palette

**Semantic Outline pane (v0.2):**
- Opens in the right sidebar (ribbon icon or command palette)
- Builds a virtual heading stack that resolves return markers into a tree
- Return markers appear as `↩ H2` siblings within the heading they re-enter, showing the exact point of structural re-entry
- Every item is clickable — jumps to that line in the editor
- Refreshes automatically on file switch and document edit

**What this plugin does not do:** it does not alter Obsidian's native metadata cache, native outline pane, folding, backlinks, or export output. The semantic outline pane is a separate custom view — native Obsidian tooling (graph, backlinks, Dataview) still sees the raw Markdown structure.

## Roadmap

| Version | Focus |
|---------|-------|
| **0.1** | Marker UX — parse, decorate, hide/show, commands, validation ✓ |
| **0.2** | Semantic Outline — custom side pane with virtual heading stack, click-to-jump, parent-return relationships ✓ |
| **0.3** | Refactor tools — convert repeated identical headings into return markers, normalize absolute/relative, validate entire file |
| **0.4** | Export support — transform markers for HTML/PDF/Pandoc output |

## Installation

Build from source:

```bash
npm install
npm run build
```

Copy `main.js`, `styles.css`, and `manifest.json` to:

```
YourVault/.obsidian/plugins/return-headings/
```

Then enable the plugin in Obsidian settings.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Hide markers in Reading View | on | Markers are invisible when reading |
| Show subtle markers in Live Preview | on | Replace raw syntax with `↩ H2` label while cursor is elsewhere |
| Validate impossible returns | on | Track heading depth and flag unresolvable markers |
| Warn on invalid returns | on | Highlight out-of-range markers in red |

## Commands

All commands are available in the command palette (`Ctrl/Cmd+P`):

- **Insert return to H1–H6** — absolute return markers
- **Insert return up 1–3 headings** — relative return markers
- **Toggle visibility of return markers** — flip hide/show across both Reading View and Live Preview

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
npm run lint   # ESLint
```
