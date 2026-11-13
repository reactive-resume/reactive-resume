import type { DownloadFormat } from "./download-tab";
import type { ReactElement, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { getExportFormats, useLinkedLetter } from "./download-tab";
import { IconTile, rowGroundClassName } from "@/components/calm/list-row";
import { createLetterFile, letterFileName } from "@/features/letters/export";
import { useCurrentResume } from "@/features/resume/builder/draft";
import { useOpenIssueCount } from "@/features/resume/editor/check/use-check";
import { useEditorStore } from "@/features/resume/editor/store";
import {
	createExportFile,
	getDefaultFileName,
	preloadDocumentExport,
	sanitizeFileName,
	useResumeExport,
} from "@/features/resume/export/use-resume-export";
import { getReadableErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { client } from "@/libs/orpc/client";

type DownloadMenuProps<Id extends string> = {
	/** The ▾ of the split button (`DownloadButtons` `renderMore`). */
	trigger: ReactElement;
	formats: DownloadFormat<Id>[];
	/** The default file name, without its ending. */
	defaultFileName: string;
	/** Makes and saves the file; throws what the export throws. The toast and the thanks are the menu's. */
	download: (format: Id, fileName: string) => Promise<string>;
	onPrint?: (() => void) | undefined;
	/** A tick under the formats ("Also download the Kiln Studio cover letter"). */
	companion?: { label: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void } | undefined;
	/** Open Check items: one quiet line with a way in. It never blocks. */
	issues?: { count: number; onReview: () => void } | undefined;
};

/**
 * B16 (P4): every format as a row that is the download, the one file name, Print, and Check as a quiet line. Download
 * PDF stays one click on the split button; this is its ▾. A file that can't be made offers PDF instead.
 */
export function DownloadMenu<Id extends string>({
	trigger,
	formats,
	defaultFileName,
	download,
	onPrint,
	companion,
	issues,
}: DownloadMenuProps<Id>) {
	const id = useId();
	const popup = useRef<HTMLDivElement>(null);
	const phone = useBreakpoint() === "mobile";
	const [open, setOpen] = useState(false);
	const [fileName, setFileName] = useState<string | null>(null);
	const [busy, setBusy] = useState<Id | null>(null);
	const [failed, setFailed] = useState<DownloadFormat<Id> | null>(null);
	const [done, setDone] = useState(false);
	const [hovered, setHovered] = useState<Id | null>(null);
	const name = fileName ?? defaultFileName;
	const pdf = formats.find((format) => format.id === "pdf");
	const ending = formats.find((format) => format.id === (hovered ?? "pdf"))?.extension ?? ".pdf";

	const run = async (format: DownloadFormat<Id>) => {
		setBusy(format.id);
		setFailed(null);
		setDone(false);
		try {
			const file = await download(format.id, sanitizeFileName(name) || defaultFileName);
			toast.add({ description: t`Downloaded ${file}` });
			setDone(true);
		} catch (error) {
			setFailed(format);
			toast.add({ type: "error", description: getReadableErrorMessage(error, t`Download failed. Try again.`) });
		}
		setBusy(null);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			{/* The ▾ turns to ▴ while the menu is open (B16). */}
			<PopoverTrigger
				render={trigger}
				className="[&_[data-slot=icon]]:transition-transform data-popup-open:[&_[data-slot=icon]]:rotate-180"
			/>
			<PopoverContent
				ref={popup}
				initialFocus={() =>
					popup.current?.querySelector<HTMLButtonElement>("[data-download-format]:not(:disabled)") ?? true
				}
				align="end"
				sideOffset={14}
				aria-label={t`Download`}
				data-design="menu"
				onPointerEnter={preloadDocumentExport}
				className="w-[476px] max-w-[calc(100vw-16px)] gap-0 rounded-lg p-4"
			>
				<label htmlFor={id} className="mb-2 text-[13px]/[18px] font-medium text-ink-2">
					<Trans>File name</Trans>
				</label>
				<div className="flex h-10 items-center overflow-hidden rounded-md border border-control-border bg-raised pe-3 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
					<input
						id={id}
						value={name}
						spellCheck={false}
						aria-describedby={`${id}-hint`}
						onChange={(event) => setFileName(sanitizeFileName(event.target.value))}
						className="h-full min-w-0 flex-1 bg-transparent ps-3 font-mono text-[13px] font-medium text-ink outline-none"
					/>
					<span className="font-mono text-[13px]/4 font-medium text-ink-3">{ending}</span>
				</div>
				<p id={`${id}-hint`} className="mt-1.5 text-xs/4 text-ink-3">
					<Trans>Recruiters see this name. The ending follows the format you pick.</Trans>
				</p>

				<div className="-mx-2 mt-4 flex flex-col gap-0 border-t border-line pt-1">
					{formats.map((format) => (
						<FormatRow
							key={format.id}
							format={format}
							busy={busy === format.id}
							disabled={busy !== null || format.disabled}
							onHover={setHovered}
							onClick={() => void run(format)}
						/>
					))}
				</div>

				{companion && (
					<div className="flex items-center gap-2.5 py-2 text-sm">
						<Checkbox
							id={`${id}-companion`}
							checked={companion.checked}
							onCheckedChange={(checked) => companion.onCheckedChange(checked === true)}
						/>
						<label htmlFor={`${id}-companion`} className="cursor-pointer">
							{companion.label}
						</label>
					</div>
				)}

				{onPrint && (
					<div className="-mx-2 flex flex-col border-t border-line py-1">
						<FormatRow
							format={{
								id: "print",
								label: t`Print`,
								extension: "",
								icon: "printer",
								description: t`Sends the PDF to your printer.`,
							}}
							busy={false}
							disabled={busy !== null}
							onHover={() => undefined}
							onClick={() => {
								setOpen(false);
								onPrint();
							}}
						/>
					</div>
				)}

				<div className="-mx-2 flex flex-col border-t border-line py-1 xl:hidden">
					<FormatRow
						format={{
							id: "history",
							label: t`Version history`,
							extension: "",
							icon: "clock-counter-clockwise",
							description: t`Review earlier saved versions.`,
						}}
						busy={false}
						disabled={busy !== null}
						onHover={() => undefined}
						onClick={() => {
							setOpen(false);
							if (phone) useEditorStore.getState().setSheetTab("history");
							else useEditorStore.getState().setHistoryOpen(true);
						}}
					/>
				</div>

				{failed && failed.id !== "pdf" && pdf ? (
					<p role="alert" className="flex items-center gap-2 border-t border-line pt-3 t-small text-danger-text">
						<Icon name="warning-circle" size={16} />
						<span className="min-w-0 flex-1">
							<Trans>The {failed.label} file couldn't be made.</Trans>
						</span>
						<button type="button" className="font-medium text-accent-text" onClick={() => void run(pdf)}>
							<Trans>Download PDF instead</Trans>
						</button>
					</p>
				) : done ? (
					<p className={cn(ENTER_CLASS, "flex items-center gap-2 border-t border-line pt-3 t-small text-ink-2")}>
						<Icon name="hand-heart" size={16} className="shrink-0 text-ink-3" />
						<span className="min-w-0 flex-1">
							<Trans>Good luck out there. Reactive Resume stays free because people chip in.</Trans>
						</span>
						<a
							href="https://opencollective.com/reactive-resume/donate"
							target="_blank"
							rel="noopener noreferrer"
							className="font-medium text-accent-text"
						>
							<Trans>Donate</Trans>
						</a>
					</p>
				) : issues && issues.count > 0 ? (
					<p className="flex items-center gap-2 border-t border-line pt-3 t-small text-ink-2">
						<Icon name="list-checks" size={16} className="shrink-0 text-ink-3" />
						<span className="min-w-0 flex-1">
							<Plural
								value={issues.count}
								one="Check has # thing to review. You can still download."
								other="Check has # things to review. You can still download."
							/>
						</span>
						<button
							type="button"
							className="font-medium text-accent-text"
							onClick={() => {
								setOpen(false);
								issues.onReview();
							}}
						>
							<Trans>Review</Trans>
						</button>
					</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

type FormatRowProps<Id extends string> = {
	format: DownloadFormat<Id>;
	busy: boolean;
	disabled?: boolean | undefined;
	onHover: (id: Id | null) => void;
	onClick: () => void;
};

/** One format: its tile, its name and ending, when to use it. The row is the download. */
function FormatRow<Id extends string>({ format, busy, disabled, onHover, onClick }: FormatRowProps<Id>) {
	return (
		<button
			type="button"
			disabled={disabled}
			data-download-format={format.id}
			aria-busy={busy}
			onPointerEnter={() => onHover(format.id)}
			onPointerLeave={() => onHover(null)}
			onFocus={() => onHover(format.id)}
			onBlur={() => onHover(null)}
			onClick={onClick}
			className={cn(
				rowGroundClassName,
				"mx-2 flex min-h-14 items-center gap-3 py-2 text-start before:-inset-x-2 hover:before:bg-hover focus:before:bg-hover disabled:cursor-not-allowed disabled:opacity-60",
			)}
		>
			<IconTile className="bg-surface shadow-[inset_0_0_0_1px_var(--line)]">
				{busy ? <Spinner decorative className="size-4" /> : <Icon name={format.icon} size={20} />}
			</IconTile>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex flex-wrap items-center gap-2 text-sm/5 font-medium text-ink">
					{format.label}
					{format.extension && <span className="t-mono text-ink-3">{format.extension}</span>}
					{format.id === "pdf" && (
						<span className="rounded-xs bg-accent-soft px-1.5 py-0.5 t-caption text-accent-text">
							<Trans>Best for applying</Trans>
						</span>
					)}
				</span>
				<span className="text-[13px]/[18px] text-ink-3">{format.description}</span>
			</span>
		</button>
	);
}

type ResumeDownloadMenuProps = { trigger: ReactElement; onReview: () => void };

/** The resume's Download menu: its five formats, Print, its job's letter as a second file, and Check's count. */
export function ResumeDownloadMenu({ trigger, onReview }: ResumeDownloadMenuProps) {
	const resume = useCurrentResume();
	const count = useOpenIssueCount();
	const linkedLetter = useLinkedLetter(resume);
	const { onPrint } = useResumeExport(resume);
	const [withLetter, setWithLetter] = useState(false);
	const formats = getExportFormats();

	return (
		<DownloadMenu
			trigger={trigger}
			formats={formats}
			defaultFileName={getDefaultFileName(resume)}
			onPrint={() => void onPrint()}
			issues={{ count, onReview }}
			companion={
				linkedLetter
					? {
							label: <Trans>Also download the {linkedLetter.company} cover letter</Trans>,
							checked: withLetter,
							onCheckedChange: setWithLetter,
						}
					: undefined
			}
			download={async (format, name) => {
				const extension = formats.find((option) => option.id === format)?.extension ?? ".pdf";
				const file = `${name}${extension}`;
				downloadWithAnchor(await createExportFile(resume, format), file);
				if (withLetter && linkedLetter) {
					const letter = await client.coverLetters.getById({ id: linkedLetter.id });
					downloadWithAnchor(await createLetterFile(letter, format), `${letterFileName(letter)}${extension}`);
				}
				return file;
			}}
		/>
	);
}
