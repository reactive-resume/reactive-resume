import type { LetterMode } from "@/features/letters/use-letter-mode";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tabs, TabsContent } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { LetterDesignPanel } from "./design-panel";
import { LetterBar, useDownloadLetter } from "./letter-bar";
import { LetterPage } from "./letter-page";
import { LetterShareSheet } from "./share-sheet";
import { LetterWritePanel } from "./write-panel";
import { MobileTabIndicator } from "@/components/layout/mobile-tab-indicator";
import {
	AssistantColumn,
	AssistantOverlay,
	AssistantReplace,
	assistantGridTransition,
	assistantPlaceFor,
	columnsWithAssistant,
	LetterAssistant,
} from "@/features/assistant/dock";
import { useLetterEditorStore } from "@/features/letters/store";
import {
	useLetterMode,
	useOpenLetterAssistantFromUrl,
	useOpenLetterVersionFromUrl,
} from "@/features/letters/use-letter-mode";
import { usePreviewPausedStore } from "@/features/resume/builder/draft";
import { useIsLandscape } from "@/features/resume/editor/chrome";
import { useEditorStore } from "@/features/resume/editor/store";
import { switchModeInstantly } from "@/libs/motion";

/**
 * The letter editor: the resume editor's shell with Write and Design (no Check). The panel holds who the letter is
 * for, to and from, and its body; the page shows the letter as it prints.
 */
export function LetterShell() {
	const [mode, setMode] = useLetterMode();
	const breakpoint = useBreakpoint();
	const layout = breakpoint === "mobile" ? "mobile" : breakpoint === "tablet" ? "tablet" : "desktop";
	const landscape = useIsLandscape();
	const pinnable = layout === "tablet" && landscape;
	const pinned = useEditorStore((state) => state.drawerPinned) && pinnable;
	const resetEditor = useEditorStore((state) => state.reset);
	const assistantOpen = useEditorStore((state) => state.assistantOpen);
	const assistantInstant = useEditorStore((state) => state.assistantInstant);
	const assistantPlace = assistantPlaceFor(breakpoint);
	const assistantColumn = assistantPlace === "column" && !pinned;
	const assistantReplaces = assistantPlace === "replace" && assistantOpen;

	// Zoom, open sheets and the History version belong to one document.
	useEffect(() => resetEditor, [resetEditor]);
	useOpenLetterVersionFromUrl();
	useOpenLetterAssistantFromUrl();
	useLinkedUpdateNotice();
	useUnsavedGuard();

	return (
		<Tabs value={mode} onValueChange={(value) => setMode(value as LetterMode)} className="contents">
			<div className="grid h-svh grid-rows-[var(--editor-bar)_minmax(0,1fr)] overflow-hidden bg-bg">
				<a
					href="#main-content"
					className="sr-only rounded-md bg-raised px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-[100]"
				>
					<Trans>Skip to the page</Trans>
				</a>

				<LetterBar layout={layout} pinnable={pinnable} />

				{(layout === "desktop" || pinned) && (
					<div
						className={cn("relative grid min-h-0", assistantGridTransition(assistantOpen, assistantInstant))}
						style={{
							gridTemplateColumns: assistantColumn
								? columnsWithAssistant(assistantOpen)
								: pinned
									? "380px minmax(0,1fr)"
									: "var(--editor-panel) minmax(0,1fr)",
						}}
					>
						<AssistantReplace
							replaced={assistantReplaces}
							assistant={
								<div className="min-h-0 border-e border-line">
									<LetterAssistant />
								</div>
							}
						>
							<TabsContent
								key={mode}
								value={mode}
								aria-label={panelLabel(mode)}
								className="relative min-h-0 overflow-y-auto border-e border-line bg-surface [overflow-anchor:none]"
							>
								<ModePanel mode={mode} />
							</TabsContent>
						</AssistantReplace>
						<main id="main-content" className="min-h-0 min-w-0">
							<LetterPage />
						</main>
						{assistantColumn && (
							<AssistantColumn>
								<LetterAssistant />
							</AssistantColumn>
						)}
					</div>
				)}
				{layout === "tablet" && !pinned && <TabletBody mode={mode} />}
				{layout === "mobile" && <MobileBody mode={mode} onModeChange={setMode} />}

				{(assistantPlace === "drawer" || assistantPlace === "screen") && (
					<AssistantOverlay place={assistantPlace}>
						<LetterAssistant />
					</AssistantOverlay>
				)}

				<LetterShareSheet />
				<LetterHotkeys onModeChange={setMode} />
			</div>
		</Tabs>
	);
}

const panelLabel = (mode: LetterMode) => (mode === "design" ? t`Design` : t`Letter details`);

function ModePanel({ mode }: { mode: LetterMode }) {
	return mode === "design" ? <LetterDesignPanel /> : <LetterWritePanel />;
}

function TabletBody({ mode }: { mode: LetterMode }) {
	const drawerOpen = useEditorStore((state) => state.drawerOpen);

	return (
		<div className="relative min-h-0">
			<main id="main-content" className="h-full min-w-0">
				<LetterPage />
			</main>
			<TabsContent
				key={mode}
				value={mode}
				aria-label={panelLabel(mode)}
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

type MobileView = "write" | "page" | "design";

const MOBILE_TABS: { view: MobileView; icon: IconName }[] = [
	{ view: "write", icon: "edit" },
	{ view: "page", icon: "description" },
	{ view: "design", icon: "palette" },
];

type MobileBodyProps = { mode: LetterMode; onModeChange: (mode: LetterMode) => void };

/** Phones: one view at a time, Write · Page · Design. The page stays mounted so zoom survives switching. */
function MobileBody({ mode, onModeChange }: MobileBodyProps) {
	const stored = useEditorStore((state) => state.mobileView);
	const view: MobileView = stored === "page" || stored === "design" || stored === "write" ? stored : mode;
	const setView = useEditorStore((state) => state.setMobileView);
	const setPreviewPaused = usePreviewPausedStore((state) => state.setPaused);
	const labels: Record<MobileView, string> = { write: t`Write`, page: t`Page`, design: t`Design` };

	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect -- a shared store the preview renderer reads, reset on unmount
		setPreviewPaused(view !== "page");
		return () => setPreviewPaused(false);
	}, [view, setPreviewPaused]);

	return (
		<div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
			<div className="relative min-h-0">
				<main id="main-content" className={cn("h-full", view !== "page" && "invisible")}>
					<LetterPage />
				</main>
				{view !== "page" && (
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

/** 1 and 2 switch modes outside fields, ⌘P downloads the PDF, ⌘⇧E opens Download. Saving is automatic. */
function LetterHotkeys({ onModeChange }: { onModeChange: (mode: LetterMode) => void }) {
	const download = useDownloadLetter();
	const setShareTab = useEditorStore((state) => state.setShareTab);

	useHotkey("1", () => switchModeInstantly(() => onModeChange("write")));
	useHotkey("2", () => switchModeInstantly(() => onModeChange("design")));
	useHotkey("Mod+P", () => void download.run());
	useHotkey("Mod+Shift+E", () => setShareTab("download"));
	useHotkey("Mod+J", () => useEditorStore.getState().setAssistantOpen(!useEditorStore.getState().assistantOpen, true));
	useHotkey("Mod+S", () => {
		void useLetterEditorStore.getState().flush();
		toast.add({ type: "info", description: t`Your changes are saved automatically.`, id: "auto-save" });
	});

	return null;
}

/** Closing the tab with edits still on their way asks first. */
function useUnsavedGuard() {
	useEffect(() => {
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			const { status, pending } = useLetterEditorStore.getState();
			if (status === "saved" && Object.keys(pending).length === 0) return;
			void useLetterEditorStore.getState().flush();
			event.preventDefault();
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, []);
}

const SENDER_FIELDS = ["name", "headline", "email", "phone", "location"] as const;
type SenderField = (typeof SENDER_FIELDS)[number];
type SenderSnapshot = Partial<Record<SenderField, string>>;

const snapshotOf = (letter: CoverLetter): SenderSnapshot =>
	Object.fromEntries(SENDER_FIELDS.map((field) => [field, letter.style.basics[field]]));

const readSnapshot = (key: string): SenderSnapshot | null => {
	try {
		return JSON.parse(window.localStorage.getItem(key) ?? "null") as SenderSnapshot | null;
	} catch {
		return null;
	}
};

const changedMessage = (field: SenderField) =>
	({
		name: t`Your name changed on the resume. The letter updated too.`,
		headline: t`Your headline changed on the resume. The letter updated too.`,
		email: t`Your email address changed on the resume. The letter updated too.`,
		phone: t`Your phone number changed on the resume. The letter updated too.`,
		location: t`Your location changed on the resume. The letter updated too.`,
	})[field];

/**
 * C2: a linked letter says so, once, when details it takes from the resume changed since this device last showed
 * it. The live link means there's nothing to refresh.
 */
function useLinkedUpdateNotice() {
	const letterId = useLetterEditorStore((state) => state.letter?.id);
	const basics = useLetterEditorStore((state) => state.letter?.style.basics);

	useEffect(() => {
		const letter = useLetterEditorStore.getState().letter;
		if (!letterId || !letter?.senderLinked) return;
		const before = readSnapshot(`letter-sender:${letter.id}`);
		if (!before) return;
		const now = snapshotOf(letter);
		const changed = SENDER_FIELDS.filter((field) => before[field] !== undefined && before[field] !== now[field]);
		const [only] = changed;
		if (!only) return;
		toast.add({
			description:
				changed.length === 1 ? changedMessage(only) : t`Your details changed on the resume. The letter updated too.`,
		});
	}, [letterId]);

	// What this device has shown, for the next visit.
	useEffect(() => {
		const letter = useLetterEditorStore.getState().letter;
		if (!letter || !basics) return;
		try {
			window.localStorage.setItem(`letter-sender:${letter.id}`, JSON.stringify(snapshotOf(letter)));
		} catch {
			// Storage can be unavailable; the notice is a nicety.
		}
	}, [basics]);
}
