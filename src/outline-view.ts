/**
 * Semantic Outline side pane — custom `ItemView`.
 *
 * Renders the virtual heading tree (produced by `buildVirtualTree`) as a
 * clickable sidebar panel. Unlike Obsidian's native Outline pane, this view
 * understands heading-return markers: return nodes appear as `↩ H2` siblings
 * within the heading they re-enter, visually encoding the structural re-entry.
 *
 * The pane is registered as a custom view type and can be opened via the
 * ribbon icon or the command palette.
 */

import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type ReturnHeadingsPlugin from './main';
import { buildVirtualTree, type OutlineNode } from './virtual-tree';

export const VIEW_TYPE_OUTLINE = 'return-headings-outline';

// ── View ─────────────────────────────────────────────────────────────────────

/**
 * Custom `ItemView` that renders the virtual heading tree for the currently
 * active Markdown file.
 *
 * Refresh is debounced (150 ms) to avoid excessive rebuilds during fast
 * typing. The main plugin calls `scheduleRefresh()` on `active-leaf-change`
 * and `editor-change`.
 */
export class ReturnHeadingsOutlineView extends ItemView {
	plugin: ReturnHeadingsPlugin;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Stable reference to our content root. Created once in `onOpen` so
	 * `refresh()` doesn't re-query the DOM on every call.
	 */
	private rootEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: ReturnHeadingsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_OUTLINE;
	}

	getDisplayText(): string {
		return 'Return Headings';
	}

	getIcon(): string {
		return 'list-tree';
	}

	async onOpen() {
		// Create a stable content root we own, independent of Obsidian's
		// internal containerEl structure.
		this.rootEl = this.containerEl.createEl('div', { cls: 'rh-outline' });
		this.refresh();
	}

	async onClose() {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
	}

	/**
	 * Schedules a debounced refresh. Safe to call frequently (e.g. on every
	 * keypress via `editor-change`).
	 */
	scheduleRefresh() {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.refresh(), 150);
	}

	/** Rebuilds the entire tree from the active document. */
	refresh() {
		if (!this.rootEl) return;
		this.rootEl.empty();

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) {
			this.rootEl.createEl('div', {
				text: 'Open a Markdown file to see its outline.',
				cls: 'rh-outline-empty',
			});
			return;
		}

		const tree = buildVirtualTree(mdView.editor.getValue());

		if (tree.length === 0) {
			this.rootEl.createEl('div', {
				text: 'No headings found.',
				cls: 'rh-outline-empty',
			});
			return;
		}

		const treeEl = this.rootEl.createEl('div', { cls: 'rh-outline-tree' });
		this.renderNodes(treeEl, tree, mdView);
	}

	// ── Private ───────────────────────────────────────────────────────────────

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

			const targetLine = node.line;
			label.addEventListener('click', () => {
				const editor = mdView.editor;
				editor.setCursor({ line: targetLine, ch: 0 });
				editor.scrollIntoView(
					{ from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } },
					true,
				);
				this.app.workspace.setActiveLeaf(mdView.leaf, { focus: true });
			});

			if (node.children.length > 0) {
				const childrenEl = item.createEl('div', { cls: 'rh-outline-children' });
				this.renderNodes(childrenEl, node.children, mdView);
			}
		}
	}
}
