import { getDisplayLabel, parseMarker, resolveDepth } from './parser';

export interface OutlineNode {
	type: 'heading' | 'return';
	level: number;
	text: string;
	line: number;
	children: OutlineNode[];
}

export function buildVirtualTree(content: string): OutlineNode[] {
	const lines = content.split('\n');
	const root: OutlineNode[] = [];

	// Stack tracks the active ancestor chain as OutlineNode references.
	// Each entry's .level tells us heading depth; return markers are never pushed.
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
		const trimmed = lines[i]!.trim();

		// Real heading
		const headingMatch = trimmed.match(/^(#{1,6}) (.+)/);
		if (headingMatch) {
			const level = headingMatch[1]!.length;
			const text = headingMatch[2]!.trim();
			const node: OutlineNode = { type: 'heading', level, text, line: i, children: [] };

			// Pop until we find a parent with a shallower level
			while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
				stack.pop();
			}
			addChild(node);
			stack.push(node);
			continue;
		}

		// Return marker
		const marker = parseMarker(trimmed);
		if (!marker) continue;

		const targetLevel = resolveDepth(marker, topLevel());
		const node: OutlineNode = {
			type: 'return',
			level: targetLevel,
			text: getDisplayLabel(marker),
			line: i,
			children: [],
		};

		// Pop until the heading at targetLevel is the stack top.
		// Return markers are children of the heading they re-enter.
		while (stack.length > 0 && stack[stack.length - 1]!.level > targetLevel) {
			stack.pop();
		}
		addChild(node);
		// Return nodes are not pushed — they don't create a new heading context.
	}

	return root;
}
