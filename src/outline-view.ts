import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type ReturnHeadingsPlugin from './main';
import { buildVirtualTree, type OutlineNode } from './virtual-tree';

export const VIEW_TYPE_OUTLINE = 'return-headings-outline';

export class ReturnHeadingsOutlineView extends ItemView {
	plugin: ReturnHeadingsPlugin;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

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
		this.refresh();
	}

	async onClose() {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
	}

	scheduleRefresh() {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.refresh(), 150);
	}

	refresh() {
		// children[0] is the header bar Obsidian adds; children[1] is our content area
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('rh-outline');

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) {
			container.createEl('div', {
				text: 'Open a Markdown file to see its outline.',
				cls: 'rh-outline-empty',
			});
			return;
		}

		const tree = buildVirtualTree(mdView.editor.getValue());

		if (tree.length === 0) {
			container.createEl('div', {
				text: 'No headings found.',
				cls: 'rh-outline-empty',
			});
			return;
		}

		const treeEl = container.createEl('div', { cls: 'rh-outline-tree' });
		this.renderNodes(treeEl, tree, mdView);
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

			label.addEventListener('click', () => {
				const editor = mdView.editor;
				editor.setCursor({ line: node.line, ch: 0 });
				editor.scrollIntoView(
					{ from: { line: node.line, ch: 0 }, to: { line: node.line, ch: 0 } },
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
