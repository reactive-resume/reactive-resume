import type { ValueValidator } from "./rich-text-markup";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { isDarkColor } from "@reactive-resume/utils/color";
import { ParagraphIndent } from "./paragraph-indent";
import { LiteralHeading, LiteralParagraph, LiteralWhitespaceInput } from "./rich-input-whitespace";
import { cellStyles, keptStyle, rowStyles, tableStyles } from "./rich-text-markup";

// Keeps the table formatting the editor supports and drops every other declaration, including for unsupported markup
// shown read-only: imported HTML must not apply arbitrary CSS (overlays, external resources) just by being opened.
const preservedStyle = (styles: ReadonlyMap<string, ValueValidator>) => ({
	default: null,
	parseHTML: (element: HTMLElement) => keptStyle(element, styles),
	renderHTML: (attributes: { style?: string | null }) => (attributes.style ? { style: attributes.style } : {}),
});

const styled = <T extends typeof TableRow | typeof TableHeader | typeof TableCell>(
	extension: T,
	styles: ReadonlyMap<string, ValueValidator>,
) =>
	extension.extend({
		addAttributes() {
			return { ...this.parent?.(), style: preservedStyle(styles) };
		},
	});

const StyledTable = Table.extend({
	addAttributes() {
		return { ...this.parent?.(), style: preservedStyle(tableStyles) };
	},
	renderHTML({ HTMLAttributes }) {
		return ["table", HTMLAttributes, ["tbody", 0]];
	},
});

export const richTextExtensions = [
	StarterKit.configure({
		heading: false,
		paragraph: false,
		codeBlock: false,
		link: {
			openOnClick: false,
			enableClickSelection: true,
			defaultProtocol: "https",
			protocols: ["http", "https"],
		},
	}),
	LiteralParagraph,
	LiteralHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
	LiteralWhitespaceInput,
	TextStyle,
	Color,
	Highlight.configure({ multicolor: true }).extend({
		renderHTML({ HTMLAttributes }) {
			const color = HTMLAttributes["data-color"] as string | undefined;
			if (color && isDarkColor(color)) {
				HTMLAttributes.style = `${HTMLAttributes.style ?? ""}; color: #ffffff`;
			}
			return ["mark", HTMLAttributes, 0];
		},
	}),
	TextAlign.configure({ types: ["heading", "paragraph", "listItem"] }),
	ParagraphIndent,
	StyledTable,
	styled(TableRow, rowStyles),
	styled(TableHeader, cellStyles),
	styled(TableCell, cellStyles),
];
