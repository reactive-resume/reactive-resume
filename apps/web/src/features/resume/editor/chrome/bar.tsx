import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { ButtonGroup } from "@reactive-resume/ui/components/button-group";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { AssistantButton } from "@/features/assistant/assistant-button";
import { BackLink, DrawerControls } from "@/features/resume/editor/chrome";
import { useEditorStore } from "@/features/resume/editor/store";

type EditorBarFrameProps = {
	layout: "desktop" | "tablet" | "mobile";
	/** Tablet in landscape: the panel can be pinned beside the page. */
	pinnable: boolean;
	/** The document's name and save state. */
	menu: ReactNode;
	/** The mode switch; phones switch from their tab bar instead. */
	modes: ReactNode;
	/** Share and Download, after History and the assistant. */
	children: ReactNode;
};

/**
 * The 56px editor bar: back, the document's name and save state · the mode switch · History, the assistant, Share and
 * Download. The mode switch stays centered through a `1fr auto 1fr` grid.
 */
export function EditorBarFrame({ layout, pinnable, menu, modes, children }: EditorBarFrameProps) {
	const setShareTab = useEditorStore((state) => state.setShareTab);

	return (
		<header className="grid h-(--editor-bar) grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-surface px-3">
			<div className="flex min-w-0 items-center gap-1.5">
				<BackLink />
				{layout === "tablet" && <DrawerControls pinnable={pinnable} />}
				<div className="flex min-w-0 flex-col items-start">{menu}</div>
			</div>

			{layout === "mobile" ? <span /> : modes}

			<div className="flex items-center justify-end gap-1">
				{/* History lives in the Share & export sheet; the clock opens it there. */}
				{layout === "desktop" && (
					<IconButton
						icon="clock-counter-clockwise"
						label={t`History`}
						className="text-ink-2"
						onClick={() => setShareTab("history")}
					/>
				)}
				{/* Every layout opens the assistant from the ✦: a column, a drawer, or full screen on phones. */}
				<span className={layout === "desktop" ? "me-1.5" : undefined}>
					<AssistantButton />
				</span>
				{children}
			</div>
		</header>
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
};

/** Download PDF is the only filled button; the ▾ segment opens the Download tab with every format. */
export function DownloadButtons({
	busy,
	onDownload,
	compact,
	iconOnly,
	disabled = false,
	onPreload,
}: DownloadButtonsProps) {
	const setShareTab = useEditorStore((state) => state.setShareTab);

	if (compact) {
		return (
			<IconButton
				icon="download-simple"
				label={t`Download PDF`}
				shortcut="⌘P"
				disabled={disabled || busy}
				onClick={onDownload}
			/>
		);
	}

	return (
		<ButtonGroup aria-label={t`Download`}>
			<Button
				loading={busy}
				disabled={disabled}
				size={iconOnly ? "icon" : "default"}
				aria-label={iconOnly ? t`Download PDF` : undefined}
				className="gap-1.5"
				onClick={onDownload}
			>
				{!busy && <Icon name="download-simple" />}
				{iconOnly ? null : busy ? <Trans>Preparing…</Trans> : <Trans>Download PDF</Trans>}
			</Button>
			<Button
				size="icon"
				disabled={disabled || busy}
				aria-label={t`More download formats`}
				className="w-8 border-s border-s-[oklch(1_0_0/0.25)]"
				onPointerEnter={onPreload}
				onFocus={onPreload}
				onClick={() => setShareTab("download")}
			>
				<Icon name="caret-down" />
			</Button>
		</ButtonGroup>
	);
}
