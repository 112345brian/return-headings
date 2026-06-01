import { Editor, MarkdownView, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, ReturnHeadingsSettingTab, type ReturnHeadingsSettings } from './settings';
import { buildLivePreviewExtension } from './live-preview';
import { buildReadingViewProcessor } from './reading-view';
import { ReturnHeadingsOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { buildStickyBarExtension } from './sticky-headings';

export default class ReturnHeadingsPlugin extends Plugin {
	settings!: ReturnHeadingsSettings;

	async onload() {
		await this.loadSettings();

		// Reading View post-processor
		this.registerMarkdownPostProcessor(buildReadingViewProcessor(() => this.settings));

		// Live Preview decorations + sticky breadcrumb bar
		this.registerEditorExtension([
			buildLivePreviewExtension(() => this.settings),
			buildStickyBarExtension(() => this.settings),
		]);

		// Semantic Outline side pane
		this.registerView(VIEW_TYPE_OUTLINE, leaf => new ReturnHeadingsOutlineView(leaf, this));

		this.addRibbonIcon('list-tree', 'Return Headings outline', () => {
			this.activateOutlineView();
		});

		// Refresh outline on file switch or edit
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.refreshOutlineView()),
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', () => this.refreshOutlineView()),
		);

		this.addSettingTab(new ReturnHeadingsSettingTab(this.app, this));

		// ── Insertion commands ──────────────────────────────────────────────────

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

		// ── View commands ───────────────────────────────────────────────────────

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
			id: 'open-outline',
			name: 'Open Return Headings outline',
			callback: () => this.activateOutlineView(),
		});
	}

	onunload() {
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
