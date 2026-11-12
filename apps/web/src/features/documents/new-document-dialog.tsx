import type { Locale } from "@reactive-resume/utils/locale";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { SheetContent } from "@reactive-resume/ui/components/sheet";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { getLanguageName, localeSchema } from "@reactive-resume/utils/locale";
import { pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { defaultCopySource, formatEdited } from "./filter";
import { handOverImportFile } from "./import/pending-file";
import { useNewDocumentsStore } from "./new-documents";
import { useStartDocument } from "./use-start-document";
import { DocumentThumb } from "@/components/calm/document-thumb";
import { List, ListRow, rowLinkClassName } from "@/components/calm/list-row";
import { StageDot } from "@/components/calm/stage-dot";
import { Combobox } from "@/components/ui/combobox";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryKey, applicationsListQueryOptions } from "@/features/applications/queries";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { toastError } from "@/libs/error-message";
import { formatRelativeTime } from "@/libs/locale";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

export type NewDocumentContext = "documents" | "letters" | "applications" | "career";

export type NewDocumentDialogData = {
	/** The section New was opened from: Cover letter leads when it was opened for a letter. */
	context?: NewDocumentContext;
	/** Open on a step other than the choices. */
	step?: "copy";
	destination?: "job-match";
	/** Copy for a job: the resume to start from. A letter: the resume it goes with. */
	sourceResumeId?: string;
	/** The application the new document is for. */
	applicationId?: string;
	/** A file dropped on the page: it goes to the Import page, which waits for it to be confirmed. */
	file?: File;
};

type OpenResumeOptions = { withAssistant?: boolean; checkTab?: "match" };

type NewDocumentDialogProps = { data?: NewDocumentDialogData | undefined; mobileSheet?: boolean };

/** A text action at the end of a row (`.ttb`). */
const textActionClassName = "rounded-xs text-sm font-medium text-accent-text hover:underline disabled:opacity-45";

/**
 * New document: Resume or Cover letter first, then how to start. A file is imported on its own page
 * (`/dashboard/documents/import`); this dialog only sends you there.
 */
export function NewDocumentDialog({ data, mobileSheet = false }: NewDocumentDialogProps) {
	if (data?.file) return <ImportHandOver file={data.file} />;
	return <NewDocument data={data} mobileSheet={mobileSheet} />;
}

/** A dropped file never shows this dialog: it is handed to the Import page. */
function ImportHandOver({ file }: { file: File }) {
	const navigate = useNavigate();
	const closeDialog = useDialogStore((state) => state.closeDialog);
	useEffect(() => {
		handOverImportFile(file);
		closeDialog();
		void navigate({ to: "/dashboard/documents/import" });
	}, [file, closeDialog, navigate]);
	return null;
}

const PAGE_SIZES = { a4: "A4", letter: "Letter" } as const;
type PageSize = keyof typeof PAGE_SIZES;

function NewDocument({ data, mobileSheet = false }: NewDocumentDialogProps) {
	const Content = mobileSheet ? SheetContent : DialogContent;
	const [opener] = useState(() => document.activeElement);
	const navigate = useNavigate();
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const { hasUsableProvider } = useHasUsableAiProvider();
	const closeDialog = useDialogStore((state) => state.closeDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const context = data?.context ?? "documents";
	const id = useId();
	const nameRef = useRef<HTMLInputElement>(null);

	const [step, setStep] = useState<"choose" | "copy">(data?.step ?? "choose");
	const [kind, setKind] = useState<"resume" | "letter">(context === "letters" ? "letter" : "resume");
	const [from, setFrom] = useState<"blank" | "copy" | "import">("blank");
	/** `null` until typed: the field follows the suggested name. */
	const [name, setName] = useState<string | null>(null);
	const [moreOpen, setMoreOpen] = useState(false);
	const [locale, setLocale] = useState<Locale>();
	const [pageSize, setPageSize] = useState<PageSize>("a4");
	const [jobId, setJobId] = useState(data?.applicationId ?? "");
	const [letterResumeId, setLetterResumeId] = useState(data?.sourceResumeId ?? "");
	const [letterFrom, setLetterFrom] = useState<"blank" | "letter">("blank");
	const [letterSourceId, setLetterSourceId] = useState("");
	const [choosingLetter, setChoosingLetter] = useState(false);

	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const resumes = (documents ?? []).filter((document) => document.type === "resume");
	const letters = (documents ?? []).filter((document) => document.type === "letter");
	const jobs = (applications ?? []).filter(
		(application) => application.status !== "closed" || application.id === data?.applicationId,
	);
	const copySource = defaultCopySource(resumes);
	const letterSource = letters.find((letter) => letter.id === letterSourceId) ?? letters[0];
	const job = jobs.find((application) => application.id === jobId);

	const { startBlank, trySample, newLetter, creating } = useStartDocument(data?.applicationId, locale);
	const { mutateAsync: copyResume, isPending: copying } = useMutation(orpc.documents.copyForJob.mutationOptions());
	const busy = creating || copying;

	const suggestedName =
		kind === "letter"
			? job
				? [job.company, job.role.trim()].filter(Boolean).join(" · ")
				: t`Untitled letter`
			: from === "copy" && copySource
				? t`${copySource.name.split(" — ")[0] ?? ""} (copy)`
				: t`Untitled resume`;
	const typedName = name?.trim().slice(0, 100) ?? "";
	const finalName = typedName || suggestedName;
	const importing = kind === "resume" && from === "import";

	// A copy made for a job opens with the assistant ready to tailor it.
	const openResume = (resumeId: string, { withAssistant = false, checkTab }: OpenResumeOptions = {}) => {
		closeDialog();
		void navigate({
			to: "/builder/$resumeId",
			params: { resumeId },
			search: { ...(withAssistant ? { assistant: "new" } : {}), mode: checkTab ? "check" : undefined, checkTab },
		});
	};
	// Save job reuses Applications' own Add dialog through its one-shot ?create link.
	const saveJob = () => {
		closeDialog();
		void navigate({ to: "/dashboard/applications", search: { create: true } });
	};
	const refreshDocuments = () => queryClient.invalidateQueries({ queryKey: orpc.documents.key() });

	const copy = async () => {
		if (!copySource) return;
		const forJob = data?.applicationId;
		const input = { resumeId: copySource.id, ...(forJob ? { applicationId: forJob } : {}), name: finalName };
		// A retry of the same copy (a lost response, a second press) sends the same ID, so it's made once.
		const key = `copy-for-job:${JSON.stringify(input)}`;
		try {
			const resumeId = await copyResume({ ...input, newId: pendingRequestId(key) });
			settleRequestId(key);
			toast.add({ description: t`Created “${finalName}”` });
			markNew(resumeId);
			void refreshDocuments();
			openResume(resumeId, { withAssistant: Boolean(forJob) && hasUsableProvider });
		} catch (error) {
			toastError(error, t`Couldn't copy the resume. Try again.`);
		}
	};

	const create = () => {
		if (kind === "letter") {
			void newLetter(letterResumeId || null, (letterFrom === "letter" && letterSource?.id) || null, {
				applicationId: jobId || undefined,
				// A letter with no job and no typed name is numbered ("Untitled letter 2") like before.
				name: typedName || (job ? suggestedName : undefined),
			});
		} else if (from === "import") {
			closeDialog();
			void navigate({
				to: "/dashboard/documents/import",
				search: data?.applicationId ? { application: data.applicationId } : {},
			});
		} else if (from === "copy") void copy();
		else void startBlank(undefined, { name: typedName || undefined, pageSize });
	};

	const languageName = getLanguageName(locale ?? localeSchema.parse(i18n.locale));

	return (
		<Content
			closeLabel={t`Close`}
			// The name is the first thing to type; on a phone the keyboard would cover the choices.
			{...(mobileSheet ? {} : { initialFocus: nameRef })}
			finalFocus={() => {
				if (opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length) return opener;
				// Responsive navigation replaces the opener; return to the current New action.
				return document.querySelector<HTMLElement>("[data-document-new-trigger]") ?? true;
			}}
			{...(mobileSheet ? { side: "bottom" as const } : {})}
			className={
				mobileSheet
					? "gap-5 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
					: "gap-5 sm:max-w-[560px]"
			}
		>
			{/* Each step enters as it replaces the last; reduced motion keeps only its opacity fade. */}
			{step === "copy" ? (
				<div key="copy" className={cn(ENTER_CLASS, "grid gap-4")}>
					<CopyForJob
						initialSourceId={data?.sourceResumeId}
						initialJobId={data?.applicationId}
						onBack={() => setStep("choose")}
						// Opened straight on this step (a card's Copy for a job…): there's no choice to go back to.
						onCancel={data?.step === "copy" ? closeDialog : undefined}
						onCreated={(resumeId, forJob) => {
							markNew(resumeId);
							void refreshDocuments();
							openResume(
								resumeId,
								data?.destination === "job-match"
									? { checkTab: "match" }
									: { withAssistant: forJob && hasUsableProvider },
							);
						}}
					/>
				</div>
			) : (
				<form
					key="choose"
					className={cn(ENTER_CLASS, "contents")}
					onSubmit={(event) => {
						event.preventDefault();
						if (!busy) create();
					}}
				>
					<DialogHeader className="pe-9">
						<DialogTitle>
							<Trans>New document</Trans>
						</DialogTitle>
						<DialogDescription className="sr-only">
							<Trans>Start a resume or a cover letter: blank, from a copy, or from a file.</Trans>
						</DialogDescription>
					</DialogHeader>

					<RadioGroup
						aria-label={t`Kind`}
						value={kind}
						onValueChange={(value) => {
							setKind(value as typeof kind);
							setName(null);
						}}
						className="grid grid-cols-1 gap-3 sm:grid-cols-2"
					>
						<KindCard
							id={`${id}-resume`}
							value="resume"
							title={<Trans>Resume</Trans>}
							description={<Trans>Your experience, laid out on a page.</Trans>}
						/>
						<KindCard
							id={`${id}-letter`}
							value="letter"
							title={<Trans>Cover letter</Trans>}
							description={<Trans>A letter for one job, matched to a resume.</Trans>}
						/>
					</RadioGroup>

					{kind === "letter" && (
						<>
							<Field
								id={`${id}-job`}
								label={<Trans>For which job</Trans>}
								hint={
									<Trans>
										The letter is linked to the application, so its posting is at hand. “No job yet” is on the list.
									</Trans>
								}
							>
								{/* The chosen job's stage dot sits in the field, before its name, as in the list's rows. */}
								<div className="relative w-full">
									{job && (
										<StageDot
											status={job.status}
											className="pointer-events-none absolute inset-s-3 top-1/2 z-10 -translate-y-1/2"
										>
											{null}
										</StageDot>
									)}
									<NativeSelect
										id={`${id}-job`}
										value={jobId}
										disabled={busy}
										className={cn(job && "ps-7")}
										onChange={(event) => {
											setJobId(event.target.value);
											setName(null);
										}}
									>
										<option value="">{t`No job yet`}</option>
										{jobs.map((application) => (
											<option key={application.id} value={application.id}>
												{[application.company, application.role.trim()].filter(Boolean).join(" · ")}
											</option>
										))}
									</NativeSelect>
								</div>
							</Field>
							<Field
								id={`${id}-letter-resume`}
								label={<Trans>Resume</Trans>}
								hint={<Trans>Your name and contact details come from it, and the letter can match its design.</Trans>}
							>
								<NativeSelect
									id={`${id}-letter-resume`}
									value={letterResumeId}
									disabled={busy}
									onChange={(event) => setLetterResumeId(event.target.value)}
								>
									<option value="">{t`No resume`}</option>
									{resumes.map((resume) => (
										<option key={resume.id} value={resume.id}>
											{resume.name}
										</option>
									))}
								</NativeSelect>
							</Field>
						</>
					)}

					{kind === "resume" && (
						<Field id={`${id}-name`} label={<Trans>Name</Trans>}>
							<Input
								ref={nameRef}
								id={`${id}-name`}
								value={importing ? "" : (name ?? suggestedName)}
								placeholder={importing ? t`Named from the file` : undefined}
								maxLength={100}
								disabled={importing}
								onChange={(event) => setName(event.target.value)}
							/>
						</Field>
					)}

					<div className="flex min-w-0 flex-col gap-1.5">
						<Label id={`${id}-from`}>
							<Trans>Start from</Trans>
						</Label>
						{kind === "resume" ? (
							<RadioGroup
								aria-labelledby={`${id}-from`}
								value={from}
								onValueChange={(value) => {
									setFrom(value as typeof from);
									setName(null);
								}}
								className="block"
							>
								<List cap>
									<StartRow
										id={`${id}-blank`}
										value="blank"
										title={<Trans>Blank</Trans>}
										subtitle={<Trans>Opens on your name and contact details. Nothing to fill in first.</Trans>}
									/>
									{copySource && (
										<StartRow
											id={`${id}-copy`}
											value="copy"
											title={<Trans>A copy of “{copySource.name}”</Trans>}
											subtitle={<Trans>Resume · edited {formatRelativeTime(copySource.editedAt, i18n.locale)}</Trans>}
											action={
												<button type="button" className={textActionClassName} onClick={() => setStep("copy")}>
													<Trans>Choose another</Trans>
												</button>
											}
										/>
									)}
									<StartRow
										id={`${id}-import`}
										value="import"
										title={<Trans>Import a PDF, Word or JSON file</Trans>}
										subtitle={<Trans>Anything that can't be placed is listed before you create it.</Trans>}
									/>
								</List>
							</RadioGroup>
						) : (
							<RadioGroup
								aria-labelledby={`${id}-from`}
								value={letterFrom}
								onValueChange={(value) => setLetterFrom(value as typeof letterFrom)}
								className="block"
							>
								<List cap>
									<StartRow
										id={`${id}-blank-letter`}
										value="blank"
										title={<Trans>Blank letter</Trans>}
										subtitle={<Trans>Recipient, date and greeting are filled in. The body is yours.</Trans>}
									/>
									{letterSource && (
										<StartRow
											id={`${id}-from-letter`}
											value="letter"
											title={<Trans>The body of “{letterSource.name}”</Trans>}
											subtitle={<Trans>The new letter keeps its own recipient, date and history.</Trans>}
											action={
												letters.length > 1 && (
													<button
														type="button"
														className={textActionClassName}
														aria-expanded={choosingLetter}
														onClick={() => {
															setLetterFrom("letter");
															setChoosingLetter(true);
														}}
													>
														<Trans>Choose another</Trans>
													</button>
												)
											}
										/>
									)}
								</List>
							</RadioGroup>
						)}
						{kind === "letter" && choosingLetter && letterSource && (
							<NativeSelect
								aria-label={t`Start from an earlier letter`}
								value={letterSource.id}
								disabled={busy}
								onChange={(event) => setLetterSourceId(event.target.value)}
							>
								{letters.map((letter) => (
									<option key={letter.id} value={letter.id}>
										{letter.application ? t`${letter.name} — ${letter.application.company}` : letter.name}
									</option>
								))}
							</NativeSelect>
						)}
					</div>

					{kind === "letter" && (
						<Field id={`${id}-name`} label={<Trans>Name</Trans>}>
							<Input
								ref={nameRef}
								id={`${id}-name`}
								value={name ?? suggestedName}
								maxLength={100}
								onChange={(event) => setName(event.target.value)}
							/>
						</Field>
					)}

					{kind === "resume" && (
						<div className="flex flex-col gap-3">
							<button
								type="button"
								aria-expanded={moreOpen}
								aria-controls={`${id}-more`}
								onClick={() => setMoreOpen((open) => !open)}
								className="flex h-7 items-center gap-2.5 rounded-xs text-start text-sm text-ink-2 hover:text-ink"
							>
								<Icon
									name="caret-right"
									size={16}
									className={cn("transition-[rotate] duration-quick rtl:-scale-x-100", moreOpen && "rotate-90")}
								/>
								<span className="flex-1">
									<Trans>More options</Trans>
								</span>
								{from === "blank" && (
									<span className="text-[13px]/[18px] text-ink-3">
										{languageName} · {PAGE_SIZES[pageSize]}
									</span>
								)}
							</button>
							{moreOpen && (
								<div id={`${id}-more`} className={cn(ENTER_CLASS, "grid gap-4 ps-[26px]")}>
									<Field
										id={`${id}-language`}
										label={<Trans>Resume language</Trans>}
										hint={
											from === "blank" ? (
												<Trans>
													Sets section titles, date words and text direction. Your content isn't translated.
												</Trans>
											) : from === "copy" ? (
												<Trans>A copy keeps the language and page size of the resume it's made from.</Trans>
											) : (
												<Trans>For a file, the language is chosen when you import it.</Trans>
											)
										}
									>
										<Combobox
											id={`${id}-language`}
											className="min-w-0"
											options={[
												{ value: "", label: getLanguageName(localeSchema.parse(i18n.locale)) },
												...getLocaleOptions().filter((option) => option.value !== i18n.locale),
											]}
											value={locale ?? ""}
											disabled={busy || from !== "blank"}
											onValueChange={(value) => setLocale(localeSchema.safeParse(value).data)}
										/>
									</Field>
									<div className="flex flex-col gap-1.5">
										<Label id={`${id}-size`}>
											<Trans>Page size</Trans>
										</Label>
										<SegmentedControl
											aria-labelledby={`${id}-size`}
											value={pageSize}
											disabled={busy || from !== "blank"}
											onValueChange={(value) => setPageSize(value as PageSize)}
											className="w-fit"
										>
											<SegmentedControlItem value="a4">{PAGE_SIZES.a4}</SegmentedControlItem>
											<SegmentedControlItem value="letter">{PAGE_SIZES.letter}</SegmentedControlItem>
										</SegmentedControl>
									</div>
									<div className="flex flex-wrap gap-x-5 gap-y-2">
										<button
											type="button"
											className={textActionClassName}
											disabled={busy}
											onClick={() => void trySample()}
										>
											<Trans>Try with a sample resume</Trans>
										</button>
										<button type="button" className={textActionClassName} onClick={saveJob}>
											<Trans>Save a job instead</Trans>
										</button>
									</div>
								</div>
							)}
						</div>
					)}

					<DialogFooter className="mt-1 sm:items-center">
						{/* Opened from Applications or Career, saving a job is as likely as a document. */}
						{(context === "applications" || context === "career") && !moreOpen && (
							<Button type="button" variant="ghost" className="sm:me-auto" onClick={saveJob}>
								<Trans>Save a job instead</Trans>
							</Button>
						)}
						<Button type="button" variant="ghost" onClick={closeDialog}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={busy || (!importing && finalName.length === 0)}>
							{kind === "letter" ? (
								<Trans>Create letter</Trans>
							) : importing ? (
								<Trans>Continue</Trans>
							) : (
								<Trans>Create resume</Trans>
							)}
						</Button>
					</DialogFooter>
				</form>
			)}
		</Content>
	);
}

type KindCardProps = { id: string; value: "resume" | "letter"; title: ReactNode; description: ReactNode };

/** Resume or Cover letter: a card that is one radio, with the sheet it makes at the start. */
function KindCard({ id, value, title, description }: KindCardProps) {
	return (
		<label
			htmlFor={id}
			className="flex min-w-0 cursor-pointer items-center gap-3.5 rounded-lg bg-raised py-3.5 ps-3.5 pe-4 shadow-[inset_0_0_0_1px_var(--line-2)] transition-[background-color,box-shadow] duration-quick has-data-checked:bg-accent-soft has-data-checked:shadow-[inset_0_0_0_2px_var(--accent)]"
		>
			<DocumentThumb kind={value} className="h-14 w-10" />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="t-label">{title}</span>
				<span className="text-[13px]/[18px] text-ink-3">{description}</span>
			</span>
			<RadioGroupItem id={id} value={value} className="self-start" />
		</label>
	);
}

type StartRowProps = { id: string; value: string; title: ReactNode; subtitle?: ReactNode; action?: ReactNode };

/** One way to start, as a radio row: the whole row chooses it, and its text action stays its own target. */
function StartRow({ id, value, title, subtitle, action }: StartRowProps) {
	return (
		<ListRow
			interactive
			leading={<RadioGroupItem id={id} value={value} />}
			title={
				<label htmlFor={id} className={cn(rowLinkClassName, "block cursor-pointer truncate")}>
					{title}
				</label>
			}
			subtitle={subtitle}
			trailing={action}
		/>
	);
}

type FieldProps = { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode };

function Field({ id, label, hint, children }: FieldProps) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			{children}
			{hint && <p className="text-[13px]/[18px] text-ink-3">{hint}</p>}
		</div>
	);
}

type CopyForJobProps = {
	initialSourceId?: string | undefined;
	initialJobId?: string | undefined;
	onBack: () => void;
	/** Replaces Back when the dialog opened on this step. */
	onCancel?: (() => void) | undefined;
	/** The new resume, and whether it was made for a job. */
	onCreated: (resumeId: string, forJob: boolean) => void;
};

/** The posting cap Applications uses for a saved job's description. */
const MAX_POSTING_CHARS = 20_000;

/**
 * Pick a resume and a job; the copy is named from both and linked to the application. The source starts on the base
 * resume (not a copy made for another job), each source shows the job it was made for, and a job not saved yet can
 * be added here.
 */
function CopyForJob({ initialSourceId, initialJobId, onBack, onCancel, onCreated }: CopyForJobProps) {
	const { i18n } = useLingui();
	const nameId = useId();
	const queryClient = useQueryClient();
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const applications = useQuery(applicationsListQueryOptions());
	const resumes = (documents ?? []).filter((document) => document.type === "resume");
	const jobs = (applications.data ?? []).filter(
		(application) => application.status !== "closed" || application.id === initialJobId,
	);
	const [sourceId, setSourceId] = useState(initialSourceId);
	const [changingSource, setChangingSource] = useState(!initialSourceId);
	const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
	const [adding, setAdding] = useState(false);
	const [allJobs, setAllJobs] = useState(false);
	const [newJob, setNewJob] = useState({ company: "", role: "", posting: "" });
	const [name, setName] = useState<string | null>(null);
	const { mutateAsync: copyForJob, isPending } = useMutation(orpc.documents.copyForJob.mutationOptions());

	// A named resume (the builder's Copy for a job) is the only source until the list has it: never another resume.
	const source = sourceId ? resumes.find((resume) => resume.id === sourceId) : defaultCopySource(resumes);
	const job = adding ? null : jobs.find((application) => application.id === jobId);
	const waitingForJob = !adding && Boolean(jobId) && !job && applications.isFetching;
	const company = adding ? newJob.company.trim() : job?.company;
	// "Product designer · Kiln Studio": a copy of a copy keeps the base name, whichever separator it was named with.
	const base = (source?.name ?? "").split(/ [—·] /)[0] ?? "";
	const suggested = (company ? `${base} · ${company}` : t`${base} (copy)`).slice(0, 100);
	const finalName = (name ?? suggested).trim();
	const newJobReady = !adding || (newJob.company.trim().length > 0 && newJob.role.trim().length > 0);

	const create = async () => {
		if (!source || !newJobReady || waitingForJob) return;
		const pasted = newJob.posting.trim();
		const truncated = pasted.length > MAX_POSTING_CHARS;
		const input = {
			resumeId: source.id,
			...(adding
				? {
						// The job and its copy are saved together, or neither is.
						application: {
							company: newJob.company.trim(),
							role: newJob.role.trim(),
							...(pasted
								? {
										jobDescription: pasted.slice(0, MAX_POSTING_CHARS),
										postingSource: {
											method: "paste" as const,
											format: "text" as const,
											truncated,
											completeness: truncated ? ("incomplete" as const) : ("unknown" as const),
										},
									}
								: {}),
						},
					}
				: jobId
					? { applicationId: jobId }
					: {}),
			...(finalName ? { name: finalName } : {}),
		};
		const linked = adding || Boolean(jobId);
		const message = company ? t`Created and linked to ${company}` : t`Created “${finalName}”`;
		// A retry of the same copy (a lost response, a second press) sends the same ID, so it's made once.
		const key = `copy-for-job:${JSON.stringify(input)}`;
		try {
			const resumeId = await copyForJob({ ...input, newId: pendingRequestId(key) });
			settleRequestId(key);
			if (adding) void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
			toast.add({ description: message });
			onCreated(resumeId, linked);
		} catch (error) {
			toastError(
				error,
				adding ? t`Couldn't save the job and its copy. Try again.` : t`Couldn't copy the resume. Try again.`,
			);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle className="font-display text-[22px]">
					<Trans>Copy a resume for a job</Trans>
				</DialogTitle>
			</DialogHeader>

			<fieldset className="grid gap-1.5">
				<legend className="mb-1.5 text-xs font-medium text-ink-2">
					<Trans>Start from</Trans>
				</legend>
				{documents && resumes.length === 0 && (
					<p className="text-sm text-ink-2">
						<Trans>
							You don't have a resume to copy yet. Import or create a resume first, then return to copy it for this job.
						</Trans>
					</p>
				)}
				{!changingSource && source ? (
					<List cap>
						<ListRow
							leading={<DocumentThumb kind="resume" />}
							title={source.name}
							subtitle={<Trans>Resume · edited {formatEdited(source.editedAt, i18n.locale)} · it stays as it is</Trans>}
							trailing={
								<button type="button" className={textActionClassName} onClick={() => setChangingSource(true)}>
									<Trans>Change</Trans>
								</button>
							}
						/>
					</List>
				) : (
					<div className="grid max-h-56 gap-1 overflow-y-auto">
						{resumes.map((resume) => (
							<label
								key={resume.id}
								className={cn(
									"relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-quick",
									resume.id === source?.id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
								)}
							>
								<input
									type="radio"
									name="copy-source"
									className="sr-only"
									checked={resume.id === source?.id}
									onChange={() => {
										setSourceId(resume.id);
										setName(null);
									}}
								/>
								<Icon name="file-text" className="text-ink-2" />
								<span className="grid min-w-0 flex-1 gap-0.5">
									<span className="truncate text-sm font-medium">{resume.name}</span>
									<span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-3">
										{resume.application ? (
											<span className="inline-flex max-w-full items-center gap-1 truncate rounded-sm bg-sunken px-1.5 py-0.5 text-ink-2">
												<Icon name="briefcase" size={12} />
												<span className="truncate">
													<Trans>Copy for {resume.application.company}</Trans>
												</span>
											</span>
										) : (
											<span className="rounded-sm bg-sunken px-1.5 py-0.5 text-ink-2">
												<Trans>Not linked to a job</Trans>
											</span>
										)}
										<span>{formatRelativeTime(resume.editedAt, i18n.locale)}</span>
									</span>
								</span>
							</label>
						))}
					</div>
				)}
			</fieldset>

			<fieldset className="grid gap-1.5">
				<div className="flex items-baseline justify-between">
					<legend className="text-[13px]/[18px] font-medium text-ink-2">
						<Trans>For which job?</Trans>
					</legend>
					<button
						type="button"
						aria-pressed={adding}
						className={textActionClassName}
						onClick={() => {
							setAdding(true);
							setName(null);
						}}
					>
						<Trans>Add a job</Trans>
					</button>
				</div>
				<RadioGroup
					aria-label={t`For which job?`}
					value={adding ? "" : (jobId ?? "none")}
					onValueChange={(value) => {
						setAdding(false);
						setJobId(value === "none" ? null : (value as string));
						setName(null);
					}}
					className="block"
				>
					<List cap tight>
						{(allJobs || jobs.length <= 4
							? jobs
							: // The chosen job stays in view when the rest fold away.
								jobs.slice(0, 3).concat(jobs.slice(3).filter((application) => application.id === jobId))
						).map((application) => (
							<StartRow
								key={application.id}
								id={`${nameId}-job-${application.id}`}
								value={application.id}
								// Two roles at one company stay apart.
								title={application.role.trim() ? `${application.company} · ${application.role}` : application.company}
								action={<StageDot status={application.status} className="text-[13px]/[18px] text-ink-3" />}
							/>
						))}
						{!allJobs && jobs.length > 4 && (
							<button
								type="button"
								className="flex min-h-11 items-center border-b border-line ps-8 text-[13px]/[18px] text-ink-3 hover:text-ink-2"
								onClick={() => setAllJobs(true)}
							>
								{plural(jobs.length - 3, {
									one: "Show # more application",
									other: "Show # more applications",
								})}
							</button>
						)}
						<StartRow
							id={`${nameId}-job-none`}
							value="none"
							title={<Trans>No job yet</Trans>}
							action={
								<span className="text-[13px]/[18px] text-ink-3">
									<Trans>Link one later</Trans>
								</span>
							}
						/>
					</List>
				</RadioGroup>
				{adding ? (
					<div className={cn(ENTER_CLASS, "grid gap-2 rounded-lg border border-line p-3")}>
						<div className="grid gap-2 sm:grid-cols-2">
							<div className="grid gap-1">
								<label htmlFor={`${nameId}-company`} className="text-xs font-medium text-ink-2">
									<Trans>Company</Trans>
								</label>
								<Input
									id={`${nameId}-company`}
									value={newJob.company}
									maxLength={200}
									required
									onChange={(event) => setNewJob((current) => ({ ...current, company: event.target.value }))}
								/>
							</div>
							<div className="grid gap-1">
								<label htmlFor={`${nameId}-role`} className="text-xs font-medium text-ink-2">
									<Trans>Role</Trans>
								</label>
								<Input
									id={`${nameId}-role`}
									value={newJob.role}
									maxLength={200}
									required
									onChange={(event) => setNewJob((current) => ({ ...current, role: event.target.value }))}
								/>
							</div>
						</div>
						<div className="grid gap-1">
							<label htmlFor={`${nameId}-posting`} className="text-xs font-medium text-ink-2">
								<Trans>Job posting (optional)</Trans>
							</label>
							<Textarea
								id={`${nameId}-posting`}
								rows={3}
								maxLength={100_000}
								value={newJob.posting}
								onChange={(event) => setNewJob((current) => ({ ...current, posting: event.target.value }))}
							/>
						</div>
						<span className="text-xs text-ink-3">
							<Trans>Saved to Applications as a saved job, then linked to the copy. No AI request is made.</Trans>
						</span>
					</div>
				) : null}
			</fieldset>

			<div className="grid gap-1.5">
				<label htmlFor={nameId} className="text-xs font-medium text-ink-2">
					<Trans>Name</Trans>
				</label>
				<Input
					id={nameId}
					value={name ?? suggested}
					maxLength={100}
					onChange={(event) => setName(event.target.value)}
				/>
				<span className="text-[13px]/[18px] text-ink-3">
					{job ? (
						<Trans>
							Suggested from the resume and the job. The copy is linked to the application, so Check and the assistant
							use its posting.
						</Trans>
					) : (
						<Trans>Suggested from the resume. Change it anytime.</Trans>
					)}
				</span>
			</div>

			<div className="flex flex-wrap justify-end gap-2">
				<Button variant="ghost" onClick={documents && resumes.length === 0 ? onBack : (onCancel ?? onBack)}>
					{documents && resumes.length === 0 ? (
						<Trans>Import or create a resume</Trans>
					) : onCancel ? (
						<Trans>Cancel</Trans>
					) : (
						<Trans>Back</Trans>
					)}
				</Button>
				<Button
					disabled={!source || !finalName || finalName.length > 100 || !newJobReady || waitingForJob || isPending}
					onClick={() => void create()}
				>
					{adding ? <Trans>Save job, create and open</Trans> : <Trans>Create and open</Trans>}
				</Button>
			</div>
		</>
	);
}
