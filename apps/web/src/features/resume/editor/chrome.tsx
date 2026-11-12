import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ComponentProps, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { useFloatingToolbarSpace } from "@reactive-resume/ui/hooks/use-floating-toolbar-space";
import { clampZoom, FIT_MAX, useEditorStore, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./store";
import { anchoredScroll, wheelZoom, type ZoomAnchor } from "./zoom-wheel";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useLetterEditorStore } from "@/features/letters/store";
import { usePreviewPausedStore, useResumeStore } from "@/features/resume/builder/draft";

// The editor chrome resumes and letters share: the back link and drawer controls in the bar, the canvas width
// and the zoom bar.

// Page widths in PDF points; 1pt renders as 1 CSS px at 100%.
const PAGE_WIDTH = { a4: 595.28, letter: 612, "free-form": 595.28 } as const;
// Horizontal room the canvas keeps around the page: 40px each side, 16px on phones.
const CANVAS_GUTTER = { wide: 80, narrow: 32 } as const;

function useCanvasSize() {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		// Fit subtracts the horizontal gutters once; contentRect already excludes that padding.
		const observer = new ResizeObserver(([entry]) =>
			setSize({ width: element.clientWidth, height: entry?.contentRect.height ?? 0 }),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return [ref, size.width, size.height] as const;
}

/**
 * The rendered page under the pointer, so zoom holds the point on that page rather than the first page. A pointer in
 * the gap between pages gets the nearest page; while the preview is still loading, its only child.
 */
function pageUnderPointer(canvas: HTMLElement, clientX: number, clientY: number) {
	// A rendered page is the canvas's box; the loading placeholder has a figure per page instead. Both keep the page
	// itself last in the figure, after its caption.
	const pages = new Set<HTMLElement>();
	for (const element of canvas.querySelectorAll("canvas")) {
		if (element.parentElement) pages.add(element.parentElement);
	}
	for (const figure of canvas.querySelectorAll("figure")) {
		if (figure.lastElementChild instanceof HTMLElement) pages.add(figure.lastElementChild);
	}
	if (pages.size === 0) return canvas.firstElementChild;

	let nearest: HTMLElement | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const page of pages) {
		const bounds = page.getBoundingClientRect();
		const dx = clientX < bounds.left ? bounds.left - clientX : clientX > bounds.right ? clientX - bounds.right : 0;
		const dy = clientY < bounds.top ? bounds.top - clientY : clientY > bounds.bottom ? clientY - bounds.bottom : 0;
		const distance = dx + dy;
		if (distance === 0) return page;
		if (distance < nearestDistance) {
			nearest = page;
			nearestDistance = distance;
		}
	}
	return nearest;
}

/**
 * The canvas ref, the fit scale for the page format, and the scale the page is drawn at (zoom, or fit). `covered` is
 * the canvas width something lies over (a sheet), which fit leaves out.
 */
export function usePageScale(
	format: keyof typeof PAGE_WIDTH,
	covered = 0,
	/** Pages side by side: fit divides what's left of the width between them, and keeps one whole page in view. */
	across?: { pages: number; gap: number; pageHeight: number; chrome: number },
) {
	const zoom = useEditorStore((state) => state.zoom);
	const isPhone = useBreakpoint() === "mobile";
	const [canvasRef, canvasWidth, canvasHeight] = useCanvasSize();
	const gutter = isPhone ? CANVAS_GUTTER.narrow : CANVAS_GUTTER.wide;
	const pages = across?.pages ?? 1;
	const widthFit = (canvasWidth - gutter - covered - (across?.gap ?? 0) * (pages - 1)) / (PAGE_WIDTH[format] * pages);
	// Side by side, a page is seen whole: the canvas's height counts too, in steps of 10%.
	const heightFit = across ? (canvasHeight - across.chrome) / across.pageHeight : Number.POSITIVE_INFINITY;
	const fit = Math.min(FIT_MAX, widthFit, heightFit);
	const fitScale = canvasWidth > 0 ? (across ? Math.max(ZOOM_MIN, Math.floor(fit * 10) / 10) : fit) : 1;
	const pageScale = zoom === "fit" ? Math.max(0.25, fitScale) : zoom;

	// The wheel handler outlives renders: keep the current fit scale where it can read it.
	const fitScaleRef = useRef(fitScale);
	useEffect(() => {
		fitScaleRef.current = fitScale;
	}, [fitScale]);

	// A gesture's unrounded scale, the zoom it was last rounded to, and the page point it holds under the pointer.
	const wheelZoomRef = useRef<{ scale: number; stored: number } | null>(null);
	const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
	const zoomFrameRef = useRef<number | null>(null);
	/** The last zoom this handler set, so a change from Fit or the zoom bar can be told apart. */
	const wheelAppliedRef = useRef<number | null>(null);

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
			const stored = zoom === "fit" ? Math.max(0.25, fitScaleRef.current) : zoom;
			// Keep the unrounded scale between events, so a slow trackpad pinch adds up instead of rounding away. A
			// zoom set anywhere else (Fit, the zoom bar) starts a fresh gesture.
			const previous = wheelZoomRef.current;
			const accumulated = previous?.stored === stored ? previous.scale : null;
			const before = accumulated ?? stored;
			const raw = wheelZoom(before, event.deltaY, event.deltaMode, canvas.clientHeight);
			const after = clampZoom(raw);
			// Fit can sit below the explicit minimum on a small canvas: zooming out must not jump up to it.
			const changed = after !== stored && !(raw < before && after > stored);
			// Hold a scale inside the bounds, so an overshoot does not swallow the first reverse notch. A Fit below the
			// minimum keeps its own scale until a zoom-in raises it into range.
			const retained = changed
				? after
				: raw < before && stored < ZOOM_MIN
					? before
					: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw));
			wheelZoomRef.current = { scale: retained, stored: changed ? after : stored };
			if (!changed) return;

			// The page under the pointer, not the canvas's corner, is what stays put while it grows or shrinks.
			const page = pageUnderPointer(canvas, event.clientX, event.clientY);
			const pageBounds = page?.getBoundingClientRect();
			if (page && pageBounds) {
				const anchor = zoomAnchorRef.current;
				if (anchor) {
					// Several wheel events can land before one frame: keep every scale change, and follow the latest
					// pointer and the page now under it.
					anchor.ratio *= after / stored;
					anchor.page = page;
					anchor.contentX = event.clientX - pageBounds.left;
					anchor.contentY = event.clientY - pageBounds.top;
					anchor.pointerX = event.clientX;
					anchor.pointerY = event.clientY;
				} else {
					zoomAnchorRef.current = {
						page,
						contentX: event.clientX - pageBounds.left,
						contentY: event.clientY - pageBounds.top,
						ratio: after / stored,
						pointerX: event.clientX,
						pointerY: event.clientY,
					};
				}

				if (zoomFrameRef.current === null) {
					zoomFrameRef.current = requestAnimationFrame(() => {
						zoomFrameRef.current = null;
						const anchor = zoomAnchorRef.current;
						zoomAnchorRef.current = null;
						if (!anchor?.page.isConnected) return;
						const { left, top } = anchoredScroll(
							anchor,
							{ left: canvas.scrollLeft, top: canvas.scrollTop },
							anchor.page.getBoundingClientRect(),
						);
						canvas.scrollLeft = left;
						canvas.scrollTop = top;
					});
				}
			}

			wheelAppliedRef.current = after;
			setZoom(after);
		};

		// A zoom from Fit or the zoom bar replaces the gesture: its pending frame must not scroll the new layout by the
		// old scale ratio.
		const unsubscribe = useEditorStore.subscribe((state) => {
			if (state.zoom === wheelAppliedRef.current) return;
			wheelAppliedRef.current = null;
			wheelZoomRef.current = null;
			zoomAnchorRef.current = null;
			if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
			zoomFrameRef.current = null;
		});

		canvas.addEventListener("wheel", zoomByWheel, { passive: false });
		return () => {
			unsubscribe();
			canvas.removeEventListener("wheel", zoomByWheel);
			if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
			zoomFrameRef.current = null;
			zoomAnchorRef.current = null;
			wheelZoomRef.current = null;
			wheelAppliedRef.current = null;
		};
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

/**
 * The document name in the editor bar, as the button that opens the document menu. The name is the button's own
 * text and takes its own direction; the hover ground bleeds 6px past it. A locked resume says so in the status line.
 */
export function DocumentMenuTrigger({ name, isLocked: _isLocked, ...props }: DocumentMenuTriggerProps) {
	return (
		<button
			type="button"
			dir="auto"
			{...props}
			aria-label={t`Document menu: ${name}`}
			title={name}
			className="touch-target relative isolate flex max-w-full min-w-0 items-center gap-1 truncate text-start text-[15px]/5 font-semibold text-ink before:absolute before:-inset-x-1.5 before:-inset-y-0.5 before:-z-10 before:rounded-sm before:transition-colors before:duration-quick hover:before:bg-hover aria-expanded:before:bg-hover"
		>
			{name}
			<Icon name="caret-down" size={14} className="shrink-0 text-ink-3" />
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
						to={application ? "/dashboard/applications" : "/dashboard/documents"}
						search={application ? { applicationId: application.id } : {}}
						aria-label={label}
						className={buttonVariants({ variant: "ghost", size: "icon", className: "text-ink-2" })}
					/>
				}
			>
				<Icon name="caret-left" />
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

/** Tablet: hide the panel to give the page the whole canvas. */
export function DrawerControls({ pinnable: _pinnable }: { pinnable: boolean }) {
	const hidden = useEditorStore((state) => state.panelHidden);
	return (
		<IconButton
			icon="sidebar-simple"
			id="editor-panel-toggle"
			aria-controls="editor-panel"
			label={hidden ? t`Show panel` : t`Hide panel`}
			aria-expanded={!hidden}
			className="text-ink-2"
			onClick={() => useEditorStore.setState({ panelHidden: !hidden })}
		/>
	);
}

type ZoomBarProps = {
	fitScale: number;
	/** Kept for callers; the status line under the document's name counts the pages. */
	pageCount?: number;
};

/**
 * − · the scale · + · Fit, in the canvas's lower end corner, so nothing floats over the page. Zoom runs from 60% to
 * 300%, and Ctrl/Cmd+wheel over the canvas zooms around the pointer.
 */
export function ZoomBar({ fitScale }: ZoomBarProps) {
	const { t } = useLingui();
	const { ref } = useFloatingToolbarSpace();
	const paused = usePreviewPausedStore((state) => state.paused);
	const zoom = useEditorStore((state) => state.zoom);
	const setZoom = useEditorStore((state) => state.setZoom);
	const current = zoom === "fit" ? fitScale : zoom;

	useHotkey("Mod+0", () => setZoom("fit"), { meta: { name: t`Fit page to window` } });

	return (
		<div
			ref={paused ? undefined : ref}
			className="absolute end-5 bottom-5 flex h-10 items-center gap-0.5 rounded-lg border border-line bg-raised px-1 shadow-e2 pointer-coarse:gap-1.5"
		>
			<IconButton
				icon="minus"
				label={t`Zoom out`}
				size="icon-sm"
				tooltipSide="top"
				disabled={current <= ZOOM_MIN}
				onClick={() => setZoom(current - ZOOM_STEP)}
			/>
			<span className="px-2 text-center t-mono text-ink-2">{`${Math.round(current * 100)}%`}</span>
			<IconButton
				icon="plus"
				label={t`Zoom in`}
				size="icon-sm"
				tooltipSide="top"
				disabled={current >= ZOOM_MAX}
				onClick={() => setZoom(current + ZOOM_STEP)}
			/>
			<IconButton
				icon="arrows-in-simple"
				label={t`Fit page to window`}
				shortcut="⌘0"
				size="icon-sm"
				tooltipSide="top"
				onClick={() => setZoom("fit")}
			/>
		</div>
	);
}
