import type { JdTermMatch } from "@reactive-resume/resume/ats-pdf";
import type { ResumeData, SkillItem } from "@reactive-resume/schema/resume/data";
import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { generateId } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { checkStateOf, editWithUndo } from "./actions";
import { applicationsListQueryKey, applicationsListQueryOptions } from "@/features/applications/queries";
import { openAssistantFrom } from "@/features/assistant/open";
import { useCurrentBuilderResumeSelector, useIsResumeLocked, usePatchResume } from "@/features/resume/builder/draft";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

/** Matches the applications feature's cap on a saved posting. */
const MAX_POSTING_CHARS = 20_000;

/** A posting term, with `label` as the posting writes it ("C#" rather than the matcher's "csharp"). */
type MatchedTerm = JdTermMatch & { label: string };

type JobMatchResult = { found: MatchedTerm[]; missing: MatchedTerm[]; total: number };

export type JobMatch = {
	/** The application the resume was made for, once the list has loaded. */
	application: { id: string; company: string; role: string; jobDescription: string | null } | null;
	/** The linked application's posting, or the one pasted this visit when none is linked. */
	posting: string;
	result: JobMatchResult | null;
	hiddenTerms: readonly string[];
};

const loadAtsPdf = () => import("@reactive-resume/resume/ats-pdf");

/**
 * Job match reads the posting of the application the resume is linked to, or one pasted for this visit, and sorts
 * its terms into found and missing. Terms hidden as "not true for me" are left out. It isn't part of the score.
 */
export function useJobMatch(data: ResumeData | undefined): JobMatch {
	const applicationId = useCurrentBuilderResumeSelector((resume) => resume.applicationId ?? null);
	const pasted = useEditorStore((state) => state.pastedPosting);
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const application = applications?.find((entry) => entry.id === applicationId) ?? null;
	const posting = application ? (application.jobDescription ?? "").trim() : pasted.trim();

	// The matcher (stemmer and skill aliases) loads only once there's a posting to match.
	const { data: engine } = useQuery({
		queryKey: ["ats-pdf-engine"],
		queryFn: loadAtsPdf,
		staleTime: Number.POSITIVE_INFINITY,
		enabled: posting.length > 0,
	});

	const hiddenTerms = data?.metadata.check?.hiddenTerms;
	const resumeText = useMemo(() => (data ? buildMarkdown(data) : ""), [data]);

	const result = useMemo(() => {
		if (!engine || !posting) return null;
		const hidden = new Set(hiddenTerms ?? []);
		const terms = engine
			.matchJobDescription({ jobDescription: posting, resumeText })
			.terms.filter((term) => !hidden.has(term.term))
			.map((term) => ({ ...term, label: termAsWritten(engine.surfaceFormsOf(term.term), posting) ?? term.term }));

		return {
			found: terms.filter((term) => term.resumeCount > 0),
			missing: terms.filter((term) => term.resumeCount === 0),
			total: terms.length,
		};
	}, [engine, posting, resumeText, hiddenTerms]);

	return { application, posting, result, hiddenTerms: hiddenTerms ?? [] };
}

/** The first spelling of a term the posting uses, as it writes it ("Figma", not "figma"). */
function termAsWritten(forms: readonly string[], posting: string): string | undefined {
	for (const form of forms) {
		const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const found = posting.match(new RegExp(escaped, "i"))?.[0];
		if (found) return found;
	}
}

type JobMatchTabProps = { match: JobMatch; data: ResumeData };

export function JobMatchTab({ match }: JobMatchTabProps) {
	const { application, posting, result, hiddenTerms } = match;
	const [openTerm, setOpenTerm] = useState<string | null>(null);
	const highlightTerm = useEditorStore((state) => state.highlightTerm);
	const setHighlightTerm = useEditorStore((state) => state.setHighlightTerm);
	const locked = useIsResumeLocked();

	if (!posting) return <NoPosting application={application} />;

	const open = result?.missing.find((term) => term.term === openTerm);

	const addToSkills = (term: MatchedTerm) => {
		const written = term.label;
		editWithUndo(
			(draft) => {
				draft.sections.skills.items.push(newSkill(written));
			},
			t`“${written}” added to Skills`,
		);
		setOpenTerm(null);
		setHighlightTerm(term.term);
	};

	const hideTerm = (term: MatchedTerm) => {
		editWithUndo(
			(draft) => {
				const state = checkStateOf(draft);
				if (!state.hiddenTerms.includes(term.term)) state.hiddenTerms.push(term.term);
			},
			t`“${term.label}” hidden`,
		);
		setOpenTerm(null);
	};

	return (
		<div className="grid gap-3.5">
			<PostingSource application={application} />

			{!result ? (
				<p className="flex items-center gap-2 text-sm text-ink-2">
					<Trans>Reading the posting…</Trans>
				</p>
			) : result.total === 0 ? (
				<p className="text-sm text-ink-2">
					<Trans>No terms stood out in this posting.</Trans>
				</p>
			) : (
				<>
					<div className="grid gap-1.5">
						<div className="flex items-baseline justify-between gap-2">
							<strong className="text-sm font-semibold">
								<Trans>
									{result.found.length} of {result.total} posting terms appear
								</Trans>
							</strong>
							<span className="text-xs text-ink-3">
								<Trans>not scored</Trans>
							</span>
						</div>
						<div
							role="progressbar"
							aria-label={t`Posting terms in your resume`}
							aria-valuemin={0}
							aria-valuemax={result.total}
							aria-valuenow={result.found.length}
							className="h-1.5 overflow-hidden rounded-full bg-sunken"
						>
							<div
								className="h-full translate-x-(--fill) rounded-full bg-accent transition-[translate] duration-standard ease-enter rtl:-translate-x-(--fill)"
								style={{ "--fill": `${(result.found.length / result.total) * 100 - 100}%` } as CSSProperties}
							/>
						</div>
					</div>

					{result.missing.length > 0 && (
						<section aria-labelledby="match-missing" className="grid gap-2">
							<h3 id="match-missing" className="text-xs font-semibold text-ink-3 uppercase">
								<Trans>Not in your resume · add only if true</Trans>
							</h3>
							<div className="flex flex-wrap gap-1.5">
								{result.missing.map((term) => (
									<button
										key={term.term}
										type="button"
										aria-expanded={openTerm === term.term}
										onClick={() => setOpenTerm(openTerm === term.term ? null : term.term)}
										className={cn(
											"flex h-[30px] items-center gap-1 rounded-[7px] border border-dashed px-2.5 text-[13px] font-medium transition-colors duration-quick",
											openTerm === term.term ? "border-accent bg-accent-soft" : "border-line-2 hover:bg-hover",
										)}
									>
										<Icon name="add" size={15} className="text-ink-3" />
										{term.label}
									</button>
								))}
							</div>

							{open && (
								<section
									key={open.term}
									aria-label={t`Add “${open.label}”`}
									className={cn(ENTER_CLASS, "grid gap-2 rounded-xl border border-line bg-raised p-3 shadow-e2")}
								>
									<p className="text-[13px] leading-[19px] text-ink-2">
										<Plural
											value={open.jdCount}
											one={`“${open.label}” appears once in the posting.`}
											other={`“${open.label}” appears #× in the posting.`}
										/>{" "}
										<Trans>If it's part of your experience, add it where it belongs.</Trans>
									</p>
									<div className="grid justify-items-start gap-1">
										<Button size="sm" disabled={locked} onClick={() => addToSkills(open)}>
											<Icon name="add" size={16} />
											<Trans>Add to Skills</Trans>
										</Button>
										<Button size="sm" variant="secondary" disabled={locked} onClick={() => askAssistant(open.label)}>
											<Icon name="auto_awesome" size={16} />
											<Trans>Ask the assistant to work it in</Trans>
										</Button>
										<Button size="sm" variant="ghost" disabled={locked} onClick={() => hideTerm(open)}>
											<Trans>Not true for me, hide it</Trans>
										</Button>
									</div>
								</section>
							)}
						</section>
					)}

					{result.found.length > 0 && (
						<section aria-labelledby="match-found" className="grid gap-2">
							<h3 id="match-found" className="text-xs font-semibold text-ink-3 uppercase">
								<Trans>Already covered · pick one to find it on the page</Trans>
							</h3>
							<div className="flex flex-wrap gap-1.5">
								{result.found.map((term) => {
									const on = highlightTerm === term.term;
									return (
										<button
											key={term.term}
											type="button"
											aria-pressed={on}
											onClick={() => setHighlightTerm(on ? null : term.term)}
											className={cn(
												"flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-quick",
												on ? "bg-[#F2DE8C] text-[oklch(0.3_0.05_80)]" : "bg-accent-soft text-accent-text",
											)}
										>
											<Icon name="check" size={14} />
											{term.label}
										</button>
									);
								})}
							</div>
						</section>
					)}
				</>
			)}

			{hiddenTerms.length > 0 && (
				<p className="text-xs text-ink-3">
					<Trans>Hidden: {hiddenTerms.join(", ")}</Trans> ·{" "}
					<button
						type="button"
						disabled={locked}
						className="font-medium text-ink-2 underline underline-offset-2"
						onClick={() =>
							editWithUndo(
								(draft) => {
									checkStateOf(draft).hiddenTerms = [];
								},
								t`Hidden terms are back`,
							)
						}
					>
						<Trans>Show again</Trans>
					</button>
				</p>
			)}
		</div>
	);
}

const newSkill = (name: string): SkillItem => ({
	id: generateId(),
	hidden: false,
	icon: "",
	iconColor: "",
	name,
	proficiency: "",
	level: 0,
	keywords: [],
});

function useLinkApplication() {
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const patchResume = usePatchResume();
	const { mutateAsync, isPending } = useMutation(orpc.documents.linkApplication.mutationOptions());

	const link = async (applicationId: string | null) => {
		try {
			await mutateAsync({ type: "resume", id: resumeId, applicationId });
			patchResume((resume) => {
				resume.applicationId = applicationId;
			});
		} catch (error) {
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't link the application.` }),
			});
		}
	};

	return { link, isPending };
}

/** Where the posting comes from, with Change (link another application or unlink) or Save as application. */
function PostingSource({ application }: { application: JobMatch["application"] }) {
	const [changing, setChanging] = useState(false);
	const setPastedPosting = useEditorStore((state) => state.setPastedPosting);
	const { link } = useLinkApplication();

	if (!application) {
		return (
			<div className="grid gap-2 rounded-[10px] bg-bg p-3">
				<div className="flex items-center gap-2.5">
					<span className="grid size-7 place-items-center rounded-[7px] bg-sunken text-ink-2">
						<Icon name="content_copy" size={16} />
					</span>
					<span className="grid min-w-0 flex-1">
						<b className="text-[13px] font-semibold">
							<Trans>Pasted posting</Trans>
						</b>
						<span className="text-xs text-ink-3">
							<Trans>For this visit only</Trans>
						</span>
					</span>
					<Button size="sm" variant="secondary" onClick={() => setPastedPosting("")}>
						<Trans>Clear</Trans>
					</Button>
				</div>
				<SaveAsApplication />
			</div>
		);
	}

	return (
		<div className="grid gap-2 rounded-[10px] bg-bg p-3">
			<div className="flex items-center gap-2.5">
				<span className="grid size-7 place-items-center rounded-[7px] bg-sunken text-[13px] font-semibold text-ink-2">
					{application.company.slice(0, 1).toUpperCase()}
				</span>
				<span className="grid min-w-0 flex-1">
					<b className="truncate text-[13px] font-semibold">
						{application.role} · {application.company}
					</b>
					<span className="text-xs text-ink-3">
						<Trans>Posting from the linked application</Trans>
					</span>
				</span>
				<Button size="sm" variant="secondary" aria-expanded={changing} onClick={() => setChanging(!changing)}>
					<Trans>Change</Trans>
				</Button>
			</div>
			{changing && (
				<div className="grid gap-2">
					<ApplicationPicker
						value={application.id}
						onChange={(id) => {
							setChanging(false);
							void link(id);
						}}
					/>
					<Button
						size="sm"
						variant="ghost"
						className="w-fit"
						onClick={() => {
							setChanging(false);
							void link(null);
						}}
					>
						<Trans>Unlink this application</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}

function ApplicationPicker({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const choices = (applications ?? []).filter((application) => application.status !== "closed");
	// Linking changes the document's details, which a locked document keeps as they are.
	const locked = useIsResumeLocked();

	return (
		<NativeSelect
			aria-label={t`Link an application`}
			disabled={locked}
			value={value ?? ""}
			onChange={(event) => event.target.value && onChange(event.target.value)}
		>
			<option value="" disabled>
				{choices.length > 0 ? t`Link an application…` : t`No applications yet`}
			</option>
			{choices.map((application) => (
				<option key={application.id} value={application.id}>
					{application.role} · {application.company}
				</option>
			))}
		</NativeSelect>
	);
}

/**
 * C2: nothing to match against. Link an existing application first; pasting a posting is the fallback. A linked
 * application without a saved posting takes one here, saved to the application.
 */
function NoPosting({ application }: { application: JobMatch["application"] }) {
	const pasted = useEditorStore((state) => state.pastedPosting);
	const setPastedPosting = useEditorStore((state) => state.setPastedPosting);
	const [draft, setDraft] = useState(pasted);
	const { link, isPending } = useLinkApplication();
	const queryClient = useQueryClient();
	const { mutate: savePosting, isPending: saving } = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() }),
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't save the posting.` }),
			}),
	});

	if (application) {
		return (
			<div className="grid gap-2.5 rounded-xl border border-line p-4">
				<strong className="text-sm font-semibold">
					{application.role} · {application.company}
				</strong>
				<p className="text-[13px] leading-[19px] text-ink-2">
					<Trans>This application has no posting saved yet. Paste it to match against it.</Trans>
				</p>
				<Textarea
					aria-label={t`Job posting`}
					rows={5}
					maxLength={MAX_POSTING_CHARS}
					value={draft}
					placeholder={t`Paste a job posting…`}
					onChange={(event) => setDraft(event.target.value)}
				/>
				<Button
					size="sm"
					className="w-fit"
					disabled={!draft.trim() || saving}
					onClick={() => savePosting({ id: application.id, jobDescription: draft.trim() })}
				>
					<Trans>Save to the application</Trans>
				</Button>
			</div>
		);
	}

	return (
		<div className="grid gap-2.5 rounded-xl border border-line p-4">
			<strong className="text-sm font-semibold">
				<Trans>Match against a job</Trans>
			</strong>
			<p className="text-[13px] leading-[19px] text-ink-2">
				<Trans>This resume isn't linked to an application yet.</Trans>
			</p>
			<ApplicationPicker value={null} onChange={(id) => void link(id)} />
			{isPending && (
				<span className="text-xs text-ink-3">
					<Trans>Linking…</Trans>
				</span>
			)}
			<span className="text-center text-xs text-ink-3">
				<Trans>or</Trans>
			</span>
			<Textarea
				aria-label={t`Job posting`}
				rows={4}
				maxLength={MAX_POSTING_CHARS}
				value={draft}
				placeholder={t`Paste a job posting…`}
				onChange={(event) => setDraft(event.target.value)}
			/>
			<Button size="sm" className="w-fit" disabled={!draft.trim()} onClick={() => setPastedPosting(draft)}>
				<Trans>Match this posting</Trans>
			</Button>
			<span className="text-xs leading-[17px] text-ink-3">
				<Trans>A pasted posting can be saved as an application afterwards.</Trans>
			</span>
		</div>
	);
}

/** Saves the pasted posting as a new application (company and role are required) and links the resume to it. */
function SaveAsApplication() {
	const [open, setOpen] = useState(false);
	const [company, setCompany] = useState("");
	const [role, setRole] = useState("");
	const posting = useEditorStore((state) => state.pastedPosting);
	const setPastedPosting = useEditorStore((state) => state.setPastedPosting);
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const queryClient = useQueryClient();
	const { link } = useLinkApplication();
	const { mutateAsync: create, isPending } = useMutation(orpc.applications.create.mutationOptions());
	const companyId = useId();

	if (!open) {
		return (
			<Button size="sm" variant="ghost" className="w-fit" onClick={() => setOpen(true)}>
				<Icon name="work" size={16} />
				<Trans>Save as application…</Trans>
			</Button>
		);
	}

	const save = async () => {
		try {
			const id = await create({
				company: company.trim(),
				role: role.trim(),
				jobDescription: posting.trim().slice(0, MAX_POSTING_CHARS),
				resumeId,
			});
			await queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
			await link(id);
			setPastedPosting("");
			toast.add({ description: t`Saved as an application and linked` });
		} catch (error) {
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't save the application.` }),
			});
		}
	};

	return (
		<form
			className="grid gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<div className="grid grid-cols-2 gap-2">
				<div className="grid gap-1">
					<Label htmlFor={companyId}>
						<Trans>Company</Trans>
					</Label>
					<Input id={companyId} required value={company} onChange={(event) => setCompany(event.target.value)} />
				</div>
				<div className="grid gap-1">
					<Label htmlFor={`${companyId}-role`}>
						<Trans>Role</Trans>
					</Label>
					<Input id={`${companyId}-role`} required value={role} onChange={(event) => setRole(event.target.value)} />
				</div>
			</div>
			<div className="flex gap-1.5">
				<Button size="sm" type="submit" disabled={!company.trim() || !role.trim() || isPending}>
					<Trans>Save and link</Trans>
				</Button>
				<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</form>
	);
}

/** The assistant asks before adding anything, so it gets the term and a request to check first. */
function askAssistant(label: string) {
	openAssistantFrom({
		ask: t`The posting asks for “${label}”. If it's true for me, work it into my resume where it fits. Ask me first.`,
	});
}
