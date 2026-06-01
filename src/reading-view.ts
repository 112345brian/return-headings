import type { MarkdownPostProcessorContext } from 'obsidian';
import type { ReturnHeadingsSettings } from './settings';
import { getDisplayLabel, parseMarker } from './parser';

export function buildReadingViewProcessor(getSettings: () => ReturnHeadingsSettings) {
	return (el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
		const settings = getSettings();

		const process = (elem: HTMLElement) => {
			const text = elem.textContent?.trim() ?? '';
			if (!text) return;
			const marker = parseMarker(text);
			if (!marker) return;

			if (settings.hideMarkersInReadingView) {
				elem.addClass('heading-return-hidden');
			} else {
				elem.addClass('heading-return-visible');
				elem.empty();
				elem.createEl('span', {
					text: getDisplayLabel(marker),
					cls: 'heading-return-label',
				});
			}
		};

		// el is often the block element itself (e.g. <p>) for a standalone line
		process(el);
		el.querySelectorAll('p, div').forEach(child => process(child as HTMLElement));
	};
}
