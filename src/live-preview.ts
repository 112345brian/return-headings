/**
 * CodeMirror 6 editor extension for Live Preview / source mode.
 *
 * Scans the full document on every relevant update and applies decorations to
 * heading-return marker lines:
 *
 * - When the cursor is **on** the marker line: applies a CSS class so the raw
 *   syntax remains visible but styled faintly (editing-in-place feel).
 * - When the cursor is **elsewhere**: replaces the line with a `↩ H2`-style
 *   widget. Invalid markers (e.g. `---h7`) are highlighted in red if
 *   validation is enabled in settings.
 *
 * Registered via `Plugin.registerEditorExtension()` so it applies to every
 * open markdown editor.
 */

import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { ReturnHeadingsSettings } from './settings';
import { getDisplayLabel, parseMarker, resolveDepth, validateMarker } from './parser';

// ── Widget ───────────────────────────────────────────────────────────────────

/** Inline replacement widget rendered for off-cursor marker lines. */
class ReturnMarkerWidget extends WidgetType {
	constructor(
		readonly label: string,
		readonly invalid: boolean,
	) {
		super();
	}

	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className =
			'heading-return-marker' + (this.invalid ? ' heading-return-marker-invalid' : '');
		span.textContent = this.label;
		span.setAttribute('aria-label', this.label);
		return span;
	}

	eq(other: ReturnMarkerWidget): boolean {
		return this.label === other.label && this.invalid === other.invalid;
	}
}

// ── Extension ────────────────────────────────────────────────────────────────

/**
 * Builds the CM6 `ViewPlugin` extension that decorates heading-return markers
 * in Live Preview / source mode.
 *
 * The plugin tracks heading depth by scanning all lines in document order,
 * so relative return markers (`---h-1`) are validated against the correct
 * depth even when they appear deep in the document.
 *
 * @param getSettings - Accessor for the current plugin settings (called on
 *   every rebuild so settings changes are reflected immediately).
 */
export function buildLivePreviewExtension(getSettings: () => ReturnHeadingsSettings) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const settings = getSettings();
				const builder = new RangeSetBuilder<Decoration>();

				// Lines that contain a cursor selection — show raw syntax there.
				const cursorLines = new Set<number>();
				for (const range of view.state.selection.ranges) {
					cursorLines.add(view.state.doc.lineAt(range.head).number);
				}

				// Track full heading stack (level + text) so return-marker labels
				// can show the actual heading name rather than a generic "↩ H2".
				const headingStack: { level: number; text: string }[] = [];
				const doc = view.state.doc;

				for (let i = 1; i <= doc.lines; i++) {
					const line = doc.line(i);
					const text = line.text.trim();

					const headingMatch = text.match(/^(#{1,6}) (.+)/);
					if (headingMatch?.[1] && headingMatch?.[2]) {
						const level = headingMatch[1].length;
						const headingText = headingMatch[2].trim();
						while (
							headingStack.length > 0 &&
							headingStack[headingStack.length - 1]!.level >= level
						) {
							headingStack.pop();
						}
						headingStack.push({ level, text: headingText });
						continue;
					}

					const marker = parseMarker(text);
					if (!marker) continue;

					if (cursorLines.has(i)) {
						builder.add(
							line.from,
							line.from,
							Decoration.line({ class: 'heading-return-marker-editing' }),
						);
						continue;
					}

					const currentLevel =
						headingStack.length > 0 ? headingStack[headingStack.length - 1]!.level : 0;

					// Resolve the target heading name for an informative label.
					const targetLevel = resolveDepth(marker, currentLevel);
					const targetStack = headingStack.slice();
					while (
						targetStack.length > 0 &&
						targetStack[targetStack.length - 1]!.level > targetLevel
					) {
						targetStack.pop();
					}
					const targetHeading = targetStack[targetStack.length - 1];
					const label = targetHeading
						? `↩ ${targetHeading.text}`
						: getDisplayLabel(marker);

					if (settings.showSubtleMarkersInLivePreview) {
						const invalid =
							settings.validateImpossibleReturns && currentLevel > 0
								? validateMarker(marker, currentLevel) !== null
								: false;

						builder.add(
							line.from,
							line.to,
							Decoration.replace({ widget: new ReturnMarkerWidget(label, invalid) }),
						);
					} else {
						builder.add(
							line.from,
							line.from,
							Decoration.line({ class: 'heading-return-marker-raw' }),
						);
					}
				}

				return builder.finish();
			}
		},
		{ decorations: v => v.decorations },
	);
}
