/**
 * Syntax parser for heading-return markers.
 *
 * Recognises two forms:
 *   `---hN`   — absolute return: jump to heading level N (1–6)
 *   `---h-N`  — relative return: move up N levels from the current depth
 *
 * These are the only lines this plugin treats as structural markers;
 * everything else is left to Obsidian's normal Markdown rendering.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Distinguishes absolute (`---h2`) from relative (`---h-1`) return markers. */
export type MarkerType = 'absolute' | 'relative';

/** A parsed heading-return marker line. */
export interface ReturnMarker {
	type: MarkerType;
	/**
	 * For `absolute`: the target heading level (1–6).
	 * For `relative`: the number of levels to ascend (≥ 1).
	 */
	value: number;
	/** The raw trimmed text of the marker line, e.g. `---h2` or `---h-1`. */
	raw: string;
}

// ── Regexes ──────────────────────────────────────────────────────────────────

const ABSOLUTE_RE = /^---h(\d+)$/;
const RELATIVE_RE = /^---h-(\d+)$/;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempts to parse a single trimmed line as a heading-return marker.
 *
 * @param line - A single line of document text (should be trimmed).
 * @returns A `ReturnMarker` if the line matches, or `null` otherwise.
 */
export function parseMarker(line: string): ReturnMarker | null {
	const trimmed = line.trim();

	const abs = trimmed.match(ABSOLUTE_RE);
	if (abs && abs[1] !== undefined) {
		return { type: 'absolute', value: parseInt(abs[1]), raw: trimmed };
	}

	const rel = trimmed.match(RELATIVE_RE);
	if (rel && rel[1] !== undefined) {
		return { type: 'relative', value: parseInt(rel[1]), raw: trimmed };
	}

	return null;
}

/**
 * Validates a marker against the current heading depth.
 *
 * @param marker - The marker to validate.
 * @param currentDepth - The heading level currently at the top of the stack
 *   (0 if no heading has been encountered yet).
 * @returns An error message string if the marker is invalid, or `null` if it
 *   is well-formed.
 */
export function validateMarker(marker: ReturnMarker, currentDepth: number): string | null {
	if (marker.type === 'absolute') {
		if (marker.value < 1 || marker.value > 6) {
			return `Invalid heading level h${marker.value} — Markdown only supports H1–H6.`;
		}
	} else {
		if (marker.value < 1) {
			return 'Relative step must be at least 1.';
		}
		if (currentDepth > 0 && currentDepth - marker.value < 1) {
			return `Cannot go up ${marker.value} level${marker.value > 1 ? 's' : ''} from H${currentDepth}.`;
		}
	}
	return null;
}

/**
 * Resolves a marker to an absolute heading level given the current depth.
 *
 * @param marker - The marker to resolve.
 * @param currentDepth - The heading level at the top of the stack (0 = none).
 * @returns The absolute heading level (1–6) the marker resolves to.
 */
export function resolveDepth(marker: ReturnMarker, currentDepth: number): number {
	if (marker.type === 'absolute') return marker.value;
	return Math.max(1, currentDepth - marker.value);
}

/**
 * Returns the short human-readable label shown in the Live Preview widget,
 * sticky bar, floating TOC, and outline pane.
 *
 * @param marker - The parsed marker.
 * @returns e.g. `↩ H2` or `↩ up 2 headings`.
 */
export function getDisplayLabel(marker: ReturnMarker): string {
	if (marker.type === 'absolute') return `↩ H${marker.value}`;
	return `↩ up ${marker.value} heading${marker.value > 1 ? 's' : ''}`;
}
