/**
 * Return Headings — main plugin entry point.
 *
 * Wires together all sub-systems:
 *   - Live Preview decorations (CM6 ViewPlugin)
 *   - Sticky heading bar: CM6 ViewPlugin for edit mode, ReadingViewStickyBar
 *     for Reading View — both synced via workspace events
 *   - Reading View post-processor (hides/labels markers)
 *   - Semantic Outline side pane (custom ItemView)
 *   - Floating TOC panels (one per open MarkdownView leaf)
 *   - Insertion commands and toggle commands
 *   - Settings tab
 */

import { Editor, MarkdownView, Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, ReturnHeadingsSettingTab, type ReturnHeadingsSettings } from './settings';
import { buildLivePreviewExtension } from './live-preview';
import { buildReadingViewProcessor } from './reading-view';
import { ReturnHeadingsOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { buildStickyBarExtension, ReadingViewStickyBar } from './sticky-headings';
import { FloatingTocPanel } from './floating-toc';

export default class ReturnHeadingsPlugin extends Plugin {
	settings!: ReturnHeadingsSettings;

	private tocPanels = new Map<WorkspaceLeaf, FloatingTocPanel>();
	private readingStickyBars = new Map<WorkspaceLeaf, ReadingViewStickyBar>();

	async onload() {
		await this.loadSettings();

		this.registerMarkdownPostProcessor(buildReadingViewProcessor(this.app, () => this.settings));

		this.registerEditorExtension([
			buildLivePreviewExtension(() => this.settings),
			buildStickyBarExtension(() => this.settings),
		]);

		this.registerView(VIEW_TYPE_OUTLINE, leaf => new ReturnHeadingsOutlineView(leaf, this));

		this.addRibbonIcon('list-tree', 'Return headings outline', () => {
			void this.activateOutlineView();
		});

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.syncFloatingTocPanels();
				this.syncReadingStickyBars();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.syncFloatingTocPanels();
				this.syncReadingStickyBars();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.syncFloatingTocPanels();
				this.syncReadingStickyBars();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				const active = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
				if (active) this.tocPanels.get(active)?.refresh();
			}),
		);

		// Wait for the workspace layout to be ready before attaching DOM-dependent
		// components — avoids race conditions on startup and cold loads.
		this.app.workspace.onLayoutReady(() => {
			this.syncFloatingTocPanels();
			this.syncReadingStickyBars();
		});

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
				this.syncReadingStickyBars();
			},
		});

		this.addCommand({
			id: 'toggle-floating-toc',
			name: 'Toggle floating toc',
			callback: async () => {
				this.settings.floatingTocEnabled = !this.settings.floatingTocEnabled;
				await this.saveSettings();
				this.reattachFloatingToc();
			},
		});

		this.addCommand({
			id: 'open-outline',
			name: 'Open outline',
			callback: () => void this.activateOutlineView(),
		});
	}

	onunload() {
		for (const panel of this.tocPanels.values()) panel.detach();
		this.tocPanels.clear();
		for (const bar of this.readingStickyBars.values()) bar.detach();
		this.readingStickyBars.clear();
		// Note: do NOT call detachLeavesOfType here — Obsidian handles view
		// cleanup on plugin unload automatically.
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
	 * Force-detaches all floating TOC panels and re-creates them with current
	 * settings. Called when position or mode settings change so the new classes
	 * take effect immediately.
	 */
	reattachFloatingToc() {
		for (const panel of this.tocPanels.values()) panel.detach();
		this.tocPanels.clear();
		this.syncFloatingTocPanels();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private syncFloatingTocPanels() {
		if (!this.settings.floatingTocEnabled) {
			for (const panel of this.tocPanels.values()) panel.detach();
			this.tocPanels.clear();
			return;
		}

		const openLeaves = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView) openLeaves.add(leaf);
		});

		for (const [leaf, panel] of this.tocPanels) {
			if (!openLeaves.has(leaf)) {
				panel.detach();
				this.tocPanels.delete(leaf);
			}
		}

		for (const leaf of openLeaves) {
			if (!this.tocPanels.has(leaf)) {
				const panel = new FloatingTocPanel(leaf.view as MarkdownView, () => this.settings);
				panel.attach();
				this.tocPanels.set(leaf, panel);
			}
		}
	}

	/**
	 * Creates/destroys `ReadingViewStickyBar` instances for leaves that are
	 * currently in Reading View mode. Called on layout changes and mode switches.
	 */
	private syncReadingStickyBars() {
		const readingLeaves = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves(leaf => {
			if (
				leaf.view instanceof MarkdownView &&
				leaf.view.getMode() === 'preview'
			) {
				readingLeaves.add(leaf);
			}
		});

		for (const [leaf, bar] of this.readingStickyBars) {
			if (!readingLeaves.has(leaf)) {
				bar.detach();
				this.readingStickyBars.delete(leaf);
			}
		}

		for (const leaf of readingLeaves) {
			if (!this.readingStickyBars.has(leaf)) {
				const bar = new ReadingViewStickyBar(
					leaf.view as MarkdownView,
					() => this.settings,
				);
				bar.attach();
				this.readingStickyBars.set(leaf, bar);
			}
		}
	}

	private async activateOutlineView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_OUTLINE, active: true });
			await this.app.workspace.revealLeaf(leaf);
		}
	}
}

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
