import type { ImportKind } from "@/features/resume/import/read-file";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { generateRandomName } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { useNewDocumentsStore } from "./new-documents";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { detectImportKind, ImportError, readResumeFile, summarizeImport } from "@/features/resume/import/read-file";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { formatRelativeTime } from "@/libs/locale";
import { ENTER_CLASS, POP_CLASS } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

export type NewDocumentDialogData = {
	/** Open on a step other than the three choices. */
	step?: "copy";
	/** Copy for a job: the resume to start from. */
	sourceResumeId?: string;
	/** Copy for a job: the application it's for. */
	applicationId?: string;
	/** A file dropped on the page, imported straight away. */
	file?: File;
};

type Step =
	| { name: "choose" }
	| { name: "importing"; file: File; stage: number; notes: string[] }
	| { name: "imported"; file: File; resumeId: string; sections: number; entries: number; flagged: number }
	| { name: "failed"; file: File; message: string }
	| { name: "copy" };

type OpenResumeOptions = { withAssistant?: boolean; importedFrom?: string };

const ACCEPT = ".pdf,.docx,.json,.zip,application/pdf,application/json,application/zip";

const formatSize = (bytes: number) =>
	bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function requireImportKind(kind: ImportKind | null): ImportKind {
	if (!kind) {
		throw new ImportError(
			t`This file type can't be imported. Use a PDF, Word, Reactive Resume or JSON Resume file, or a LinkedIn export (.zip).`,
		);
	}
	return kind;
}

/** Runs an import and reports each stage into the dialog's step; a newer run or a cancel drops the older one's updates. */
function useResumeImport(
	setStep: Dispatch<SetStateAction<Step>>,
	openLetter: (coverLetterId: string) => void,
	applicationId?: string,
) {
	const queryClient = useQueryClient();
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const { hasUsableProvider } = useHasUsableAiProvider();
	const run = useRef(0);
	const refreshDocuments = () => queryClient.invalidateQueries({ queryKey: orpc.documents.key() });

	const importFile = async (file: File) => {
		const attempt = ++run.current;
		const current = () => run.current === attempt;
		const advance = (stage: number, note: string) => {
			const index = stage - 1;
			setStep((previous) =>
				previous.name === "importing" && current()
					? { ...previous, stage, notes: Object.assign([...previous.notes], { [index]: note }) }
					: previous,
			);
		};

		setStep({ name: "importing", file, stage: 0, notes: [] });
		try {
			const kind = requireImportKind(await detectImportKind(file));

			if (kind === "cover-letter-json") {
				const letter = await client.coverLetters.import({ document: JSON.parse(await file.text()) });
				if (!current()) return;
				markNew(letter.id);
				void refreshDocuments();
				toast.add({ description: t`Cover letter imported` });
				openLetter(letter.id);
				return;
			}

			const resume = await readResumeFile(file, kind, {
				aiAvailable: hasUsableProvider,
				onRead: (note) => advance(1, note),
			});
			if (!current()) return;
			const summary = summarizeImport(resume);
			advance(1, t`file read`);
			advance(2, t`${summary.sections} sections`);

			const resumeId = await client.resume.import({ data: resume });
			if (!current()) return;
			if (applicationId) await client.documents.linkApplication({ type: "resume", id: resumeId, applicationId });
			if (!current()) return;
			markNew(resumeId);
			void refreshDocuments();
			setStep({ name: "imported", file, resumeId, ...summary });
		} catch (error) {
			if (!current()) return;
			const message =
				error instanceof ImportError
					? error.message
					: getOrpcErrorMessage(error, {
							byCode: {
								BAD_REQUEST: t`The file couldn't be read as a resume.`,
								BAD_GATEWAY: t`Couldn't reach the AI provider. Try again in a moment.`,
							},
							fallback: t`Something went wrong while importing. Try again, or start blank.`,
						});
			setStep({ name: "failed", file, message });
		}
	};

	const cancel = () => {
		run.current++;
		setStep({ name: "choose" });
	};

	return { importFile, cancel, refreshDocuments };
}

/**
 * New: import a file, copy a resume for a job, or start blank; no name, slug or tags are asked for first.
 * Importing shows three labelled steps rather than a spinner, so a slow parse still looks like progress.
 */
export function NewDocumentDialog({ data }: { data?: NewDocumentDialogData | undefined }) {
	const navigate = useNavigate();
	const { hasUsableProvider } = useHasUsableAiProvider();
	const closeDialog = useDialogStore((state) => state.closeDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const [step, setStep] = useState<Step>({ name: data?.step ?? "choose" } as Step);
	const inputRef = useRef<HTMLInputElement>(null);

	// A copy made for a job opens with the assistant ready to tailor it.
	const openResume = (resumeId: string, { withAssistant = false, importedFrom }: OpenResumeOptions = {}) => {
		closeDialog();
		void navigate({
			to: "/builder/$resumeId",
			params: { resumeId },
			search: {
				...(withAssistant ? { assistant: "new" } : {}),
				...(importedFrom ? { imported: importedFrom } : {}),
			},
		});
	};
	const openLetter = (coverLetterId: string) => {
		closeDialog();
		void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId } });
	};

	const { importFile, cancel, refreshDocuments } = useResumeImport(setStep, openLetter, data?.applicationId);

	// A file dropped on the page starts importing as soon as the dialog opens.
	const dropped = useRef(data?.file);
	useEffect(() => {
		if (!dropped.current) return;
		const file = dropped.current;
		dropped.current = undefined;
		void importFile(file);
	});

	const { startBlank, trySample, newLetter, creating } = useStartDocument(data?.applicationId);

	const chooseFile = () => inputRef.current?.click();

	return (
		<DialogContent className="sm:max-w-[640px]">
			<input
				ref={inputRef}
				type="file"
				accept={ACCEPT}
				className="hidden"
				aria-label={t`Choose a file to import`}
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) void importFile(file);
				}}
			/>
			{/* Each step fades up into place as it replaces the last; the dialog's height changes in the same frame. */}
			{step.name === "copy" ? (
				<div key="copy" className={cn(ENTER_CLASS, "grid gap-4")}>
					<CopyForJob
						initialSourceId={data?.sourceResumeId}
						initialJobId={data?.applicationId}
						onBack={() => setStep({ name: "choose" })}
						onCreated={(resumeId, forJob) => {
							markNew(resumeId);
							void refreshDocuments();
							openResume(resumeId, { withAssistant: forJob && hasUsableProvider });
						}}
					/>
				</div>
			) : step.name !== "choose" ? (
				<ImportStep
					key="progress"
					step={step}
					creating={creating}
					onCancel={cancel}
					onStartBlank={() => void startBlank()}
					onChooseFile={chooseFile}
					onClose={closeDialog}
					onOpen={(resumeId, importedFrom) => openResume(resumeId, { importedFrom })}
				/>
			) : (
				<div key="choose" className={cn(ENTER_CLASS, "grid gap-4")}>
					<DialogHeader>
						<DialogTitle className="font-display text-[22px] font-medium">
							<Trans>New document</Trans>
						</DialogTitle>
						<DialogDescription className="sr-only">
							<Trans>Import a resume, copy one for a job, or start blank.</Trans>
						</DialogDescription>
					</DialogHeader>

					<button
						type="button"
						onClick={chooseFile}
						onDragOver={(event) => event.preventDefault()}
						onDrop={(event) => {
							event.preventDefault();
							const file = event.dataTransfer.files[0];
							if (file) void importFile(file);
						}}
						className="flex items-start gap-4 rounded-xl border-[1.5px] border-dashed border-line-2 p-5 text-start transition-[background-color,border-color,scale] duration-quick ease-enter hover:border-accent hover:bg-accent-soft active:scale-[0.98]"
					>
						<span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-2">
							<Icon name="upload_file" size={24} />
						</span>
						<span className="grid gap-1">
							<span className="text-[15px] font-semibold">
								<Trans>Import a resume</Trans>
							</span>
							<span className="text-[13px] leading-[19px] text-ink-2">
								<Trans>
									Drop a file here or browse. PDF, Word, Reactive Resume or JSON Resume. We fill in every section and
									flag anything we're unsure of.
								</Trans>
							</span>
						</span>
					</button>

					<div className="grid gap-3 sm:grid-cols-2">
						<ChoiceTile
							icon="content_copy"
							title={t`Copy a resume for a job`}
							description={t`Start from one you have and link the application.`}
							onClick={() => setStep({ name: "copy" })}
						/>
						<ChoiceTile
							icon="note_add"
							title={t`Start blank`}
							description={t`Opens the editor on your name. Nothing else to fill in first.`}
							disabled={creating}
							onClick={() => void startBlank()}
						/>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[13px]">
						<button
							type="button"
							className="flex items-center gap-1.5 text-ink-2 hover:text-ink"
							onClick={() => void newLetter()}
						>
							<Icon name="mail" size={18} />
							<Trans>New cover letter instead</Trans>
						</button>
						<button
							type="button"
							className="text-ink-2 underline underline-offset-2 hover:text-ink"
							disabled={creating}
							onClick={() => void trySample()}
						>
							<Trans>Try with a sample resume</Trans>
						</button>
					</div>
				</div>
			)}
		</DialogContent>
	);
}

type ImportStepProps = {
	step: Extract<Step, { name: "importing" | "imported" | "failed" }>;
	creating: boolean;
	onCancel: () => void;
	onStartBlank: () => void;
	onChooseFile: () => void;
	onClose: () => void;
	onOpen: (resumeId: string, importedFrom: string) => void;
};

/** The import's progress, then its outcome: found counts with Open in editor, or the error with a way forward. */
function ImportStep({ step, creating, onCancel, onStartBlank, onChooseFile, onClose, onOpen }: ImportStepProps) {
	return (
		<div className={cn(ENTER_CLASS, "grid gap-4")}>
			<DialogHeader>
				<DialogTitle className="font-display text-[22px] font-medium">
					{step.name === "failed" ? (
						<Trans>Couldn't import</Trans>
					) : step.name === "imported" ? (
						<Trans>Imported</Trans>
					) : (
						<Trans>Importing</Trans>
					)}
				</DialogTitle>
			</DialogHeader>
			<div className="flex items-center gap-3 rounded-[10px] border border-line p-3">
				<Icon
					name={step.file.name.toLowerCase().endsWith(".pdf") ? "picture_as_pdf" : "description"}
					className="text-ink-2"
				/>
				<span className="grid min-w-0 flex-1">
					<span className="truncate text-sm font-medium">{step.file.name}</span>
					<span className="text-xs text-ink-3">{formatSize(step.file.size)}</span>
				</span>
				{step.name === "importing" && (
					<Button variant="ghost" size="sm" onClick={onCancel}>
						<Trans>Cancel</Trans>
					</Button>
				)}
			</div>

			{/* One ImportProgress for importing and imported, so its checks don't replay when the import finishes. */}
			{step.name !== "failed" && (
				<ImportProgress
					stage={step.name === "imported" ? 3 : step.stage}
					notes={
						step.name === "imported"
							? [t`file read`, t`${step.sections} sections`, t`${step.entries} entries`]
							: step.notes
					}
				/>
			)}

			{step.name === "failed" && (
				<>
					<div
						role="alert"
						className={cn(
							ENTER_CLASS,
							"flex gap-2.5 rounded-[10px] bg-danger-soft p-3 text-[13px] leading-[19px] text-danger-text",
						)}
					>
						<Icon name="error" size={20} />
						<span>{step.message}</span>
					</div>
					<div className={cn(ENTER_CLASS, "flex flex-wrap justify-end gap-2")}>
						<Button variant="secondary" onClick={onStartBlank} disabled={creating}>
							<Trans>Start blank</Trans>
						</Button>
						<Button onClick={onChooseFile}>
							<Trans>Choose another file</Trans>
						</Button>
					</div>
				</>
			)}

			{step.name === "imported" && (
				<>
					<p role="status" className={cn(ENTER_CLASS, "flex gap-2 text-[13px] leading-[19px]")}>
						<Icon
							name="check_circle"
							size={20}
							className="text-accent-text transition-[opacity,scale] duration-standard ease-enter starting:scale-80 starting:opacity-0"
						/>
						<span>
							<Trans>
								{step.sections} sections and {step.entries} entries found.
							</Trans>{" "}
							{step.flagged > 0 && <Trans>{step.flagged} fields are flagged for a quick look in the editor.</Trans>}
						</span>
					</p>
					<div className={cn(ENTER_CLASS, "flex flex-wrap justify-end gap-2")}>
						<Button variant="secondary" onClick={onClose}>
							<Trans>Stay here</Trans>
						</Button>
						<Button onClick={() => onOpen(step.resumeId, step.file.name)}>
							<Trans>Open in editor</Trans>
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

/** Start blank, try a sample, or a new letter: each creates the document at once and opens it. */
export function useStartDocument(applicationId?: string) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const closeDialog = useDialogStore((state) => state.closeDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const { mutateAsync: createResume, isPending: creating } = useMutation(orpc.resume.create.mutationOptions());
	const { mutateAsync: createLetter } = useMutation(orpc.coverLetters.create.mutationOptions());

	const created = async (id: string, type: "resume" | "letter") => {
		if (applicationId) await client.documents.linkApplication({ type, id, applicationId });
		markNew(id);
		void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
		if (applicationId) void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
		closeDialog();
	};
	const failed = (error: unknown) =>
		toast.add({
			type: "error",
			description: getOrpcErrorMessage(error, { fallback: t`Couldn't create the document.` }),
		});

	return {
		creating,
		startBlank: async () => {
			try {
				const resumeId = await createResume({
					name: t`Untitled resume`,
					tags: [],
					autoName: true,
					withSampleData: false,
				});
				await created(resumeId, "resume");
				void navigate({ to: "/builder/$resumeId", params: { resumeId } });
			} catch (error) {
				failed(error);
			}
		},
		trySample: async () => {
			try {
				const resumeId = await createResume({ name: generateRandomName(), tags: [], withSampleData: true });
				await created(resumeId, "resume");
				toast.add({ description: t`Sample resume added. Delete it anytime.` });
				void navigate({ to: "/builder/$resumeId", params: { resumeId } });
			} catch (error) {
				failed(error);
			}
		},
		newLetter: async () => {
			// A new letter takes its sender details and design from the resume edited most recently.
			const documents = queryClient.getQueryData(orpc.documents.list.queryKey({ input: { trashed: false } }));
			const resume = documents
				?.filter((document) => document.type === "resume")
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
			const input = {
				name: t`Untitled letter`,
				recipient: "",
				content: "",
				...(resume ? { resumeId: resume.id } : {}),
			};
			try {
				const letter = await createLetter(input);
				await created(letter.id, "letter");
				void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: letter.id } });
			} catch (error) {
				failed(error);
			}
		},
	};
}

type ChoiceTileProps = {
	icon: "content_copy" | "note_add";
	title: string;
	description: string;
	onClick: () => void;
	disabled?: boolean;
};

function ChoiceTile({ icon, title, description, onClick, disabled }: ChoiceTileProps) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="flex items-start gap-3 rounded-xl border border-line p-4 text-start transition-[background-color,border-color,scale] duration-quick ease-enter hover:border-line-2 hover:bg-hover enabled:active:scale-[0.97] disabled:opacity-60"
		>
			<Icon name={icon} size={22} className="mt-0.5 text-ink-2" />
			<span className="grid gap-0.5">
				<span className="text-sm font-semibold">{title}</span>
				<span className="text-[13px] leading-[18px] text-ink-2">{description}</span>
			</span>
		</button>
	);
}

/** Reading the file → Finding sections → Filling in entries, each with a note once done. */
function ImportProgress({ stage, notes }: { stage: number; notes: string[] }) {
	const steps = [t`Reading the file`, t`Finding sections`, t`Filling in entries`];

	return (
		<div className="grid gap-3">
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
								<Icon name="check_circle" size={18} className={cn(POP_CLASS, "text-accent-text")} />
							) : current ? (
								<Spinner decorative className={cn(POP_CLASS, "size-[18px]")} />
							) : (
								<span className="size-[18px] rounded-full border-[1.5px] border-line-2" />
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
				className="h-1 overflow-hidden rounded-full bg-sunken"
			>
				<div
					className="h-full translate-x-(--fill) bg-accent transition-[translate] duration-standard ease-enter rtl:-translate-x-(--fill)"
					style={{ "--fill": `${(stage / 3) * 100 - 100}%` } as CSSProperties}
				/>
			</div>
		</div>
	);
}

type CopyForJobProps = {
	initialSourceId?: string | undefined;
	initialJobId?: string | undefined;
	onBack: () => void;
	/** The new resume, and whether it was made for a job. */
	onCreated: (resumeId: string, forJob: boolean) => void;
};

/** Pick a resume and a job; the copy is named from both and linked to the application. */
function CopyForJob({ initialSourceId, initialJobId, onBack, onCreated }: CopyForJobProps) {
	const { i18n } = useLingui();
	const nameId = useId();
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const resumes = (documents ?? []).filter((document) => document.type === "resume");
	const jobs = (applications ?? []).filter((application) => application.status !== "closed");
	const [sourceId, setSourceId] = useState(initialSourceId);
	const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
	const [name, setName] = useState<string | null>(null);
	const { mutateAsync: copyForJob, isPending } = useMutation(orpc.documents.copyForJob.mutationOptions());

	const source = resumes.find((resume) => resume.id === sourceId) ?? resumes[0];
	const job = jobs.find((application) => application.id === jobId);
	const base = (source?.name ?? "").split(" — ")[0] ?? "";
	const suggested = job ? `${base} — ${job.company}` : t`${base} (copy)`;
	const finalName = (name ?? suggested).trim();

	const create = async () => {
		if (!source) return;
		const input = {
			resumeId: source.id,
			...(job ? { applicationId: job.id } : {}),
			...(finalName ? { name: finalName } : {}),
		};
		const message = job ? t`Created and linked to ${job.company}` : t`Created “${finalName}”`;
		try {
			const resumeId = await copyForJob(input);
			toast.add({ description: message });
			onCreated(resumeId, Boolean(job));
		} catch (error) {
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't copy the resume.` }) });
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle className="font-display text-[22px] font-medium">
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
				<div className="grid max-h-56 gap-1 overflow-y-auto">
					{resumes.map((resume) => (
						<label
							key={resume.id}
							className={cn(
								"flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-colors duration-quick",
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
							<Icon name="description" className="text-ink-2" />
							<span className="grid min-w-0 flex-1">
								<span className="truncate text-sm font-medium">{resume.name}</span>
								<span className="text-xs text-ink-3">{formatRelativeTime(resume.updatedAt, i18n.locale)}</span>
							</span>
						</label>
					))}
				</div>
			</fieldset>

			<fieldset className="grid gap-1.5">
				<legend className="mb-1.5 text-xs font-medium text-ink-2">
					<Trans>For which job?</Trans>
				</legend>
				<div className="flex flex-wrap gap-1.5">
					{[
						...jobs.map((application) => ({ id: application.id, label: application.company })),
						{ id: null, label: t`No job yet` },
					].map((option) => (
						<button
							key={option.id ?? "none"}
							type="button"
							aria-pressed={jobId === option.id}
							onClick={() => {
								setJobId(option.id);
								setName(null);
							}}
							className={cn(
								"flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-[background-color,border-color,color,scale] duration-quick ease-enter active:scale-[0.97]",
								jobId === option.id
									? "border-accent bg-accent-soft text-accent-text"
									: "border-line-2 text-ink-2 hover:bg-hover",
							)}
						>
							{option.id && <Icon name="work" size={16} />}
							{option.label}
						</button>
					))}
				</div>
				{job && (
					<span className="text-xs text-ink-3">
						<Trans>The copy is linked to the application, so Check and the assistant use its posting.</Trans>
					</span>
				)}
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
				<span className="text-xs text-ink-3">
					<Trans>Suggested from the source and the job. Change it anytime.</Trans>
				</span>
			</div>

			<div className="flex flex-wrap justify-end gap-2">
				<Button variant="ghost" onClick={onBack}>
					{documents && resumes.length === 0 ? <Trans>Import or create a resume</Trans> : <Trans>Back</Trans>}
				</Button>
				<Button disabled={!source || !finalName || isPending} onClick={() => void create()}>
					<Trans>Create and open</Trans>
				</Button>
			</div>
		</>
	);
}
