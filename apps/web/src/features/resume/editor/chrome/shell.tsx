import type { MobileView } from "@/features/resume/editor/store";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { CSSProperties, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { TabsContent } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { MobileTabIndicator } from "@/components/layout/mobile-tab-indicator";
import { AssistantOverlay } from "@/features/assistant/dock";
import { useEditorStore } from "@/features/resume/editor/store";

// The editor shell resumes and letters share: the layout for the screen, the one panel slot beside the page (the
// mode's panel, or the assistant or History in its place) and the phone tab bar. Each editor brings its own bar,
// panels, page and phone body. How another area mounts in the slot: `.agents` handoff, B/work/B/PANEL-SLOT.md.

/** One panel beside the page from 640px; phones show one view at a time. */
export function useEditorLayout() {
	const breakpoint = useBreakpoint();
	const layout = breakpoint === "mobile" ? "mobile" : breakpoint === "tablet" ? "tablet" : "desktop";
	return {
		layout,
		pinnable: false,
		pinned: layout === "tablet",
		assistantPlace: layout === "mobile" ? "screen" : "replace",
	} as const;
}

type EditorFrameProps = {
	editorLayout: ReturnType<typeof useEditorLayout>;
	bar: ReactNode;
	mode: string;
	/** The panel's accessible name in this mode. */
	panelLabel: string;
	panel: ReactNode;
	page: ReactNode;
	assistant: ReactNode;
	/** Version history, in the panel's place while `historyOpen` (the clock in the bar). Without it the clock keeps
	 * opening the Download & history sheet. */
	history?: ReactNode;
	/** Phones show one view at a time; each editor brings its own. */
	mobile: ReactNode;
	/** The Download & history sheet and hotkeys. */
	children: ReactNode;
};

/** A 56px bar over the one panel slot and the page; the assistant and History take the panel's place. */
export function EditorFrame({
	editorLayout,
	bar,
	mode,
	panelLabel,
	panel,
	page,
	assistant,
	history,
	mobile,
	children,
}: EditorFrameProps) {
	const { layout, assistantPlace } = editorLayout;

	return (
		<div className="grid h-svh grid-rows-[var(--editor-bar)_minmax(0,1fr)] overflow-hidden bg-bg">
			<a
				href="#main-content"
				className="sr-only rounded-md bg-raised px-4 py-2 text-sm focus-visible:not-sr-only focus-visible:absolute focus-visible:inset-s-2 focus-visible:top-2 focus-visible:z-[100]"
			>
				<Trans>Skip to the page</Trans>
			</a>

			{bar}

			{layout !== "mobile" && (
				<DesktopBody
					mode={mode}
					panelLabel={panelLabel}
					panel={panel}
					page={page}
					assistant={assistantPlace === "replace" ? assistant : null}
					history={history}
					narrow={layout === "tablet"}
				/>
			)}
			{layout === "mobile" && mobile}

			{assistantPlace === "screen" && <AssistantOverlay place={assistantPlace}>{assistant}</AssistantOverlay>}

			{children}
		</div>
	);
}

const PANEL_WIDTH_KEY = "editor-panel-width";
const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 360;
/** The page keeps at least this much room beside a dragged panel. */
const MIN_PAGE_WIDTH = 480;
const PANEL_WIDTH_STEP = 24;
/** The Design template gallery's width: room for a grid of template previews. */
const WIDE_PANEL_CSS = "clamp(380px, 65vw, 936px)";

const maxPanelWidth = () => Math.max(MIN_PANEL_WIDTH, window.innerWidth - MIN_PAGE_WIDTH);
const clampPanelWidth = (width: number) => Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), maxPanelWidth()));
/** The CSS width, clamped again by the window so a width saved on a wider screen still leaves the page its room. */
const panelWidthCss = (width: number) =>
	`clamp(${MIN_PANEL_WIDTH}px, ${width}px, max(${MIN_PANEL_WIDTH}px, calc(100vw - ${MIN_PAGE_WIDTH}px)))`;

// A per-browser convenience: private windows or blocked storage fall back to the default width.
function readPanelWidth() {
	try {
		const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
		return Number.isFinite(stored) && stored >= MIN_PANEL_WIDTH ? stored : DEFAULT_PANEL_WIDTH;
	} catch {
		return DEFAULT_PANEL_WIDTH;
	}
}

function savePanelWidth(width: number) {
	try {
		if (width === DEFAULT_PANEL_WIDTH) localStorage.removeItem(PANEL_WIDTH_KEY);
		else localStorage.setItem(PANEL_WIDTH_KEY, String(width));
	} catch {
		// Storage unavailable: the width lasts for this visit only.
	}
}

type PanelResizerProps = {
	width: number;
	onResize: (width: number) => void;
	onCommit: (width: number) => void;
};

/** How long the share-of-screen badge stays up after the last arrow key. */
const KEYBOARD_BADGE_MS = 1000;

const subscribeToViewport = (onChange: () => void) => {
	window.addEventListener("resize", onChange);
	return () => window.removeEventListener("resize", onChange);
};
/** The window's width, kept in step with resizes (read through React, so React Compiler never caches a stale value). */
const useViewportWidth = () =>
	useSyncExternalStore(
		subscribeToViewport,
		() => window.innerWidth,
		() => 0,
	);

/**
 * The panel's end edge: drag it, or focus it and use the arrow keys, to widen the panel. Double-click returns it to the
 * default width. In right-to-left layouts the panel sits on the right, so dragging left widens it. While it is being
 * resized, a badge beside the edge shows the panel's share of the screen.
 */
export function PanelResizer({ width, onResize, onCommit }: PanelResizerProps) {
	const { i18n } = useLingui();
	const drag = useRef<{ x: number; width: number; rtl: boolean; last: number } | null>(null);
	const keyboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Where the badge shows: at the pointer's height while dragging, centred (null) for the keyboard. */
	const [badge, setBadge] = useState<{ y: number | null } | null>(null);
	const viewport = useViewportWidth();
	const maxWidth = Math.max(MIN_PANEL_WIDTH, viewport - MIN_PAGE_WIDTH);
	// The width the panel actually has: a saved width is clamped again by a narrower window.
	const shownWidth = Math.min(Math.max(width, MIN_PANEL_WIDTH), maxWidth);
	const share = viewport ? i18n.number(shownWidth / viewport, { style: "percent", maximumFractionDigits: 0 }) : null;
	useEffect(
		() => () => {
			if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
		},
		[],
	);
	const set = (next: number) => {
		const clamped = clampPanelWidth(next);
		onResize(clamped);
		return clamped;
	};
	const showKeyboardBadge = () => {
		if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
		setBadge({ y: null });
		keyboardTimer.current = setTimeout(() => setBadge(null), KEYBOARD_BADGE_MS);
	};
	const pointerY = (event: { clientY: number; currentTarget: Element }) =>
		event.clientY - event.currentTarget.getBoundingClientRect().top;

	// A 24px target (44px on touch screens) that reaches 4px into the panel, so the panel's scrollbar stays usable; the
	// visible 2px line sits on the panel's edge.
	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- a focusable separator is the ARIA window-splitter pattern.
		<div
			role="separator"
			aria-orientation="vertical"
			aria-controls="editor-panel"
			aria-label={t`Resize panel`}
			aria-valuemin={MIN_PANEL_WIDTH}
			aria-valuemax={viewport ? maxWidth : undefined}
			aria-valuenow={shownWidth}
			aria-valuetext={share ? t`${share} of the screen` : undefined}
			tabIndex={0}
			title={t`Drag to resize. Double-click to reset.`}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				const panel = document.getElementById("editor-panel");
				drag.current = {
					x: event.clientX,
					width: panel?.getBoundingClientRect().width ?? width,
					rtl: getComputedStyle(event.currentTarget).direction === "rtl",
					last: width,
				};
				setBadge({ y: pointerY(event) });
			}}
			onPointerMove={(event) => {
				const start = drag.current;
				if (!start) return;
				const delta = (event.clientX - start.x) * (start.rtl ? -1 : 1);
				start.last = set(start.width + delta);
				setBadge({ y: pointerY(event) });
			}}
			onPointerUp={(event) => {
				const start = drag.current;
				if (!start) return;
				drag.current = null;
				setBadge(null);
				event.currentTarget.releasePointerCapture(event.pointerId);
				onCommit(start.last);
			}}
			onPointerCancel={() => {
				drag.current = null;
				setBadge(null);
			}}
			onDoubleClick={() => onCommit(set(DEFAULT_PANEL_WIDTH))}
			onKeyDown={(event) => {
				const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
				const step = event.shiftKey ? PANEL_WIDTH_STEP * 4 : PANEL_WIDTH_STEP;
				const keys: Record<string, number> = {
					ArrowRight: rtl ? -step : step,
					ArrowLeft: rtl ? step : -step,
				};
				let next: number | null = null;
				if (event.key in keys) next = shownWidth + (keys[event.key] ?? 0);
				else if (event.key === "Home") next = MIN_PANEL_WIDTH;
				else if (event.key === "End") next = maxPanelWidth();
				if (next === null) return;
				event.preventDefault();
				onCommit(set(next));
				showKeyboardBadge();
			}}
			className="group absolute inset-y-0 z-10 w-6 -translate-x-1 cursor-col-resize touch-none outline-none select-none rtl:translate-x-1 pointer-coarse:w-11"
			style={{ insetInlineStart: `var(--editor-panel)` }}
		>
			<span
				aria-hidden="true"
				className="absolute inset-y-0 start-1 w-0.5 -translate-x-1/2 bg-transparent transition-colors duration-quick group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent rtl:translate-x-1/2"
			/>
			{badge && share && (
				<span
					aria-hidden="true"
					className={cn(
						"pointer-events-none absolute start-full ms-2 rounded-sm bg-ink px-2 py-1 text-xs leading-4 font-medium whitespace-nowrap text-bg tabular-nums shadow-e2 transition-opacity duration-quick starting:opacity-0",
						badge.y === null ? "top-1/2 -translate-y-1/2" : "-translate-y-1/2",
					)}
					style={badge.y === null ? undefined : { top: badge.y }}
				>
					{share}
				</span>
			)}
		</div>
	);
}

type BodyProps = { mode: string; panelLabel: string; panel: ReactNode; page: ReactNode };

type DesktopBodyProps = BodyProps & {
	/** Takes the panel's place while `assistantOpen`. */
	assistant: ReactNode;
	/** Takes the panel's place while `historyOpen`. */
	history: ReactNode;
	/** Pinned on a tablet: a 380px panel. */
	narrow: boolean;
};

/**
 * The panel slot beside the page: 400px on desktop by default and resizable from its edge, 380px when pinned on a tablet. It holds one thing at a time: the
 * mode's panel, or the assistant or History in its place, so the page keeps its width. Hidden (`panelHidden`), the
 * page has the whole canvas.
 */
function DesktopBody({ mode, panelLabel, panel, page, assistant, history, narrow }: DesktopBodyProps) {
	const assistantOpen = useEditorStore((state) => state.assistantOpen);
	const historyOpen = useEditorStore((state) => state.historyOpen);
	const instant = useEditorStore((state) => state.assistantInstant);
	const hidden = useEditorStore((state) => state.panelHidden);
	// Desktop only: a pinned tablet panel keeps its 380px.
	const [panelWidth, setPanelWidth] = useState(readPanelWidth);
	// The Design template gallery takes a wide panel while it is open; the chosen width comes back when it closes.
	const wide = useEditorStore((state) => state.panelWide) && !narrow;
	const panelCss = wide ? WIDE_PANEL_CSS : panelWidthCss(panelWidth);
	// Toasts live in a portal; anchor their viewport to the visible panel through the document root.
	useEffect(() => {
		if (hidden) return;
		const root = document.documentElement;
		const previous = root.style.getPropertyValue("--toast-end");
		root.style.setProperty("--toast-end", narrow ? "calc(100vw - 380px + 1rem)" : `calc(100vw - ${panelCss} + 1rem)`);
		return () => {
			if (previous) root.style.setProperty("--toast-end", previous);
			else root.style.removeProperty("--toast-end");
		};
	}, [hidden, narrow, panelCss]);
	const takeover = assistantOpen && assistant ? "assistant" : historyOpen && history ? "history" : null;
	// Each thing fades up 4px as it takes the slot; ⌘J swaps at once.
	const enter = instant
		? undefined
		: "transition-[opacity,translate] duration-standard ease-enter starting:translate-y-1 starting:opacity-0";

	return (
		<div
			className="relative flex min-h-0"
			style={narrow ? undefined : ({ "--editor-panel": panelCss } as CSSProperties)}
		>
			{!hidden && (
				<aside
					id="editor-panel"
					data-design="epanel"
					data-panel={takeover ?? mode}
					aria-label={takeover === "assistant" ? t`Assistant` : takeover === "history" ? t`Version history` : t`Editor`}
					className={cn(
						"grid min-h-0 shrink-0 grid-rows-[minmax(0,1fr)] overflow-hidden border-e border-line bg-bg",
						narrow ? "w-[380px]" : "w-(--editor-panel)",
					)}
				>
					{takeover ? (
						<div key={takeover} className={cn("flex min-h-0 min-w-0 flex-col", enter)}>
							{takeover === "assistant" ? assistant : history}
						</div>
					) : (
						<TabsContent
							key={mode}
							value={mode}
							aria-label={panelLabel}
							// `relative`: absolutely positioned descendants (sr-only text, say) stay inside this scroller instead of
							// stretching the document, which would let scrollIntoView shift the whole editor. Keyed by mode so each
							// mode starts at its top; no scroll anchoring, which yanked the Design panel back while scrolling it.
							className={cn("relative flex min-h-0 flex-col overflow-y-auto [overflow-anchor:none]", enter)}
						>
							{panel}
						</TabsContent>
					)}
				</aside>
			)}
			{/* Not while the gallery owns the width: the splitter would report and change a width nobody sees. */}
			{!hidden && !narrow && !wide && (
				<PanelResizer
					width={panelWidth}
					onResize={setPanelWidth}
					onCommit={(width) => {
						setPanelWidth(width);
						savePanelWidth(width);
					}}
				/>
			)}
			<main id="main-content" className="min-h-0 min-w-0 flex-1">
				{page}
			</main>
		</div>
	);
}

type MobileTabBarProps<V extends MobileView> = {
	tabs: { view: V; icon: IconName; label: string }[];
	view: V;
	/** Every view but Page is also the editor's mode. */
	onModeChange: (mode: Exclude<V, "page">) => void;
};

/** Phones: the views along the bottom, one showing at a time. */
export function MobileTabBar<V extends MobileView>({ tabs, view, onModeChange }: MobileTabBarProps<V>) {
	return (
		<nav aria-label={t`Editor views`} className="flex border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
			{tabs.map(({ view: tab, icon, label }) => {
				const active = tab === view;

				return (
					<button
						key={tab}
						type="button"
						aria-current={active ? "page" : undefined}
						onClick={() => {
							useEditorStore.setState({ mobileView: tab });
							if (tab !== "page") onModeChange(tab as Exclude<V, "page">);
						}}
						className={cn(
							"relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-center text-xs [overflow-wrap:anywhere] transition-[color,scale] duration-quick ease-enter active:scale-[0.97]",
							tab === "page" && "ms-1 border-s border-line",
							active ? "font-semibold text-accent-text" : "text-ink-2",
						)}
					>
						{active && <MobileTabIndicator />}
						<Icon name={icon} size={24} filled={active} />
						{label}
					</button>
				);
			})}
		</nav>
	);
}
