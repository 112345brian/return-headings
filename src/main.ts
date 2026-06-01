import { Editor, MarkdownView, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, ReturnHeadingsSettingTab, type ReturnHeadingsSettings } from './settings';
import { buildLivePreviewExtension } from './live-preview';
import { buildReadingViewProcessor } from './reading-view';

export default class ReturnHeadingsPlugin extends Plugin {
	settings!: ReturnHeadingsSettings;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownPostProcessor(buildReadingViewProcessor(() => this.settings));

		this.registerEditorExtension(buildLivePreviewExtension(() => this.settings));

		this.addSettingTab(new ReturnHeadingsSettingTab(this.app, this));

		// Absolute return commands
		for (let level = 1; level <= 6; level++) {
			this.addCommand({
				id: `insert-return-h${level}`,
				name: `Insert return to H${level}`,
				editorCallback: (editor: Editor) => insertMarker(editor, `---h${level}`),
			});
		}

		// Relative return commands
		for (const steps of [1, 2, 3]) {
			this.addCommand({
				id: `insert-return-up-${steps}`,
				name: `Insert return up ${steps} heading${steps > 1 ? 's' : ''}`,
				editorCallback: (editor: Editor) => insertMarker(editor, `---h-${steps}`),
			});
		}

		// Toggle marker visibility
		this.addCommand({
			id: 'toggle-marker-visibility',
			name: 'Toggle visibility of return markers',
			callback: async () => {
				this.settings.hideMarkersInReadingView = !this.settings.hideMarkersInReadingView;
				this.settings.showSubtleMarkersInLivePreview = !this.settings.showSubtleMarkersInLivePreview;
				await this.saveSettings();
				// Refresh active markdown view
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					view.editor.refresh();
				}
			},
		});
	}

	onunload() {}

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
}

function insertMarker(editor: Editor, marker: string) {
	const cursor = editor.getCursor();
	const currentLine = editor.getLine(cursor.line);
	if (currentLine.trim() === '') {
		editor.setLine(cursor.line, marker);
		editor.setCursor({ line: cursor.line, ch: marker.length });
	} else {
		const insertPos = { line: cursor.line, ch: currentLine.length };
		editor.replaceRange(`\n${marker}\n`, insertPos);
		editor.setCursor({ line: cursor.line + 1, ch: marker.length });
	}
}
