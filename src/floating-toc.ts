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
 * - Binary search on precomputed boundaries for O(log n) highlight updates
 *   (the source plugin uses binary search on `metadataCache.headings`; we
 *   use it on our precomputed `HeadingBoundary[]`).
 *
 * **What differs:**
 * - Heading source: `metadataCache.headings` → `buildVirtualTree()`. Return
 *   markers (`---h2`, `---h-1`) appear as square-dot nodes in the tree,
 *   nested correctly under the heading they re-enter.
 * - Scroll highlight: raw heading lookup → `findContextAtBoundaries()`, so
 *   scrolling past a return marker correctly shifts the highlighted dot to the
 *   resumed heading rather than the nearest raw heading above the cursor.
 * - No Vue / Svelte / lodash — plain TypeScript + Obsidian DOM helpers.
 * - No search modal or Ctrl+click fold (deferred to a future version).
 */

import type { EditorView } from '@codemirror/view';
import type { MarkdownView } from 'obsidian';
import type { ReturnHeadingsSettings } from './settings';
import { buildVirtualTree, type OutlineNode } from './virtual-tree';
import {
	type HeadingBoundary,
	computeHeadingBoundaries,
	findContextAtBoundaries,
	getFirstVisibleLineNum,
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
 *
 * `FloatingTocPanel` instances are managed by the main plugin via a
 * `Map<WorkspaceLeaf, FloatingTocPanel>` that is synced on `layout-change`
 * and `active-leaf-change`. See `main.ts → syncFloatingTocPanels()`.
 */
export class FloatingTocPanel {
	private readonly container: HTMLElement;
	private readonly mdView: MarkdownView;
	private readonly getSettings: () => ReturnHeadingsSettings;

	/** Maps 0-indexed source line → the `<li>` element for that heading. */
	private lineToEl = new Map<number, HTMLElement>();

	/** The currently highlighted `<li>`, if any. */
	private locatedEl: HTMLElement | null = null;

	private scrollEl: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private rafPending = false;
	private pinned = false;

	/**
	 * Precomputed heading boundaries — recomputed on `refresh()`, searched on
	 * every scroll frame. Mirrors the binary-search optimisation used in
	 * obsidian-floating-toc-plugin's `_handleScroll`.
	 */
	private boundaries: HeadingBoundary[] = [];

	constructor(view: MarkdownView, getSettings: () => ReturnHeadingsSettings) {
		this.mdView = view;
		this.getSettings = getSettings;
		this.container = document.createElement('div');
		this.container.className = 'rh-ftoc';
	}

	/**
	 * Injects the panel DOM before `.markdown-source-view` (or
	 * `.markdown-reading-view`) and wires the scroll listener.
	 *
	 * The injection point sits inside `.view-content` which has
	 * `position: relative` in Obsidian — this is the same strategy used by
	 * obsidian-floating-toc-plugin to achieve correct absolute positioning.
	 *
	 * Does nothing if `floatingTocEnabled` is false in settings.
	 */
	attach(): void {
		if (!this.getSettings().floatingTocEnabled) return;

		const anchor =
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-source-view') ??
			this.mdView.containerEl.querySelector<HTMLElement>('.markdown-reading-view');
		if (!anchor) return;

		anchor.insertAdjacentElement('beforebegin', this.container);
		this.buildContent();

		this.scrollEl = this.mdView.containerEl.querySelector<HTMLElement>('.cm-scroller');
		if (this.scrollEl) {
			this.scrollHandler = () => {
				if (this.rafPending) return;
				this.rafPending = true;
				requestAnimationFrame(() => {
					this.updateHighlight();
					this.rafPending = false;
				});
			};
			this.scrollEl.addEventListener('scroll', this.scrollHandler, { passive: true });
		}
	}

	/** Removes the panel DOM and scroll listener. */
	detach(): void {
		if (this.scrollHandler && this.scrollEl) {
			this.scrollEl.removeEventListener('scroll', this.scrollHandler);
		}
		this.container.remove();
		this.lineToEl.clear();
	}

	/**
	 * Rebuilds the TOC tree from the current document state and updates the
	 * scroll highlight. Called by the main plugin on `editor-change`.
	 */
	refresh(): void {
		this.lineToEl.clear();
		this.locatedEl = null;
		this.container.empty();
		this.buildContent();
		this.updateHighlight();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private buildContent(): void {
		const toolbar = this.container.createEl('div', { cls: 'rh-ftoc-toolbar' });
		const pinBtn = toolbar.createEl('button', {
			cls: 'rh-ftoc-pin-btn',
			attr: { title: 'Pin TOC' },
		});
		pinBtn.setText('⊕');
		pinBtn.addEventListener('click', e => {
			e.stopPropagation();
			this.pinned = !this.pinned;
			this.container.toggleClass('rh-ftoc-pinned', this.pinned);
			pinBtn.setText(this.pinned ? '⊗' : '⊕');
		});

		const content = this.mdView.editor.getValue();

		// Precompute boundaries here so scroll updates are O(log n).
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
				row.addEventListener('click', () => {
					const editor = this.mdView.editor;
					editor.setCursor({ line: targetLine, ch: 0 });
					editor.scrollIntoView(
						{ from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } },
						true,
					);
					this.mdView.app.workspace.setActiveLeaf(this.mdView.leaf, { focus: true });
				});
			}

			if (node.children.length > 0) {
				const childList = li.createEl('ul', { cls: 'rh-ftoc-children' });
				this.renderNodes(childList, node.children, depth + 1);
			}
		}
	}

	/**
	 * Determines the current heading context via binary search on
	 * `this.boundaries` and updates the `.rh-ftoc-located` CSS class.
	 *
	 * O(log n) — safe to call on every rAF tick.
	 */
	private updateHighlight(): void {
		const cm = (this.mdView.editor as unknown as { cm?: EditorView }).cm;
		if (!cm) return;

		const lineNum = getFirstVisibleLineNum(cm);
		if (lineNum === null) return;

		const context = findContextAtBoundaries(this.boundaries, lineNum);

		if (this.locatedEl) {
			this.locatedEl.removeClass('rh-ftoc-located');
			this.locatedEl = null;
		}

		if (context.length === 0) return;

		// The deepest heading in the virtual stack is the current location.
		const current = context[context.length - 1]!;
		const el = this.lineToEl.get(current.line);
		if (el) {
			el.addClass('rh-ftoc-located');
			this.locatedEl = el;
			// Auto-scroll within the TOC only when pinned; otherwise the panel
			// is not wide enough to show text and the scroll would be invisible.
			if (this.pinned) {
				el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}
	}
}
