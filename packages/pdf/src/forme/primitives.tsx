import type { Style, StyleProp } from "./style-types";
import type { ReactNode } from "react";
import { createElement } from "react";

export type { Style, StyleProp } from "./style-types";

/**
 * The primitives templates are written with. They keep react-pdf's names and props, so templates carry over, and
 * record host elements that `to-forme.ts` turns into Forme nodes. `#react-pdf-renderer` resolves to this module.
 */

type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined };

type FlowProps = {
	style?: StyleProp | undefined;
	/** False keeps the element on one page. */
	wrap?: boolean | undefined;
	/** Starts the element on a new page. */
	break?: boolean | undefined;
	/** Repeats the element on every page. */
	fixed?: boolean | undefined;
	/** react-pdf only; Forme has no equivalent, so it's accepted and ignored. */
	minPresenceAhead?: number | undefined;
	children?: ReactNode;
} & DataAttributes;

export type ViewProps = FlowProps;

export type TextProps = FlowProps & {
	orphans?: number | undefined;
	widows?: number | undefined;
};

export type LinkProps = TextProps & { src: string };

export type ImageProps = {
	src: string | undefined;
	style?: StyleProp | undefined;
	fixed?: boolean | undefined;
} & DataAttributes;

export type SvgProps = {
	/** SVG markup of the drawing, without the outer `<svg>`. */
	content: string;
	viewBox?: string | undefined;
	width?: number | string | undefined;
	height?: number | string | undefined;
	style?: StyleProp | undefined;
	opacity?: number | undefined;
} & DataAttributes;

export type PageSize = "A4" | "LETTER" | { width: number; height?: number | undefined };

export type PageProps = {
	size?: PageSize | undefined;
	style?: StyleProp | undefined;
	wrap?: boolean | undefined;
	children?: ReactNode;
} & DataAttributes;

export type DocumentProps = {
	title?: string | undefined;
	author?: string | undefined;
	subject?: string | undefined;
	creator?: string | undefined;
	language?: string | undefined;
	/** "auto" hyphenates words by the document language; "manual" breaks only at soft hyphens. */
	hyphenation?: "auto" | "manual" | undefined;
	children?: ReactNode;
};

export const HOST = {
	document: "rr-document",
	page: "rr-page",
	view: "rr-view",
	text: "rr-text",
	link: "rr-link",
	image: "rr-image",
	svg: "rr-svg",
} as const;

const host =
	<P extends object>(type: string) =>
	(props: P) =>
		createElement(type, props);

export const Document = host<DocumentProps>(HOST.document);
export const Page = host<PageProps>(HOST.page);
export const View = host<ViewProps>(HOST.view);
export const Text = host<TextProps>(HOST.text);
export const Link = host<LinkProps>(HOST.link);
export const Image = host<ImageProps>(HOST.image);
export const Svg = host<SvgProps>(HOST.svg);

/** Kept for react-pdf-style `StyleSheet.create(...)`: an identity that keeps the literal types. */
export const StyleSheet = { create: <T extends Record<string, Style>>(styles: T): T => styles };
