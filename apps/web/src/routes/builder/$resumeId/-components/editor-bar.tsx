import type { EditorMode } from "@/features/resume/editor/store";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { DocumentMenu } from "./document-menu";
import { useCurrentBuilderResumeSelector, useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
import { useOpenIssueCount } from "@/features/resume/editor/check/use-check";
import { DownloadButtons, EditorBarFrame } from "@/features/resume/editor/chrome/bar";
import { preloadDocumentExport, useResumeExport } from "@/features/resume/export/use-resume-export";

type EditorBarProps = {
	layout: "desktop" | "tablet" | "mobile";
	/** Tablet in landscape: the panel can be pinned beside the page. */
	pinnable: boolean;
};

/**
 * The 56px editor bar. Desktop: back, name and save state · Write/Design/Check/Share · history, assistant and
 * Download PDF. The mode switch stays centered through a `1fr auto 1fr` grid.
 */
export function EditorBar({ layout, pinnable }: EditorBarProps) {
	// Download needs a connection.
	const offline = useResumeStore((state) => state.saveStatus === "offline");
	const resume = useCurrentResume();
	const { onDownloadPDF, isExporting } = useResumeExport(resume);

	return (
		<EditorBarFrame layout={layout} pinnable={pinnable} menu={<DocumentMenu />} modes={<ModeTabs />}>
			<DownloadButtons
				busy={isExporting}
				onDownload={() => void onDownloadPDF()}
				onPreload={preloadDocumentExport}
				compact={layout === "mobile"}
				iconOnly={layout === "tablet"}
				disabled={offline}
			/>
		</EditorBarFrame>
	);
}

const MODE_ICONS = {
	write: "pencil-simple",
	design: "palette",
	check: "list-checks",
	share: "globe-hemisphere-west",
} as const;

function ModeTabs() {
	const issueCount = useOpenIssueCount();
	const isPublic = useCurrentBuilderResumeSelector((resume) => resume.isPublic ?? false);
	const labels: Record<EditorMode, string> = { write: t`Write`, design: t`Design`, check: t`Check`, share: t`Share` };

	return (
		<TabsList aria-label={t`Editor mode`} className="h-9" data-mode-switch="">
			{(Object.keys(MODE_ICONS) as EditorMode[]).map((mode) => (
				<TabsTrigger key={mode} value={mode} className="px-4">
					<Icon name={MODE_ICONS[mode]} size={18} />
					{labels[mode]}
					{mode === "check" && <CheckBadge count={issueCount} />}
					{mode === "share" && isPublic && (
						<span className="size-1.5 rounded-full bg-accent" aria-hidden="true" title={t`Public`} />
					)}
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
		<span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-warn-soft px-[5px] text-[11px] font-semibold text-warn-text">
			<span aria-hidden="true">{count}</span>
			<span className="sr-only">
				<Plural value={count} one="# open issue" other="# open issues" />
			</span>
		</span>
	);
}
