import { App, PluginSettingTab, Setting } from 'obsidian';
import type ReturnHeadingsPlugin from './main';

export interface ReturnHeadingsSettings {
	hideMarkersInReadingView: boolean;
	showSubtleMarkersInLivePreview: boolean;
	validateImpossibleReturns: boolean;
	warnOnInvalidReturn: boolean;
	stickyHeadingsEnabled: boolean;
	floatingTocEnabled: boolean;
}

export const DEFAULT_SETTINGS: ReturnHeadingsSettings = {
	hideMarkersInReadingView: true,
	showSubtleMarkersInLivePreview: true,
	validateImpossibleReturns: true,
	warnOnInvalidReturn: true,
	stickyHeadingsEnabled: true,
	floatingTocEnabled: true,
};

export class ReturnHeadingsSettingTab extends PluginSettingTab {
	plugin: ReturnHeadingsPlugin;

	constructor(app: App, plugin: ReturnHeadingsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Return Headings' });

		// ── Marker display ─────────────────────────────────────────────────────

		containerEl.createEl('h3', { text: 'Marker display' });

		new Setting(containerEl)
			.setName('Hide markers in Reading View')
			.setDesc('Markers like ---h2 and ---h-1 are invisible when reading.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.hideMarkersInReadingView).onChange(async v => {
					this.plugin.settings.hideMarkersInReadingView = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Show subtle markers in Live Preview')
			.setDesc('Replace raw marker syntax with a faint label (e.g. ↩ H2) while editing.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.showSubtleMarkersInLivePreview).onChange(async v => {
					this.plugin.settings.showSubtleMarkersInLivePreview = v;
					await this.plugin.saveSettings();
				}),
			);

		// ── Validation ─────────────────────────────────────────────────────────

		containerEl.createEl('h3', { text: 'Validation' });

		new Setting(containerEl)
			.setName('Validate impossible returns')
			.setDesc('Track heading depth and flag markers that cannot be resolved.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.validateImpossibleReturns).onChange(async v => {
					this.plugin.settings.validateImpossibleReturns = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Warn on invalid returns')
			.setDesc('Show a warning decoration on markers that reference out-of-range heading levels.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.warnOnInvalidReturn).onChange(async v => {
					this.plugin.settings.warnOnInvalidReturn = v;
					await this.plugin.saveSettings();
				}),
			);

		// ── Navigation ─────────────────────────────────────────────────────────

		containerEl.createEl('h3', { text: 'Navigation' });

		new Setting(containerEl)
			.setName('Sticky heading bar')
			.setDesc(
				'Show a breadcrumb bar at the top of the editor reflecting your virtual heading context as you scroll.',
			)
			.addToggle(t =>
				t.setValue(this.plugin.settings.stickyHeadingsEnabled).onChange(async v => {
					this.plugin.settings.stickyHeadingsEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Floating TOC')
			.setDesc(
				'Show a floating table of contents panel on the right edge of the editor. Hover to expand; pin to keep open. Return markers appear as structural nodes, and the current heading is highlighted as you scroll.',
			)
			.addToggle(t =>
				t.setValue(this.plugin.settings.floatingTocEnabled).onChange(async v => {
					this.plugin.settings.floatingTocEnabled = v;
					await this.plugin.saveSettings();
					this.plugin.reattachFloatingToc();
				}),
			);
	}
}
