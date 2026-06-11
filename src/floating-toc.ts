/**
 * Floating table-of-contents panel.
 *
 * Inspired by obsidian-floating-toc-plugin (MIT, pkm-er):
 *   https://github.com/pkm-er/obsidian-floating-toc-plugin
 *
 * **What was taken from the source plugin:**
 * - DOM injection strategy: `insertAdjacentElement('beforebegin', ...)` on
 *   `.markdown-source-view`, positioning the element inside `.view-content`
 *   which has `position: relative` in Obsidian.
 * - Hover-to-expand / pin UX pattern.
 * - Per-leaf panel lifecycle (attach/detach on leaf open/close).
 * - rAF-throttled scroll handler.
 * - Binary search on precomputed boundaries for O(log n) highlight updates.
 *
 * **What differs:**
 * - Heading source: `metadataCache.headings` → `buildVirtualTree()`. Return
 *   markers appear as square-dot nodes in the tree.
 * - Scroll highlight: raw heading lookup → `findContextAtBoundaries()`.
 * - Reading View support: listens on `.markdown-preview-view` scroller and
 *   uses DOM-based heading detection when in preview mode.
 * - No Vue / Svelte / lodash — plain TypeScript + Obsidian DOM helpers.
 */

import { EditorView } from '@codemirror/view';
import type { MarkdownView } from 'obsidian';
import type { ReturnHeadingsSettings } from './settings';
import { buildVirtualTree, type OutlineNode } from './virtual-tree';
import {
	type HeadingBoundary,
	computeHeadingBoundaries,
	findContextAtBoundaries,
	getFirstVisibleLineNum,
	headingElementToLine,
	headingTextContent,
	lastHeadingAbove,
} from './utils';

// ── Panel ────────────────────────────────────────────────────────────────────

/**
 * Manages one floating TOC panel for a single `MarkdownView` leaf.
 *
 * Lifecycle:
 * 1. `new FloatingTocPanel(view, getSettings)` — create (no DOM yet).
 * 2. `attach()` — inject DOM and wire scroll listener.
 * 3. `refresh()` — rebuild tree and highlight (called on `editor-change`).
 * 4. `detach()` — remove DOM and clean up listeners.
 */
export class FloatingTocPanel {
	private readonly container: HTMLElement;
	private readonly mdView: MarkdownView;
	private readonly getSettings: () => ReturnHeadingsSettings;

	/** Maps 0-indexed source line → the `<li>` element for that heading. */
	private lineToEl = new Map<number, HTMLElement>();

	/** The currently highlighted `<li>`, if any. */
	private locatedEl: HTMLElement | null = null;

	private editorScrollEl: HTMLElement | null = null;
	private readingScrollEl: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private rafPending = false;
	private pinned = false;
	private hostPositionSet = false;

	/** Precomputed heading boundaries, recomputed on `refresh()`. */
	private boundaries: HeadingBoundary[] = [];

	constructor(view: MarkdownView, getSettings: () => ReturnHeadingsSettings) {
		this.mdView = view;
		this.getSettings = getSettings;
		this.container = view.containerEl.ownerDocument.createElement('div');
		this.container.className = 'rh-ftoc';
	}

	/**
	 * Injects the panel DOM and wires scroll listeners for both editor and
	 * reading view modes.
	 */
	attach(): void {
		const settings = this.getSettings();
		if (!settings.floatingTocEnabled) return;

		const anchor =
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-source-view') ??
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-reading-view') ??
			this.mdView.containerEl.querySelector<HTMLElement>('.view-content');

		const host = anchor?.parentElement ?? this.mdView.containerEl;
		if (!host.hasClass('rh-position-relative')) {
			host.addClass('rh-position-relative');
			this.hostPositionSet = true;
		}

		this.applyPositionClasses();

		if (anchor && anchor.parentElement === host) {
			anchor.insertAdjacentElement('beforebegin', this.container);
		} else {
			host.appendChild(this.container);
		}
		this.buildContent();

		this.scrollHandler = () => {
			if (this.rafPending) return;
			this.rafPending = true;
			this.mdView.containerEl.ownerDocument.defaultView!.requestAnimationFrame(() => {
				this.updateHighlight();
				this.rafPending = false;
			});
		};

		// Wire editor scroller.
		this.editorScrollEl =
			this.mdView.containerEl.querySelector<HTMLElement>('.cm-scroller');
		this.editorScrollEl?.addEventListener('scroll', this.scrollHandler, { passive: true });

		// Wire reading view scroller.
		this.readingScrollEl =
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
		this.readingScrollEl?.addEventListener('scroll', this.scrollHandler, { passive: true });
	}

	/** Removes the panel DOM and scroll listeners. */
	detach(): void {
		if (this.scrollHandler) {
			this.editorScrollEl?.removeEventListener('scroll', this.scrollHandler);
			this.readingScrollEl?.removeEventListener('scroll', this.scrollHandler);
		}
		this.container.remove();
		this.lineToEl.clear();

		const anchor =
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-source-view') ??
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-reading-view') ??
			this.mdView.containerEl.querySelector<HTMLElement>('.view-content');
		const host = anchor?.parentElement ?? this.mdView.containerEl;
		if (this.hostPositionSet) {
			host.removeClass('rh-position-relative');
			this.hostPositionSet = false;
		}
	}

	/**
	 * Rebuilds the TOC tree and updates the scroll highlight.
	 * Called by the main plugin on `editor-change`.
	 */
	refresh(): void {
		this.lineToEl.clear();
		this.locatedEl = null;
		this.container.empty();
		this.buildContent();
		this.updateHighlight();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private applyPositionClasses(): void {
		const settings = this.getSettings();
		this.container.toggleClass('rh-ftoc-left', settings.floatingTocPosition === 'left');
		this.container.toggleClass('rh-ftoc-right', settings.floatingTocPosition === 'right');

		this.pinned = settings.floatingTocMode === 'pinned';
		this.container.toggleClass('rh-ftoc-pinned', this.pinned);
	}

	private buildContent(): void {
		const toolbar = this.container.createEl('div', { cls: 'rh-ftoc-toolbar' });

		if (this.getSettings().floatingTocMode === 'floating') {
			const pinBtn = toolbar.createEl('button', {
				cls: 'rh-ftoc-pin-btn',
				attr: { title: 'Pin toc' },
			});
			pinBtn.setText('⊕');
			pinBtn.addEventListener('click', e => {
				e.stopPropagation();
				this.pinned = !this.pinned;
				this.container.toggleClass('rh-ftoc-pinned', this.pinned);
				pinBtn.setText(this.pinned ? '⊗' : '⊕');
			});
		}

		// getViewData() works in both editing and reading mode.
		let content: string;
		try {
			content = this.mdView.getViewData();
		} catch {
			content = this.mdView.editor.getValue();
		}

		if (!content) return;

		this.boundaries = computeHeadingBoundaries(content);

		const tree = buildVirtualTree(content);
		if (tree.length === 0) return;

		const list = this.container.createEl('ul', { cls: 'rh-ftoc-list' });
		this.renderNodes(list, tree, 0);
	}

	private renderNodes(parent: HTMLElement, nodes: OutlineNode[], depth: number): void {
		for (const node of nodes) {
			const li = parent.createEl('li', {
				cls: `rh-ftoc-item rh-ftoc-${node.type} rh-ftoc-depth-${Math.min(depth, 5)}`,
			});

			const row = li.createEl('div', {
				cls: 'rh-ftoc-row',
				attr: { title: node.text },
			});
			row.createEl('span', { cls: 'rh-ftoc-indicator' });
			row.createEl('span', { text: node.text, cls: 'rh-ftoc-text' });

			if (node.type === 'heading') {
				this.lineToEl.set(node.line, li);
				const targetLine = node.line;
				row.addEventListener('click', () => this.jumpToLine(targetLine));
			}

			if (node.children.length > 0) {
				const childList = li.createEl('ul', { cls: 'rh-ftoc-children' });
				this.renderNodes(childList, node.children, depth + 1);
			}
		}
	}

	/**
	 * Scrolls the editor or reading view to the given 0-indexed source line.
	 * Works in both edit mode (CM dispatch) and reading mode (DOM scrollIntoView).
	 */
	private jumpToLine(targetLine: number): void {
		const mode = this.mdView.getMode();

		if (mode === 'preview') {
			// Reading view: find the rendered heading element and scroll it into view.
			const file = this.mdView.file;
			if (!file) return;
			const cache = this.mdView.app.metadataCache.getCache(file.path);
			const ch = cache?.headings?.find(h => h.position.start.line === targetLine);
			if (!ch) return;

			const section =
				this.mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-section');
			if (!section) return;

			const headingEls = Array.from(section.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
			for (const el of headingEls) {
				if (
					el.tagName.toLowerCase() === `h${ch.level}` &&
					headingTextContent(el) === ch.heading
				) {
					el.scrollIntoView({ behavior: 'smooth', block: 'start' });
					return;
				}
			}
		} else {
			const cm = (this.mdView.editor as unknown as { cm?: EditorView }).cm;
			if (!cm) {
				// Fallback for source mode without direct CM access.
				const editor = this.mdView.editor;
				editor.setCursor({ line: targetLine, ch: 0 });
				editor.scrollIntoView(
					{ from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } },
					true,
				);
				this.mdView.app.workspace.setActiveLeaf(this.mdView.leaf, { focus: true });
				return;
			}
			const cmLine = cm.state.doc.line(
				Math.max(1, Math.min(targetLine + 1, cm.state.doc.lines)),
			);
			cm.dispatch({
				selection: { anchor: cmLine.from },
				effects: EditorView.scrollIntoView(cmLine.from, { y: 'start', yMargin: 0 }),
			});
			cm.focus();
		}
	}

	/**
	 * Determines the current heading context and updates the `.rh-ftoc-located`
	 * class. Handles both editor mode (CM line lookup) and reading view mode
	 * (DOM heading detection).
	 */
	private updateHighlight(): void {
		let lineNum: number | null = null;
		const mode = this.mdView.getMode();

		if (mode === 'preview') {
			lineNum = this.currentLineInPreview();
		} else {
			const cm = (this.mdView.editor as unknown as { cm?: EditorView }).cm;
			if (cm) lineNum = getFirstVisibleLineNum(cm);
		}

		if (lineNum === null) return;

		const context = findContextAtBoundaries(this.boundaries, lineNum);

		if (this.locatedEl) {
			this.locatedEl.removeClass('rh-ftoc-located');
			this.locatedEl = null;
		}

		if (context.length === 0) return;

		const current = context[context.length - 1]!;
		const el = this.lineToEl.get(current.line);
		if (el) {
			el.addClass('rh-ftoc-located');
			this.locatedEl = el;
			if (this.pinned) {
				el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}
	}

	/**
	 * Finds the 0-indexed source line of the last heading visible above the
	 * top of the reading view viewport.
	 */
	private currentLineInPreview(): number | null {
		const previewScroller =
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
		if (!previewScroller) return null;

		const section =
			previewScroller.querySelector<HTMLElement>('.markdown-preview-section');
		if (!section) return null;

		const scrollerTop = previewScroller.getBoundingClientRect().top;
		const h = lastHeadingAbove(section, scrollerTop + 5);
		if (!h) return null;

		const file = this.mdView.file;
		if (!file) return null;

		return headingElementToLine(h, file.path, this.mdView.app.metadataCache);
	}
}
