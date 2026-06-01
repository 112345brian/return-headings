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
 *   DOM-based class injected into `.markdown-preview-view`.  Uses
 *   `getBoundingClientRect()` on rendered heading elements to build the
 *   context stack without a source-to-render line-number mapping.  The
 *   virtual heading stack (return markers) is not applied here — Reading View
 *   shows raw headings only — but the visual presentation is identical.
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
} from './utils';

export type { HeadingEntry };

const MAX_LINES = 5;

// ── Shared DOM builder ───────────────────────────────────────────────────────

/**
 * Clears `bar` and rebuilds one `div.rh-sticky-line` per context entry.
 * Each line shows `## Heading text` with level-appropriate styling.
 * Clicking a line calls `onJump(entry)`.
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
		bar.style.display = 'none';
		return;
	}

	const lineNum = getFirstVisibleLineNum(view);
	if (lineNum === null || lineNum < 1 || view.scrollDOM.scrollTop < 1) {
		bar.style.display = 'none';
		return;
	}

	const rawContext = findContextAtBoundaries(boundaries, lineNum);
	// Filter out heading levels shallower than the configured minimum.
	const context = settings.stickyHeadingsMinLevel > 1
		? rawContext.filter(e => e.level >= settings.stickyHeadingsMinLevel)
		: rawContext;

	if (context.length === 0) {
		bar.style.display = 'none';
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

	bar.style.display = '';
}

/**
 * Builds the CM6 `ViewPlugin` for editor mode (source / Live Preview).
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
				this.bar = document.createElement('div');
				this.bar.className = 'rh-sticky-bar';
				this.bar.style.display = 'none';
				view.dom.appendChild(this.bar);

				this.boundaries = computeHeadingBoundaries(view.state.doc.toString());

				this.scrollHandler = () => {
					if (this.rafPending) return;
					this.rafPending = true;
					requestAnimationFrame(() => {
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
 * Injected as `position:absolute; top:0` into `.markdown-preview-view`.
 * On each scroll frame it walks rendered `<h1>`–`<h6>` elements and builds
 * a heading stack from whatever is above the bar's bottom edge.
 *
 * Return markers are not reflected here (they're hidden in Reading View) —
 * the context is based on the raw rendered heading hierarchy only.
 */
export class ReadingViewStickyBar {
	private bar: HTMLElement;
	private previewEl: HTMLElement | null = null;
	private scrollEl: HTMLElement | null = null;
	private rafPending = false;
	private contextKey = '';
	private scrollHandler: (() => void) | null = null;

	constructor(
		private readonly view: MarkdownView,
		private readonly getSettings: () => ReturnHeadingsSettings,
	) {
		this.bar = document.createElement('div');
		this.bar.className = 'rh-sticky-bar';
		this.bar.style.display = 'none';
	}

	attach(): void {
		const previewEl =
			this.view.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
		if (!previewEl) return;

		this.previewEl = previewEl;
		// Overlay the preview so content scrolls beneath the bar.
		previewEl.style.position = 'relative';
		previewEl.prepend(this.bar);

		// Walk up to find the actual scroll container.
		this.scrollEl = this.findScrollParent(previewEl);

		this.scrollHandler = () => {
			if (this.rafPending) return;
			this.rafPending = true;
			requestAnimationFrame(() => {
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
		this.bar.remove();
	}

	private findScrollParent(el: HTMLElement): HTMLElement {
		let cur: HTMLElement | null = el.parentElement;
		while (cur && cur !== document.body) {
			const { overflowY } = window.getComputedStyle(cur);
			if (overflowY === 'auto' || overflowY === 'scroll') return cur;
			cur = cur.parentElement;
		}
		return document.documentElement as HTMLElement;
	}

	private update(): void {
		const settings = this.getSettings();
		if (!settings.stickyHeadingsEnabled || !this.previewEl) {
			this.bar.style.display = 'none';
			return;
		}

		const scrollTop = this.scrollEl?.scrollTop ?? window.scrollY;
		if (scrollTop < 1) {
			this.bar.style.display = 'none';
			return;
		}

		const section = this.previewEl.querySelector<HTMLElement>('.markdown-preview-section');
		if (!section) return;

		const headingEls = Array.from(
			section.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'),
		);
		if (headingEls.length === 0) {
			this.bar.style.display = 'none';
			return;
		}

		// Build context from headings whose bottom edge is above the bar's bottom.
		const barBottom =
			this.previewEl.getBoundingClientRect().top + (this.bar.offsetHeight || 0) + 2;

		const rawStack: { level: number; text: string; el: HTMLElement }[] = [];

		for (const h of headingEls) {
			if (h.getBoundingClientRect().bottom > barBottom) break;
			const level = parseInt(h.tagName[1]!);
			const text = h.textContent?.trim() ?? '';
			while (rawStack.length > 0 && rawStack[rawStack.length - 1]!.level >= level) rawStack.pop();
			rawStack.push({ level, text, el: h });
		}

		const minLevel = settings.stickyHeadingsMinLevel ?? 1;
		const stack = minLevel > 1 ? rawStack.filter(e => e.level >= minLevel) : rawStack;

		if (stack.length === 0) {
			this.bar.style.display = 'none';
			return;
		}

		const contextKey = stack.map(s => `${s.level}:${s.text}`).join('|');
		if (contextKey === this.contextKey) return;
		this.contextKey = contextKey;

		this.bar.empty();
		const visible = stack.length > MAX_LINES ? stack.slice(-MAX_LINES) : stack;

		for (let i = 0; i < visible.length; i++) {
			const entry = visible[i]!;
			const isLast = i === visible.length - 1;
			const line = this.bar.createEl('div', {
				cls: `rh-sticky-line rh-sticky-h${entry.level}${isLast ? ' rh-sticky-line-last' : ''}`,
			});
			line.createEl('span', { text: '#'.repeat(entry.level) + ' ', cls: 'rh-sticky-prefix' });
			line.createEl('span', { text: entry.text, cls: 'rh-sticky-text' });
			const targetEl = entry.el;
			line.addEventListener('click', () =>
				targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' }),
			);
		}

		this.bar.style.display = '';
	}
}
