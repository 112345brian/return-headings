/**
 * Markdown post-processor for Reading View.
 *
 * Obsidian's Markdown renderer turns `---h2` into a `<p>---h2</p>` element
 * (it is not a valid HR tag, so it renders as paragraph text). This processor
 * finds those elements and either hides them or replaces their content with a
 * faint `↩ H2` label, depending on the current settings.
 *
 * Registered via `Plugin.registerMarkdownPostProcessor()`.
 */

import type { MarkdownPostProcessorContext } from 'obsidian';
import type { ReturnHeadingsSettings } from './settings';
import { getDisplayLabel, parseMarker } from './parser';

/**
 * Returns a `MarkdownPostProcessor` callback that is aware of the current
 * plugin settings.
 *
 * The post-processor checks both the element itself and its `<p>` / `<div>`
 * children, because Obsidian sometimes passes a block wrapper and sometimes
 * the block element directly.
 *
 * @param getSettings - Accessor for the current plugin settings.
 */
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
				// Replace the raw marker text with a styled label.
				elem.addClass('heading-return-visible');
				elem.empty();
				elem.createEl('span', {
					text: getDisplayLabel(marker),
					cls: 'heading-return-label',
				});
			}
		};

		// `el` may be the block element itself or a wrapper containing blocks.
		process(el);
		el.querySelectorAll('p, div').forEach(child => process(child as HTMLElement));
	};
}
