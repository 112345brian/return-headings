/**
 * Return Headings — main plugin entry point.
 *
 * Wires together all sub-systems:
 *   - Live Preview decorations (CM6 ViewPlugin)
 *   - Sticky heading breadcrumb bar (CM6 showPanel)
 *   - Reading View post-processor
 *   - Semantic Outline side pane (custom ItemView)
 *   - Floating TOC panels (one per open MarkdownView leaf)
 *   - Insertion commands and toggle commands
 *   - Settings tab
 *
 * **Floating TOC lifecycle (multi-leaf, inspired by obsidian-floating-toc-plugin):**
 * A `Map<WorkspaceLeaf, FloatingTocPanel>` tracks one panel per open Markdown
 * leaf. `syncFloatingTocPanels()` is called on `active-leaf-change` and
 * `layout-change` to create panels for new leaves and destroy panels for
 * closed ones — matching the approach used by the source plugin.
 */

import { Editor, MarkdownView, Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, ReturnHeadingsSettingTab, type ReturnHeadingsSettings } from './settings';
import { buildLivePreviewExtension } from './live-preview';
import { buildReadingViewProcessor } from './reading-view';
import { ReturnHeadingsOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { buildStickyBarExtension } from './sticky-headings';
import { FloatingTocPanel } from './floating-toc';

export default class ReturnHeadingsPlugin extends Plugin {
	settings!: ReturnHeadingsSettings;

	/**
	 * One floating TOC panel per open Markdown leaf. Synced on leaf changes
	 * and layout changes via `syncFloatingTocPanels()`.
	 */
	private tocPanels = new Map<WorkspaceLeaf, FloatingTocPanel>();

	async onload() {
		await this.loadSettings();

		// ── Reading View ────────────────────────────────────────────────────
		this.registerMarkdownPostProcessor(buildReadingViewProcessor(() => this.settings));

		// ── Live Preview + sticky bar (CM6 extensions) ──────────────────────
		this.registerEditorExtension([
			buildLivePreviewExtension(() => this.settings),
			buildStickyBarExtension(() => this.settings),
		]);

		// ── Semantic Outline pane ───────────────────────────────────────────
		this.registerView(VIEW_TYPE_OUTLINE, leaf => new ReturnHeadingsOutlineView(leaf, this));

		this.addRibbonIcon('list-tree', 'Return Headings outline', () => {
			this.activateOutlineView();
		});

		// ── Workspace events ────────────────────────────────────────────────

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.refreshOutlineView();
				this.syncFloatingTocPanels();
			}),
		);

		// layout-change fires when panes open or close, allowing us to attach
		// panels to new leaves and clean up panels for closed ones.
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.syncFloatingTocPanels();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				this.refreshOutlineView();
				// Refresh only the panel for the leaf that just changed.
				const active = this.app.workspace.activeLeaf;
				if (active) this.tocPanels.get(active)?.refresh();
			}),
		);

		// Attach panels for any leaves already open at load time.
		this.syncFloatingTocPanels();

		// ── Settings ────────────────────────────────────────────────────────
		this.addSettingTab(new ReturnHeadingsSettingTab(this.app, this));

		// ── Insertion commands ───────────────────────────────────────────────

		for (let level = 1; level <= 6; level++) {
			this.addCommand({
				id: `insert-return-h${level}`,
				name: `Insert return to H${level}`,
				editorCallback: (editor: Editor) => insertMarker(editor, `---h${level}`),
			});
		}

		for (const steps of [1, 2, 3]) {
			this.addCommand({
				id: `insert-return-up-${steps}`,
				name: `Insert return up ${steps} heading${steps > 1 ? 's' : ''}`,
				editorCallback: (editor: Editor) => insertMarker(editor, `---h-${steps}`),
			});
		}

		// ── View toggle commands ─────────────────────────────────────────────

		this.addCommand({
			id: 'toggle-marker-visibility',
			name: 'Toggle visibility of return markers',
			callback: async () => {
				this.settings.hideMarkersInReadingView = !this.settings.hideMarkersInReadingView;
				this.settings.showSubtleMarkersInLivePreview =
					!this.settings.showSubtleMarkersInLivePreview;
				await this.saveSettings();
				this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.refresh();
			},
		});

		this.addCommand({
			id: 'toggle-sticky-headings',
			name: 'Toggle sticky heading bar',
			callback: async () => {
				this.settings.stickyHeadingsEnabled = !this.settings.stickyHeadingsEnabled;
				await this.saveSettings();
			},
		});

		this.addCommand({
			id: 'toggle-floating-toc',
			name: 'Toggle floating TOC',
			callback: async () => {
				this.settings.floatingTocEnabled = !this.settings.floatingTocEnabled;
				await this.saveSettings();
				this.syncFloatingTocPanels();
			},
		});

		this.addCommand({
			id: 'open-outline',
			name: 'Open Return Headings outline',
			callback: () => this.activateOutlineView(),
		});
	}

	onunload() {
		for (const panel of this.tocPanels.values()) panel.detach();
		this.tocPanels.clear();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_OUTLINE);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ReturnHeadingsSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Synchronises the floating TOC panel map with the current set of open
	 * Markdown leaves. Creates panels for new leaves, destroys panels for
	 * closed ones.
	 *
	 * Also called from the `floatingTocEnabled` setting toggle to
	 * immediately attach or detach all panels.
	 */
	reattachFloatingToc() {
		this.syncFloatingTocPanels();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private syncFloatingTocPanels() {
		if (!this.settings.floatingTocEnabled) {
			for (const panel of this.tocPanels.values()) panel.detach();
			this.tocPanels.clear();
			return;
		}

		// Collect all currently open Markdown leaves.
		const openLeaves = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView) openLeaves.add(leaf);
		});

		// Detach panels for leaves that have since closed.
		for (const [leaf, panel] of this.tocPanels) {
			if (!openLeaves.has(leaf)) {
				panel.detach();
				this.tocPanels.delete(leaf);
			}
		}

		// Attach panels for newly opened leaves.
		for (const leaf of openLeaves) {
			if (!this.tocPanels.has(leaf)) {
				const panel = new FloatingTocPanel(
					leaf.view as MarkdownView,
					() => this.settings,
				);
				panel.attach();
				this.tocPanels.set(leaf, panel);
			}
		}
	}

	private refreshOutlineView() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)) {
			(leaf.view as ReturnHeadingsOutlineView).scheduleRefresh();
		}
	}

	private async activateOutlineView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_OUTLINE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Inserts a marker line at (or after) the current cursor position.
 * If the current line is blank, replaces it; otherwise appends on a new line.
 */
function insertMarker(editor: Editor, marker: string) {
	const cursor = editor.getCursor();
	const currentLine = editor.getLine(cursor.line);
	if (currentLine.trim() === '') {
		editor.setLine(cursor.line, marker);
		editor.setCursor({ line: cursor.line, ch: marker.length });
	} else {
		editor.replaceRange(`\n${marker}\n`, { line: cursor.line, ch: currentLine.length });
		editor.setCursor({ line: cursor.line + 1, ch: marker.length });
	}
}
