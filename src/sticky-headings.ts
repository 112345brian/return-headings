/**
 * Sticky heading bar — VS Code sticky-scroll style.
 *
 * Two implementations share the same DOM/CSS:
 *
 *  **Editor mode** (`buildStickyBarExtension`):
 *   CM6 `ViewPlugin` that appends `position:absolute` into `.cm-editor` so
 *   content scrolls underneath.  Boundaries are precomputed on `docChanged`
 *   and searched with binary search on each scroll frame (O(log n)).
 *
 *  **Reading View** (`ReadingViewStickyBar`):
 *   DOM-based class injected into `.markdown-reading-view` (the outer wrapper
 *   that does NOT scroll).  Uses `getBoundingClientRect()` on rendered heading
 *   elements to build the context stack.  The scroll container is the inner
 *   `.markdown-preview-view`.
 *
 * Adapted from obsidian-sticky-headings (MIT, zhouhua):
 *   https://github.com/zhouhua/obsidian-sticky-headings
 */

import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { MarkdownView } from 'obsidian';
import type { ReturnHeadingsSettings } from './settings';
import {
	type HeadingBoundary,
	type HeadingEntry,
	computeHeadingBoundaries,
	findContextAtBoundaries,
	getFirstVisibleLineNum,
	headingTextContent,
} from './utils';

export type { HeadingEntry };

const MAX_LINES = 5;

// ── Shared DOM builder ───────────────────────────────────────────────────────

/**
 * Clears `bar` and rebuilds one `div.rh-sticky-line` per context entry.
 * Each line shows `## Heading text` with level-appropriate styling.
 * Clicking a line calls `onJump(idx)`.
 */
function buildLines(
	bar: HTMLElement,
	context: { level: number; text: string }[],
	onJump: (idx: number) => void,
): void {
	bar.empty();
	const visible = context.length > MAX_LINES ? context.slice(-MAX_LINES) : context;

	for (let i = 0; i < visible.length; i++) {
		const entry = visible[i]!;
		const isLast = i === visible.length - 1;

		const line = bar.createEl('div', {
			cls: `rh-sticky-line rh-sticky-h${entry.level}${isLast ? ' rh-sticky-line-last' : ''}`,
		});

		line.createEl('span', { text: '#'.repeat(entry.level) + ' ', cls: 'rh-sticky-prefix' });
		line.createEl('span', { text: entry.text, cls: 'rh-sticky-text' });

		const idx = i;
		line.addEventListener('click', () => onJump(idx));
	}
}

// ── Editor-mode extension ────────────────────────────────────────────────────

function renderEditorBar(
	bar: HTMLElement,
	view: EditorView,
	boundaries: HeadingBoundary[],
	settings: ReturnHeadingsSettings,
): void {
	if (!settings.stickyHeadingsEnabled) {
		bar.addClass('rh-hidden');
		return;
	}

	const lineNum = getFirstVisibleLineNum(view);
	if (lineNum === null || lineNum < 1 || view.scrollDOM.scrollTop < 1) {
		bar.addClass('rh-hidden');
		return;
	}

	// Lazily recompute if boundaries are empty (can happen on first render
	// before docChanged fires).
	const activeBoundaries =
		boundaries.length === 0
			? computeHeadingBoundaries(view.state.doc.toString())
			: boundaries;

	const rawContext = findContextAtBoundaries(activeBoundaries, lineNum);
	const context =
		settings.stickyHeadingsMinLevel > 1
			? rawContext.filter(e => e.level >= settings.stickyHeadingsMinLevel)
			: rawContext;

	if (context.length === 0) {
		bar.addClass('rh-hidden');
		return;
	}

	const contextKey = context.map(e => e.line).join(',');
	if (bar.dataset.contextKey === contextKey) return;
	bar.dataset.contextKey = contextKey;

	buildLines(bar, context, idx => {
		const visible = context.length > MAX_LINES ? context.slice(-MAX_LINES) : context;
		const entry = visible[idx];
		if (!entry) return;
		const cmLine = view.state.doc.line(
			Math.max(1, Math.min(entry.line + 1, view.state.doc.lines)),
		);
		view.dispatch({
			selection: { anchor: cmLine.from },
			effects: EditorView.scrollIntoView(cmLine.from, { y: 'start', yMargin: 0 }),
		});
		view.focus();
	});

	bar.removeClass('rh-hidden');
}

/**
 * Builds the CM6 `ViewPlugin` extension for editor mode (source / Live Preview).
 * The bar is injected as `position:absolute; top:0` into `view.dom`
 * (`.cm-editor`), overlaying the scroller so content passes beneath it.
 */
export function buildStickyBarExtension(getSettings: () => ReturnHeadingsSettings) {
	return ViewPlugin.fromClass(
		class {
			private bar: HTMLElement;
			private boundaries: HeadingBoundary[];
			private rafPending = false;
			private readonly scrollHandler: () => void;

			constructor(private readonly view: EditorView) {
				this.bar = view.dom.ownerDocument.createElement('div');
				this.bar.className = 'rh-sticky-bar rh-hidden';
				view.dom.appendChild(this.bar);

				this.boundaries = computeHeadingBoundaries(view.state.doc.toString());

				this.scrollHandler = () => {
					if (this.rafPending) return;
					this.rafPending = true;
					view.dom.ownerDocument.defaultView!.requestAnimationFrame(() => {
						renderEditorBar(this.bar, this.view, this.boundaries, getSettings());
						this.rafPending = false;
					});
				};
				view.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true });

				renderEditorBar(this.bar, view, this.boundaries, getSettings());
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.boundaries = computeHeadingBoundaries(update.view.state.doc.toString());
				}
				if (update.docChanged || update.geometryChanged) {
					renderEditorBar(this.bar, update.view, this.boundaries, getSettings());
				}
			}

			destroy() {
				this.view.scrollDOM.removeEventListener('scroll', this.scrollHandler);
				this.bar.remove();
			}
		},
	);
}

// ── Reading View implementation ──────────────────────────────────────────────

/**
 * DOM-based sticky bar for Reading View.
 *
 * Injected as `position:absolute; top:0` into `.markdown-reading-view` (the
 * outer non-scrolling wrapper) so the bar stays fixed at the top while the
 * content scrolls inside `.markdown-preview-view`.
 *
 * On each scroll frame it walks rendered `<h1>`–`<h6>` elements and builds
 * a heading stack from whatever is above the bar's bottom edge.
 *
 * Headings inside embedded notes (`.markdown-embed`) are excluded so they
 * don't pollute the context of the parent note.
 *
 * Strange New Worlds reference-count badges are stripped from heading text
 * via `headingTextContent()` before display.
 *
 * Return markers are not reflected here (they're hidden in Reading View) —
 * the context is based on the raw rendered heading hierarchy only.
 */
export class ReadingViewStickyBar {
	private bar: HTMLElement | null = null;
	private hostEl: HTMLElement | null = null;
	private scrollEl: HTMLElement | null = null;
	private rafPending = false;
	private contextKey = '';
	private scrollHandler: (() => void) | null = null;

	constructor(
		private readonly view: MarkdownView,
		private readonly getSettings: () => ReturnHeadingsSettings,
	) {}

	attach(): void {
		const containerEl = this.view.containerEl;

		// The bar is placed inside the outer non-scrolling wrapper so it stays
		// fixed while .markdown-preview-view scrolls beneath it.
		const hostEl = containerEl.querySelector<HTMLElement>('.markdown-reading-view');
		if (!hostEl) return;

		this.hostEl = hostEl;

		const doc = containerEl.ownerDocument;
		this.bar = doc.createElement('div');
		this.bar.className = 'rh-sticky-bar rh-hidden';

		hostEl.addClass('rh-position-relative');
		hostEl.prepend(this.bar);

		// The actual scroll container is the inner preview element.
		this.scrollEl =
			containerEl.querySelector<HTMLElement>('.markdown-preview-view') ??
			this.findScrollParent(hostEl);

		this.scrollHandler = () => {
			if (this.rafPending) return;
			this.rafPending = true;
			doc.defaultView!.requestAnimationFrame(() => {
				this.update();
				this.rafPending = false;
			});
		};
		this.scrollEl?.addEventListener('scroll', this.scrollHandler, { passive: true });

		this.update();
	}

	detach(): void {
		if (this.scrollHandler && this.scrollEl) {
			this.scrollEl.removeEventListener('scroll', this.scrollHandler);
		}
		this.bar?.remove();
		this.bar = null;
		this.hostEl?.removeClass('rh-position-relative');
		this.hostEl = null;
		this.scrollEl = null;
	}

	private findScrollParent(el: HTMLElement): HTMLElement {
		const doc = el.ownerDocument;
		let cur: HTMLElement | null = el.parentElement;
		while (cur && cur !== doc.body) {
			const { overflowY } = doc.defaultView!.getComputedStyle(cur);
			if (overflowY === 'auto' || overflowY === 'scroll') return cur;
			cur = cur.parentElement;
		}
		return doc.documentElement;
	}

	private update(): void {
		const settings = this.getSettings();
		if (!settings.stickyHeadingsEnabled || !this.scrollEl || !this.bar) {
			this.bar?.addClass('rh-hidden');
			return;
		}

		const scrollTop = this.scrollEl.scrollTop;
		if (scrollTop < 1) {
			this.bar.addClass('rh-hidden');
			return;
		}

		const section = this.scrollEl.querySelector<HTMLElement>('.markdown-preview-section');
		if (!section) return;

		const headingEls = Array.from(
			section.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'),
		).filter(h => !h.closest('.markdown-embed'));

		if (headingEls.length === 0) {
			this.bar.addClass('rh-hidden');
			return;
		}

		// Build context from headings whose bottom edge is above the bar's bottom.
		const barBottom = this.bar.getBoundingClientRect().bottom + 2;

		const rawStack: { level: number; text: string; el: HTMLElement }[] = [];

		for (const h of headingEls) {
			if (h.getBoundingClientRect().bottom > barBottom) break;
			const level = parseInt(h.tagName[1]!);
			const text = headingTextContent(h);
			while (rawStack.length > 0 && rawStack[rawStack.length - 1]!.level >= level)
				rawStack.pop();
			rawStack.push({ level, text, el: h });
		}

		const minLevel = settings.stickyHeadingsMinLevel ?? 1;
		const stack = minLevel > 1 ? rawStack.filter(e => e.level >= minLevel) : rawStack;

		if (stack.length === 0) {
			this.bar.addClass('rh-hidden');
			return;
		}

		const contextKey = stack.map(s => `${s.level}:${s.text}`).join('|');
		if (contextKey === this.contextKey) return;
		this.contextKey = contextKey;

		const bar = this.bar;
		bar.empty();
		const visible = stack.length > MAX_LINES ? stack.slice(-MAX_LINES) : stack;

		for (let i = 0; i < visible.length; i++) {
			const entry = visible[i]!;
			const isLast = i === visible.length - 1;
			const line = bar.createEl('div', {
				cls: `rh-sticky-line rh-sticky-h${entry.level}${isLast ? ' rh-sticky-line-last' : ''}`,
			});
			line.createEl('span', { text: '#'.repeat(entry.level) + ' ', cls: 'rh-sticky-prefix' });
			line.createEl('span', { text: entry.text, cls: 'rh-sticky-text' });
			const targetEl = entry.el;
			line.addEventListener('click', () =>
				targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' }),
			);
		}

		bar.removeClass('rh-hidden');
	}
}
