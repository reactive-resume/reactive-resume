import type { EditorMode } from "@/features/resume/editor/store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { ButtonGroup } from "@reactive-resume/ui/components/button-group";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { DocumentMenu } from "./document-menu";
import { AssistantButton } from "@/features/assistant/assistant-button";
import { useCurrentBuilderResumeSelector, useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
import { useOpenIssueCount } from "@/features/resume/editor/check/use-check";
import { BackLink, DrawerControls } from "@/features/resume/editor/chrome";
import { useEditorStore } from "@/features/resume/editor/store";
import { useResumeExport } from "@/features/resume/export/use-resume-export";

type EditorBarProps = {
	layout: "desktop" | "tablet" | "mobile";
	/** Tablet in landscape: the panel can be pinned beside the page. */
	pinnable: boolean;
};

/**
 * The 56px editor bar. Desktop: back, name and save state · Write/Design/Check · history, assistant,
 * Share and Download PDF. The mode switch stays centered through a `1fr auto 1fr` grid.
 */
export function EditorBar({ layout, pinnable }: EditorBarProps) {
	// Download and Share need a connection.
	const offline = useResumeStore((state) => state.saveStatus === "offline");
	const wide = useBreakpoint() === "wide";

	return (
		<header className="grid h-(--editor-bar) grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-surface px-3">
			<div className="flex min-w-0 items-center gap-1.5">
				<BackLink />
				{layout === "tablet" && <DrawerControls pinnable={pinnable} />}
				<div className="flex min-w-0 flex-col items-start">
					<DocumentMenu />
				</div>
			</div>

			{layout === "mobile" ? <span /> : <ModeTabs />}

			<div className="flex items-center justify-end gap-1">
				{layout === "desktop" && <HistoryButton />}
				{/* Every layout opens the assistant from the ✦: a column, a drawer, or full screen on phones. */}
				<span className={layout === "desktop" ? "me-1.5" : undefined}>
					<AssistantButton />
				</span>
				{/* Below 1280 the bar is too narrow for Share's label next to everything else. */}
				<ShareButton compact={layout !== "desktop" || !wide} disabled={offline} />
				<DownloadButtons compact={layout === "mobile"} iconOnly={layout === "tablet"} disabled={offline} />
			</div>
		</header>
	);
}

const MODE_ICONS = { write: "edit", design: "palette", check: "fact_check" } as const;

function ModeTabs() {
	const issueCount = useOpenIssueCount();
	const labels: Record<EditorMode, string> = { write: t`Write`, design: t`Design`, check: t`Check` };

	return (
		<TabsList aria-label={t`Editor mode`} className="h-9" data-mode-switch="">
			{(Object.keys(MODE_ICONS) as EditorMode[]).map((mode) => (
				<TabsTrigger key={mode} value={mode} className="px-4">
					<Icon name={MODE_ICONS[mode]} size={18} />
					{labels[mode]}
					{mode === "check" && <CheckBadge count={issueCount} />}
				</TabsTrigger>
			))}
		</TabsList>
	);
}

function CheckBadge({ count }: { count: number }) {
	if (count === 0) {
		return (
			<span className="inline-flex text-accent-text">
				<Icon name="check" size={16} />
				<span className="sr-only">
					<Trans>No open issues</Trans>
				</span>
			</span>
		);
	}

	return (
		<span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warn-soft px-[5px] text-[11px] font-semibold text-warn-text">
			{count}
			<span className="sr-only">
				<Trans>open issues</Trans>
			</span>
		</span>
	);
}

/** History lives in the Share & export sheet; the clock opens it there. */
function HistoryButton() {
	const setShareTab = useEditorStore((state) => state.setShareTab);

	return <IconButton icon="history" label={t`History`} className="text-ink-2" onClick={() => setShareTab("history")} />;
}

type ToolbarActionProps = {
	compact: boolean;
	disabled: boolean;
};

function ShareButton({ compact, disabled }: ToolbarActionProps) {
	const isPublic = useCurrentBuilderResumeSelector((resume) => resume.isPublic ?? false);
	const setShareTab = useEditorStore((state) => state.setShareTab);
	if (compact && !isPublic) {
		return (
			<IconButton
				icon="ios_share"
				label={t`Share`}
				shortcut="⌘⇧S"
				className="me-2"
				disabled={disabled}
				onClick={() => setShareTab("link")}
			/>
		);
	}

	return (
		<Button
			variant="secondary"
			className={compact ? "me-2 px-2" : "me-2"}
			aria-label={isPublic ? t`Share public resume` : t`Share`}
			disabled={disabled}
			onClick={() => setShareTab("link")}
		>
			{!compact && (
				<>
					<Icon name="ios_share" />
					<Trans>Share</Trans>
				</>
			)}
			{isPublic && (
				<Badge variant="accent">
					<Icon name="public" />
					<Trans>Public</Trans>
				</Badge>
			)}
		</Button>
	);
}

/** Download PDF is the only filled button; the ▾ segment opens the Download tab with every format. */
function DownloadButtons({ compact, iconOnly, disabled }: ToolbarActionProps & { iconOnly?: boolean }) {
	const resume = useCurrentResume();
	const { onDownloadPDF, isExporting } = useResumeExport(resume);
	const setShareTab = useEditorStore((state) => state.setShareTab);

	if (compact) {
		return (
			<IconButton
				icon="download"
				label={t`Download PDF`}
				shortcut="⌘P"
				disabled={disabled || isExporting}
				onClick={() => void onDownloadPDF()}
			/>
		);
	}

	return (
		<ButtonGroup aria-label={t`Download`}>
			{/* Tablets drop the label so the bar fits beside the mode switch; the button keeps its name. */}
			<Button
				loading={isExporting}
				disabled={disabled}
				size={iconOnly ? "icon" : "default"}
				aria-label={iconOnly ? t`Download PDF` : undefined}
				className="gap-1.5"
				onClick={() => void onDownloadPDF()}
			>
				{!isExporting && <Icon name="download" />}
				{iconOnly ? null : isExporting ? <Trans>Preparing…</Trans> : <Trans>Download PDF</Trans>}
			</Button>
			<Button
				size="icon"
				disabled={disabled || isExporting}
				aria-label={t`More download formats`}
				className="w-8 border-s border-s-[oklch(1_0_0/0.25)]"
				onClick={() => setShareTab("download")}
			>
				<Icon name="expand_more" />
			</Button>
		</ButtonGroup>
	);
}
