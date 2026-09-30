import type { Resume } from "@/features/resume/builder/draft";
import type { ExportFormat } from "@/features/resume/export/use-resume-export";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useLetterWords } from "@/features/letters/compose";
import { createLetterFile, letterFileName } from "@/features/letters/export";
import { useCurrentResume } from "@/features/resume/builder/draft";
import { useOpenIssueCount } from "@/features/resume/editor/check/use-check";
import { createExportFile, getDefaultFileName, sanitizeFileName } from "@/features/resume/export/use-resume-export";
import { ENTER_CLASS } from "@/libs/motion";
import { client } from "@/libs/orpc/client";

export type DownloadFormat<Id extends string = ExportFormat> = {
	id: Id;
	label: string;
	/** ".pdf", or what's made ("2 files"). */
	extension: string;
	icon: IconName;
	description: string;
	disabled?: boolean;
};

export const getExportFormats = (): DownloadFormat[] => [
	{
		id: "pdf",
		label: "PDF",
		extension: ".pdf",
		icon: "picture_as_pdf",
		description: t`Looks exactly like the page. Use it for applications and email.`,
	},
	{
		id: "docx",
		label: t`Word`,
		extension: ".docx",
		icon: "description",
		description: t`For portals or recruiters who ask for Word. Layout is simplified.`,
	},
	{
		id: "md",
		label: "Markdown",
		extension: ".md",
		icon: "notes",
		description: t`Plain text with headings. Paste into application forms and notes.`,
	},
	{
		id: "json",
		label: "JSON",
		extension: ".json",
		icon: "data_object",
		description: t`Complete data backup. Imports back into Reactive Resume or JSON Resume tools.`,
	},
];

type FormatRadioGroupProps<Id extends string> = {
	formats: DownloadFormat<Id>[];
	value: Id;
	onChange: (value: Id) => void;
};

/** Format radio cards: icon, name, extension and when to use it. PDF is marked "Best for applying". */
export function FormatRadioGroup<Id extends string>({ formats, value, onChange }: FormatRadioGroupProps<Id>) {
	return (
		<RadioGroup
			aria-label={t`Format`}
			value={value}
			onValueChange={(next) => onChange(next as Id)}
			className="grid gap-1.5"
		>
			{formats.map((option) => (
				<Radio.Root
					key={option.id}
					value={option.id}
					disabled={option.disabled}
					className="group/format flex cursor-pointer items-start gap-3 rounded-[10px] border border-line p-3 text-start transition-colors duration-quick hover:border-line-2 data-checked:border-accent data-checked:bg-accent-soft data-disabled:cursor-not-allowed data-disabled:opacity-45"
				>
					<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2">
						<Icon name={option.icon} size={22} />
					</span>
					<span className="grid min-w-0 flex-1 gap-0.5">
						<span className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold">{option.label}</span>
							<span className="font-mono text-[11px] font-medium text-ink-3 group-data-checked/format:text-ink-2">
								{option.extension}
							</span>
							{option.id === "pdf" && (
								<span className="rounded bg-accent-soft px-1.5 text-[11px] leading-[18px] font-semibold text-accent-text">
									<Trans>Best for applying</Trans>
								</span>
							)}
						</span>
						<span className="text-[13px] leading-[18px] text-ink-2">{option.description}</span>
					</span>
					<span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-line-2 group-data-checked/format:border-accent">
						<span className="size-2 rounded-full bg-accent opacity-0 group-data-checked/format:opacity-100" />
					</span>
				</Radio.Root>
			))}
		</RadioGroup>
	);
}

type FileNameFieldProps = { value: string; extension: string; hint: ReactNode; onChange: (value: string) => void };

/** The file name recruiters see, with the extension shown after it. Characters file systems reject are dropped. */
export function FileNameField({ value, extension, hint, onChange }: FileNameFieldProps) {
	const id = useId();

	return (
		<div className="grid gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				<Trans>File name</Trans>
			</label>
			<div className="flex h-[38px] items-center overflow-hidden rounded-lg border border-line-2 bg-raised focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
				<input
					id={id}
					value={value}
					spellCheck={false}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onChange(sanitizeFileName(event.target.value))}
					className="h-full min-w-0 flex-1 bg-transparent ps-2.5 font-mono text-[13px] font-medium text-ink outline-none"
				/>
				<span className="px-2.5 font-mono text-[13px] font-medium text-ink-3">{extension}</span>
			</div>
			<span id={`${id}-hint`} className="text-xs text-ink-3">
				{hint}
			</span>
		</div>
	);
}

/** "done" follows a successful download, until the format changes or another download starts. */
export type DownloadState = "idle" | "busy" | "error" | "done";

type DownloadActionsProps = {
	state: DownloadState;
	label: string;
	onDownload: () => void;
	/** Offered when a file other than a PDF fails. */
	onDownloadPdf?: (() => void) | undefined;
};

/**
 * The failure alert (with PDF as the fallback) and the 44px button that shows its progress. After a download, a
 * one-line thank-you asks for a donation: the moment someone has what they came for is the one time it's fair to ask.
 */
export function DownloadActions({ state, label, onDownload, onDownloadPdf }: DownloadActionsProps) {
	return (
		<>
			{state === "error" && (
				<div
					role="alert"
					className="flex flex-wrap items-start gap-2.5 rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13px] leading-[19px] text-danger-text"
				>
					<Icon name="error" size={20} />
					<span className="min-w-0 flex-1">
						<Trans>The {label} file couldn't be generated. Try again, or download PDF instead.</Trans>
					</span>
					{onDownloadPdf && (
						<Button size="sm" variant="secondary" onClick={onDownloadPdf}>
							<Trans>Download PDF instead</Trans>
						</Button>
					)}
				</div>
			)}

			<Button
				className="h-11 gap-2 text-[15px]"
				aria-busy={state === "busy"}
				disabled={state === "busy"}
				onClick={onDownload}
			>
				{state === "busy" ? (
					<>
						<Spinner decorative className="size-4" />
						<Trans>Preparing {label} file…</Trans>
					</>
				) : state === "error" ? (
					<>
						<Icon name="refresh" />
						<Trans>Try again</Trans>
					</>
				) : (
					<>
						<Icon name="download" />
						<Trans>Download {label}</Trans>
					</>
				)}
			</Button>

			{state === "done" && (
				<p className={cn(ENTER_CLASS, "flex items-start gap-2 text-[13px] leading-[19px] text-ink-2")}>
					<Icon name="volunteer_activism" size={18} className="shrink-0 text-ink-3" />
					<span>
						<Trans>Good luck out there. Reactive Resume stays free because people chip in.</Trans>{" "}
						<a
							href="https://opencollective.com/reactive-resume/donate"
							target="_blank"
							rel="noopener noreferrer"
							className="font-medium text-accent-text underline underline-offset-2 hover:text-accent-hover"
						>
							<Trans>Donate</Trans>
						</a>
					</span>
				</p>
			)}
		</>
	);
}

/** The letter written for this resume's application, which can be downloaded along with it. */
function useLinkedLetter(resume: Resume) {
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const application = applications?.find(
		(item) => item.coverLetterId && (item.id === resume.applicationId || item.resumeId === resume.id),
	);
	return application?.coverLetterId ? { id: application.coverLetterId, company: application.company } : null;
}

type DownloadTabProps = {
	/** Opens Check; the note about open issues links there. */
	onReview: () => void;
};

/**
 * Download: every format explained by when to use it, the file name recruiters see, and a button that shows
 * its progress. Open Check issues are mentioned but never block. A failed file offers PDF instead. With a letter
 * written for the resume's application, that letter can come along as a second file.
 */
export function DownloadTab({ onReview }: DownloadTabProps) {
	const resume = useCurrentResume();
	const issues = useOpenIssueCount();
	const words = useLetterWords();
	const linkedLetter = useLinkedLetter(resume);
	const headerId = useId();
	const [format, setFormat] = useState<ExportFormat>("pdf");
	const [withLetter, setWithLetter] = useState(false);
	const [fileName, setFileName] = useState<string | null>(null);
	const [state, setState] = useState<DownloadState>("idle");

	const formats = getExportFormats();
	const selected = formats.find((option) => option.id === format) ?? (formats[0] as DownloadFormat);
	const name = fileName ?? getDefaultFileName(resume);

	const download = async (as: ExportFormat) => {
		const extension = formats.find((option) => option.id === as)?.extension ?? ".pdf";
		const file = `${sanitizeFileName(name) || getDefaultFileName(resume)}${extension}`;
		const letterId = withLetter ? linkedLetter?.id : undefined;
		setState("busy");
		try {
			const blob = await createExportFile(resume, as);
			downloadWithAnchor(blob, file);
			if (letterId) {
				const letter = await client.coverLetters.getById({ id: letterId });
				downloadWithAnchor(await createLetterFile(letter, words, as), `${letterFileName(letter, words)}${extension}`);
				toast.add({ description: t`Downloaded ${file} and the cover letter` });
			} else {
				toast.add({ description: t`Downloaded ${file}` });
			}
			setState("done");
		} catch {
			setState("error");
		}
	};

	return (
		<div className="grid gap-4">
			<FormatRadioGroup
				formats={formats}
				value={format}
				onChange={(value) => {
					setFormat(value);
					setState("idle");
				}}
			/>

			<FileNameField
				value={name}
				extension={selected.extension}
				hint={<Trans>Recruiters see this name. Your name plus “Resume” works well.</Trans>}
				onChange={setFileName}
			/>

			{linkedLetter && (
				<div className="flex items-center gap-2.5 text-sm">
					<Checkbox
						id={`${headerId}-letter`}
						checked={withLetter}
						onCheckedChange={(checked) => setWithLetter(checked === true)}
					/>
					<label htmlFor={`${headerId}-letter`} className="cursor-pointer">
						<Trans>Also download the {linkedLetter.company} cover letter</Trans>
					</label>
				</div>
			)}

			{issues > 0 && (
				<div className="flex gap-2.5 rounded-[10px] bg-warn-soft px-3 py-2.5 text-[13px] leading-[19px] text-warn-text">
					<Icon name="fact_check" size={20} />
					<span>
						<Plural
							value={issues}
							one="Check has # thing to review. You can still download."
							other="Check has # things to review. You can still download."
						/>{" "}
						<button type="button" className="font-medium underline underline-offset-2" onClick={onReview}>
							<Trans>Review</Trans>
						</button>
					</span>
				</div>
			)}

			<DownloadActions
				state={state}
				label={selected.label}
				onDownload={() => void download(format)}
				onDownloadPdf={format === "pdf" ? undefined : () => void download("pdf")}
			/>
		</div>
	);
}
