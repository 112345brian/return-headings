import { EditorView, showPanel, type Panel } from '@codemirror/view';
import { parseMarker, resolveDepth } from './parser';
import type { ReturnHeadingsSettings } from './settings';

export interface HeadingEntry {
	level: number;
	text: string;
	line: number; // 0-indexed
}

/**
 * Walks document content from line 0 through targetLine, applying both real
 * headings and return markers to maintain a virtual heading stack.
 * Returns the resolved stack at that position.
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

function renderBar(dom: HTMLElement, view: EditorView, settings: ReturnHeadingsSettings): void {
	if (!settings.stickyHeadingsEnabled) {
		dom.style.display = 'none';
		return;
	}

	const scrollTop = view.scrollDOM.scrollTop;

	// Nothing scrolled yet — bar would only duplicate what's already visible
	if (scrollTop < 1) {
		dom.style.display = 'none';
		return;
	}

	let lineNum: number;
	try {
		const block = view.lineBlockAtHeight(scrollTop);
		lineNum = view.state.doc.lineAt(block.from).number - 1; // convert to 0-indexed
	} catch {
		dom.style.display = 'none';
		return;
	}

	if (lineNum < 1) {
		dom.style.display = 'none';
		return;
	}

	// Slice doc only up to the current line — avoids scanning the full doc on every scroll
	const clampedLine = Math.min(lineNum + 1, view.state.doc.lines);
	const upToHere = view.state.sliceDoc(0, view.state.doc.line(clampedLine).to);
	const context = getContextAtLine(upToHere, lineNum);

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

export function buildStickyBarExtension(getSettings: () => ReturnHeadingsSettings) {
	return showPanel.of((view: EditorView): Panel => {
		const dom = document.createElement('div');
		dom.className = 'rh-sticky-bar';
		dom.style.display = 'none';

		let pending = false;
		const onScroll = () => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => {
				renderBar(dom, view, getSettings());
				pending = false;
			});
		};

		view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });

		return {
			dom,
			top: true,
			update(update) {
				if (update.docChanged || update.geometryChanged) {
					renderBar(dom, update.view, getSettings());
				}
			},
			destroy() {
				view.scrollDOM.removeEventListener('scroll', onScroll);
			},
		};
	});
}
