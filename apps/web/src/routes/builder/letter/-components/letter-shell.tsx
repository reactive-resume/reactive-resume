import type { LetterMode } from "@/features/letters/use-letter-mode";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import { t } from "@lingui/core/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect } from "react";
import { Tabs, TabsContent } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { LetterDesignPanel } from "./design-panel";
import { LetterDownloadSheet } from "./download-sheet";
import { LetterBar, useDownloadLetter } from "./letter-bar";
import { LetterPage } from "./letter-page";
import { LetterWritePanel } from "./write-panel";
import { LetterAssistant } from "@/features/assistant/dock";
import { useLetterEditorStore } from "@/features/letters/store";
import {
	useLetterMode,
	useOpenLetterAssistantFromUrl,
	useOpenLetterVersionFromUrl,
} from "@/features/letters/use-letter-mode";
import { useLetterWebMcpTools } from "@/features/letters/webmcp";
import { usePreviewPausedStore } from "@/features/resume/builder/draft";
import { EditorFrame, MobileTabBar, useEditorLayout } from "@/features/resume/editor/chrome/shell";
import { useEditorStore } from "@/features/resume/editor/store";
import { switchModeInstantly } from "@/libs/motion";

const routeApi = getRouteApi("/builder/letter/$coverLetterId");

/**
 * The letter editor: the resume editor's shell with Write and Design (no Check). The panel holds who the letter is
 * for, to and from, and its body; the page shows the letter as it prints.
 */
export function LetterShell() {
	const [mode, setMode] = useLetterMode();
	const editorLayout = useEditorLayout();
	const resetEditor = useEditorStore((state) => state.reset);

	// Zoom, open sheets and the History version belong to one document.
	useEffect(() => resetEditor, [resetEditor]);
	useOpenLetterVersionFromUrl();
	useOpenLetterAssistantFromUrl();
	useLinkedUpdateNotice();
	useUnsavedGuard();
	useLetterWebMcpTools(routeApi.useParams().coverLetterId);

	return (
		<Tabs value={mode} onValueChange={(value) => setMode(value as LetterMode)} className="contents">
			<EditorFrame
				editorLayout={editorLayout}
				bar={<LetterBar layout={editorLayout.layout} pinnable={editorLayout.pinnable} />}
				mode={mode}
				panelLabel={mode === "design" ? t`Design` : t`Letter details`}
				panel={<ModePanel mode={mode} />}
				page={<LetterPage />}
				assistant={<LetterAssistant />}
				mobile={<MobileBody mode={mode} onModeChange={setMode} />}
			>
				<LetterDownloadSheet />
				<LetterHotkeys onModeChange={setMode} />
			</EditorFrame>
		</Tabs>
	);
}

function ModePanel({ mode }: { mode: LetterMode }) {
	return mode === "design" ? <LetterDesignPanel /> : <LetterWritePanel />;
}

type MobileView = "write" | "page" | "design";

type MobileBodyProps = { mode: LetterMode; onModeChange: (mode: LetterMode) => void };

/** Phones: one view at a time, Write · Page · Design. The page stays mounted so zoom survives switching. */
function MobileBody({ mode, onModeChange }: MobileBodyProps) {
	const stored = useEditorStore((state) => state.mobileView);
	const view: MobileView = stored === "page" || stored === "design" || stored === "write" ? stored : mode;
	const setPreviewPaused = usePreviewPausedStore((state) => state.setPaused);

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

			<MobileTabBar
				tabs={[
					{ view: "write", icon: "pencil-simple", label: t`Write` },
					{ view: "page", icon: "file-text", label: t`Page` },
					{ view: "design", icon: "palette", label: t`Design` },
				]}
				view={view}
				onModeChange={onModeChange}
			/>
		</div>
	);
}

/** 1 and 2 switch modes outside fields, ⌘P downloads the PDF, ⌘⇧E opens Download. Saving is automatic. */
function LetterHotkeys({ onModeChange }: { onModeChange: (mode: LetterMode) => void }) {
	const download = useDownloadLetter();
	const setSheetTab = useEditorStore((state) => state.setSheetTab);

	useHotkey("1", () => switchModeInstantly(() => onModeChange("write")));
	useHotkey("2", () => switchModeInstantly(() => onModeChange("design")));
	useHotkey("Mod+P", () => void download.run());
	useHotkey("Mod+Shift+E", () => setSheetTab("download"));
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
			const { status, pending, draft } = useLetterEditorStore.getState();
			// An unkept draft is work the user paid for; reloading without a warning would lose it silently.
			const unkept = draft.phase === "streaming" || draft.phase === "ready";
			if (!unkept && status === "saved" && Object.keys(pending).length === 0) return;
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
