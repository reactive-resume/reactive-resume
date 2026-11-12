import type { ReactElement, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { ButtonGroup } from "@reactive-resume/ui/components/button-group";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { formatShortcut, Kbd } from "@reactive-resume/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { loadAssistantPanel } from "@/features/assistant/dock";
import { useAssistantShortcutEnabled } from "@/features/assistant/shortcut";
import { useResumeData, useResumeStore } from "@/features/resume/builder/draft";
import { BackLink, DrawerControls } from "@/features/resume/editor/chrome";
import { pendingProposals } from "@/features/resume/editor/proposals/proposals";
import { useEditorStore } from "@/features/resume/editor/store";

type EditorBarFrameProps = {
	layout: "desktop" | "tablet" | "mobile";
	/** Tablet in landscape: the panel can be pinned beside the page. */
	pinnable: boolean;
	/** The document's name and save state. */
	menu: ReactNode;
	/** The mode switch; phones switch from their tab bar instead. */
	modes: ReactNode;
	/** Undo and Redo, first in the actions. */
	history?: ReactNode;
	/**
	 * The clock opens History in the panel's place (`setHistoryOpen`) when the editor gives its frame a `history`
	 * panel. Without this, it opens the Download & history sheet on History, as before.
	 */
	historyInPanel?: boolean;
	/** Download, after History and the assistant. */
	children: ReactNode;
};

/**
 * The 56px editor bar: back, the document's name and save state · the mode switch, centred · Undo and Redo, History,
 * the assistant and Download, the one accent. Tablet actions take only their own width.
 */
export function EditorBarFrame({
	layout,
	pinnable,
	menu,
	modes,
	history,
	historyInPanel = false,
	children,
}: EditorBarFrameProps) {
	return (
		<header
			data-design="ebar"
			className={cn(
				"grid h-(--editor-bar) items-center gap-2 border-b border-line bg-bg px-3",
				layout === "desktop"
					? "grid-cols-[minmax(0,1fr)_auto_auto] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
					: layout === "tablet"
						? "grid-cols-[minmax(0,1fr)_auto_auto]"
						: "grid-cols-[minmax(0,1fr)_auto] gap-0 px-1",
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				<BackLink />
				{layout === "tablet" && <DrawerControls pinnable={pinnable} />}
				<div className="flex min-w-0 flex-col px-1">{menu}</div>
			</div>

			{layout !== "mobile" && modes}

			<div className="flex items-center justify-end gap-1">
				{history}
				{layout === "desktop" && <HistoryButton inPanel={historyInPanel} />}
				<AssistantToggle />
				<span className="ms-1 flex">{children}</span>
			</div>
		</header>
	);
}

/** The clock stands apart from Undo and Redo: it opens the versions, not a step. */
function HistoryButton({ inPanel }: { inPanel: boolean }) {
	const open = useEditorStore((state) => state.historyOpen);

	return (
		<IconButton
			icon="clock-counter-clockwise"
			label={t`Version history`}
			aria-pressed={inPanel ? open : undefined}
			data-history-toggle=""
			className="ms-2 max-xl:hidden"
			onClick={() => {
				const { setHistoryOpen, setSheetTab } = useEditorStore.getState();
				if (inPanel) setHistoryOpen(!open);
				else setSheetTab("history");
			}}
		/>
	);
}

/**
 * Opens and closes the assistant (⌘J) in the panel's place. It has its label from 1280 up and is an icon below;
 * accent-soft while open. Closing the assistant returns focus here (`data-assistant-toggle`).
 */
function AssistantToggle() {
	const shortcutEnabled = useAssistantShortcutEnabled();
	const open = useEditorStore((state) => state.assistantOpen);
	const setOpen = useEditorStore((state) => state.setAssistantOpen);
	const labelled = useBreakpoint() === "wide";
	const data = useResumeData();
	const assistantProposals = useEditorStore((state) => state.assistantProposals);
	const applications = useResumeStore((state) => state.proposalApplications);
	const proposed = data ? pendingProposals(data, assistantProposals, undefined, applications).length : 0;
	const preload = () => void loadAssistantPanel();

	if (!labelled) {
		return (
			<IconButton
				icon="sparkle"
				label={proposed ? t`Assistant · ${proposed} proposed` : t`Assistant`}
				shortcut={shortcutEnabled ? "⌘J" : ""}
				aria-pressed={open}
				data-assistant-toggle=""
				onPointerEnter={preload}
				onFocus={preload}
				onClick={() => setOpen(!open)}
			/>
		);
	}

	const button = (
		<Button
			variant="ghost"
			aria-label={t`Assistant`}
			aria-pressed={open}
			data-assistant-toggle=""
			onPointerEnter={preload}
			onFocus={preload}
			onClick={() => setOpen(!open)}
		>
			<Icon name="sparkle" />
			<Trans>Assistant</Trans>
			{proposed > 0 && (
				<span data-assistant-pending className="rounded-xs bg-accent-soft px-1.5 t-caption text-accent-text">
					<Plural value={proposed} one="# proposed" other="# proposed" />
				</span>
			)}
		</Button>
	);
	if (!shortcutEnabled) return button;

	return (
		<Tooltip>
			<TooltipTrigger render={button} />
			<TooltipContent side="bottom">
				<Trans>Assistant</Trans>
				<Kbd>{formatShortcut("⌘J")}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}

type DownloadButtonsProps = {
	busy: boolean;
	onDownload: () => void;
	/** Phones: one icon button. */
	compact: boolean;
	/** Tablets drop the label so the bar fits beside the mode switch; the button keeps its name. */
	iconOnly: boolean;
	disabled?: boolean;
	/** Starts loading the export code before the ▾ is pressed. */
	onPreload?: () => void;
	/**
	 * The ▾ segment as a menu: wrap the given button as the menu's trigger and return the menu. Without it, the ▾
	 * opens the Download & history sheet on Download.
	 */
	renderMore?: (button: ReactElement) => ReactNode;
};

/** Download PDF is the only filled button; the ▾ segment holds every other format. */
export function DownloadButtons({
	busy,
	onDownload,
	compact,
	iconOnly,
	disabled = false,
	onPreload,
	renderMore,
}: DownloadButtonsProps) {
	const setSheetTab = useEditorStore((state) => state.setSheetTab);

	if (compact) {
		return (
			<IconButton
				icon="download-simple"
				label={t`Download PDF`}
				shortcut="⌘P"
				variant="primary"
				disabled={disabled || busy}
				onClick={onDownload}
			/>
		);
	}

	const more = (
		<Button
			size="icon"
			disabled={disabled || busy}
			aria-label={t`More download formats`}
			className="group w-[34px] [--icon-size:16px]"
			onPointerEnter={onPreload}
			onFocus={onPreload}
			onClick={renderMore ? undefined : () => setSheetTab("download")}
		>
			<Icon name="caret-down" className="group-data-popup-open:rotate-180" />
		</Button>
	);

	return (
		<ButtonGroup aria-label={disabled ? t`Download, needs a connection` : t`Download`}>
			<Button
				loading={busy}
				disabled={disabled}
				size={iconOnly ? "icon" : "default"}
				aria-label={iconOnly ? t`Download PDF` : undefined}
				className={iconOnly ? undefined : "pe-3"}
				onClick={onDownload}
			>
				{!busy && <Icon name="download-simple" />}
				{iconOnly ? null : busy ? <Trans>Preparing…</Trans> : <Trans>Download PDF</Trans>}
			</Button>
			{renderMore ? renderMore(more) : more}
		</ButtonGroup>
	);
}
