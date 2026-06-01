/**
 * Markdown post-processor for Reading View.
 *
 * Obsidian's Markdown renderer turns `---h2` into a `<p>---h2</p>` element
 * (it is not a valid HR tag, so it renders as paragraph text). This processor
 * finds those elements and either hides them or replaces their content with a
 * faint label showing the actual heading being returned to (e.g. `↩ Kant`).
 *
 * Heading names are resolved from `metadataCache` (synchronous, no async
 * needed) by finding the last raw heading before the marker's source line and
 * walking back to the target depth level.
 */

import type { App, MarkdownPostProcessorContext, TFile } from 'obsidian';
import type { ReturnHeadingsSettings } from './settings';
import { getDisplayLabel, parseMarker, resolveDepth } from './parser';

/**
 * Returns a `MarkdownPostProcessor` that hides or labels heading-return
 * markers in Reading View.
 *
 * @param app - Obsidian `App` instance, used to query `metadataCache`.
 * @param getSettings - Accessor for current plugin settings.
 */
export function buildReadingViewProcessor(
	app: App,
	getSettings: () => ReturnHeadingsSettings,
) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		const settings = getSettings();

		const process = (elem: HTMLElement) => {
			const text = elem.textContent?.trim() ?? '';
			if (!text) return;

			const marker = parseMarker(text);
			if (!marker) return;

			if (settings.hideMarkersInReadingView) {
				elem.addClass('heading-return-hidden');
				return;
			}

			// Resolve the target heading name using the metadata cache.
			// Falls back to the generic label if cache isn't available.
			const label = resolveReturnLabel(app, ctx, marker);

			elem.addClass('heading-return-visible');
			elem.empty();
			elem.createEl('span', { text: label, cls: 'heading-return-label' });
		};

		process(el);
		el.querySelectorAll('p, div').forEach(child => process(child as HTMLElement));
	};
}

/**
 * Looks up the heading name that a return marker is returning to, using
 * `metadataCache.getCache()` (synchronous, always available in Reading View).
 *
 * Does not account for other return markers in the file (only raw headings
 * from the cache), which is an acceptable approximation for Reading View
 * where markers themselves are hidden.
 */
function resolveReturnLabel(
	app: App,
	ctx: MarkdownPostProcessorContext,
	marker: ReturnType<typeof parseMarker>,
): string {
	if (!marker) return '';

	const sectionInfo = ctx.getSectionInfo(
		// getSectionInfo needs the actual element; pass a dummy to get file-level info
		document.createElement('div'),
	);

	const cache = app.metadataCache.getCache(ctx.sourcePath);
	if (!cache?.headings || cache.headings.length === 0) {
		return getDisplayLabel(marker);
	}

	// Find the source line of this marker via getSectionInfo on the context.
	// If not available, use the last heading in the file as a fallback.
	const markerLine = sectionInfo?.lineStart ?? Infinity;

	// All headings before this marker line, in document order.
	const headingsAbove = cache.headings.filter(
		h => h.position.start.line < markerLine,
	);

	if (headingsAbove.length === 0) return getDisplayLabel(marker);

	const currentLevel = headingsAbove[headingsAbove.length - 1]!.level;
	const targetLevel = resolveDepth(marker, currentLevel);

	// Walk backwards to find the most recent heading at the target level.
	for (let i = headingsAbove.length - 1; i >= 0; i--) {
		const h = headingsAbove[i]!;
		if (h.level === targetLevel) {
			return `↩ ${h.heading}`;
		}
		// Stop if we've gone past a shallower heading (context reset).
		if (h.level < targetLevel) break;
	}

	return getDisplayLabel(marker);
}
