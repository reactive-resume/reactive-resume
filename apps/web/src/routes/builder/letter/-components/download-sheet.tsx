import type { ExportFormat } from "@/features/resume/export/use-resume-export";
import type { DownloadFormat, DownloadState } from "@/features/resume/share/download-tab";
import type { HistorySource } from "@/features/resume/share/history-tab";
import type { ReactElement } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { createLetterFile, letterFileName } from "@/features/letters/export";
import { useLetterEditorStore } from "@/features/letters/store";
import { DownloadSheetFrame } from "@/features/resume/editor/chrome/download-sheet";
import { useEditorStore } from "@/features/resume/editor/store";
import { createExportFile, getDefaultFileName, sanitizeFileName } from "@/features/resume/export/use-resume-export";
import { DownloadMenu } from "@/features/resume/share/download-menu";
import {
	DownloadActions,
	FileNameField,
	FormatRadioGroup,
	getExportFormats,
} from "@/features/resume/share/download-tab";
import { HistoryPanel, HistoryTimeline } from "@/features/resume/share/history-tab";
import { getOrpcErrorMessage, getReadableErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

/** Download & history for letters. Letters have no public link, so Export opens Download. */
export function LetterDownloadSheet() {
	const history = useLetterHistory(useEditorStore((state) => state.sheetTab) === "history");

	return (
		<DownloadSheetFrame
			fallback="download"
			tabs={[
				{ value: "download", label: <Trans>Download</Trans>, content: <LetterDownloadTab /> },
				{ value: "history", label: <Trans>History</Trans>, content: <HistoryTimeline source={history} /> },
			]}
		/>
	);
}

type LetterFormat = ExportFormat | "both";

const PAUSE_BETWEEN_FILES_MS = 400;

type Letter = NonNullable<ReturnType<typeof useLetterEditorStore.getState>["letter"]>;

/** The letter's formats: the resume's list, with "Resume + letter" when a resume is linked (L6). */
function useLetterFormats(letter: Letter | null): DownloadFormat<LetterFormat>[] {
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	const resumeId = letter?.sourceResumeId;
	const resumeName = resumes?.find((item) => item.id === resumeId)?.name ?? t`your resume`;
	const [pdf, ...others] = getExportFormats();
	return [
		...(pdf ? [pdf] : []),
		...(resumeId
			? [
					{
						id: "both" as const,
						label: t`Resume + letter`,
						extension: t`2 files`,
						icon: "files" as const,
						description: t`This letter and “${resumeName}” as two PDFs, named to match.`,
					},
				]
			: []),
		...others.map((option) =>
			option.id === "json"
				? { ...option, description: t`A backup of this letter. Imports back into Reactive Resume as a letter.` }
				: option.id === "md"
					? // A letter has no headings.
						{ ...option, description: t`Plain text. Paste into application forms and emails.` }
					: option,
		),
	];
}

/** Makes and saves the file; "both" saves the resume's PDF and the letter's, named to match. Returns what it saved. */
async function downloadLetter(letter: Letter, as: LetterFormat, formats: DownloadFormat<LetterFormat>[], name: string) {
	if (as === "both" && letter.sourceResumeId) {
		const resume = await client.resume.getById({ id: letter.sourceResumeId });
		downloadWithAnchor(await createExportFile(resume, "pdf"), `${getDefaultFileName(resume)}.pdf`);
		// Two downloads in a row are more reliable a moment apart.
		await new Promise((resolve) => window.setTimeout(resolve, PAUSE_BETWEEN_FILES_MS));
		downloadWithAnchor(await createLetterFile(letter, "pdf"), `${letterFileName(letter)}.pdf`);
		return t`your resume and this letter`;
	}
	const extension = formats.find((option) => option.id === as)?.extension ?? ".pdf";
	const file = `${sanitizeFileName(name) || letterFileName(letter)}${extension}`;
	downloadWithAnchor(await createLetterFile(letter, as === "both" ? "pdf" : as), file);
	return file;
}

/** L6 tile 13: the ▾ beside Download PDF on a letter. */
export function LetterDownloadMenu({ trigger }: { trigger: ReactElement }) {
	const letter = useLetterEditorStore((state) => state.letter);
	const formats = useLetterFormats(letter);
	if (!letter) return trigger;

	return (
		<DownloadMenu
			trigger={trigger}
			formats={formats}
			defaultFileName={letterFileName(letter)}
			download={(as, name) => downloadLetter(letter, as, formats, name)}
		/>
	);
}

/** B15 for letters: History in the panel's place, from the clock in the bar. */
export function LetterHistoryPanel() {
	const history = useLetterHistory(true);
	return (
		<HistoryPanel
			onClose={() => {
				useEditorStore.getState().setHistoryOpen(false);
				requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-history-toggle]")?.focus());
			}}
		>
			<HistoryTimeline source={{ ...history, nameLabel: t`Name the letter as it is now` }} />
		</HistoryPanel>
	);
}

/**
 * Download (phones and tablets, from the sheet): the letter as PDF (or Word, OpenDocument, Markdown, JSON), or, for a
 * letter with a resume, both as two PDFs named to match: First-Last-Resume.pdf and First-Last-Cover-Letter.pdf.
 */
function LetterDownloadTab() {
	const letter = useLetterEditorStore((state) => state.letter);
	const formats = useLetterFormats(letter);
	const [format, setFormat] = useState<LetterFormat>("pdf");
	const [fileName, setFileName] = useState<string | null>(null);
	const [state, setState] = useState<DownloadState>("idle");
	if (!letter) return null;

	const selected = formats.find((option) => option.id === format) ?? (formats[0] as DownloadFormat<LetterFormat>);
	const name = fileName ?? letterFileName(letter);

	const download = async (as: LetterFormat) => {
		setState("busy");
		try {
			const file = await downloadLetter(letter, as, formats, name);
			toast.add({ description: t`Downloaded ${file}` });
			setState("done");
		} catch (error) {
			setState("error");
			toast.add({ type: "error", description: getReadableErrorMessage(error, t`Download failed. Try again.`) });
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
		errorMessage: (error) =>
			getOrpcErrorMessage(error, { fallback: t`Couldn't update this letter's versions. Try again.` }),
		save: async (name) => {
			if (!(await useLetterEditorStore.getState().flush()))
				throw new Error(t`Couldn't save your changes. Try again before continuing.`);
			await client.coverLetters.createVersion({ id, name });
			void refresh();
		},
		restore: async (versionId) => {
			await useLetterEditorStore
				.getState()
				.change(() => client.coverLetters.restoreVersion({ id, versionId, proposalSafety: "v1" }));
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
