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

v0.1 is a **syntax and decoration plugin**. It:

- Parses `---hN` and `---h-N` marker lines
- Hides markers in Reading View (or shows a faint `↩ H2` label)
- Replaces markers with a styled label in Live Preview while the cursor is elsewhere; shows raw syntax when editing the line
- Highlights invalid markers (e.g. `---h7`, or `---h-5` inside an H2) in red when validation is enabled
- Adds commands to insert any marker from the command palette

**What v0.1 does not do:** it does not alter Obsidian's heading structure, metadata cache, native outline pane, folding, backlinks, or export. Paragraphs after a return marker are not yet semantically re-parented in any Obsidian-native sense. The markers are notation only — visual and validated, but not yet structurally operative.

## Roadmap

| Version | Focus |
|---------|-------|
| **0.1** | Marker UX — parse, decorate, hide/show, commands, validation |
| **0.2** | Semantic Outline — custom side pane with virtual heading stack, click-to-jump, parent-return relationships |
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
