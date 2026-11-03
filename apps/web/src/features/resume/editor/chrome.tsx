import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ComponentProps, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { clampZoom, FIT_MAX, useEditorStore, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./store";
import { scrollAfterZoom, wheelZoom } from "./zoom-wheel";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useLetterEditorStore } from "@/features/letters/store";
import { useResumeStore } from "@/features/resume/builder/draft";

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

/**
 * The canvas ref, the fit scale for the page format, and the scale the page is drawn at (zoom, or fit). `covered` is
 * the canvas width something lies over (a sheet), which fit leaves out.
 */
export function usePageScale(format: keyof typeof PAGE_WIDTH, covered = 0) {
	const zoom = useEditorStore((state) => state.zoom);
	const isPhone = useBreakpoint() === "mobile";
	const [canvasRef, canvasWidth] = useCanvasWidth();
	const gutter = isPhone ? CANVAS_GUTTER.narrow : CANVAS_GUTTER.wide;
	const fitScale = canvasWidth > 0 ? Math.min(FIT_MAX, (canvasWidth - gutter - covered) / PAGE_WIDTH[format]) : 1;
	const pageScale = zoom === "fit" ? Math.max(0.25, fitScale) : zoom;

	// The wheel handler outlives renders: keep the current fit scale where it can read it.
	const fitScaleRef = useRef(fitScale);
	useEffect(() => {
		fitScaleRef.current = fitScale;
	}, [fitScale]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const zoomByWheel = (event: WheelEvent) => {
			// Ctrl/Cmd+wheel is the browser's zoom gesture (a trackpad pinch sends it too): keep it on the canvas. Every
			// other wheel is left alone, so the page scrolls normally, and the panel and the rest of the app are untouched.
			if (!(event.ctrlKey || event.metaKey) || event.altKey || event.deltaY === 0) return;

			// Even at a zoom limit the browser must not step in and zoom the whole app.
			event.preventDefault();

			const { zoom, setZoom } = useEditorStore.getState();
			const before = zoom === "fit" ? Math.max(0.25, fitScaleRef.current) : zoom;
			const after = clampZoom(wheelZoom(before, event.deltaY, event.deltaMode, canvas.clientHeight));
			if (after === before) return;

			const bounds = canvas.getBoundingClientRect();
			const pointerX = event.clientX - bounds.left;
			const pointerY = event.clientY - bounds.top;
			const { scrollLeft, scrollTop } = canvas;

			setZoom(after);

			// Zoom around the pointer, not the page's corner, once the new scale has been laid out.
			requestAnimationFrame(() => {
				if (!canvas.isConnected) return;
				canvas.scrollLeft = scrollAfterZoom(scrollLeft, pointerX, before, after);
				canvas.scrollTop = scrollAfterZoom(scrollTop, pointerY, before, after);
			});
		};

		canvas.addEventListener("wheel", zoomByWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", zoomByWheel);
	}, [canvasRef]);

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
				<span dir="auto" className="truncate text-sm leading-[18px] font-semibold text-ink">
					{name}
				</span>
				{isLocked && <Icon name="lock" size={16} className="text-ink-3" />}
				<Icon name="caret-down" size={16} className="text-ink-3" />
			</span>
		</button>
	);
}

/**
 * Leaving the editor is navigation, so it's a link styled as an icon button. Opened from an application, it returns
 * there — after checking that application owns this document — instead of stranding the user in Documents.
 */
export function BackLink() {
	const params = useParams({ strict: false });
	const search = useSearch({ strict: false });
	const letterApplicationId = useLetterEditorStore((state) =>
		state.letter?.id === params.coverLetterId ? state.letter?.sourceApplicationId : null,
	);
	const resumeApplicationId = useResumeStore((state) =>
		state.resume?.id === params.resumeId ? state.resume?.applicationId : null,
	);
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const applicationId = search.applicationId ?? letterApplicationId ?? resumeApplicationId;
	const application =
		applications?.find(
			(item) =>
				item.id === applicationId &&
				(params.resumeId ? item.resumeId === params.resumeId : item.coverLetterId === params.coverLetterId),
		) ??
		(!search.applicationId
			? applications?.find((item) =>
					params.resumeId ? item.resumeId === params.resumeId : item.coverLetterId === params.coverLetterId,
				)
			: undefined);
	const label = application ? t`Back to ${application.company}` : t`Back to documents`;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Link
						to={application ? "/dashboard/applications" : "/dashboard"}
						search={application ? { applicationId: application.id } : {}}
						aria-label={label}
						className={buttonVariants({ variant: "ghost", size: "icon", className: "text-ink-2" })}
					/>
				}
			>
				<Icon name="arrow-left" />
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

/** Tablet: show or hide the panel drawer and, in landscape, pin it beside the page. */
export function DrawerControls({ pinnable }: { pinnable: boolean }) {
	const open = useEditorStore((state) => state.drawerOpen);
	const pinned = useEditorStore((state) => state.drawerPinned) && pinnable;

	return (
		<>
			{!pinned && (
				<IconButton
					icon={open ? "sidebar-simple" : "sidebar-simple"}
					id="editor-panel-toggle"
					aria-controls="editor-panel"
					label={open ? t`Hide panel` : t`Show panel`}
					aria-expanded={open}
					className="text-ink-2"
					onClick={() => useEditorStore.setState({ drawerOpen: !open })}
				/>
			)}
			{pinnable && (open || pinned) && (
				<IconButton
					icon="square-split-horizontal"
					label={t`Keep the panel beside the page`}
					aria-pressed={pinned}
					className={cn("text-ink-2", pinned && "bg-accent-soft text-accent-text")}
					onClick={() => {
						// Unpinning leaves the drawer open over the page.
						useEditorStore.setState({ drawerPinned: !pinned, drawerOpen: true });
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

/**
 * − · Fit · + and the page count, floating 18px above the bottom of the canvas. Zoom runs from 60% to 300%, and
 * Ctrl/Cmd+wheel over the canvas zooms around the pointer.
 */
export function ZoomBar({ fitScale, pageCount }: ZoomBarProps) {
	const { t } = useLingui();
	const zoom = useEditorStore((state) => state.zoom);
	const setZoom = useEditorStore((state) => state.setZoom);
	const current = zoom === "fit" ? fitScale : zoom;

	useHotkey("Mod+0", () => setZoom("fit"), { meta: { name: t`Fit page to width` } });
	// Toasts sit bottom center, where this bar is: lift them above it while it's on screen.
	useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--toast-bottom", "4.5rem");
		return () => {
			root.style.removeProperty("--toast-bottom");
		};
	}, []);

	const buttonClassName =
		// touch-target: a 44px hit area on touch screens around the 32px button; the bar's coarse-pointer gap keeps
		// neighbouring hit areas from overlapping.
		"touch-target relative flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors duration-quick hover:bg-hover disabled:text-ink-3 disabled:hover:bg-transparent";

	return (
		<div className="absolute bottom-[18px] left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-raised p-1 shadow-e2 pointer-coarse:gap-1.5">
			<button
				type="button"
				aria-label={t`Zoom out`}
				disabled={current <= ZOOM_MIN}
				className={buttonClassName}
				onClick={() => setZoom(current - ZOOM_STEP)}
			>
				<Icon name="minus" />
			</button>
			<button
				type="button"
				aria-label={t`Fit page to width`}
				className="touch-target relative h-8 min-w-[52px] rounded-lg px-1.5 font-mono text-xs font-medium text-ink transition-colors duration-quick hover:bg-hover"
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
				<Icon name="plus" />
			</button>
			<span className="px-2 font-mono text-xs whitespace-nowrap text-ink-3">
				<Plural value={pageCount} one="# page" other="# pages" />
			</span>
		</div>
	);
}
