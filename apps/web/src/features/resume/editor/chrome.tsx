import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ComponentProps, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./store";

// The editor chrome resumes and letters share: the back link and drawer controls in the bar, the canvas width
// and the zoom bar.

const LANDSCAPE_QUERY = "(orientation: landscape)";

function subscribeToOrientation(onChange: () => void) {
	const list = window.matchMedia(LANDSCAPE_QUERY);
	list.addEventListener("change", onChange);
	return () => list.removeEventListener("change", onChange);
}

/** Tablets in landscape can pin the panel beside the page. */
export const useIsLandscape = () =>
	useSyncExternalStore(
		subscribeToOrientation,
		() => window.matchMedia(LANDSCAPE_QUERY).matches,
		() => false,
	);

// Page widths in PDF points; 1pt renders as 1 CSS px at 100%.
const PAGE_WIDTH = { a4: 595.28, letter: 612, "free-form": 595.28 } as const;
// Horizontal room the canvas keeps around the page: 40px each side, 16px on phones.
const CANVAS_GUTTER = { wide: 80, narrow: 32 } as const;

function useCanvasWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return [ref, width] as const;
}

/** The canvas ref, the fit scale for the page format, and the scale the page is drawn at (zoom, or fit). */
export function usePageScale(format: keyof typeof PAGE_WIDTH) {
	const zoom = useEditorStore((state) => state.zoom);
	const isPhone = useBreakpoint() === "mobile";
	const [canvasRef, canvasWidth] = useCanvasWidth();
	const gutter = isPhone ? CANVAS_GUTTER.narrow : CANVAS_GUTTER.wide;
	const fitScale = canvasWidth > 0 ? Math.min(ZOOM_MAX, (canvasWidth - gutter) / PAGE_WIDTH[format]) : 1;
	const pageScale = zoom === "fit" ? Math.max(0.25, fitScale) : zoom;

	return { canvasRef, fitScale, pageScale };
}

type CanvasStatusPillProps = { icon: IconName; children: ReactNode };

/** The dark pill above the first page while a version or template is previewed instead of the live document. */
export function CanvasStatusPill({ icon, children }: CanvasStatusPillProps) {
	return (
		<span role="status" className="flex h-8 items-center gap-2 rounded-lg bg-ink px-3 text-[13px] text-bg">
			<Icon name={icon} size={18} />
			{children}
		</span>
	);
}

// Base UI's trigger hands its ref, handlers and aria state to the element it renders.
type DocumentMenuTriggerProps = ComponentProps<"button"> & { name: string; isLocked: boolean };

/** The document name in the editor bar, as the button that opens the document menu. */
export function DocumentMenuTrigger({ name, isLocked, ...props }: DocumentMenuTriggerProps) {
	return (
		<button
			type="button"
			{...props}
			aria-label={t`Document menu: ${name}`}
			className="-mx-1.5 flex max-w-[calc(100%+0.75rem)] min-w-0 flex-col items-start rounded-md px-1.5 py-0.5 text-start transition-colors duration-quick hover:bg-hover"
		>
			<span className="flex max-w-full min-w-0 items-center gap-1.5">
				<span className="truncate text-sm leading-[18px] font-semibold text-ink">{name}</span>
				{isLocked && <Icon name="lock" size={16} className="text-ink-3" />}
				<Icon name="expand_more" size={16} className="text-ink-3" />
			</span>
		</button>
	);
}

/** Leaving the editor is navigation, so it's a link styled as an icon button. */
export function BackLink() {
	const label = t`Back to documents`;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Link
						to="/dashboard"
						aria-label={label}
						className={buttonVariants({ variant: "ghost", size: "icon", className: "text-ink-2" })}
					/>
				}
			>
				<Icon name="arrow_back" />
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

/** Tablet: show or hide the panel drawer and, in landscape, pin it beside the page. */
export function DrawerControls({ pinnable }: { pinnable: boolean }) {
	const open = useEditorStore((state) => state.drawerOpen);
	const pinned = useEditorStore((state) => state.drawerPinned) && pinnable;
	const setOpen = useEditorStore((state) => state.setDrawerOpen);
	const setPinned = useEditorStore((state) => state.setDrawerPinned);

	return (
		<>
			{!pinned && (
				<IconButton
					icon={open ? "left_panel_close" : "left_panel_open"}
					label={open ? t`Hide panel` : t`Show panel`}
					aria-expanded={open}
					className="text-ink-2"
					onClick={() => setOpen(!open)}
				/>
			)}
			{pinnable && (open || pinned) && (
				<IconButton
					icon="vertical_split"
					label={t`Keep the panel beside the page`}
					aria-pressed={pinned}
					className={cn("text-ink-2", pinned && "bg-accent-soft text-accent-text")}
					onClick={() => {
						// Unpinning leaves the drawer open over the page.
						setPinned(!pinned);
						setOpen(true);
					}}
				/>
			)}
		</>
	);
}

type ZoomBarProps = {
	fitScale: number;
	pageCount: number;
};

/** − · Fit · + and the page count, floating 18px above the bottom of the canvas. Zoom runs from 60% to 150%. */
export function ZoomBar({ fitScale, pageCount }: ZoomBarProps) {
	const zoom = useEditorStore((state) => state.zoom);
	const setZoom = useEditorStore((state) => state.setZoom);
	const current = zoom === "fit" ? fitScale : zoom;

	useHotkey("Mod+0", () => setZoom("fit"));

	const buttonClassName =
		"flex size-8 items-center justify-center rounded-[7px] text-ink-2 transition-colors duration-quick hover:bg-hover disabled:text-ink-3 disabled:hover:bg-transparent";

	return (
		<div className="absolute bottom-[18px] left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-raised p-1 shadow-e2">
			<button
				type="button"
				aria-label={t`Zoom out`}
				disabled={current <= ZOOM_MIN}
				className={buttonClassName}
				onClick={() => setZoom(current - ZOOM_STEP)}
			>
				<Icon name="remove" />
			</button>
			<button
				type="button"
				aria-label={t`Fit page to width`}
				className="h-8 min-w-[52px] rounded-[7px] px-1.5 font-mono text-xs font-medium text-ink transition-colors duration-quick hover:bg-hover"
				onClick={() => setZoom("fit")}
			>
				{zoom === "fit" ? <Trans>Fit</Trans> : `${Math.round(current * 100)}%`}
			</button>
			<button
				type="button"
				aria-label={t`Zoom in`}
				disabled={current >= ZOOM_MAX}
				className={buttonClassName}
				onClick={() => setZoom(current + ZOOM_STEP)}
			>
				<Icon name="add" />
			</button>
			<span className="px-2 font-mono text-xs whitespace-nowrap text-ink-3">
				<Plural value={pageCount} one="# page" other="# pages" />
			</span>
		</div>
	);
}
