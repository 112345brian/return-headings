/**
 * Shared scroll-tracking and heading-context utilities.
 *
 * The central performance insight (borrowed from obsidian-floating-toc-plugin):
 * computing the virtual heading stack is O(n) in document length. Doing it on
 * every scroll frame is wasteful. Instead, we precompute `HeadingBoundary[]`
 * once per document change (O(n)) and binary-search it on each scroll event
 * (O(log n)).
 */

import type { EditorView } from '@codemirror/view';
import { parseMarker, resolveDepth } from './parser';

// ── Types ────────────────────────────────────────────────────────────────────

/** One entry in the virtual heading stack at a given document position. */
export interface HeadingEntry {
	/** Heading level 1–6. */
	level: number;
	/** Heading text, without leading `#` characters. */
	text: string;
	/** 0-indexed line number in the source document. */
	line: number;
}

/**
 * Records the virtual heading stack immediately after a heading or return
 * marker on a given line has been applied. Sorted ascending by `line`.
 */
export interface HeadingBoundary {
	/** 0-indexed line where this structural event occurs. */
	line: number;
	/** Snapshot of the virtual heading stack after this line. */
	stack: HeadingEntry[];
}

// ── Precomputation ───────────────────────────────────────────────────────────

/**
 * Walks the full document content and records a `HeadingBoundary` snapshot
 * every time the virtual heading stack changes — i.e. at each real heading
 * or return-marker line.
 *
 * Call this once on `docChanged`; then use `findContextAtBoundaries` on each
 * scroll event to avoid O(n) work per frame.
 *
 * @param content - Full document text (from `editor.getValue()` or
 *   `view.state.doc.toString()`).
 * @returns Boundaries sorted ascending by line number.
 */
export function computeHeadingBoundaries(content: string): HeadingBoundary[] {
	const lines = content.split('\n');
	const stack: HeadingEntry[] = [];
	const boundaries: HeadingBoundary[] = [];

	for (let i = 0; i < lines.length; i++) {
		const trimmed = (lines[i] ?? '').trim();

		const headingMatch = trimmed.match(/^(#{1,6}) (.+)/);
		if (headingMatch) {
			const level = headingMatch[1]!.length;
			const text = headingMatch[2]!.trim();
			while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
			stack.push({ level, text, line: i });
			boundaries.push({ line: i, stack: stack.map(e => ({ ...e })) });
			continue;
		}

		const marker = parseMarker(trimmed);
		if (marker) {
			const currentLevel = stack.length > 0 ? stack[stack.length - 1]!.level : 0;
			const targetLevel = resolveDepth(marker, currentLevel);
			while (stack.length > 0 && stack[stack.length - 1]!.level > targetLevel) stack.pop();
			boundaries.push({ line: i, stack: stack.map(e => ({ ...e })) });
		}
	}

	return boundaries;
}

// ── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Binary-searches precomputed boundaries for the virtual heading stack that
 * was active at the given 0-indexed document line.
 *
 * Returns the stack of the last boundary whose `line` is ≤ `targetLine`, or
 * an empty array if no heading has appeared yet.
 *
 * O(log n) — safe to call on every scroll frame.
 *
 * @param boundaries - Output of `computeHeadingBoundaries`.
 * @param targetLine - 0-indexed line at the top of the visible editor area.
 */
export function findContextAtBoundaries(
	boundaries: HeadingBoundary[],
	targetLine: number,
): HeadingEntry[] {
	if (boundaries.length === 0) return [];

	let lo = 0;
	let hi = boundaries.length - 1;
	let result = -1;

	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (boundaries[mid]!.line <= targetLine) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}

	return result >= 0 ? (boundaries[result]!.stack ?? []) : [];
}

/**
 * Convenience one-shot function: scans `content` up to `targetLine` and
 * returns the virtual heading stack at that position.
 *
 * Prefer this when you need a single lookup; use the precomputed pair when
 * the same document is queried repeatedly (e.g. on every scroll frame).
 *
 * @param content - Document text, may be a prefix up to the target line.
 * @param targetLine - 0-indexed line to query.
 */
export function getContextAtLine(content: string, targetLine: number): HeadingEntry[] {
	const lines = content.split('\n');
	const stack: HeadingEntry[] = [];
	const limit = Math.min(targetLine, lines.length - 1);

	for (let i = 0; i <= limit; i++) {
		const trimmed = (lines[i] ?? '').trim();

		const headingMatch = trimmed.match(/^(#{1,6}) (.+)/);
		if (headingMatch) {
			const level = headingMatch[1]!.length;
			const text = headingMatch[2]!.trim();
			while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
			stack.push({ level, text, line: i });
			continue;
		}

		const marker = parseMarker(trimmed);
		if (marker) {
			const currentLevel = stack.length > 0 ? stack[stack.length - 1]!.level : 0;
			const targetLevel = resolveDepth(marker, currentLevel);
			while (stack.length > 0 && stack[stack.length - 1]!.level > targetLevel) stack.pop();
		}
	}

	return stack;
}

/**
 * Binary-searches the boundary list for the first boundary whose line is
 * strictly **greater than** `currentLine`.
 *
 * Returns the 0-indexed line number of that boundary, or `null` if there are
 * no more boundaries after `currentLine`.
 *
 * @param boundaries - Output of `computeHeadingBoundaries`.
 * @param currentLine - 0-indexed line at the top of the visible editor area.
 */
export function findNextBoundaryLine(
	boundaries: HeadingBoundary[],
	currentLine: number,
): number | null {
	let lo = 0;
	let hi = boundaries.length - 1;
	let result = -1;

	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (boundaries[mid]!.line > currentLine) {
			result = mid;
			hi = mid - 1;
		} else {
			lo = mid + 1;
		}
	}

	return result >= 0 ? (boundaries[result]!.line ?? null) : null;
}

// ── CM6 scroll helper ────────────────────────────────────────────────────────

/**
 * Returns the 0-indexed line number of the first fully visible line in the
 * CodeMirror editor.
 *
 * Uses `posAtCoords` with the actual screen position of the scroll container's
 * top-left corner. This is reliable regardless of container padding or the
 * content-area top offset — unlike `lineBlockAtHeight(scrollTop)` which
 * produces wrong results when `--file-margins` or similar CSS adds padding
 * above the first line.
 *
 * @param cm - The CodeMirror 6 `EditorView` instance.
 */
export function getFirstVisibleLineNum(cm: EditorView): number | null {
	try {
		const rect = cm.scrollDOM.getBoundingClientRect();
		// Use screen coordinates 1px inside the top-left corner so the hit-test
		// lands inside the content area rather than on the border.
		const pos = cm.posAtCoords({ x: rect.left + 1, y: rect.top + 1 });
		if (pos === null) return null;
		return cm.state.doc.lineAt(pos).number - 1; // convert to 0-indexed
	} catch {
		return null;
	}
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the text of a rendered heading element with any Strange New Worlds
 * reference-count badges stripped out.
 *
 * SNW injects `.snw-reference` spans inside heading elements; without this
 * stripping, `.textContent` would produce e.g. "Recents2" instead of "Recents".
 */
export function headingTextContent(h: HTMLElement): string {
	const clone = h.cloneNode(true) as HTMLElement;
	clone.querySelectorAll('.snw-reference, [class*="snw"]').forEach(n => n.remove());
	return clone.textContent?.trim() ?? '';
}

/**
 * Finds the source line for a rendered heading element using `metadataCache`.
 *
 * Strips SNW badges before comparing heading text. Returns `null` if the
 * heading can't be mapped (e.g. no cache, or heading is inside an embed).
 *
 * @param h - The rendered `<h1>`–`<h6>` element.
 * @param filePath - Source file path, used to look up the metadata cache.
 * @param metadataCache - Obsidian's `MetadataCache` instance.
 */
export function headingElementToLine(
	h: HTMLElement,
	filePath: string,
	metadataCache: { getCache(path: string): { headings?: { level: number; heading: string; position: { start: { line: number } } }[] } | null },
): number | null {
	const cache = metadataCache.getCache(filePath);
	if (!cache?.headings) return null;

	const text = headingTextContent(h);
	const level = parseInt(h.tagName[1]!);

	for (const ch of cache.headings) {
		if (ch.level === level && ch.heading === text) {
			return ch.position.start.line;
		}
	}
	return null;
}

/**
 * Returns the last rendered heading element (h1-h6) whose top edge is at or
 * above `threshold` viewport-y, filtering out headings inside embeds.
 *
 * Used by reading-view scroll detection in the floating TOC and outline pane.
 *
 * @param section - `.markdown-preview-section` or similar container.
 * @param threshold - Viewport Y coordinate (from `getBoundingClientRect().top`).
 */
export function lastHeadingAbove(section: HTMLElement, threshold: number): HTMLElement | null {
	const headings = Array.from(
		section.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'),
	).filter(h => !h.closest('.markdown-embed'));

	let result: HTMLElement | null = null;
	for (const h of headings) {
		if (h.getBoundingClientRect().top <= threshold) {
			result = h;
		} else {
			break;
		}
	}
	return result;
}
