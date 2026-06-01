/**
 * Builds a virtual heading tree from a document, aware of heading-return
 * markers. Used by the Semantic Outline pane and the Floating TOC.
 *
 * The key difference from Obsidian's native heading cache: when a return
 * marker is encountered (e.g. `---h2`), the active heading context is wound
 * back to that level. Subsequent headings and markers are treated as children
 * of the resumed heading, not as independent top-level items.
 */

import { getDisplayLabel, parseMarker, resolveDepth } from './parser';

// ── Types ────────────────────────────────────────────────────────────────────

/** A node in the virtual heading tree. */
export interface OutlineNode {
	/** `heading` for a real `## Foo` heading; `return` for a `---h2` marker. */
	type: 'heading' | 'return';
	/** Heading level 1–6 (for headings) or the resolved target level (for return markers). */
	level: number;
	/** Display text: the heading text, or a label like `↩ H2`. */
	text: string;
	/** 0-indexed source line number. */
	line: number;
	/** Child nodes in the tree. */
	children: OutlineNode[];
}

// ── Tree builder ─────────────────────────────────────────────────────────────

/**
 * Walks `content` line by line and builds a virtual heading tree that
 * respects heading-return markers.
 *
 * **Algorithm:**
 * - A real heading pops the stack until a shallower parent is found, then
 *   becomes a child of that parent (or a root node) and is pushed onto the
 *   stack.
 * - A return marker pops the stack until the *target* heading level is at
 *   the top, then adds the return node as a child of that heading. Return
 *   nodes are **not** pushed onto the stack — they don't create a new heading
 *   context.
 *
 * The resulting tree structure makes return markers appear as siblings of
 * sub-headings within the heading they re-enter, which is exactly what the
 * outline pane and floating TOC render.
 *
 * @param content - Full document text.
 * @returns Root-level outline nodes (may be empty for documents with no headings).
 */
export function buildVirtualTree(content: string): OutlineNode[] {
	const lines = content.split('\n');
	const root: OutlineNode[] = [];

	// `stack` tracks the current ancestor chain as live OutlineNode references.
	// Only heading nodes are pushed; return nodes are children but never ancestors.
	const stack: OutlineNode[] = [];

	const topLevel = () => (stack.length > 0 ? stack[stack.length - 1]!.level : 0);

	const addChild = (node: OutlineNode) => {
		if (stack.length > 0) {
			stack[stack.length - 1]!.children.push(node);
		} else {
			root.push(node);
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const trimmed = (lines[i] ?? '').trim();

		// ── Real heading ─────────────────────────────────────────────────────
		const headingMatch = trimmed.match(/^(#{1,6}) (.+)/);
		if (headingMatch) {
			const level = headingMatch[1]!.length;
			const text = headingMatch[2]!.trim();
			const node: OutlineNode = { type: 'heading', level, text, line: i, children: [] };

			while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
			addChild(node);
			stack.push(node);
			continue;
		}

		// ── Return marker ────────────────────────────────────────────────────
		const marker = parseMarker(trimmed);
		if (!marker) continue;

		const targetLevel = resolveDepth(marker, topLevel());

		// Pop the stack now so we can read the target heading's name.
		while (stack.length > 0 && stack[stack.length - 1]!.level > targetLevel) stack.pop();
		const targetHeading = stack[stack.length - 1];
		// Show "↩ Kant" rather than "↩ H2" — the heading name is more informative.
		const returnLabel = targetHeading ? `↩ ${targetHeading.text}` : getDisplayLabel(marker);

		const node: OutlineNode = {
			type: 'return',
			level: targetLevel,
			text: returnLabel,
			line: i,
			children: [],
		};

		// Stack already popped above when reading the target heading name.
		addChild(node);
		// Return nodes are NOT pushed — they don't become new heading contexts.
	}

	return root;
}
