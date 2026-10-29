/** Inline formatting collected while walking rich-text HTML. Colors are lowercase `rrggbb` (no leading `#`). */
export type InlineStyle = {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	code?: boolean;
	color?: string;
	highlight?: string;
};

export type OdtInline =
	| { type: "text"; text: string; style: InlineStyle }
	| { type: "tab" }
	| { type: "break" }
	| { type: "link"; href: string; children: OdtInline[] };

/** Named paragraph styles declared in `styles.xml`. */
export type ParagraphStyle =
	| "Body"
	| "Contact"
	| "EntryHeading"
	| "Meta"
	| "Quote"
	| "CodeBlock"
	| "Subtitle"
	| "Title";

export type OdtListItem = { blocks: OdtBlock[] };

export type OdtBlock =
	| { type: "paragraph"; children: OdtInline[]; style?: ParagraphStyle; indent?: number }
	| { type: "heading"; level: number; children: OdtInline[] }
	| { type: "list"; ordered: boolean; items: OdtListItem[] }
	| { type: "rule" };

/** Resolves a section's (usually empty) stored title from its id; locale-aware, supplied by the caller. */
export type SectionTitleResolver = (sectionId: string) => string | undefined;

export type OdtRenderOptions = { includeCoverLetterHeader?: boolean };

/** Builds a styled text run. */
export function text(value: string, style: InlineStyle = {}): OdtInline {
	return { type: "text", text: value, style };
}

/** Builds a paragraph block, with an optional named style and indent level. */
export function paragraph(children: OdtInline[], style?: ParagraphStyle, indent?: number): OdtBlock {
	return { type: "paragraph", children, ...(style ? { style } : {}), ...(indent ? { indent } : {}) };
}
