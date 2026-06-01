/**
 * Sticky heading breadcrumb bar — CM6 `showPanel` extension.
 *
 * Adds a panel at the top of the editor (above the scroller content, natively
 * managed by CM6) that shows the virtual heading context at the current scroll
 * position as a clickable breadcrumb trail.
 *
 * **What makes this different from obsidian-sticky-headings:**
 * The context is derived from `findContextAtBoundaries()` which resolves
 * heading-return markers (`---h2`, `---h-1`) as well as real headings. Scrolling
 * past a return marker correctly updates the breadcrumb to reflect structural
 * re-entry — something `metadataCache.headings` cannot express.
 *
 * **Performance approach (borrowed from obsidian-floating-toc-plugin):**
 * Boundaries are precomputed O(n) on `docChanged` and searched O(log n) on
 * every scroll frame, instead of scanning the document on each frame.
 */

import { EditorView, showPanel, type Panel } from '@codemirror/view';
import type { ReturnHeadingsSettings } from './settings';
import {
	type HeadingBoundary,
	type HeadingEntry,
	computeHeadingBoundaries,
	findContextAtBoundaries,
	getFirstVisibleLineNum,
} from './utils';

// Re-export so callers that previously imported HeadingEntry from here still work.
export type { HeadingEntry };

// ── Bar renderer ─────────────────────────────────────────────────────────────

/**
 * Rebuilds the breadcrumb DOM inside `dom` for the given virtual heading
 * context. Each item is a clickable span that moves the cursor to the
 * corresponding heading and scrolls it into view.
 */
function renderBar(
	dom: HTMLElement,
	view: EditorView,
	boundaries: HeadingBoundary[],
	settings: ReturnHeadingsSettings,
): void {
	if (!settings.stickyHeadingsEnabled) {
		dom.style.display = 'none';
		return;
	}

	const scrollTop = view.scrollDOM.scrollTop;

	// At the very top there is nothing to summarise — the heading is already visible.
	if (scrollTop < 1) {
		dom.style.display = 'none';
		return;
	}

	const lineNum = getFirstVisibleLineNum(view);
	if (lineNum === null || lineNum < 1) {
		dom.style.display = 'none';
		return;
	}

	const context = findContextAtBoundaries(boundaries, lineNum);

	dom.empty();

	if (context.length === 0) {
		dom.style.display = 'none';
		return;
	}

	dom.style.display = '';

	context.forEach((entry, idx) => {
		if (idx > 0) {
			dom.createEl('span', { text: '›', cls: 'rh-sticky-sep' });
		}

		const isLast = idx === context.length - 1;
		const item = dom.createEl('span', {
			text: entry.text,
			cls: `rh-sticky-item rh-sticky-level-${entry.level}${isLast ? ' rh-sticky-current' : ''}`,
		});

		// Capture line number so the click handler stays correct after re-renders.
		const targetLineIdx = entry.line;
		item.addEventListener('click', () => {
			const cmLine = view.state.doc.line(
				Math.max(1, Math.min(targetLineIdx + 1, view.state.doc.lines)),
			);
			view.dispatch({
				selection: { anchor: cmLine.from },
				effects: EditorView.scrollIntoView(cmLine.from, { y: 'start', yMargin: 0 }),
			});
		});
	});
}

// ── Extension ────────────────────────────────────────────────────────────────

/**
 * Builds the CM6 `showPanel` extension that renders the sticky breadcrumb bar.
 *
 * The panel registers a direct scroll event listener on `view.scrollDOM` for
 * responsive updates (rAF-throttled), and also rebuilds on `docChanged` and
 * `geometryChanged` via the `update` callback.
 *
 * Boundaries are recomputed only when the document changes (`docChanged`), not
 * on every scroll event, keeping scroll-frame work to O(log n).
 *
 * @param getSettings - Accessor for the current plugin settings.
 */
export function buildStickyBarExtension(getSettings: () => ReturnHeadingsSettings) {
	return showPanel.of((view: EditorView): Panel => {
		const dom = document.createElement('div');
		dom.className = 'rh-sticky-bar';
		dom.style.display = 'none';

		// Boundaries are cached and refreshed only on doc change.
		let boundaries: HeadingBoundary[] = computeHeadingBoundaries(
			view.state.doc.toString(),
		);

		let pending = false;
		const onScroll = () => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => {
				renderBar(dom, view, boundaries, getSettings());
				pending = false;
			});
		};

		view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });

		return {
			dom,
			top: true,
			update(update) {
				if (update.docChanged) {
					// Recompute boundaries only when content changes.
					boundaries = computeHeadingBoundaries(update.view.state.doc.toString());
				}
				if (update.docChanged || update.geometryChanged) {
					renderBar(dom, update.view, boundaries, getSettings());
				}
			},
			destroy() {
				view.scrollDOM.removeEventListener('scroll', onScroll);
			},
		};
	});
}
