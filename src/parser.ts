export type MarkerType = 'absolute' | 'relative';

export interface ReturnMarker {
	type: MarkerType;
	value: number;
	raw: string;
}

const ABSOLUTE_RE = /^---h(\d+)$/;
const RELATIVE_RE = /^---h-(\d+)$/;

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

export function validateMarker(marker: ReturnMarker, currentDepth: number): string | null {
	if (marker.type === 'absolute') {
		if (marker.value < 1 || marker.value > 6) {
			return `Invalid heading level h${marker.value} — Markdown only supports H1–H6.`;
		}
	} else {
		if (marker.value < 1) {
			return `Relative step must be at least 1.`;
		}
		if (currentDepth > 0 && currentDepth - marker.value < 1) {
			return `Cannot go up ${marker.value} level${marker.value > 1 ? 's' : ''} from H${currentDepth}.`;
		}
	}
	return null;
}

export function resolveDepth(marker: ReturnMarker, currentDepth: number): number {
	if (marker.type === 'absolute') return marker.value;
	return Math.max(1, currentDepth - marker.value);
}

export function getDisplayLabel(marker: ReturnMarker): string {
	if (marker.type === 'absolute') return `↩ H${marker.value}`;
	return `↩ up ${marker.value} heading${marker.value > 1 ? 's' : ''}`;
}
