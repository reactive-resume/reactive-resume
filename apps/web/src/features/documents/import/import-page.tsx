import type { ImportReviewStep, ImportStep } from "./use-resume-import";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { Locale } from "@reactive-resume/utils/locale";
import type { CSSProperties, ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { hasUnreadableDateText } from "@reactive-resume/schema/resume/dates";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { formatFileSize } from "@reactive-resume/utils/file";
import { getLanguageName, localeSchema } from "@reactive-resume/utils/locale";
import { stripHtml } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { IMPORT_ACCEPT, useStartDocument } from "../use-start-document";
import { clearImportFile, peekImportFile } from "./pending-file";
import { useResumeImport } from "./use-resume-import";
import { Crumb, CrumbLink } from "@/components/calm/crumb";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { Columns, Page, PageBody, PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { SetUpAiLine } from "@/components/calm/set-up-ai-line";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { Combobox } from "@/components/ui/combobox";
import { useDialogStore } from "@/dialogs/store";
import { SetUpAiDialog } from "@/features/ai/set-up-ai";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { getSectionName } from "@/features/resume/editor/check/issues";
import { summarizeImport } from "@/features/resume/import/read-file";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { ENTER_CLASS, POP_CLASS } from "@/libs/motion";

/** A text action at the end of a row (`.ttb`). */
const textActionClassName = "rounded-xs text-sm font-medium text-accent-text hover:underline";

type ImportPageProps = {
	/** The imported resume is linked to this application. */
	applicationId?: string | undefined;
};

/**
 * Import a resume: choose or drop a file, say how a PDF or Word file is read, watch it being read, then check what
 * was found before anything is created. JSON and LinkedIn files come in as they are and skip the review.
 */
export function ImportPage({ applicationId }: ImportPageProps) {
	const navigate = useNavigate();
	const { i18n } = useLingui();
	const inputRef = useRef<HTMLInputElement>(null);
	const [locale, setLocale] = useState<Locale>();
	const [settingUpAi, setSettingUpAi] = useState(false);
	const [handedOver] = useState(peekImportFile);
	useEffect(clearImportFile, []);

	const { step, importFile, confirm, cancel, providerState } = useResumeImport({
		initialFile: handedOver,
		applicationId,
		locale,
		openLetter: (coverLetterId) => void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId } }),
	});
	const { startBlank, creating } = useStartDocument(applicationId, locale);
	const noAi = !providerState.isUnavailable && !providerState.hasUsableProvider;
	const dragging = useFileDrop((file) => void importFile(file));

	const chooseFile = () => inputRef.current?.click();
	const leave = () => void navigate({ to: "/dashboard/documents" });
	const language = (
		<LanguageField
			value={locale}
			onChange={setLocale}
			// Before a file's kind is known, "default" may also mean the language saved in the file.
			defaultLabel={step.name === "ready" ? t`Default` : getLanguageName(localeSchema.parse(i18n.locale))}
			defaultLocale={step.name === "ready" ? undefined : i18n.locale}
		/>
	);

	return (
		<Page>
			<PageBody>
				<PageHeader
					crumb={
						<Crumb>
							<CrumbLink to="/dashboard/documents">
								<Trans>Documents</Trans>
							</CrumbLink>
						</Crumb>
					}
					title={<Trans>Import a resume</Trans>}
					actions={<PhoneHeaderActions />}
					subtitle={
						step.name === "review" ? (
							<Trans>Check what was read. Nothing is created until you choose Create resume.</Trans>
						) : (
							<Trans>Nothing is created until you have checked what was read.</Trans>
						)
					}
				/>
				{noAi && (
					<SetUpAiLine
						className="mt-3.5"
						lead={<Trans>Word files and scanned PDFs are read with AI.</Trans>}
						onSetUp={() => setSettingUpAi(true)}
					>
						<Trans>PDF, JSON and LinkedIn files import on this device without it.</Trans>
					</SetUpAiLine>
				)}
				<AiProviderLoadState state={providerState} />
				<SetUpAiDialog open={settingUpAi} onOpenChange={setSettingUpAi} />
				<input
					ref={inputRef}
					type="file"
					accept={IMPORT_ACCEPT}
					className="hidden"
					aria-label={t`Choose a file to import`}
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void importFile(file);
					}}
				/>

				<Columns className="mt-4" aside={<Formats />}>
					{step.name === "idle" ? (
						<DropArea dragging={dragging} onChooseFile={chooseFile} />
					) : step.name === "ready" ? (
						<div className={cn(ENTER_CLASS, "flex flex-col")}>
							<List cap>
								<FileRow file={step.file} last />
							</List>
							<Footer language={language}>
								<Button size="lg" onClick={() => void importFile(step.file)}>
									<Trans>Import</Trans>
								</Button>
								<Button size="lg" variant="ghost" onClick={cancel}>
									<Trans>Cancel</Trans>
								</Button>
							</Footer>
						</div>
					) : step.name === "choice" ? (
						<Choice
							step={step}
							canUseAi={providerState.hasUsableProvider}
							creating={creating}
							onRead={(mode) => void importFile(step.file, mode)}
							onChooseFile={chooseFile}
							onStartBlank={() => void startBlank()}
							onCancel={cancel}
						/>
					) : step.name === "review" ? (
						<Review
							key="review"
							step={step}
							canUseAi={providerState.hasUsableProvider}
							language={language}
							onCreate={(keepLeftovers) => void confirm(step, keepLeftovers)}
							onReadAgain={(mode) => void importFile(step.file, mode)}
							onChooseFile={chooseFile}
							onCancel={leave}
						/>
					) : (
						<Progress
							key="progress"
							step={step}
							creating={creating}
							onCancel={cancel}
							onChooseFile={chooseFile}
							onStartBlank={() => void startBlank()}
							onStay={leave}
							onOpen={(resumeId) =>
								void navigate({
									to: "/builder/$resumeId",
									params: { resumeId },
									search: { imported: step.file.name },
								})
							}
						/>
					)}
				</Columns>
			</PageBody>
		</Page>
	);
}

/** Whether a file is being dragged over the window; a drop anywhere on the page is this page's file. */
function useFileDrop(onFile: (file: File) => void) {
	const [dragging, setDragging] = useState(false);
	const dropped = useEffectEvent(onFile);

	useEffect(() => {
		let depth = 0;
		const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
		const onEnter = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			depth += 1;
			setDragging(true);
		};
		const onLeave = () => {
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDragging(false);
		};
		const onOver = (event: DragEvent) => {
			if (hasFiles(event)) event.preventDefault();
		};
		const onDrop = (event: DragEvent) => {
			depth = 0;
			setDragging(false);
			const file = event.dataTransfer?.files[0];
			if (!file) return;
			event.preventDefault();
			// A drop inside an open dialog is that dialog's to handle.
			if (useDialogStore.getState().open) return;
			dropped(file);
		};

		window.addEventListener("dragenter", onEnter);
		window.addEventListener("dragleave", onLeave);
		window.addEventListener("dragover", onOver);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onEnter);
			window.removeEventListener("dragleave", onLeave);
			window.removeEventListener("dragover", onOver);
			window.removeEventListener("drop", onDrop);
		};
	}, []);

	return dragging;
}

/** Before a file: the place to drop one, and the button that opens the file picker. */
function DropArea({ dragging, onChooseFile }: { dragging: boolean; onChooseFile: () => void }) {
	return (
		<div
			data-dragging={dragging || undefined}
			className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-line-2 p-8 text-center transition-colors duration-quick data-dragging:border-accent data-dragging:bg-accent-soft"
		>
			<Icon name="download-simple" size={28} className={dragging ? "text-accent-text" : "text-ink-3"} />
			<p className="t-heading">{dragging ? <Trans>Drop to import</Trans> : <Trans>Drop a file here</Trans>}</p>
			<p className="max-w-56 text-sm text-ink-2">
				<Trans>PDF, Word or JSON. A resume is built from it.</Trans>
			</p>
			<Button className={cn("mt-2", dragging && "invisible")} onClick={onChooseFile}>
				<Trans>Choose a file</Trans>
			</Button>
		</div>
	);
}

function fileKind(name: string): { label: string; icon: IconName } {
	const extension = name.toLowerCase().split(".").pop();
	if (extension === "pdf") return { label: "PDF", icon: "file-pdf" };
	if (extension === "docx" || extension === "doc") return { label: "Word", icon: "file-doc" };
	if (extension === "zip") return { label: "ZIP", icon: "file-zip" };
	if (extension === "json") return { label: "JSON", icon: "file-text" };
	return { label: t`File`, icon: "file-text" };
}

type FileRowProps = {
	file: File;
	/** A fact after the size ("not read, and not sent anywhere"). */
	note?: ReactNode;
	trailing?: ReactNode;
	/** The row closes its list with a hairline. */
	last?: boolean;
};

function FileRow({ file, note, trailing, last = false }: FileRowProps) {
	const { i18n } = useLingui();
	const kind = fileKind(file.name);
	return (
		<ListRow
			className={cn(last && "last:border-b")}
			leading={
				<IconTile>
					<Icon name={kind.icon} size={20} />
				</IconTile>
			}
			title={file.name}
			subtitle={
				<>
					{kind.label} · {formatFileSize(file.size, i18n.locale)}
					{note && <> · {note}</>}
				</>
			}
			trailing={trailing}
		/>
	);
}

type FooterProps = { children: ReactNode; language?: ReactNode };

/** The page's buttons, accent first, with the resume language at the end of the line. */
function Footer({ children, language }: FooterProps) {
	return (
		<div className="mt-5 flex flex-wrap items-center gap-2">
			{children}
			<span className="flex-1" />
			{language}
		</div>
	);
}

type LanguageFieldProps = {
	value: Locale | undefined;
	onChange: (locale: Locale | undefined) => void;
	/** What the untouched field reads. */
	defaultLabel: string;
	/** The language the default stands for, left out of the list so it isn't offered twice. */
	defaultLocale?: string | undefined;
};

function LanguageField({ value, onChange, defaultLabel, defaultLocale }: LanguageFieldProps) {
	const id = useId();
	return (
		<div className="flex items-center gap-2">
			<label htmlFor={id} className="t-small text-ink-2">
				<Trans>Resume language</Trans>
			</label>
			<Combobox
				id={id}
				className="w-[168px] min-w-0"
				options={[
					{ value: "", label: defaultLabel },
					...getLocaleOptions().filter((option) => option.value !== defaultLocale),
				]}
				value={value ?? ""}
				placeholder={defaultLabel}
				onValueChange={(next) => onChange(localeSchema.safeParse(next).data)}
			/>
		</div>
	);
}

type ChoiceProps = {
	step: Extract<ImportStep, { name: "choice" }>;
	canUseAi: boolean;
	creating: boolean;
	onRead: (mode: "local" | "ai") => void;
	onChooseFile: () => void;
	onStartBlank: () => void;
	onCancel: () => void;
};

/** A PDF or Word file asks first how to read it; a Word file with no AI connection shows the ways in that work now. */
function Choice({ step, canUseAi, creating, onRead, onChooseFile, onStartBlank, onCancel }: ChoiceProps) {
	const chooseAnother = (
		<button type="button" className={textActionClassName} onClick={onChooseFile}>
			<Trans>Choose another file</Trans>
		</button>
	);

	if (step.kind === "docx" && !canUseAi)
		return (
			<div className={cn(ENTER_CLASS, "flex flex-col")}>
				<List cap>
					<FileRow
						file={step.file}
						note={<Trans>not read, and not sent anywhere</Trans>}
						trailing={
							<Button onClick={onChooseFile}>
								<Trans>Choose another file</Trans>
							</Button>
						}
						last
					/>
				</List>
				<SectionHeading className="pt-6">
					<Trans>Ways in without AI</Trans>
				</SectionHeading>
				<List>
					<WayIn
						icon="file-pdf"
						title={<Trans>Save it as a PDF, then choose the PDF</Trans>}
						subtitle={<Trans>In Word: File › Save as › PDF. A PDF with real text is read on this device, free.</Trans>}
					/>
					<WayIn
						icon="file-zip"
						title={<Trans>Use your LinkedIn export</Trans>}
						subtitle={<Trans>The data archive LinkedIn sends you is read on this device.</Trans>}
					/>
					<ListRow
						render={<button type="button" disabled={creating} onClick={onStartBlank} />}
						leading={
							<IconTile>
								<Icon name="file-plus" size={20} />
							</IconTile>
						}
						title={<Trans>Start blank</Trans>}
						subtitle={<Trans>An empty resume to type or paste into, section by section.</Trans>}
						caret
					/>
				</List>
			</div>
		);

	return (
		<div className={cn(ENTER_CLASS, "flex flex-col")}>
			<List cap>
				<FileRow file={step.file} trailing={chooseAnother} last />
			</List>
			<SectionHeading className="pt-6">
				<Trans>How to read this file</Trans>
			</SectionHeading>
			<List>
				{step.kind === "pdf" && (
					<ListRow
						leading={
							<IconTile>
								<Icon name="desktop" size={20} />
							</IconTile>
						}
						title={<Trans>On this device</Trans>}
						subtitle={<Trans>Free. The file never leaves your browser.</Trans>}
						trailing={
							<Button variant="secondary" onClick={() => onRead("local")}>
								<Trans>Read on this device</Trans>
							</Button>
						}
					/>
				)}
				{canUseAi && (
					<ListRow
						leading={
							<IconTile>
								<Icon name="sparkle" size={20} />
							</IconTile>
						}
						title={<Trans>With AI</Trans>}
						subtitle={
							step.kind === "pdf" ? (
								<Trans>Better for columns and tables. The file is sent to your AI connection.</Trans>
							) : (
								<Trans>Word files are read with AI. The file is sent to your AI connection.</Trans>
							)
						}
						trailing={
							<Button onClick={() => onRead("ai")}>
								<Trans>Read with AI</Trans>
							</Button>
						}
					/>
				)}
			</List>
			<Footer>
				<Button size="lg" variant="ghost" className="-ms-[18px]" onClick={onCancel}>
					<Trans>Cancel</Trans>
				</Button>
			</Footer>
		</div>
	);
}

function WayIn({ icon, title, subtitle }: { icon: IconName; title: ReactNode; subtitle: ReactNode }) {
	return (
		<ListRow
			leading={
				<IconTile>
					<Icon name={icon} size={20} />
				</IconTile>
			}
			title={title}
			subtitle={subtitle}
		/>
	);
}

/** The name of an entry, whatever its section calls it. */
const ENTRY_NAME_KEYS = ["name", "company", "school", "title", "organization", "language", "network", "content"];

const PREVIEW_NAMES = 4;

function entryName(item: object) {
	const fields = item as Record<string, unknown>;
	for (const key of ENTRY_NAME_KEYS) {
		const value = fields[key];
		const text = typeof value === "string" ? stripHtml(value).trim() : "";
		if (text) return text;
	}
	return "";
}

/** What was read into a section, as one line: the summary's text, or the names of its entries. */
function sectionPreview(data: ResumeData, key: string) {
	if (key === "summary") return { text: stripHtml(data.summary.content).trim(), flagged: 0 };
	const section =
		(data.sections as Record<string, { items: object[] } | undefined>)[key] ??
		data.customSections.find((custom) => custom.id === key);
	const items = section?.items ?? [];
	const names = items.map(entryName).filter(Boolean);
	return {
		// Four names say what kind of section it is; the count at the end of the row says how many there are.
		text: names.slice(0, PREVIEW_NAMES).join(" · ") + (names.length > PREVIEW_NAMES ? "…" : ""),
		flagged: items.filter((item) => hasUnreadableDateText((item as { dates?: never }).dates)).length,
	};
}

type ReviewProps = {
	step: ImportReviewStep;
	canUseAi: boolean;
	language: ReactNode;
	onCreate: (keepLeftovers: boolean) => void;
	onReadAgain: (mode: "local" | "ai") => void;
	onChooseFile: () => void;
	onCancel: () => void;
};

/** What the reader found, section by section, and the lines it couldn't place, before the resume is created. */
function Review({ step, canUseAi, language, onCreate, onReadAgain, onChooseFile, onCancel }: ReviewProps) {
	const { review, data } = step;
	const [keepLeftovers, setKeepLeftovers] = useState(true);
	const leftoversId = useId();
	const summary = summarizeImport(data);
	const basics = [data.basics.name, data.basics.email, data.basics.phone].map((value) => value.trim()).filter(Boolean);

	return (
		<div className={cn(ENTER_CLASS, "flex flex-col")}>
			<List cap>
				<FileRow
					file={step.file}
					trailing={
						<button type="button" className={textActionClassName} onClick={onChooseFile}>
							<Trans>Choose another file</Trans>
						</button>
					}
				/>
				{step.readWith === "device" ? (
					<ListRow
						className="last:border-b"
						leading={
							<IconTile>
								<Icon name="desktop" size={20} />
							</IconTile>
						}
						title={<Trans>Read on this device</Trans>}
						subtitle={<Trans>Free. The file never left your browser.</Trans>}
						trailing={
							canUseAi && (
								<Button size="sm" variant="secondary" onClick={() => onReadAgain("ai")}>
									<Icon name="sparkle" />
									<Trans>Read again with AI</Trans>
								</Button>
							)
						}
					/>
				) : (
					<ListRow
						className="last:border-b"
						leading={
							<IconTile>
								<Icon name="sparkle" size={20} />
							</IconTile>
						}
						title={<Trans>Read with AI</Trans>}
						subtitle={<Trans>One request to your AI connection. The file was sent to it.</Trans>}
						trailing={
							step.kind === "pdf" && (
								<Button size="sm" variant="secondary" onClick={() => onReadAgain("local")}>
									<Trans>Read again on this device</Trans>
								</Button>
							)
						}
					/>
				)}
			</List>

			<SectionHeading
				className="pt-6"
				note={
					<Trans>
						<Plural value={summary.sections} one="# section" other="# sections" /> ·{" "}
						<Plural value={summary.entries} one="# entry" other="# entries" />
					</Trans>
				}
			>
				<Trans>What was found</Trans>
			</SectionHeading>
			<List aria-label={t`Sections found`} role="list">
				{basics.length > 0 && <FoundRow label={<Trans>Basics</Trans>} value={basics.join(" · ")} count={t`found`} />}
				{review.sections.map((section) => {
					const preview = sectionPreview(data, section.key);
					return (
						<FoundRow
							key={section.key}
							label={section.title.trim() || getSectionName(data, section.key)}
							value={preview.text}
							flagged={preview.flagged}
							count={
								section.key === "summary" ? t`text` : plural(section.entries, { one: "# entry", other: "# entries" })
							}
						/>
					);
				})}
			</List>
			{review.sections.length === 0 && (
				<p className="pt-2 t-small text-ink-2">
					<Trans>No sections were found in this file.</Trans>
				</p>
			)}

			{step.comparison !== "full" && (
				<p className="pt-3 t-small text-ink-2">
					{step.comparison === "partial" ? (
						<Trans>
							Only part of this file could be compared with what came in. Check each section against your file in the
							editor.
						</Trans>
					) : (
						<Trans>
							This file's text couldn't be compared with what came in, so lines left out aren't listed. Check each
							section against your file in the editor.
						</Trans>
					)}
				</p>
			)}

			{review.missingContact && (
				<p className="mt-3 flex gap-2 rounded-lg bg-warn-soft px-4 py-3 t-small text-warn-text">
					<Icon name="warning-circle" size={18} className="shrink-0" />
					<Trans>Name and contact details weren't found. Add them in Basics.</Trans>
				</p>
			)}

			{review.notImported.length > 0 && (
				<div className="mt-3 rounded-lg bg-sunken px-4 py-3.5">
					<p className="text-sm font-medium">
						<Plural
							value={review.notImported.length}
							one="# line wasn't placed in any section"
							other="# lines weren't placed in any section"
						/>
					</p>
					<ul className="mt-1.5 mb-2.5 max-h-40 list-disc overflow-y-auto ps-[18px] t-small text-ink-2">
						{review.notImported.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
					<label htmlFor={leftoversId} className="flex items-center gap-2.5 t-small">
						<Checkbox
							id={leftoversId}
							checked={keepLeftovers}
							onCheckedChange={(checked) => setKeepLeftovers(checked)}
						/>
						<Trans>Add them as a section called “More from your file”, to sort later</Trans>
					</label>
				</div>
			)}

			<Footer language={language}>
				<Button size="lg" onClick={() => onCreate(keepLeftovers && review.notImported.length > 0)}>
					<Trans>Create resume</Trans>
				</Button>
				<Button size="lg" variant="ghost" onClick={onCancel}>
					<Trans>Cancel</Trans>
				</Button>
			</Footer>
		</div>
	);
}

type FoundRowProps = { label: ReactNode; value: string; count: string; flagged?: number };

/** One section of the review (`.cmp .li`): its name, what was read, anything to check, and how much. */
function FoundRow({ label, value, count, flagged = 0 }: FoundRowProps) {
	return (
		<ListRow role="listitem" className="min-h-11 py-2">
			<span className="w-28 shrink-0 truncate text-sm font-medium">{label}</span>
			<span className="min-w-0 flex-1 truncate text-sm text-ink-2">{value}</span>
			{flagged > 0 && (
				<Badge variant="warn">
					<Icon name="warning-circle" />
					<Plural value={flagged} one="# date to check" other="# dates to check" />
				</Badge>
			)}
			<span className="shrink-0 t-mono text-ink-3">{count}</span>
		</ListRow>
	);
}

type ProgressProps = {
	step: Extract<ImportStep, { name: "importing" | "imported" | "failed" }>;
	creating: boolean;
	onCancel: () => void;
	onChooseFile: () => void;
	onStartBlank: () => void;
	onStay: () => void;
	onOpen: (resumeId: string) => void;
};

/** The import's progress, then its outcome: found counts with Open in editor, or the error with two ways on. */
function Progress({ step, creating, onCancel, onChooseFile, onStartBlank, onStay, onOpen }: ProgressProps) {
	return (
		<div className={cn(ENTER_CLASS, "flex flex-col")}>
			<SectionHeading first>
				{step.name === "failed" ? (
					<Trans>Couldn't import</Trans>
				) : step.name === "imported" ? (
					<Trans>Imported</Trans>
				) : (
					<Trans>Importing</Trans>
				)}
			</SectionHeading>
			<List cap>
				<FileRow
					file={step.file}
					trailing={
						step.name === "importing" && (
							<Button variant="ghost" onClick={onCancel}>
								<Trans>Cancel</Trans>
							</Button>
						)
					}
					last
				/>
			</List>

			{/* One list for importing and imported, so its checks don't replay when the import finishes. */}
			{step.name !== "failed" && (
				<Steps
					stage={step.name === "imported" ? 3 : step.stage}
					notes={
						step.name === "imported"
							? [
									t`file read`,
									plural(step.sections, { one: "# section", other: "# sections" }),
									plural(step.entries, { one: "# entry", other: "# entries" }),
								]
							: step.notes
					}
				/>
			)}

			{step.name === "failed" && (
				<>
					<div
						role="alert"
						className={cn(ENTER_CLASS, "mt-4 flex gap-2.5 rounded-lg bg-danger-soft px-4 py-3 t-ui text-danger-text")}
					>
						<Icon name="warning-circle" size={20} className="shrink-0" />
						<span>{step.message}</span>
					</div>
					<Footer>
						<Button size="lg" onClick={onChooseFile}>
							<Trans>Choose another file</Trans>
						</Button>
						<Button size="lg" variant="ghost" onClick={onStartBlank} disabled={creating}>
							<Trans>Start blank</Trans>
						</Button>
					</Footer>
				</>
			)}

			{step.name === "imported" && (
				<>
					<p role="status" className={cn(ENTER_CLASS, "mt-4 flex gap-2 t-ui")}>
						<Icon name="check-circle" size={20} className="shrink-0 text-accent-text" />
						<span>
							<Trans>
								Found <Plural value={step.sections} one="# section" other="# sections" /> and{" "}
								<Plural value={step.entries} one="# entry" other="# entries" />.
							</Trans>{" "}
							{step.flagged > 0 && (
								<Plural
									value={step.flagged}
									one="# field is flagged for a quick look in the editor."
									other="# fields are flagged for a quick look in the editor."
								/>
							)}
						</span>
					</p>
					<Footer>
						<Button size="lg" onClick={() => onOpen(step.resumeId)}>
							<Trans>Open in editor</Trans>
						</Button>
						<Button size="lg" variant="ghost" onClick={onStay}>
							<Trans>Stay here</Trans>
						</Button>
					</Footer>
				</>
			)}
		</div>
	);
}

/** Reading the file → Finding sections → Filling in entries, each with a note once done. */
function Steps({ stage, notes }: { stage: number; notes: string[] }) {
	const steps = [t`Reading the file`, t`Finding sections`, t`Filling in entries`];

	return (
		<div className="grid gap-3 pt-4">
			<ol className="grid gap-2.5" aria-label={t`Import steps`}>
				{steps.map((label, index) => {
					const done = stage > index;
					const current = stage === index;
					return (
						<li
							key={label}
							className={cn("flex items-center gap-2.5 text-sm", done || current ? "text-ink" : "text-ink-3")}
						>
							{done ? (
								<Icon name="check-circle" size={18} className={cn(POP_CLASS, "text-accent-text")} />
							) : current ? (
								<Spinner decorative className={cn(POP_CLASS, "size-[18px]")} />
							) : (
								<span className="size-[18px] rounded-full border-[1.5px] border-control-border" />
							)}
							<span className="font-medium">{label}</span>
							{done && notes[index] && <span className="text-xs text-ink-3">{notes[index]}</span>}
						</li>
					);
				})}
			</ol>
			<div
				role="progressbar"
				aria-label={t`Import progress`}
				aria-valuemin={0}
				aria-valuemax={3}
				aria-valuenow={stage}
				className="h-1 overflow-hidden rounded-xs bg-sunken"
			>
				<div
					className="h-full translate-x-(--fill) bg-accent transition-[translate] duration-standard ease-enter rtl:-translate-x-(--fill)"
					style={{ "--fill": `${(stage / 3) * 100 - 100}%` } as CSSProperties}
				/>
			</div>
		</div>
	);
}

/** What the importer reads, one row per format; only two mention AI. */
function Formats() {
	const formats: { name: string; extension: string; ai?: ReactNode; note: ReactNode }[] = [
		{
			name: "PDF",
			extension: ".pdf",
			ai: <Trans>AI optional</Trans>,
			note: (
				<Trans>
					On this device, or with AI for columns and tables. A scanned PDF has no text to read on this device.
				</Trans>
			),
		},
		{
			name: "Word",
			extension: ".docx",
			ai: <Trans>Needs AI</Trans>,
			note: <Trans>Read with your AI connection. Save an older .doc file as .docx first.</Trans>,
		},
		{
			name: "Reactive Resume",
			extension: ".json",
			note: <Trans>A file exported from this app, version 4 included. Comes in exactly as it is.</Trans>,
		},
		{
			name: "JSON Resume",
			extension: ".json",
			note: <Trans>The open format other resume builders export. Comes in exactly as it is.</Trans>,
		},
		{
			name: t`LinkedIn export`,
			extension: ".zip",
			note: <Trans>The data archive LinkedIn sends you. Read on this device.</Trans>,
		},
		{
			name: t`Cover letter`,
			extension: ".json",
			note: <Trans>A letter exported from this app comes in as a letter.</Trans>,
		},
	];

	return (
		<>
			<SectionHeading first>
				<Trans>What you can import</Trans>
			</SectionHeading>
			<List role="list">
				{formats.map((format) => (
					<ListRow key={format.name} role="listitem" className="min-h-0">
						<span className="flex min-w-0 flex-1 flex-col gap-px">
							<span className="flex items-center gap-2 text-sm font-medium">
								{format.name}
								<span className="t-mono text-ink-3">{format.extension}</span>
								{format.ai && (
									<Badge variant="outline" className="ms-auto">
										<Icon name="sparkle" />
										{format.ai}
									</Badge>
								)}
							</span>
							<span className="t-small text-ink-3">{format.note}</span>
						</span>
					</ListRow>
				))}
			</List>
		</>
	);
}
