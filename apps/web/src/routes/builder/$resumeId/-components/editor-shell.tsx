import type { EditorMode } from "@/features/resume/editor/store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { getRouteApi, Outlet } from "@tanstack/react-router";
import { Suspense, useCallback, useEffect, useRef } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tabs, TabsContent } from "@reactive-resume/ui/components/tabs";
import { useFloatingToolbarSpace } from "@reactive-resume/ui/hooks/use-floating-toolbar-space";
import { cn } from "@reactive-resume/utils/style";
import { DownloadSheet } from "./download-sheet";
import { EditorBar } from "./editor-bar";
import { DesignPanel, ModePanel } from "./mode-panels";
import { useEditorHotkeys } from "./use-editor-hotkeys";
import { ResumeAssistant } from "@/features/assistant/dock";
import { takeAssistantHandoff } from "@/features/assistant/handoff";
import { openAssistantFrom } from "@/features/assistant/open";
import { useAssistantInUrl } from "@/features/assistant/use-assistant-url";
import { useMarkDocumentOpened } from "@/features/documents/new-documents";
import { usePreviewPausedStore } from "@/features/resume/builder/draft";
import { IssueStepper } from "@/features/resume/editor/check/page-layer";
import { EditorFrame, MobileTabBar, useEditorLayout } from "@/features/resume/editor/chrome/shell";
import { isSameSelection, useEditorStore } from "@/features/resume/editor/store";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { useResumeWebMcpTools } from "@/features/resume/editor/webmcp";
import { revealSelectionInPanel } from "@/features/resume/editor/write/reveal";
import { preloadRichTextEditor } from "@/features/resume/editor/write/rich-text-editor";
import { searchOf, selectionOf } from "@/features/resume/editor/write/view";
import { whenIdle } from "@/features/resume/preview/resume-thumbnail.shared";
import { HistoryPanel, HistoryTab } from "@/features/resume/share/history-tab";

/**
 * The editor: a 56px bar over one 400px panel slot and the page canvas (desktop). The slot holds the mode's panel, or
 * the assistant or History in its place. On tablets the panel is a 380px drawer over the page, pinnable beside it in
 * landscape; on phones one view shows at a time, switched by Write · Page · Design · Check · Share tabs.
 */
export function EditorShell() {
	const [mode, setMode] = useEditorMode();
	const editorLayout = useEditorLayout();
	const resetEditor = useEditorStore((state) => state.reset);

	// Selection, zoom and open sheets belong to one document.
	useEffect(() => resetEditor, [resetEditor]);
	// Design and the rich text editor load once the page is idle, so opening them is instant.
	useEffect(() => {
		void whenIdle().then(() => {
			void DesignPanel.preload?.();
			preloadRichTextEditor();
		});
	}, []);
	const { checkTab } = routeApi.useSearch();
	useEffect(() => {
		if (checkTab) useEditorStore.setState({ checkTab });
	}, [checkTab]);
	useOpenVersionFromUrl(editorLayout.layout === "desktop" || editorLayout.pinned);
	useOpenAssistantFromUrl();
	useSelectionInUrl();
	useResumeWebMcpTools(routeApi.useParams().resumeId);
	useMarkDocumentOpened(routeApi.useParams().resumeId);

	return (
		<Tabs value={mode} onValueChange={(value) => setMode(value as EditorMode)} className="contents">
			<EditorFrame
				editorLayout={editorLayout}
				bar={<EditorBar layout={editorLayout.layout} pinnable={editorLayout.pinnable} />}
				mode={mode}
				panelLabel={panelLabel(mode)}
				panel={<ModePanel mode={mode} />}
				page={<Outlet />}
				assistant={<ResumeAssistant />}
				history={<History />}
				mobile={<MobileBody mode={mode} onModeChange={setMode} />}
			>
				<DownloadSheet />
				<EditorHotkeys onModeChange={setMode} />
			</EditorFrame>
		</Tabs>
	);
}

const routeApi = getRouteApi("/builder/$resumeId");

/** `?version=` opens History on that version (the page shows it read-only), then leaves the URL. */
function useOpenVersionFromUrl(panelBesidePage: boolean) {
	const { version } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();

	useEffect(() => {
		if (!version) return;
		// Beside the page, History takes the panel's place; on smaller screens it is still the sheet.
		if (panelBesidePage) useEditorStore.getState().setHistoryOpen(true);
		else useEditorStore.getState().setSheetTab("history");
		useEditorStore.setState({ historyVersionId: version });
		void navigate({
			to: ".",
			resetScroll: false,
			search: (current: ReturnType<typeof routeApi.useSearch>) => ({ ...current, version: undefined }),
			replace: true,
		});
	}, [version, navigate, panelBesidePage]);
}

/**
 * The assistant and the URL (see `useAssistantInUrl`). Text handed over in the app (the coach's Add to resume) fills the
 * composer the same way, without passing through the URL.
 */
function useOpenAssistantFromUrl() {
	const { assistant, ask } = routeApi.useSearch();
	const { resumeId } = routeApi.useParams();
	const { session } = routeApi.useRouteContext();
	const navigate = routeApi.useNavigate();

	useEffect(() => {
		const handed = takeAssistantHandoff(session.user.id, resumeId);
		if (handed) openAssistantFrom({ draft: handed });
	}, [session.user.id, resumeId]);

	const setSearch = useCallback(
		(patch: { assistant?: string | undefined; ask?: string | undefined }) =>
			void navigate({
				to: ".",
				resetScroll: false,
				search: (current: ReturnType<typeof routeApi.useSearch>) => ({ ...current, ...patch }),
				replace: true,
			}),
		[navigate],
	);
	useAssistantInUrl({ assistant, ask }, setSearch);
}

/**
 * What is selected lives in the URL (`?section=experience&entry=…`, `?section=basics`), so Back steps up through the
 * Write panel (entry, section, outline) and a link opens where it points. The store stays the one thing the panel and
 * the page read; this keeps the two in step. Stepping to a neighbouring entry replaces the URL instead of adding to it.
 */
function useSelectionInUrl() {
	const { section, entry } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
	const selection = useEditorStore((state) => state.selection);
	/** Navigations of ours still on their way: the URL they leave behind is not news. */
	const writing = useRef(0);

	// The URL changed by itself (a link, Back, Forward): the selection follows.
	useEffect(() => {
		if (writing.current > 0) return;
		const next = selectionOf({ section, entry });
		if (!isSameSelection(useEditorStore.getState().selection, next)) useEditorStore.setState({ selection: next });
	}, [section, entry]);

	// The selection changed in the app: the URL follows.
	useEffect(() => {
		// Read now, not from this render: the effect above may have just taken a selection from the URL.
		const next = searchOf(useEditorStore.getState().selection);
		if (next.section === section && next.entry === entry) return;
		const sibling = Boolean(entry && next.entry && next.section === section);
		writing.current += 1;
		void navigate({
			to: ".",
			resetScroll: false,
			search: (current: ReturnType<typeof routeApi.useSearch>) => ({ ...current, ...next }),
			replace: sibling,
		}).finally(() => {
			writing.current -= 1;
		});
		// Only the selection's own changes write the URL; the URL's changes are read above.
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- reading `section` and `entry` here must not re-run on URL changes.
	}, [selection, navigate]);
}

/** Version history in the panel's place, from the clock in the bar. Its list and actions are area D's `HistoryTab`. */
function History() {
	return (
		<HistoryPanel
			onClose={() => {
				useEditorStore.getState().setHistoryOpen(false);
				requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-history-toggle]")?.focus());
			}}
		>
			<Suspense>
				<HistoryTab />
			</Suspense>
		</HistoryPanel>
	);
}

function EditorHotkeys({ onModeChange }: { onModeChange: (mode: EditorMode) => void }) {
	useEditorHotkeys(onModeChange);
	return null;
}

const panelLabel = (mode: EditorMode) =>
	({ write: t`Content`, design: t`Design`, check: t`Check`, share: t`Share` })[mode];

type MobileBodyProps = {
	mode: EditorMode;
	onModeChange: (mode: EditorMode) => void;
};

function MobileBody({ mode, onModeChange }: MobileBodyProps) {
	const view = useEditorStore((state) => state.mobileView) ?? mode;
	const setPreviewPaused = usePreviewPausedStore((state) => state.setPaused);

	// The page stays mounted so zoom survives switching views; it does not render while hidden.
	const pageVisible = view === "page";
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
							useEditorStore.setState({ mobileView: "write" });
							onModeChange("write");
						}}
					/>
				)}
				{view !== "page" && (
					<TabsContent
						key={mode}
						value={mode}
						className="absolute inset-0 flex flex-col overflow-y-auto bg-bg [overflow-anchor:none]"
					>
						<ModePanel mode={mode} />
					</TabsContent>
				)}
			</div>

			<MobileTabBar
				tabs={[
					{ view: "write", icon: "pencil-simple", label: t`Write` },
					{ view: "design", icon: "palette", label: t`Design` },
					{ view: "check", icon: "list-checks", label: t`Check` },
					{ view: "share", icon: "globe-hemisphere-west", label: t`Share` },
					{ view: "page", icon: "file-text", label: t`Page` },
				]}
				view={view}
				onModeChange={onModeChange}
			/>
		</div>
	);
}

/** Phones: tapping a line on the page selects it and offers to edit that entry. Improve joins it in M10. */
function SelectionBar({ onEdit }: { onEdit: () => void }) {
	const selection = useEditorStore((state) => state.selection);
	const { ref } = useFloatingToolbarSpace();
	if (!selection) return null;

	return (
		<div
			ref={ref}
			className="absolute start-1/2 bottom-[76px] z-10 flex -translate-x-1/2 items-center rounded-xl bg-ink p-1 text-bg shadow-e3 transition-[opacity,translate] duration-standard ease-enter rtl:translate-x-1/2 starting:translate-y-2 starting:opacity-0"
		>
			<button
				type="button"
				className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold"
				onClick={() => {
					onEdit();
					revealSelectionInPanel(selection);
				}}
			>
				<Icon name="pencil-simple" size={20} />
				<Trans>Edit entry</Trans>
			</button>
		</div>
	);
}
