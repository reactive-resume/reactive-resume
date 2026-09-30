import type { Application } from "../types";
import type { FileAttachment } from "./file-attachment-field";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { STAGES } from "@reactive-resume/schema/applications/data";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@reactive-resume/ui/components/accordion";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
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
import { applicationsListQueryKey } from "../queries";
import { FileAttachmentField } from "./file-attachment-field";
import { Combobox } from "@/components/ui/combobox";
import { useClosingValue } from "@/hooks/use-closing-value";
import { isImeComposing } from "@/libs/keyboard";
import { orpc } from "@/libs/orpc/client";

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
	resumeFile: null as FileAttachment | null,
	coverLetter: null as FileAttachment | null,
});

type FormState = ReturnType<typeof emptyForm>;

const toAttachment = (url: string | null, name: string | null): FileAttachment | null =>
	url ? { url, name: name ?? url } : null;

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

function toPayload(form: FormState) {
	return {
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
		resumeFileUrl: form.resumeFile?.url ?? null,
		resumeFileName: form.resumeFile?.name ?? null,
		coverLetterUrl: form.coverLetter?.url ?? null,
		coverLetterName: form.coverLetter?.name ?? null,
	};
}

type AutofillResult = {
	company?: string | null;
	role?: string | null;
	location?: string | null;
	salary?: string | null;
};

type JobDescriptionAutofillProps = {
	value: string;
	onChange: (value: string) => void;
	onFill: (result: AutofillResult) => void;
};

// Pasted job description: stored with the application and used for every AI action.
// Collapsed by default so the form stays short.
function JobDescriptionAutofill({ value, onChange, onFill }: JobDescriptionAutofillProps) {
	const autofill = useMutation(
		orpc.applications.ai.autofill.mutationOptions({
			onSuccess: (result) => {
				onFill(result);
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

	return (
		<Accordion className="rounded-lg border border-dashed border-line px-3">
			<AccordionItem value="job-description">
				<AccordionTrigger>
					<span className="flex items-center gap-1.5">
						<Icon name="auto_awesome" size={16} className="text-accent-text" />
						<Trans>Job description</Trans>
					</span>
				</AccordionTrigger>
				<AccordionContent className="flex flex-col gap-2">
					<p className="text-xs text-ink-3">
						<Trans>
							Copy the entire job description from the posting and paste it below. We'll fill in the fields for you and
							keep the text with this application for match scoring and tailoring.
						</Trans>
					</p>
					<Textarea
						// Fixed height: the accordion panel measures its content once, so a textarea that
						// grew with the pasted text would overflow the clipped panel.
						className="field-sizing-fixed h-40"
						value={value}
						rows={8}
						maxLength={MAX_JOB_DESCRIPTION_CHARS}
						placeholder={t`Paste the full job description here…`}
						onChange={(event) => onChange(event.target.value)}
						onPaste={(event) => runAutofill(event.clipboardData.getData("text"))}
					/>
					<div className="flex items-center justify-between gap-2">
						<p className="text-[11px] text-ink-3">
							{autofill.isPending ? (
								<Trans>Reading the posting…</Trans>
							) : (
								<Trans>Pasting fills the fields automatically.</Trans>
							)}
						</p>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={value.trim().length < MIN_AUTOFILL_CHARS || autofill.isPending}
							onClick={() => runAutofill(value)}
						>
							<Icon name="auto_awesome" size={16} />
							<Trans>Fill fields</Trans>
						</Button>
					</div>
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// When provided, the sheet edits this application instead of creating a new one.
	application?: Application | null;
};

export function ApplicationFormSheet({ open, onOpenChange, application: requested }: Props) {
	const queryClient = useQueryClient();
	// Closing keeps the application (title and fields) on screen until the sheet has slid away.
	const [application, onApplicationOpenChangeComplete] = useClosingValue(requested ?? null);
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

	const create = useMutation(
		orpc.applications.create.mutationOptions({
			onSuccess: () => {
				invalidate();
				toast.add({ type: "success", description: t`Application added to your pipeline.` });
				onOpenChange(false);
			},
			onError: () => toast.add({ type: "error", description: t`Couldn't add the application. Please try again.` }),
		}),
	);

	const update = useMutation(
		orpc.applications.update.mutationOptions({
			onSuccess: () => {
				invalidate();
				toast.add({ type: "success", description: t`Application updated.` });
				onOpenChange(false);
			},
			onError: () => toast.add({ type: "error", description: t`Couldn't save your changes. Please try again.` }),
		}),
	);

	const pending = create.isPending || update.isPending;

	const submit = () => {
		if (!form.company.trim() || !form.role.trim()) return;
		const payload = toPayload(form);
		if (application) update.mutate({ id: application.id, ...payload });
		else create.mutate({ ...payload, stageEnteredAt: form.stageEnteredAt || undefined });
	};

	return (
		<Sheet
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={(next) => {
				onApplicationOpenChangeComplete(next);
				// After adding, the fields clear once the sheet has closed; closing without saving keeps the draft.
				if (!next && create.isSuccess) {
					setForm(emptyForm());
					create.reset();
				}
			}}
		>
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

				<div className="-mt-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-4 [&>*]:shrink-0">
					{/* Hidden entirely when AI is off. */}
					{!aiEnabled && (
						<Field label={t`Job description`}>
							{(id) => (
								<Textarea
									id={id}
									rows={6}
									maxLength={MAX_JOB_DESCRIPTION_CHARS}
									value={form.jobDescription}
									onChange={(event) => set("jobDescription", event.target.value)}
								/>
							)}
						</Field>
					)}
					{aiEnabled && (
						<JobDescriptionAutofill
							value={form.jobDescription}
							onChange={(value) => set("jobDescription", value)}
							onFill={(result) =>
								setForm((prev) => ({
									...prev,
									company: result.company || prev.company,
									role: result.role || prev.role,
									location: result.location || prev.location,
									salary: result.salary || prev.salary,
								}))
							}
						/>
					)}

					<Field label={t`Company`} required>
						{(id) => <Input id={id} value={form.company} onChange={(event) => set("company", event.target.value)} />}
					</Field>
					<Field label={t`Role / title`} required>
						{(id) => <Input id={id} value={form.role} onChange={(event) => set("role", event.target.value)} />}
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field label={t`Location`}>
							{(id) => (
								<>
									<Input
										id={id}
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
								</>
							)}
						</Field>
						<Field label={t`Salary range`}>
							{(id) => <Input id={id} value={form.salary} onChange={(event) => set("salary", event.target.value)} />}
						</Field>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<Field label={t`Source`}>
							{(id) => (
								<>
									<Input
										id={id}
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
								</>
							)}
						</Field>
						<Field label={t`Stage`}>
							{(id) => (
								<Combobox
									id={id}
									className="w-full"
									value={form.status}
									options={STAGES.map((s) => ({ value: s.value, label: s.label }))}
									onValueChange={(value) => value && set("status", value)}
								/>
							)}
						</Field>
					</div>

					<Field label={t`Job posting link`}>
						{(id) => (
							<Input
								id={id}
								type="url"
								value={form.sourceUrl}
								placeholder="https://…"
								onChange={(event) => set("sourceUrl", event.target.value)}
							/>
						)}
					</Field>

					{!isEditing && (
						<Field label={t`Stage date`}>
							{(id) => (
								<Input
									id={id}
									type="date"
									value={form.stageEnteredAt}
									onChange={(event) => set("stageEnteredAt", event.target.value)}
								/>
							)}
						</Field>
					)}

					{/* Resume: link a live Reactive Resume (unlocks AI) or upload the exact PDF you sent. */}
					<Field label={t`Resume`}>
						{(id) => (
							<div className="flex flex-col gap-2">
								<Combobox
									id={id}
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
									onChange={(value) => set("resumeFile", value)}
								/>
								<p className="text-[11px] text-ink-3">
									<Trans>Link a Reactive Resume to use AI match scoring and tailoring.</Trans>
								</p>
							</div>
						)}
					</Field>

					{/* The attach button below names itself; the file picker has no labelable control. */}
					<Field label={t`Cover letter`}>
						{() => (
							<FileAttachmentField
								value={form.coverLetter}
								attachLabel={t`Attach a cover letter (PDF)`}
								onChange={(value) => set("coverLetter", value)}
							/>
						)}
					</Field>

					<Field label={t`Tags`}>
						{(id) => (
							<TagsField id={id} value={form.tags} suggestions={allTags ?? []} onChange={(tags) => set("tags", tags)} />
						)}
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field label={t`Follow-up date`}>
							{(id) => (
								<Input
									id={id}
									type="date"
									value={form.followUpAt}
									onChange={(event) => set("followUpAt", event.target.value)}
								/>
							)}
						</Field>
						<Field label={t`Follow-up note`}>
							{(id) => (
								<Input
									id={id}
									value={form.followUpNote}
									onChange={(event) => set("followUpNote", event.target.value)}
								/>
							)}
						</Field>
					</div>

					<Field label={t`Notes`}>
						{(id) => (
							<Textarea
								id={id}
								value={form.notes}
								rows={3}
								placeholder={t`Referred by…, things to emphasize, etc.`}
								onChange={(event) => set("notes", event.target.value)}
							/>
						)}
					</Field>
				</div>

				<SheetFooter className="flex-row justify-end gap-2">
					<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
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

type FieldProps = {
	label: string;
	required?: boolean;
	// Render prop: receives the id to put on the labelled control.
	children: (id: string) => React.ReactNode;
};

function Field({ label, required, children }: FieldProps) {
	const id = useId();
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id} className="text-xs text-ink-3">
				{label}
				{required && <span className="text-danger-text"> *</span>}
			</Label>
			{children(id)}
		</div>
	);
}

type TagsFieldProps = {
	id: string;
	value: string[];
	suggestions: string[];
	onChange: (tags: string[]) => void;
};

// Type-and-Enter tag input with chips + an autocomplete datalist of the user's existing tags.
function TagsField({ id, value, suggestions, onChange }: TagsFieldProps) {
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
				id={id}
				value={draft}
				list="application-tags"
				placeholder={t`Add a tag and press Enter…`}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (isImeComposing(event)) return;
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
							className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-3"
						>
							{tag}
							<button
								type="button"
								title={t`Remove tag`}
								className="hover:text-danger-text"
								onClick={() => onChange(value.filter((t) => t !== tag))}
							>
								<Icon name="close" size={12} />
							</button>
						</span>
					))}
				</div>
			)}
		</div>
	);
}
