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
 * Equivalent to `findContextAtBoundaries(computeHeadingBoundaries(content), targetLine)`
 * but stops scanning at `targetLine` rather than processing the full document.
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

// ── CM6 scroll helper ────────────────────────────────────────────────────────

/**
 * Returns the 0-indexed line number of the first fully visible line in the
 * CodeMirror editor, based on `scrollDOM.scrollTop`.
 *
 * Returns `null` if the position cannot be determined (e.g. the editor has
 * not finished laying out).
 *
 * Extracted as a shared helper because both the sticky breadcrumb bar and
 * the floating TOC need identical scroll-position logic.
 *
 * @param cm - The CodeMirror 6 `EditorView` instance (accessed via
 *   `(editor as any).cm` in Obsidian plugins).
 */
export function getFirstVisibleLineNum(cm: EditorView): number | null {
	try {
		const scrollTop = cm.scrollDOM.scrollTop;
		const block = cm.lineBlockAtHeight(scrollTop);
		return cm.state.doc.lineAt(block.from).number - 1; // convert to 0-indexed
	} catch {
		return null;
	}
}
