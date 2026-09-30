import type { CSSProperties, ReactNode } from "react";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

/** A UI label: section kickers, scene numbers, small caps metadata. */
export const labelClass =
	"font-martian font-medium text-[11px] uppercase leading-[1.4] tracking-[.08em] font-stretch-[87.5%]";

type CtaLinkProps = { size: "header" | "hero" | "closing"; className?: string };

/** "Build your resume": the page's one call to action, in the header, the hero and the closing section. */
export function CtaLink({ size, className }: CtaLinkProps) {
	return (
		<Link
			to="/dashboard"
			className={cn(
				"inline-flex shrink-0 items-center rounded-full bg-accent font-semibold font-ui text-on-accent transition-colors hover:bg-accent-hover",
				size === "header" && "h-[38px] px-4 text-sm",
				size === "hero" && "h-[54px] gap-2.5 px-6 text-base shadow-e2",
				size === "closing" && "h-14 gap-2.5 px-7 text-[17px] shadow-e2",
				className,
			)}
		>
			<Trans>Build your resume</Trans>
			{size !== "header" && <Icon name="arrow_forward" size={20} />}
		</Link>
	);
}

type SceneCaptionProps = {
	number: string;
	title: string;
	children: ReactNode;
	/** A link under the sentence. */
	action?: ReactNode;
	className?: string;
};

/** A pinned scene's caption: "01 / Write" over a sentence or two in the display family. */
export function SceneCaption({ number, title, children, action, className }: SceneCaptionProps) {
	return (
		<div className={cn("flex flex-col gap-3", className)}>
			<span className={cn(labelClass, "text-accent-text")}>
				{number} / {title}
			</span>
			<p className="text-pretty font-display text-base text-ink leading-[1.45] min-[900px]:text-[clamp(17px,1.35vw,20px)]">
				{children}
			</p>
			{action}
		</div>
	);
}

const doodleSizes = {
	curve: [394, 312],
	eraser: [346, 283],
	globe: [301, 374],
	jar: [264, 347],
	magnifier: [403, 390],
	note: [400, 380],
	paperclip: [335, 299],
	pencil: [363, 378],
	plane: [369, 344],
	scissors: [403, 400],
} as const;

type DoodleProps = {
	name: keyof typeof doodleSizes;
	/** Mask wipe progress, usually derived from the section's --p. */
	wipe: string;
	className?: string;
	style?: CSSProperties;
	eager?: boolean;
};

/** A graphite doodle. Decorative, so it's hidden from assistive tech and never takes the pointer. */
export function Doodle({ name, wipe, className, style, eager = false }: DoodleProps) {
	const [width, height] = doodleSizes[name];
	return (
		<img
			src={`/doodles/${name}.webp`}
			alt=""
			aria-hidden="true"
			width={width}
			height={height}
			loading={eager ? "eager" : "lazy"}
			decoding="async"
			draggable={false}
			className={cn("doodle", className)}
			style={{ "--wipe": wipe, ...style } as CSSProperties}
		/>
	);
}

/** Splits text into user-perceived characters, so accents and conjuncts type in as one. */
function useGraphemes(text: string) {
	const { i18n } = useLingui();
	const segmenter = new Intl.Segmenter(i18n.locale, { granularity: "grapheme" });
	return Array.from(segmenter.segment(text), (part) => part.segment);
}

type TypedTextProps = {
	text: string;
	/** The CSS variable, from 0 to 1, that types the text in. */
	progress: string;
	className?: string;
	charClassName?: string;
	charStyle?: (index: number) => CSSProperties | undefined;
	/** How sharply each character fades in; higher is more like a keystroke. */
	rate?: number;
};

/**
 * Text that types in as `progress` rises. The characters are decorative, drawn as generated content: the whole string
 * is in the page once, as visually hidden text, so screen readers and search engines read it as a sentence.
 */
export function TypedText({ text, progress, className, charClassName, charStyle, rate }: TypedTextProps) {
	const characters = useGraphemes(text);
	const style = { "--typed": `var(${progress})`, "--typed-rate": rate } as CSSProperties;

	return (
		<span className={className} style={style}>
			<span className="sr-only">{text}</span>
			<span aria-hidden="true">
				{characters.map((character, index) => (
					<span
						key={index}
						data-char={character}
						className={cn("typed", charClassName)}
						style={{ "--f": (index / characters.length).toFixed(4), ...charStyle?.(index) } as CSSProperties}
					/>
				))}
			</span>
		</span>
	);
}
