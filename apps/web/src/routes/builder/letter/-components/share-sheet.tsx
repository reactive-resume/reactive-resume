import type { ExportFormat } from "@/features/resume/export/use-resume-export";
import type { DownloadFormat, DownloadState } from "@/features/resume/share/download-tab";
import type { HistorySource } from "@/features/resume/share/history-tab";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { useLetterWords } from "@/features/letters/compose";
import { createLetterFile, letterFileName } from "@/features/letters/export";
import { useLetterEditorStore } from "@/features/letters/store";
import { useEditorStore } from "@/features/resume/editor/store";
import { createExportFile, getDefaultFileName, sanitizeFileName } from "@/features/resume/export/use-resume-export";
import {
	DownloadActions,
	FileNameField,
	FormatRadioGroup,
	getExportFormats,
} from "@/features/resume/share/download-tab";
import { HistoryTimeline } from "@/features/resume/share/history-tab";
import { useClosingValue } from "@/hooks/use-closing-value";
import { getOrpcErrorMessage, getReadableErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

/**
 * Share & export for letters: Download and History. Letters have no public link, so Share opens Download.
 * 440px from the right; a full-height bottom sheet on phones.
 */
export function LetterShareSheet() {
	const tab = useEditorStore((state) => state.shareTab);
	// Closing keeps the open tab on screen until the sheet has slid away.
	const [shownTab, onOpenChangeComplete] = useClosingValue(tab);
	const setTab = useEditorStore((state) => state.setShareTab);
	const setHistoryVersion = useEditorStore((state) => state.setHistoryVersion);
	const isPhone = useBreakpoint() === "mobile";
	const history = useLetterHistory(tab === "history");

	return (
		<Sheet
			open={tab !== null}
			onOpenChange={(open) => !open && setTab(null)}
			onOpenChangeComplete={onOpenChangeComplete}
		>
			<SheetContent
				side={isPhone ? "bottom" : "right"}
				closeLabel={t`Close`}
				className={cn("gap-0", isPhone && "h-[calc(100svh-1.5rem)]")}
			>
				<SheetHeader className="px-5 pt-3.5 pb-2.5">
					<SheetTitle>
						<Trans>Share & export</Trans>
					</SheetTitle>
				</SheetHeader>

				<Tabs
					value={shownTab === "history" ? "history" : "download"}
					onValueChange={(value) => {
						// The page shows a version only while History is open.
						if (value !== "history") setHistoryVersion(null);
						setTab(value as "download" | "history");
					}}
					className="min-h-0 flex-1 gap-0"
				>
					<TabsList variant="line" aria-label={t`Share sections`} className="w-full justify-start gap-5 px-5">
						<TabsTrigger value="download">
							<Trans>Download</Trans>
						</TabsTrigger>
						<TabsTrigger value="history">
							<Trans>History</Trans>
						</TabsTrigger>
					</TabsList>
					<TabsContent value="download" className="overflow-y-auto p-5">
						<LetterDownloadTab />
					</TabsContent>
					<TabsContent value="history" className="overflow-y-auto p-5">
						<HistoryTimeline source={history} />
					</TabsContent>
				</Tabs>
			</SheetContent>
		</Sheet>
	);
}

type LetterFormat = ExportFormat | "both";

const PAUSE_BETWEEN_FILES_MS = 400;

/**
 * Download: the letter as PDF (or Word, Markdown, JSON), or, for a letter with a resume, both as two PDFs named to
 * match: First-Last-Resume.pdf and First-Last-Cover-Letter.pdf.
 */
function LetterDownloadTab() {
	const letter = useLetterEditorStore((state) => state.letter);
	const words = useLetterWords();
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	const [format, setFormat] = useState<LetterFormat>("pdf");
	const [fileName, setFileName] = useState<string | null>(null);
	const [state, setState] = useState<DownloadState>("idle");
	if (!letter) return null;

	const resumeId = letter.sourceResumeId;
	const resumeName = resumes?.find((item) => item.id === resumeId)?.name ?? t`your resume`;
	const [pdf, ...others] = getExportFormats();
	const formats: DownloadFormat<LetterFormat>[] = [
		...(pdf ? [pdf] : []),
		...(resumeId
			? [
					{
						id: "both" as const,
						label: t`Resume + letter`,
						extension: t`2 files`,
						icon: "picture_as_pdf" as const,
						description: t`This letter and “${resumeName}” as two PDFs, named to match.`,
					},
				]
			: []),
		...others.map((option) =>
			option.id === "json"
				? { ...option, description: t`A backup of this letter. Imports back into Reactive Resume as a letter.` }
				: option,
		),
	];
	const selected = formats.find((option) => option.id === format) ?? (formats[0] as DownloadFormat<LetterFormat>);
	const name = fileName ?? letterFileName(letter, words);

	const download = async (as: LetterFormat) => {
		const bothId = as === "both" ? resumeId : null;
		const extension = formats.find((option) => option.id === as)?.extension ?? ".pdf";
		const file = `${sanitizeFileName(name) || letterFileName(letter, words)}${extension}`;
		setState("busy");
		try {
			if (bothId) {
				const resume = await client.resume.getById({ id: bothId });
				downloadWithAnchor(await createExportFile(resume, "pdf"), `${getDefaultFileName(resume)}.pdf`);
				// Two downloads in a row are more reliable a moment apart.
				await new Promise((resolve) => window.setTimeout(resolve, PAUSE_BETWEEN_FILES_MS));
				downloadWithAnchor(await createLetterFile(letter, words, "pdf"), `${letterFileName(letter, words)}.pdf`);
				toast.add({ description: t`Downloaded your resume and this letter` });
			} else if (as !== "both") {
				downloadWithAnchor(await createLetterFile(letter, words, as), file);
				toast.add({ description: t`Downloaded ${file}` });
			}
			setState("done");
		} catch (error) {
			setState("error");
			toast.add({ type: "error", description: getReadableErrorMessage(error, t`Download failed.`) });
		}
	};

	return (
		<div className="grid gap-4">
			<FormatRadioGroup
				formats={formats}
				value={selected.id}
				onChange={(value) => {
					setFormat(value);
					setState("idle");
				}}
			/>

			{selected.id !== "both" && (
				<FileNameField
					value={name}
					extension={selected.extension}
					hint={<Trans>Recruiters see this name. Your name plus “Cover Letter” works well.</Trans>}
					onChange={setFileName}
				/>
			)}

			<DownloadActions
				state={state}
				label={selected.label}
				onDownload={() => void download(selected.id)}
				onDownloadPdf={selected.id === "pdf" ? undefined : () => void download("pdf")}
			/>
		</div>
	);
}

/** History for the letter: sessions, named and sent versions, and restore points. */
function useLetterHistory(open: boolean): HistorySource {
	const queryClient = useQueryClient();
	const letter = useLetterEditorStore((state) => state.letter);
	const locked = useLetterEditorStore((state) => state.letter?.isLocked ?? false);
	const id = letter?.id ?? "";
	const { data: versions, isPending: loading } = useQuery({
		...orpc.coverLetters.listVersions.queryOptions({ input: { id } }),
		enabled: Boolean(id) && open,
	});
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: orpc.coverLetters.listVersions.queryKey({ input: { id } }) });

	return {
		versions,
		loading,
		locked,
		nowDetail: t`The letter as it is`,
		errorMessage: (error) => getOrpcErrorMessage(error, { fallback: t`Something went wrong. Try again.` }),
		save: async (name) => {
			if (!(await useLetterEditorStore.getState().flush()))
				throw new Error(t`Couldn't save your changes. Try again before continuing.`);
			await client.coverLetters.createVersion({ id, name });
			void refresh();
		},
		restore: async (versionId) => {
			await useLetterEditorStore.getState().change(() => client.coverLetters.restoreVersion({ id, versionId }));
			void refresh();
		},
		rename: async (versionId, name) => {
			await client.coverLetters.renameVersion({ id, versionId, name });
			void refresh();
		},
		remove: async (versionId) => {
			await client.coverLetters.deleteVersion({ id, versionId });
			void refresh();
		},
	};
}
