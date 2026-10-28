import type { CSSProperties, ReactNode } from "react";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

/** A UI label: section kickers, scene numbers, small caps metadata. */
export const labelClass = "font-martian font-medium text-[13px] leading-[1.4]";

type CtaLinkProps = { size: "header" | "hero" | "closing"; className?: string };

/** "Build your resume": the page's one call to action, in the header, the hero and the closing section. */
export function CtaLink({ size, className }: CtaLinkProps) {
	return (
		<Link
			to="/auth/register"
			className={cn(
				"inline-flex shrink-0 items-center rounded-sm bg-accent font-ui font-semibold text-on-accent transition-[background-color,transform] duration-[160ms] ease-out-strong hover:bg-accent-hover motion-safe:active:[transform:scale(.97)]",
				size === "header" && "h-[38px] px-4 text-sm",
				size === "hero" && "h-[54px] gap-2.5 px-6 text-base shadow-e2",
				size === "closing" && "h-14 gap-2.5 px-7 text-[17px] shadow-e2",
				className,
			)}
		>
			<Trans>Build your resume</Trans>
			{size !== "header" && <Icon name="arrow-right" size={20} />}
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
			<p className="font-display text-base leading-[1.45] text-pretty text-ink min-[900px]:text-[clamp(17px,1.35vw,20px)]">
				{children}
			</p>
			{action}
		</div>
	);
}

const doodleSizes = {
	curve: [800, 634],
	eraser: [800, 665],
	globe: [575, 800],
	jar: [601, 800],
	magnifier: [800, 800],
	note: [800, 746],
	paperclip: [800, 717],
	pencil: [755, 800],
	plane: [800, 754],
	scissors: [800, 791],
} as const;

type DoodleProps = {
	name: keyof typeof doodleSizes;
	/** Mask wipe progress, usually derived from the section's --p. */
	wipe: string;
	className?: string;
	style?: CSSProperties;
	eager?: boolean;
	/** The width it's drawn at, for picking a file (`img` sizes). Below 900px most doodles hide; a hidden eager one says 1px. */
	sizes?: string;
};

/** A watercolour doodle. Decorative, so it's hidden from assistive tech and never takes the pointer. */
export function Doodle({
	name,
	wipe,
	className,
	style,
	eager = false,
	sizes = "(min-width: 900px) 10vw, 30vw",
}: DoodleProps) {
	const [width, height] = doodleSizes[name];
	return (
		<img
			src={`/doodles/${name}.webp`}
			srcSet={`/doodles/${name}-tiny.webp ${Math.round(width / 4)}w, /doodles/${name}-small.webp ${Math.round(width / 2)}w, /doodles/${name}.webp ${width}w`}
			sizes={sizes}
			alt=""
			aria-hidden="true"
			width={width}
			height={height}
			loading={eager ? "eager" : "lazy"}
			// Eager doodles sit on the first screen; the pencil is the largest paint on desktop.
			fetchPriority={eager ? "high" : "auto"}
			decoding="async"
			draggable={false}
			className={cn("doodle", className)}
			style={{ "--wipe": wipe, ...style } as CSSProperties}
		/>
	);
}

/** Splits text into words, preserving spaces and punctuation while reducing decorative DOM nodes. */
function useGraphemes(text: string, characters: boolean) {
	const { i18n } = useLingui();
	const segmenter = new Intl.Segmenter(i18n.locale, { granularity: characters ? "grapheme" : "word" });
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
	const characters = useGraphemes(text, Boolean(charStyle));
	const style = {
		"--typed": `var(${progress})`,
		"--typed-rate": rate,
		"--typed-step": (1 / Math.max(1, characters.length)).toFixed(5),
	} as CSSProperties;

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

type StampProps = {
	tone: "supported" | "partial" | "missing" | "applied";
	children: ReactNode;
	/** The CSS variable, from 0 to 1, that inks the stamp in. */
	stamp: string;
	className?: string;
};

/**
 * A rubber stamp in pencil-roughened ink, landing as `stamp` reaches 1: it comes down large and tilted, then settles.
 * Tailor stamps the posting Applied; Prepare stamps each requirement with what the evidence says.
 */
export function Stamp({ tone, children, stamp, className }: StampProps) {
	return (
		<span
			className={cn(
				"font-martian inline-flex h-[2em] shrink-0 [transform:scale(calc(1.7-var(--s)*.7))_rotate(calc(-5deg-(1-var(--s))*10deg))] items-center rounded-sm border-2 border-current px-[.6em] text-[.72em] font-bold whitespace-nowrap opacity-[calc(var(--s)*.88)] mix-blend-multiply [filter:url(#landing-pencil)] [transition:transform_.2s_var(--ease-out-strong)] dark:mix-blend-normal",
				tone === "supported" && "text-[oklch(0.48_0.11_150)]",
				tone === "partial" && "text-[oklch(0.55_0.12_70)]",
				tone === "missing" && "text-[oklch(0.5_0.01_95)]",
				tone === "applied" && "text-[oklch(0.5_0.12_250)] dark:text-[oklch(0.72_0.11_250)]",
				className,
			)}
			style={{ "--s": `var(${stamp})` } as CSSProperties}
		>
			{children}
		</span>
	);
}
