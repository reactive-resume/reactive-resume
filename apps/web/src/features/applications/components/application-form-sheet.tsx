import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { Application } from "../types";
import type { FileAttachment, StagedAttachment } from "./file-attachment-field";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { STAGES } from "@reactive-resume/schema/applications/data";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@reactive-resume/ui/components/accordion";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@reactive-resume/ui/components/sheet";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { Combobox } from "@/components/ui/combobox";
import { orpc } from "@/libs/orpc/client";
import { applicationsListQueryKey } from "../queries";
import { FileAttachmentField } from "./file-attachment-field";

// Preset source suggestions surfaced via a <datalist>; the field itself stays free-text.
const SOURCE_OPTIONS = ["LinkedIn", "Indeed", "Company Website", "Referral", "Recruiter", "Other"];
// Mirrors the server-side cap on `applications.ai.autofill`.
const MAX_JOB_DESCRIPTION_CHARS = 20_000;
// ponytail: a paste shorter than this is a snippet, not a posting — don't burn an AI call on it.
const MIN_AUTOFILL_CHARS = 200;
const todayInputValue = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({
	company: "",
	role: "",
	location: "",
	salary: "",
	source: "",
	status: "saved" as ApplicationStatus,
	resumeId: "",
	tags: [] as string[],
	sourceUrl: "",
	stageEnteredAt: todayInputValue(),
	jobDescription: "",
	followUpAt: "",
	followUpNote: "",
	notes: "",
	resumeFile: null as FileAttachment | StagedAttachment | null,
	coverLetter: null as FileAttachment | StagedAttachment | null,
});

type FormState = ReturnType<typeof emptyForm>;

const toAttachment = (url: string | null, name: string | null): FileAttachment | null =>
	url ? { url, name: name ?? url } : null;

// Public file URLs are served as `${APP_URL}/api/uploads/<key>` — the delete route expects the
// bare `uploads/...` key. Mirrors `storageKeyFromApplicationUrl` in the applications service.
const storageKeyFromUrl = (url: string) => {
	const path = new URL(url, window.location.origin).pathname;
	return path.match(/^\/(?:api\/)?(uploads\/.+)$/)?.[1] ?? path.split("/").pop() ?? path;
};

function toForm(app: Application): FormState {
	return {
		company: app.company,
		role: app.role,
		location: app.location ?? "",
		salary: app.salary ?? "",
		source: app.source ?? "",
		status: app.status,
		resumeId: app.resumeId ?? "",
		tags: app.tags,
		sourceUrl: app.sourceUrl ?? "",
		stageEnteredAt: "",
		jobDescription: app.jobDescription ?? "",
		followUpAt: app.followUpAt ? new Date(app.followUpAt).toISOString().slice(0, 10) : "",
		followUpNote: app.followUpNote ?? "",
		notes: app.notes ?? "",
		resumeFile: toAttachment(app.resumeFileUrl, app.resumeFileName),
		coverLetter: toAttachment(app.coverLetterUrl, app.coverLetterName),
	};
}

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// When provided, the sheet edits this application instead of creating a new one.
	application?: Application | null;
};

export function ApplicationFormSheet({ open, onOpenChange, application }: Props) {
	const queryClient = useQueryClient();
	const isEditing = !!application;

	const [form, setForm] = useState<FormState>(() => (application ? toForm(application) : emptyForm()));

	// Re-sync the form when the sheet's target changes (a different app, or create ↔ edit).
	const [syncedId, setSyncedId] = useState(application?.id ?? null);
	if ((application?.id ?? null) !== syncedId) {
		setSyncedId(application?.id ?? null);
		setForm(application ? toForm(application) : emptyForm());
	}

	const { data: resumes } = useQuery(orpc.resume.list.queryOptions());
	const resumeOptions = (resumes ?? []).map((resume) => ({ value: resume.id, label: resume.name }));

	const { data: allTags } = useQuery(orpc.applications.tags.queryOptions());

	// Same gate as the rest of the AI surfaces: at least one enabled provider that tested green.
	const { data: providers } = useQuery(orpc.aiProviders.list.queryOptions());
	const aiEnabled = providers?.some((provider) => provider.enabled && provider.testStatus === "success") ?? false;

	const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
		setForm((prev) => ({ ...prev, [key]: value }));

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.applications.stats.queryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.applications.tags.queryKey() });
		if (application) {
			void queryClient.invalidateQueries({
				queryKey: orpc.applications.getById.queryKey({ input: { id: application.id } }),
			});
		}
	};

	// Storage mutations are only fired from submit(): picks stay staged in the form until the
	// record write succeeds, and removals are deleted only after the record stops referencing
	// them, so cancelling the sheet never mutates storage (and never leaves a broken reference).
	const upload = useMutation(orpc.storage.uploadFile.mutationOptions({ meta: { noInvalidate: true } }));
	const removeFile = useMutation(orpc.storage.deleteFile.mutationOptions({ meta: { noInvalidate: true } }));

	// Public URLs of files pushed to storage during a save attempt. If the sheet closes without
	// a committed save, they would be orphaned — so a cancelled close deletes them best-effort.
	const sessionUploads = useRef(new Set<string>());
	const savingRef = useRef(false);

	const create = useMutation(
		orpc.applications.create.mutationOptions({
			onSuccess: () => {
				invalidate();
				toast.add({ type: "success", description: t`Application added to your pipeline.` });
			},
			onError: () => toast.add({ type: "error", description: t`Couldn't add the application. Please try again.` }),
		}),
	);

	const update = useMutation(
		orpc.applications.update.mutationOptions({
			onSuccess: () => {
				invalidate();
				toast.add({ type: "success", description: t`Application updated.` });
			},
			onError: () => toast.add({ type: "error", description: t`Couldn't save your changes. Please try again.` }),
		}),
	);

	const autofill = useMutation(
		orpc.applications.ai.autofill.mutationOptions({
			onSuccess: (result) => {
				setForm((prev) => ({
					...prev,
					company: result.company || prev.company,
					role: result.role || prev.role,
					location: result.location || prev.location,
					salary: result.salary || prev.salary,
				}));
				toast.add({ type: "success", description: t`Filled in what we could from the posting.` });
			},
			onError: (error) => toast.add({ type: "error", description: error.message || t`Auto-fill failed.` }),
		}),
	);

	const runAutofill = (jobDescription: string) => {
		const posting = jobDescription.trim();
		if (posting.length < MIN_AUTOFILL_CHARS || autofill.isPending) return;
		autofill.mutate({ jobDescription: posting.slice(0, MAX_JOB_DESCRIPTION_CHARS) });
	};

	const pending = create.isPending || update.isPending || upload.isPending;

	const stageAttachment = (key: "resumeFile" | "coverLetter", file: File | null) => {
		// Object URL doubles as the preview link while the pick stays staged.
		const next = file ? { url: URL.createObjectURL(file), name: file.name, file } : null;
		setForm((prev) => {
			const prior = prev[key];
			if (prior && "file" in prior) URL.revokeObjectURL(prior.url);
			return { ...prev, [key]: next };
		});
	};

	const deleteStoredFile = (url: string) => {
		removeFile.mutate(
			{ filename: storageKeyFromUrl(url) },
			{
				onError: () =>
					toast.add({
						type: "warning",
						description: t`The file could not be removed from storage. Your application is up to date.`,
					}),
			},
		);
	};

	// Drops staged picks and session uploads that never made it into a saved record.
	const discardPendingFiles = () => {
		for (const url of sessionUploads.current) deleteStoredFile(url);
		sessionUploads.current.clear();
		for (const attachment of [form.resumeFile, form.coverLetter]) {
			if (attachment && "file" in attachment) URL.revokeObjectURL(attachment.url);
		}
	};

	// Latest-render ref: the cleanup below must see the session's current state without
	// re-firing on every render — re-firing would delete in-flight uploads mid-save.
	const discardRef = useRef(discardPendingFiles);
	useEffect(() => {
		discardRef.current = discardPendingFiles;
	});

	// Covers unmount mid-edit (e.g. navigating away): the sheet is modal, so its target can't
	// change while open, and every in-UI close routes through handleOpenChange which already
	// discards — only abandonment reaches this cleanup. Skipped while a commit is in flight:
	// submit() still owns cleanup of its own uploads even after unmount.
	useEffect(() => {
		return () => {
			if (!savingRef.current) discardRef.current();
		};
	}, []);

	const uploadStaged = async (attachment: FileAttachment | StagedAttachment | null): Promise<FileAttachment | null> => {
		if (!attachment || !("file" in attachment)) return attachment;
		let url: string;
		try {
			({ url } = await upload.mutateAsync(attachment.file));
		} catch {
			toast.add({ type: "error", description: t`Couldn't upload the file. Please try again.` });
			throw new Error("upload failed");
		}
		sessionUploads.current.add(url);
		URL.revokeObjectURL(attachment.url);
		return { url, name: attachment.name };
	};

	const submit = async () => {
		if (!form.company.trim() || !form.role.trim() || savingRef.current) return;
		savingRef.current = true;
		try {
			// Upload staged picks first so the payload carries real storage URLs.
			const [resumeFile, coverLetter] = await Promise.all([
				uploadStaged(form.resumeFile),
				uploadStaged(form.coverLetter),
			]);
			setForm((prev) => ({ ...prev, resumeFile, coverLetter }));
			const payload = {
				company: form.company.trim(),
				role: form.role.trim(),
				status: form.status,
				location: form.location.trim() || null,
				salary: form.salary.trim() || null,
				source: form.source.trim() || null,
				resumeId: form.resumeId || null,
				tags: form.tags,
				sourceUrl: form.sourceUrl.trim() || null,
				jobDescription: form.jobDescription.trim() || null,
				notes: form.notes.trim() || null,
				followUpNote: form.followUpNote.trim() || null,
				followUpAt: form.followUpAt ? new Date(form.followUpAt) : null,
				resumeFileUrl: resumeFile?.url ?? null,
				resumeFileName: resumeFile?.name ?? null,
				coverLetterUrl: coverLetter?.url ?? null,
				coverLetterName: coverLetter?.name ?? null,
			};
			if (application) await update.mutateAsync({ id: application.id, ...payload });
			else await create.mutateAsync({ ...payload, stageEnteredAt: form.stageEnteredAt || undefined });

			// The record now owns the committed URLs — drop whatever it no longer references:
			// attachments removed in this edit and uploads superseded by a later pick.
			const kept = new Set([resumeFile?.url, coverLetter?.url].filter((url): url is string => !!url));
			for (const url of [application?.resumeFileUrl, application?.coverLetterUrl]) {
				if (url && !kept.has(url)) deleteStoredFile(url);
			}
			for (const url of sessionUploads.current) {
				if (!kept.has(url)) deleteStoredFile(url);
			}
			sessionUploads.current.clear();
			if (!application) setForm(emptyForm());
			onOpenChange(false);
		} catch {
			// The mutation's own onError already surfaced a toast; stay open so the user can retry.
		} finally {
			savingRef.current = false;
		}
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			// A commit is mid-flight; submit() closes the sheet itself once storage settles.
			if (savingRef.current) return;
			discardPendingFiles();
			// The sheet stays mounted while closed, so a cancelled pick (or an uploaded-but-
			// unsaved file) would otherwise linger in the form as a draft pointing at a blob URL
			// or a storage key that discard just deleted. Restore what the record references.
			setForm((prev) => ({
				...prev,
				resumeFile: application ? toAttachment(application.resumeFileUrl, application.resumeFileName) : null,
				coverLetter: application ? toAttachment(application.coverLetterUrl, application.coverLetterName) : null,
			}));
		}
		onOpenChange(nextOpen);
	};

	return (
		<Sheet open={open} onOpenChange={handleOpenChange}>
			<SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-lg">
				<SheetHeader>
					<SheetTitle>{isEditing ? <Trans>Edit application</Trans> : <Trans>Add application</Trans>}</SheetTitle>
					<SheetDescription>
						{isEditing ? (
							<Trans>Update this application's details.</Trans>
						) : (
							<Trans>Track a job you're applying to and link the resume you sent.</Trans>
						)}
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 [&>*]:shrink-0">
					{/* Pasted job description: stored with the application and used for every AI action.
					    Collapsed by default so the form stays short; hidden entirely when AI is off. */}
					{aiEnabled && (
						<Accordion className="rounded-lg border border-border border-dashed px-3">
							<AccordionItem value="job-description">
								<AccordionTrigger>
									<span className="flex items-center gap-1.5">
										<SparkleIcon className="text-primary" />
										<Trans>Job description</Trans>
									</span>
								</AccordionTrigger>
								<AccordionContent className="flex flex-col gap-2">
									<p className="text-muted-foreground text-xs">
										<Trans>
											Copy the entire job description from the posting and paste it below. We'll fill in the fields for
											you and keep the text with this application for match scoring and tailoring.
										</Trans>
									</p>
									<Textarea
										// Fixed height: the accordion panel measures its content once, so a textarea that
										// grew with the pasted text would overflow the clipped panel.
										className="field-sizing-fixed h-40"
										value={form.jobDescription}
										rows={8}
										maxLength={MAX_JOB_DESCRIPTION_CHARS}
										placeholder={t`Paste the full job description here…`}
										onChange={(event) => set("jobDescription", event.target.value)}
										onPaste={(event) => runAutofill(event.clipboardData.getData("text"))}
									/>
									<div className="flex items-center justify-between gap-2">
										<p className="text-[11px] text-muted-foreground">
											{autofill.isPending ? (
												<Trans>Reading the posting…</Trans>
											) : (
												<Trans>Pasting fills the fields automatically.</Trans>
											)}
										</p>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={form.jobDescription.trim().length < MIN_AUTOFILL_CHARS || autofill.isPending}
											onClick={() => runAutofill(form.jobDescription)}
										>
											<SparkleIcon />
											<Trans>Fill fields</Trans>
										</Button>
									</div>
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					)}

					<Field label={t`Company`} required>
						<Input value={form.company} onChange={(event) => set("company", event.target.value)} />
					</Field>
					<Field label={t`Role / title`} required>
						<Input value={form.role} onChange={(event) => set("role", event.target.value)} />
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field label={t`Location`}>
							<Input
								value={form.location}
								list="application-locations"
								placeholder={t`Remote, Hybrid, a city…`}
								onChange={(event) => set("location", event.target.value)}
							/>
							<datalist id="application-locations">
								<option value="Remote" />
								<option value="Hybrid" />
								<option value="In-office" />
							</datalist>
						</Field>
						<Field label={t`Salary range`}>
							<Input value={form.salary} onChange={(event) => set("salary", event.target.value)} />
						</Field>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<Field label={t`Source`}>
							<Input
								value={form.source}
								list="application-sources"
								placeholder={t`LinkedIn, Referral…`}
								onChange={(event) => set("source", event.target.value)}
							/>
							<datalist id="application-sources">
								{SOURCE_OPTIONS.map((option) => (
									<option key={option} value={option} />
								))}
							</datalist>
						</Field>
						<Field label={t`Stage`}>
							<Combobox
								className="w-full"
								value={form.status}
								options={STAGES.map((s) => ({ value: s.value, label: s.label }))}
								onValueChange={(value) => value && set("status", value)}
							/>
						</Field>
					</div>

					<Field label={t`Job posting link`}>
						<Input
							type="url"
							value={form.sourceUrl}
							placeholder="https://…"
							onChange={(event) => set("sourceUrl", event.target.value)}
						/>
					</Field>

					{!isEditing && (
						<Field label={t`Stage date`}>
							<Input
								type="date"
								value={form.stageEnteredAt}
								onChange={(event) => set("stageEnteredAt", event.target.value)}
							/>
						</Field>
					)}

					{/* Resume: link a live Reactive Resume (unlocks AI) or upload the exact PDF you sent. */}
					<Field label={t`Resume`}>
						<div className="flex flex-col gap-2">
							<Combobox
								className="w-full"
								value={form.resumeId || null}
								options={resumeOptions}
								placeholder={t`Link a Reactive Resume (recommended)`}
								showClear
								emptyMessage={t`No resumes yet.`}
								onValueChange={(value) => set("resumeId", value ?? "")}
							/>
							<FileAttachmentField
								value={form.resumeFile}
								attachLabel={t`Or upload a resume PDF`}
								disabled={pending}
								onChange={(file) => stageAttachment("resumeFile", file)}
							/>
							<p className="text-[11px] text-muted-foreground">
								<Trans>Link a Reactive Resume to use AI match scoring and tailoring.</Trans>
							</p>
						</div>
					</Field>

					<Field label={t`Cover letter`}>
						<FileAttachmentField
							value={form.coverLetter}
							attachLabel={t`Attach a cover letter (PDF)`}
							disabled={pending}
							onChange={(file) => stageAttachment("coverLetter", file)}
						/>
					</Field>

					<Field label={t`Tags`}>
						<TagsField value={form.tags} suggestions={allTags ?? []} onChange={(tags) => set("tags", tags)} />
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field label={t`Follow-up date`}>
							<Input type="date" value={form.followUpAt} onChange={(event) => set("followUpAt", event.target.value)} />
						</Field>
						<Field label={t`Follow-up note`}>
							<Input value={form.followUpNote} onChange={(event) => set("followUpNote", event.target.value)} />
						</Field>
					</div>

					<Field label={t`Notes`}>
						<Textarea
							value={form.notes}
							rows={3}
							placeholder={t`Referred by…, things to emphasize, etc.`}
							onChange={(event) => set("notes", event.target.value)}
						/>
					</Field>
				</div>

				<SheetFooter className="flex-row justify-end gap-2">
					<Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="button" disabled={!form.company.trim() || !form.role.trim() || pending} onClick={submit}>
						{isEditing ? <Trans>Save changes</Trans> : <Trans>Add to pipeline</Trans>}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
	return (
		<div className="grid gap-1.5">
			<Label className="text-muted-foreground text-xs">
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			{children}
		</div>
	);
}

type TagsFieldProps = {
	value: string[];
	suggestions: string[];
	onChange: (tags: string[]) => void;
};

// Type-and-Enter tag input with chips + an autocomplete datalist of the user's existing tags.
function TagsField({ value, suggestions, onChange }: TagsFieldProps) {
	const [draft, setDraft] = useState("");

	const add = () => {
		const tag = draft.trim();
		if (!tag || value.includes(tag)) {
			setDraft("");
			return;
		}
		onChange([...value, tag]);
		setDraft("");
	};

	return (
		<div className="flex flex-col gap-2">
			<Input
				value={draft}
				list="application-tags"
				placeholder={t`Add a tag and press Enter…`}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						add();
					}
				}}
				onBlur={add}
			/>
			<datalist id="application-tags">
				{suggestions.map((tag) => (
					<option key={tag} value={tag} />
				))}
			</datalist>
			{value.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{value.map((tag) => (
						<span
							key={tag}
							className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs"
						>
							{tag}
							<button
								type="button"
								title={t`Remove tag`}
								className="hover:text-destructive"
								onClick={() => onChange(value.filter((t) => t !== tag))}
							>
								<XIcon className="size-3" />
							</button>
						</span>
					))}
				</div>
			)}
		</div>
	);
}
