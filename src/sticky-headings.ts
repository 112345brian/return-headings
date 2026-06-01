/**
 * Sticky heading bar — VS Code sticky-scroll style.
 *
 * Mirrors the core behaviour of VS Code's sticky scroll as closely as this
 * plugin's divergent semantics allow:
 *
 *  • The bar is injected as `position: absolute; top: 0` directly into
 *    `.cm-editor` (via `ViewPlugin`), so editor content scrolls UNDERNEATH
 *    it rather than being pushed below it.  This is the same DOM strategy
 *    VS Code uses and is what gives the natural "peek" effect: as the next
 *    heading scrolls toward the top of the viewport you can see it
 *    approaching in the content behind the bar.  No explicit animation code
 *    is needed — the scrolling content itself provides the transition.
 *
 *  • Each context level is rendered as a separate line showing the raw
 *    heading source text with its `#` prefix (`## Section Name`), matching
 *    VS Code's "exact source text with editor styling" approach.
 *
 *  • The context is derived from `findContextAtBoundaries()` which resolves
 *    heading-return markers, so the bar reflects the *virtual* heading stack
 *    rather than the raw `metadataCache.headings` list.
 *
 * **Where we diverge from VS Code intentionally:**
 *  • Headings are styled with Obsidian's CSS variables (`--h1-color` etc.)
 *    rather than with CM6 token decorations, so they look consistent with
 *    the rest of the note in both Live Preview and source mode.
 *  • Return-marker context is virtual; VS Code has no equivalent.
 *
 * Adapted from the sticky-heading concept in obsidian-sticky-headings
 * (MIT, zhouhua): https://github.com/zhouhua/obsidian-sticky-headings
 */

import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { ReturnHeadingsSettings } from './settings';
import {
	type HeadingBoundary,
	type HeadingEntry,
	computeHeadingBoundaries,
	findContextAtBoundaries,
	findNextBoundaryLine,
	getFirstVisibleLineNum,
} from './utils';

export type { HeadingEntry };

// Maximum context lines shown, matching VS Code's default of 5.
const MAX_STICKY_LINES = 5;

// ── Bar renderer ─────────────────────────────────────────────────────────────

/**
 * Rebuilds (or updates) the sticky bar DOM for the given scroll position.
 *
 * Skips a full DOM rebuild when the context lines haven't changed (only the
 * scroll position moved within the same context), avoiding layout thrash on
 * every pixel of scrolling.
 */
function renderBar(
	bar: HTMLElement,
	view: EditorView,
	boundaries: HeadingBoundary[],
	settings: ReturnHeadingsSettings,
): void {
	if (!settings.stickyHeadingsEnabled) {
		bar.style.display = 'none';
		return;
	}

	const lineNum = getFirstVisibleLineNum(view);
	// Hide at top of document — no context to summarise yet.
	if (lineNum === null || lineNum < 1 || view.scrollDOM.scrollTop < 1) {
		bar.style.display = 'none';
		return;
	}

	const context = findContextAtBoundaries(boundaries, lineNum);
	if (context.length === 0) {
		bar.style.display = 'none';
		return;
	}

	// Clamp to MAX_STICKY_LINES showing the deepest (most specific) levels.
	const visible = context.length > MAX_STICKY_LINES
		? context.slice(context.length - MAX_STICKY_LINES)
		: context;

	// Build a cheap key to detect whether the displayed context has changed.
	const contextKey = visible.map(e => e.line).join(',');

	if (bar.dataset.contextKey !== contextKey) {
		bar.dataset.contextKey = contextKey;
		buildLines(bar, visible, view);
	}

	bar.style.display = '';
}

/**
 * Clears and rebuilds all sticky line elements.
 * Each line shows `## Heading text` with level-appropriate styling, matching
 * VS Code's "exact source line" approach.
 */
function buildLines(
	bar: HTMLElement,
	context: HeadingEntry[],
	view: EditorView,
): void {
	bar.empty();

	for (let i = 0; i < context.length; i++) {
		const entry = context[i]!;
		const isLast = i === context.length - 1;

		const line = bar.createEl('div', {
			cls: `rh-sticky-line rh-sticky-h${entry.level}${isLast ? ' rh-sticky-line-last' : ''}`,
		});

		// `##`-style prefix, muted — matching VS Code's syntax-coloured hash marks.
		line.createEl('span', {
			text: '#'.repeat(entry.level) + ' ', // non-breaking space after hashes
			cls: 'rh-sticky-prefix',
		});

		// Heading text with level-matched colour and weight.
		line.createEl('span', {
			text: entry.text,
			cls: 'rh-sticky-text',
		});

		// Click jumps to this heading in the editor.
		const targetLine = entry.line;
		line.addEventListener('click', () => {
			const cmLine = view.state.doc.line(
				Math.max(1, Math.min(targetLine + 1, view.state.doc.lines)),
			);
			view.dispatch({
				selection: { anchor: cmLine.from },
				effects: EditorView.scrollIntoView(cmLine.from, { y: 'start', yMargin: 0 }),
			});
			view.focus();
		});
	}
}

// ── Extension ────────────────────────────────────────────────────────────────

/**
 * Builds the CM6 `ViewPlugin` that renders the sticky heading bar.
 *
 * The plugin appends a `div.rh-sticky-bar` directly to `view.dom`
 * (`.cm-editor`) with `position: absolute; top: 0`.  Because `.cm-editor`
 * has `position: relative`, the bar floats over the scroller content rather
 * than pushing it down — this is the VS Code approach and is what produces
 * the natural "peek" transition without any animation code.
 *
 * A scroll listener on `view.scrollDOM` drives real-time updates; the CM6
 * `update` callback handles document changes and geometry changes.
 *
 * @param getSettings - Accessor for current plugin settings.
 */
export function buildStickyBarExtension(getSettings: () => ReturnHeadingsSettings) {
	return ViewPlugin.fromClass(
		class {
			private bar: HTMLElement;
			private boundaries: HeadingBoundary[];
			private rafPending = false;
			private readonly scrollHandler: () => void;

			constructor(private readonly view: EditorView) {
				// Inject bar into .cm-editor so it overlays the scroller content.
				this.bar = document.createElement('div');
				this.bar.className = 'rh-sticky-bar';
				view.dom.appendChild(this.bar);

				this.boundaries = computeHeadingBoundaries(view.state.doc.toString());

				// Scroll listener for per-pixel responsiveness; rAF-throttled.
				this.scrollHandler = () => {
					if (this.rafPending) return;
					this.rafPending = true;
					requestAnimationFrame(() => {
						renderBar(this.bar, this.view, this.boundaries, getSettings());
						this.rafPending = false;
					});
				};
				view.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true });

				renderBar(this.bar, view, this.boundaries, getSettings());
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.boundaries = computeHeadingBoundaries(
						update.view.state.doc.toString(),
					);
				}
				if (update.docChanged || update.geometryChanged) {
					renderBar(this.bar, update.view, this.boundaries, getSettings());
				}
			}

			destroy() {
				this.view.scrollDOM.removeEventListener('scroll', this.scrollHandler);
				this.bar.remove();
			}
		},
	);
}
