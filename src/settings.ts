import { App, DropdownComponent, PluginSettingTab, Setting } from 'obsidian';
import type ReturnHeadingsPlugin from './main';

export type FloatingTocPosition = 'left' | 'right';
export type FloatingTocMode = 'floating' | 'pinned';

export interface ReturnHeadingsSettings {
	hideMarkersInReadingView: boolean;
	showSubtleMarkersInLivePreview: boolean;
	validateImpossibleReturns: boolean;
	warnOnInvalidReturn: boolean;
	stickyHeadingsEnabled: boolean;
	floatingTocEnabled: boolean;
	/** Which edge of the editor the TOC panel anchors to. */
	floatingTocPosition: FloatingTocPosition;
	/**
	 * `floating` — collapsed to an indicator strip; expands on hover.
	 * `pinned`   — always expanded at full width.
	 */
	floatingTocMode: FloatingTocMode;
}

export const DEFAULT_SETTINGS: ReturnHeadingsSettings = {
	hideMarkersInReadingView: true,
	showSubtleMarkersInLivePreview: true,
	validateImpossibleReturns: true,
	warnOnInvalidReturn: true,
	stickyHeadingsEnabled: true,
	floatingTocEnabled: true,
	floatingTocPosition: 'right',
	floatingTocMode: 'floating',
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
				'Show a VS Code-style sticky context bar at the top of the editor. Stacks one line per heading level; content scrolls underneath it.',
			)
			.addToggle(t =>
				t.setValue(this.plugin.settings.stickyHeadingsEnabled).onChange(async v => {
					this.plugin.settings.stickyHeadingsEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Floating TOC')
			.setDesc('Show a table of contents panel on the edge of the editor.')
			.addToggle(t =>
				t.setValue(this.plugin.settings.floatingTocEnabled).onChange(async v => {
					this.plugin.settings.floatingTocEnabled = v;
					await this.plugin.saveSettings();
					this.plugin.reattachFloatingToc();
				}),
			);

		new Setting(containerEl)
			.setName('TOC position')
			.setDesc('Which edge of the editor the TOC panel anchors to.')
			.addDropdown((d: DropdownComponent) =>
				d
					.addOption('right', 'Right')
					.addOption('left', 'Left')
					.setValue(this.plugin.settings.floatingTocPosition)
					.onChange(async v => {
						this.plugin.settings.floatingTocPosition = v as FloatingTocPosition;
						await this.plugin.saveSettings();
						this.plugin.reattachFloatingToc();
					}),
			);

		new Setting(containerEl)
			.setName('TOC mode')
			.setDesc(
				'Floating: collapsed to a thin indicator strip, expands on hover. ' +
				'Pinned: always expanded at full width.',
			)
			.addDropdown((d: DropdownComponent) =>
				d
					.addOption('floating', 'Floating (hover to expand)')
					.addOption('pinned', 'Pinned (always visible)')
					.setValue(this.plugin.settings.floatingTocMode)
					.onChange(async v => {
						this.plugin.settings.floatingTocMode = v as FloatingTocMode;
						await this.plugin.saveSettings();
						this.plugin.reattachFloatingToc();
					}),
			);
	}
}
