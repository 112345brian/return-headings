import { App, PluginSettingTab, Setting } from 'obsidian';
import type ReturnHeadingsPlugin from './main';

export interface ReturnHeadingsSettings {
	hideMarkersInReadingView: boolean;
	showSubtleMarkersInLivePreview: boolean;
	validateImpossibleReturns: boolean;
	warnOnInvalidReturn: boolean;
}

export const DEFAULT_SETTINGS: ReturnHeadingsSettings = {
	hideMarkersInReadingView: true,
	showSubtleMarkersInLivePreview: true,
	validateImpossibleReturns: true,
	warnOnInvalidReturn: true,
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
	}
}
