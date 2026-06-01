import type { EditorView } from '@codemirror/view';
import type { MarkdownView } from 'obsidian';
import type { ReturnHeadingsSettings } from './settings';
import { buildVirtualTree, type OutlineNode } from './virtual-tree';
import { getContextAtLine } from './sticky-headings';

export class FloatingTocPanel {
	private readonly container: HTMLElement;
	private readonly mdView: MarkdownView;
	private readonly getSettings: () => ReturnHeadingsSettings;

	private lineToEl = new Map<number, HTMLElement>();
	private locatedEl: HTMLElement | null = null;
	private scrollEl: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private rafPending = false;
	private pinned = false;

	constructor(view: MarkdownView, getSettings: () => ReturnHeadingsSettings) {
		this.mdView = view;
		this.getSettings = getSettings;
		this.container = document.createElement('div');
		this.container.className = 'rh-ftoc';
	}

	attach(): void {
		if (!this.getSettings().floatingTocEnabled) return;

		// Mirror the approach of obsidian-floating-toc: inject as a sibling
		// immediately before the editor/preview element so we sit inside
		// .view-content, which has position:relative in Obsidian.
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

	detach(): void {
		if (this.scrollHandler && this.scrollEl) {
			this.scrollEl.removeEventListener('scroll', this.scrollHandler);
		}
		this.container.remove();
		this.lineToEl.clear();
	}

	refresh(): void {
		this.lineToEl.clear();
		this.locatedEl = null;
		this.container.empty();
		this.buildContent();
		this.updateHighlight();
	}

	private buildContent(): void {
		// Toolbar (visible only on hover/pin)
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

	private updateHighlight(): void {
		const cm = (this.mdView.editor as unknown as { cm?: EditorView }).cm;
		if (!cm) return;

		const scrollTop = cm.scrollDOM.scrollTop;
		let lineNum: number;
		try {
			const block = cm.lineBlockAtHeight(scrollTop);
			lineNum = cm.state.doc.lineAt(block.from).number - 1; // 0-indexed
		} catch {
			return;
		}

		const clampedLine = Math.min(lineNum + 1, cm.state.doc.lines);
		const content = cm.state.sliceDoc(0, cm.state.doc.line(clampedLine).to);
		const context = getContextAtLine(content, lineNum);

		// Remove previous highlight
		if (this.locatedEl) {
			this.locatedEl.removeClass('rh-ftoc-located');
			this.locatedEl = null;
		}

		if (context.length === 0) return;

		// Deepest heading in the virtual stack = current location
		const current = context[context.length - 1]!;
		const el = this.lineToEl.get(current.line);
		if (el) {
			el.addClass('rh-ftoc-located');
			this.locatedEl = el;
			// Only auto-scroll the TOC panel when pinned (otherwise it's hidden anyway)
			if (this.pinned) {
				el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}
	}
}
