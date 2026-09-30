import type { Style } from "../forme/style-types";
import type { ResolvedNodeStyle, ResolvedPageSize } from "@reactive-resume/resume/stylesheet";

type ResolvedPdfPageSize = ResolvedPageSize;

export type ResolvedPdfNodePresentation = {
	style?: Style;
	size?: ResolvedPdfPageSize;
	break?: boolean;
	wrap?: boolean;
	fixed?: boolean;
	minPresenceAhead?: number;
	orphans?: number;
	widows?: number;
};

export type ResolvedPdfFlowProps = Omit<ResolvedPdfNodePresentation, "style" | "size" | "orphans" | "widows">;
export type ResolvedPdfTextProps = Omit<ResolvedPdfNodePresentation, "style" | "size">;

export const resolvedPdfFlowProps = ({
	break: breakBefore,
	wrap,
	fixed,
	minPresenceAhead,
}: ResolvedPdfNodePresentation): ResolvedPdfFlowProps => ({
	...(breakBefore === undefined ? {} : { break: breakBefore }),
	...(wrap === undefined ? {} : { wrap }),
	...(fixed === undefined ? {} : { fixed }),
	...(minPresenceAhead === undefined ? {} : { minPresenceAhead }),
});

export const resolvedPdfTextProps = ({
	orphans,
	widows,
	...presentation
}: ResolvedPdfNodePresentation): ResolvedPdfTextProps => ({
	...resolvedPdfFlowProps(presentation),
	...(orphans === undefined ? {} : { orphans }),
	...(widows === undefined ? {} : { widows }),
});

const toReactPdfProperty = (property: string) => {
	if (property === "-resume-shadow-color") return "shadowColor";
	if (property === "-resume-shadow-width") return "shadowWidth";
	return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
};

const styleDelta = (resolved: ResolvedNodeStyle, base: ResolvedNodeStyle["style"] | undefined): Style | undefined => {
	const specified = new Set(resolved.specifiedStyleProperties);
	const entries: [string, string | number | undefined][] =
		base === undefined
			? Object.entries(resolved.style)
			: Object.entries(resolved.style).filter(([property]) => specified.has(property));
	for (const property of specified) {
		if (!(property in resolved.style)) entries.push([property, undefined]);
	}
	if (entries.length === 0) return undefined;

	return Object.freeze(
		Object.fromEntries(entries.map(([property, value]) => [toReactPdfProperty(property), value])),
	) as Style;
};

export function adaptResolvedPdfNode(
	resolved: ResolvedNodeStyle,
	base?: ResolvedNodeStyle,
): ResolvedPdfNodePresentation {
	const style = styleDelta(resolved, base?.style);
	const { structural } = resolved;
	const breakBefore =
		structural.breakBefore === "page" ? true : base?.structural.breakBefore === "page" ? false : undefined;
	const wrap = structural.breakInside === "avoid" ? false : base?.structural.breakInside === "avoid" ? true : undefined;
	const presentation = {
		...(style ? { style } : {}),
		...(structural.pageSize === undefined ? {} : { size: structural.pageSize }),
		...(breakBefore === undefined ? {} : { break: breakBefore }),
		...(wrap === undefined ? {} : { wrap }),
		...(structural.fixed === undefined ? {} : { fixed: structural.fixed }),
		...(structural.minPresenceAhead === undefined ? {} : { minPresenceAhead: structural.minPresenceAhead }),
		...(structural.orphans === undefined ? {} : { orphans: structural.orphans }),
		...(structural.widows === undefined ? {} : { widows: structural.widows }),
	} satisfies ResolvedPdfNodePresentation;

	return Object.freeze(presentation);
}
