/**
 * Semantic Outline — permanent sidebar TOC.
 *
 * This view renders the virtual heading tree (produced by `buildVirtualTree`)
 * as a clickable sidebar panel that tracks scroll position in the active note.
 * It is the "always-visible" counterpart to the floating TOC panel:
 *
 * - Understands heading-return markers (`---h2`, `---h-1`): return nodes
 *   appear as `↩ Heading name` siblings within the heading they re-enter.
 * - Highlights the active section as you scroll in both editing and reading
 *   view modes.
 * - Click any heading to jump there; works in both modes.
 * - Refreshes on `active-leaf-change`, `editor-change`, and `layout-change`.
 *
 * The pane is registered as a custom view type and can be opened via the
 * ribbon icon or the command palette.
 */

import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type ReturnHeadingsPlugin from './main';
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

export const VIEW_TYPE_OUTLINE = 'return-headings-outline';

// ── View ─────────────────────────────────────────────────────────────────────

/**
 * Permanent sidebar TOC that tracks scroll position.
 *
 * Refresh is debounced (150 ms) to avoid excessive rebuilds during fast
 * typing. Scroll tracking fires on rAF, throttled to avoid layout thrash.
 */
export class ReturnHeadingsOutlineView extends ItemView {
	plugin: ReturnHeadingsPlugin;
	private refreshTimer: number | null = null;

	private rootEl!: HTMLElement;

	/**
	 * The last MarkdownView we successfully rendered for. Retained so that
	 * when focus shifts to the outline pane itself, clicks and refreshes don't
	 * treat the outline as "no markdown file open" and wipe the tree.
	 */
	private lastMdView: MarkdownView | null = null;

	/** Maps 0-indexed source line → the item div for that heading. */
	private lineToEl = new Map<number, HTMLElement>();

	/** Precomputed boundaries for O(log n) scroll-position lookup. */
	private boundaries: HeadingBoundary[] = [];

	/** Currently highlighted item element. */
	private activeEl: HTMLElement | null = null;

	private rafPending = false;

	/** Cleanup function for the current scroll listener(s). */
	private scrollCleanup: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ReturnHeadingsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_OUTLINE;
	}

	getDisplayText(): string {
		return 'Return headings';
	}

	getIcon(): string {
		return 'list-tree';
	}

	async onOpen() {
		this.rootEl = this.containerEl.createEl('div', { cls: 'rh-outline' });

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				// Only update lastMdView when a real markdown leaf becomes active.
				// Ignore changes that activate the outline pane itself so clicks
				// don't blank the tree.
				const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (mdView) {
					this.lastMdView = mdView;
					this.scheduleRefresh();
					this.reattachScrollListener();
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				this.scheduleRefresh();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.reattachScrollListener();
			}),
		);

		this.refresh();
		this.reattachScrollListener();
	}

	async onClose() {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.scrollCleanup?.();
		this.scrollCleanup = null;
	}

	/**
	 * Schedules a debounced refresh. Safe to call frequently (e.g. on every
	 * keypress via `editor-change`).
	 */
	scheduleRefresh() {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => this.refresh(), 150);
	}

	/** Rebuilds the entire tree from the active document. */
	refresh() {
		if (!this.rootEl) return;

		// Prefer the currently active markdown view; fall back to the last one
		// we saw so clicks inside the outline don't blank the tree.
		const mdView =
			this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMdView;

		if (!mdView) {
			this.rootEl.empty();
			this.lineToEl.clear();
			this.activeEl = null;
			this.rootEl.createEl('div', {
				text: 'Open a Markdown file to see its outline.',
				cls: 'rh-outline-empty',
			});
			return;
		}

		this.lastMdView = mdView;

		this.rootEl.empty();
		this.lineToEl.clear();
		this.activeEl = null;

		let content: string;
		try {
			content = mdView.getViewData();
		} catch {
			content = mdView.editor.getValue();
		}

		if (!content) {
			this.rootEl.createEl('div', {
				text: 'No headings found.',
				cls: 'rh-outline-empty',
			});
			return;
		}

		this.boundaries = computeHeadingBoundaries(content);
		const tree = buildVirtualTree(content);

		if (tree.length === 0) {
			this.rootEl.createEl('div', {
				text: 'No headings found.',
				cls: 'rh-outline-empty',
			});
			return;
		}

		const treeEl = this.rootEl.createEl('div', { cls: 'rh-outline-tree' });
		this.renderNodes(treeEl, tree, mdView);

		this.updateActiveSection(mdView);
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private reattachScrollListener(): void {
		this.scrollCleanup?.();
		this.scrollCleanup = null;

		const mdView =
			this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMdView;
		if (!mdView) return;

		const doc = mdView.containerEl.ownerDocument;

		const handler = () => {
			if (this.rafPending) return;
			this.rafPending = true;
			doc.defaultView!.requestAnimationFrame(() => {
				this.updateActiveSection(mdView);
				this.rafPending = false;
			});
		};

		const scrollEls = [
			mdView.containerEl.querySelector<HTMLElement>('.cm-scroller'),
			mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-view'),
		].filter((el): el is HTMLElement => el !== null);

		for (const el of scrollEls) {
			el.addEventListener('scroll', handler, { passive: true });
		}

		this.scrollCleanup = () => {
			for (const el of scrollEls) {
				el.removeEventListener('scroll', handler);
			}
		};
	}

	private renderNodes(parent: HTMLElement, nodes: OutlineNode[], mdView: MarkdownView) {
		for (const node of nodes) {
			const item = parent.createEl('div', {
				cls: `rh-outline-item rh-outline-${node.type}`,
			});

			const label = item.createEl('span', {
				text: node.text,
				cls: 'rh-outline-label',
				attr: { 'data-level': String(node.level) },
			});

			if (node.type === 'heading') {
				this.lineToEl.set(node.line, item);

				const targetLine = node.line;
				label.addEventListener('click', () => this.jumpToLine(mdView, targetLine));
			}

			if (node.children.length > 0) {
				const childrenEl = item.createEl('div', { cls: 'rh-outline-children' });
				this.renderNodes(childrenEl, node.children, mdView);
			}
		}
	}

	/**
	 * Scrolls to `targetLine` in the note. Does NOT steal focus from the
	 * note — just scrolls it, preserving the outline as the active UI element.
	 */
	private jumpToLine(mdView: MarkdownView, targetLine: number): void {
		const mode = mdView.getMode();

		if (mode === 'preview') {
			const file = mdView.file;
			if (!file) return;
			const cache = mdView.app.metadataCache.getCache(file.path);
			const ch = cache?.headings?.find(h => h.position.start.line === targetLine);
			if (!ch) return;

			const section =
				mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-section');
			if (!section) return;

			for (const el of Array.from(section.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))) {
				if (
					el.tagName.toLowerCase() === `h${ch.level}` &&
					headingTextContent(el) === ch.heading
				) {
					el.scrollIntoView({ behavior: 'smooth', block: 'start' });
					return;
				}
			}
		} else {
			const editor = mdView.editor;
			editor.setCursor({ line: targetLine, ch: 0 });
			editor.scrollIntoView(
				{ from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } },
				true,
			);
			// Do NOT call setActiveLeaf here — that would fire active-leaf-change,
			// which would cause a refresh cycle and could blank the outline.
		}
	}

	private updateActiveSection(mdView: MarkdownView): void {
		let lineNum: number | null = null;
		const mode = mdView.getMode();

		if (mode === 'preview') {
			lineNum = this.currentLineInPreview(mdView);
		} else {
			const cm = (mdView.editor as unknown as { cm?: EditorView }).cm;
			if (cm) lineNum = getFirstVisibleLineNum(cm);
		}

		if (lineNum === null) return;

		const context = findContextAtBoundaries(this.boundaries, lineNum);
		const current = context.length > 0 ? context[context.length - 1] : null;
		const newEl = current ? (this.lineToEl.get(current.line) ?? null) : null;

		if (newEl === this.activeEl) return;

		this.activeEl?.removeClass('rh-outline-active');
		newEl?.addClass('rh-outline-active');
		this.activeEl = newEl;

		if (newEl) {
			newEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	private currentLineInPreview(mdView: MarkdownView): number | null {
		const previewScroller =
			mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
		if (!previewScroller) return null;

		const section =
			previewScroller.querySelector<HTMLElement>('.markdown-preview-section');
		if (!section) return null;

		const scrollerTop = previewScroller.getBoundingClientRect().top;
		const h = lastHeadingAbove(section, scrollerTop + 5);
		if (!h) return null;

		const file = mdView.file;
		if (!file) return null;

		return headingElementToLine(h, file.path, mdView.app.metadataCache);
	}
}
