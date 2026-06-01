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
import { getDisplayLabel, parseMarker, validateMarker } from './parser';

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

				const cursorLines = new Set<number>();
				for (const range of view.state.selection.ranges) {
					cursorLines.add(view.state.doc.lineAt(range.head).number);
				}

				let currentDepth = 0;
				const doc = view.state.doc;

				for (let i = 1; i <= doc.lines; i++) {
					const line = doc.line(i);
					const text = line.text.trim();

					const headingMatch = text.match(/^(#{1,6}) /);
					if (headingMatch && headingMatch[1]) {
						currentDepth = headingMatch[1].length;
						continue;
					}

					const marker = parseMarker(text);
					if (!marker) continue;

					if (cursorLines.has(i)) {
						builder.add(line.from, line.from, Decoration.line({ class: 'heading-return-marker-editing' }));
						continue;
					}

					if (settings.showSubtleMarkersInLivePreview) {
						const label = getDisplayLabel(marker);
						const invalid =
							settings.validateImpossibleReturns && currentDepth > 0
								? validateMarker(marker, currentDepth) !== null
								: false;

						builder.add(
							line.from,
							line.to,
							Decoration.replace({ widget: new ReturnMarkerWidget(label, invalid) }),
						);
					} else {
						builder.add(line.from, line.from, Decoration.line({ class: 'heading-return-marker-raw' }));
					}
				}

				return builder.finish();
			}
		},
		{ decorations: v => v.decorations },
	);
}
