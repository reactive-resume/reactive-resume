import type { EditorMode, MobileView } from "@/features/resume/editor/store";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { getRouteApi, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tabs, TabsContent } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { DesignSheet } from "./design-panel";
import { EditorBar } from "./editor-bar";
import { ModePanel } from "./mode-panels";
import { ShareSheet } from "./share-sheet";
import { useEditorHotkeys } from "./use-editor-hotkeys";
import { MobileTabIndicator } from "@/components/layout/mobile-tab-indicator";
import {
	AssistantColumn,
	AssistantOverlay,
	AssistantReplace,
	assistantGridTransition,
	assistantPlaceFor,
	columnsWithAssistant,
	ResumeAssistant,
} from "@/features/assistant/dock";
import { openAssistantFrom } from "@/features/assistant/open";
import { usePreviewPausedStore } from "@/features/resume/builder/draft";
import { IssueStepper } from "@/features/resume/editor/check/page-layer";
import { useIsLandscape } from "@/features/resume/editor/chrome";
import { useEditorStore } from "@/features/resume/editor/store";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { revealSelectionInPanel } from "@/features/resume/editor/write/reveal";

/**
 * The editor: a 56px bar over a 400px panel and the page canvas (desktop). On tablets the panel is a 380px
 * drawer over the page, pinnable beside it in landscape; on phones one view shows at a time, switched by
 * Write · Page · Design · Check tabs.
 */
export function EditorShell() {
	const [mode, setMode] = useEditorMode();
	const breakpoint = useBreakpoint();
	const layout = breakpoint === "mobile" ? "mobile" : breakpoint === "tablet" ? "tablet" : "desktop";
	const landscape = useIsLandscape();
	const pinnable = layout === "tablet" && landscape;
	const pinned = useEditorStore((state) => state.drawerPinned) && pinnable;
	const resetEditor = useEditorStore((state) => state.reset);
	const assistantPlace = assistantPlaceFor(breakpoint);

	// Selection, zoom and open sheets belong to one document.
	useEffect(() => resetEditor, [resetEditor]);
	useOpenVersionFromUrl();
	useOpenAssistantFromUrl();

	return (
		<Tabs value={mode} onValueChange={(value) => setMode(value as EditorMode)} className="contents">
			<div className="grid h-svh grid-rows-[var(--editor-bar)_minmax(0,1fr)] overflow-hidden bg-bg">
				<a
					href="#main-content"
					className="sr-only rounded-md bg-raised px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-[100]"
				>
					<Trans>Skip to the page</Trans>
				</a>

				<EditorBar layout={layout} pinnable={pinnable} />

				{(layout === "desktop" || pinned) && (
					<DesktopBody
						mode={mode}
						assistant={assistantPlace === "column" || assistantPlace === "replace" ? assistantPlace : null}
						narrow={pinned}
					/>
				)}
				{layout === "tablet" && !pinned && <TabletBody mode={mode} />}
				{layout === "mobile" && <MobileBody mode={mode} onModeChange={setMode} />}

				{(assistantPlace === "drawer" || assistantPlace === "screen") && (
					<AssistantOverlay place={assistantPlace}>
						<ResumeAssistant />
					</AssistantOverlay>
				)}

				<ShareSheet />
				<EditorHotkeys onModeChange={setMode} />
			</div>
		</Tabs>
	);
}

const routeApi = getRouteApi("/builder/$resumeId");

/** `?version=` opens History on that version (the page shows it read-only), then leaves the URL. */
function useOpenVersionFromUrl() {
	const { version } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();

	useEffect(() => {
		if (!version) return;
		const editor = useEditorStore.getState();
		editor.setShareTab("history");
		editor.setHistoryVersion(version);
		void navigate({
			to: ".",
			resetScroll: false,
			search: (current: ReturnType<typeof routeApi.useSearch>) => ({ ...current, version: undefined }),
			replace: true,
		});
	}, [version, navigate]);
}

/** `?assistant=` or `?ask=` opens the assistant on that conversation or question, then leaves the URL. */
function useOpenAssistantFromUrl() {
	const { assistant, ask } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();

	useEffect(() => {
		if (!openAssistantFrom({ assistant, ask })) return;
		void navigate({
			to: ".",
			resetScroll: false,
			search: (current: ReturnType<typeof routeApi.useSearch>) => ({
				...current,
				assistant: undefined,
				ask: undefined,
			}),
			replace: true,
		});
	}, [assistant, ask, navigate]);
}

function EditorHotkeys({ onModeChange }: { onModeChange: (mode: EditorMode) => void }) {
	useEditorHotkeys(onModeChange);
	return null;
}

const panelLabels = (): Record<EditorMode, string> => ({ write: t`Content`, design: t`Design`, check: t`Check` });

type DesktopBodyProps = {
	mode: EditorMode;
	/** ≥1280: the assistant has its own column. 1024–1279: it takes the panel's place while open. */
	assistant: "column" | "replace" | null;
	/** Pinned on a tablet: a 380px panel. */
	narrow: boolean;
};

/** The panel beside the page: 400px on desktop, 380px when pinned on a tablet; the assistant joins at ≥1280. */
function DesktopBody({ mode, assistant, narrow }: DesktopBodyProps) {
	const assistantOpen = useEditorStore((state) => state.assistantOpen);
	const assistantInstant = useEditorStore((state) => state.assistantInstant);
	const replaced = assistant === "replace" && assistantOpen;

	return (
		<div
			className={cn("relative grid min-h-0", assistantGridTransition(assistantOpen, assistantInstant))}
			style={{
				gridTemplateColumns:
					assistant === "column"
						? columnsWithAssistant(assistantOpen)
						: narrow
							? "380px minmax(0,1fr)"
							: "var(--editor-panel) minmax(0,1fr)",
			}}
		>
			<AssistantReplace
				replaced={replaced}
				assistant={
					<div className="min-h-0 border-e border-line">
						<ResumeAssistant />
					</div>
				}
			>
				<TabsContent
					key={mode}
					value={mode}
					aria-label={panelLabels()[mode]}
					// `relative`: absolutely positioned descendants (sr-only text, say) stay inside this scroller instead of
					// stretching the document, which would let scrollIntoView shift the whole editor. Keyed by mode so each
					// mode starts at its top; no scroll anchoring, which yanked the Design panel back while scrolling it.
					className="relative min-h-0 overflow-y-auto border-e border-line bg-surface [overflow-anchor:none]"
				>
					<ModePanel mode={mode} />
				</TabsContent>
			</AssistantReplace>
			<main id="main-content" className="min-h-0 min-w-0">
				<Outlet />
			</main>
			{assistant === "column" && (
				<AssistantColumn>
					<ResumeAssistant />
				</AssistantColumn>
			)}
		</div>
	);
}

function TabletBody({ mode }: { mode: EditorMode }) {
	const drawerOpen = useEditorStore((state) => state.drawerOpen);

	return (
		<div className="relative min-h-0">
			<main id="main-content" className="h-full min-w-0">
				<Outlet />
			</main>
			<TabsContent
				key={mode}
				value={mode}
				aria-label={panelLabels()[mode]}
				inert={!drawerOpen}
				className={cn(
					"absolute inset-y-0 start-0 z-20 w-[380px] max-w-[calc(100%-3rem)] overflow-y-auto border-e border-line bg-surface shadow-e3 transition-transform duration-emphasized ease-enter [overflow-anchor:none]",
					!drawerOpen && "-translate-x-full rtl:translate-x-full",
				)}
			>
				<ModePanel mode={mode} />
			</TabsContent>
		</div>
	);
}

type MobileBodyProps = {
	mode: EditorMode;
	onModeChange: (mode: EditorMode) => void;
};

const MOBILE_TABS: { view: MobileView; icon: IconName }[] = [
	{ view: "write", icon: "edit" },
	{ view: "page", icon: "description" },
	{ view: "design", icon: "palette" },
	{ view: "check", icon: "fact_check" },
];

function MobileBody({ mode, onModeChange }: MobileBodyProps) {
	const view = useEditorStore((state) => state.mobileView) ?? mode;
	const setView = useEditorStore((state) => state.setMobileView);
	const setPreviewPaused = usePreviewPausedStore((state) => state.setPaused);
	const labels: Record<MobileView, string> = { write: t`Write`, page: t`Page`, design: t`Design`, check: t`Check` };

	// The page stays mounted so zoom survives switching views; it doesn't re-render while hidden. Design keeps
	// it in view above its sheet.
	const pageVisible = view === "page" || view === "design";
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect -- a shared store the preview renderer reads, reset on unmount
		setPreviewPaused(!pageVisible);
		return () => setPreviewPaused(false);
	}, [pageVisible, setPreviewPaused]);

	return (
		<div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
			{/* Clip, not hidden: the lowered Design sheet overflows it, and scrolling into the sheet mustn't scroll it. */}
			<div className="relative min-h-0 overflow-clip">
				<main id="main-content" className={cn("h-full", !pageVisible && "invisible")}>
					<Outlet />
				</main>
				{view === "page" && mode === "check" && <IssueStepper />}
				{view === "page" && mode !== "check" && (
					<SelectionBar
						onEdit={() => {
							setView("write");
							onModeChange("write");
						}}
					/>
				)}
				{view === "design" && <DesignSheet />}
				{view !== "page" && view !== "design" && (
					<TabsContent
						key={mode}
						value={mode}
						className="absolute inset-0 overflow-y-auto bg-surface [overflow-anchor:none]"
					>
						<ModePanel mode={mode} />
					</TabsContent>
				)}
			</div>

			<nav
				aria-label={t`Editor views`}
				className="flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
			>
				{MOBILE_TABS.map(({ view: tab, icon }) => {
					const active = tab === view;

					return (
						<button
							key={tab}
							type="button"
							aria-current={active ? "page" : undefined}
							onClick={() => {
								setView(tab);
								if (tab !== "page") onModeChange(tab);
							}}
							className={cn(
								"relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-[color,scale] duration-quick ease-enter active:scale-[0.97]",
								active ? "font-semibold text-ink" : "text-ink-2",
							)}
						>
							{active && <MobileTabIndicator />}
							<Icon name={icon} size={24} filled={active} />
							{labels[tab]}
						</button>
					);
				})}
			</nav>
		</div>
	);
}

/** Phones: tapping a line on the page selects it and offers to edit that entry. Improve joins it in M10. */
function SelectionBar({ onEdit }: { onEdit: () => void }) {
	const selection = useEditorStore((state) => state.selection);
	if (!selection) return null;

	return (
		<div className="absolute bottom-[76px] left-1/2 z-10 flex -translate-x-1/2 items-center rounded-xl bg-ink p-1 text-bg shadow-e3 transition-[opacity,translate] duration-standard ease-enter starting:translate-y-2 starting:opacity-0">
			<button
				type="button"
				className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold"
				onClick={() => {
					onEdit();
					revealSelectionInPanel(selection);
				}}
			>
				<Icon name="edit" size={20} />
				<Trans>Edit entry</Trans>
			</button>
		</div>
	);
}
