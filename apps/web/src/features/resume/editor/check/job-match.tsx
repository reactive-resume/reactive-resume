import type { RouterInput } from "@/libs/orpc/client";
import type { JdTermMatch } from "@reactive-resume/resume/ats-pdf";
import type { ResumeData, SkillItem } from "@reactive-resume/schema/resume/data";
import type { CSSProperties } from "react";
import { ph, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { formatList } from "@reactive-resume/utils/locale";
import { generateId, isolate, pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { checkStateOf, editWithUndo } from "./actions";
import { CheckAiLine } from "./ai-line";
import { List, ListRow } from "@/components/calm/list-row";
import { applicationsListQueryKey, applicationsListQueryOptions } from "@/features/applications/queries";
import { openAssistantFrom } from "@/features/assistant/open";
import { useNewDocumentsStore } from "@/features/documents/new-documents";
import {
	savePendingChanges,
	saveResumeMetadata,
	useCurrentBuilderResumeSelector,
	useIsResumeLocked,
	usePatchResume,
} from "@/features/resume/builder/draft";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { toastError } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

/** Matches the applications feature's cap on a saved posting. */
const MAX_POSTING_CHARS = 20_000;

/** A posting term, with `label` as the posting writes it ("C#" rather than the matcher's "csharp"). */
type MatchedTerm = JdTermMatch & { label: string };

type JobMatchResult = { found: MatchedTerm[]; missing: MatchedTerm[]; total: number };

export type JobMatch = {
	/** The application the resume was made for, once the list has loaded. */
	application: {
		id: string;
		company: string;
		role: string;
		location?: string | null | undefined;
		jobDescription: string | null;
	} | null;
	/** The linked application's posting, or the one pasted this visit when none is linked. */
	posting: string;
	result: JobMatchResult | null;
	hiddenTerms: readonly string[];
	contextOnly: boolean;
	applicationLoading: boolean;
	applicationFailed: boolean;
	retryApplication: () => void;
};

const loadAtsPdf = () => import("@reactive-resume/resume/ats-pdf");

/**
 * Job match reads the posting of the application the resume is linked to, or one pasted for this visit, and sorts
 * its terms into found and missing. Terms hidden as "not true for me" are left out. It isn't part of the score.
 */
export function useJobMatch(data: ResumeData | undefined, selectedId?: string): JobMatch {
	const linkedId = useCurrentBuilderResumeSelector((resume) => resume.applicationId ?? null);
	const applicationId = selectedId ?? linkedId;
	const pasted = useEditorStore((state) => state.pastedPosting);
	const applicationQuery = useQuery({
		...orpc.applications.getById.queryOptions({ input: { id: applicationId ?? "" } }),
		enabled: Boolean(applicationId),
	});
	const selectedApplication = applicationQuery.data ?? null;
	const posting = applicationId ? (selectedApplication?.jobDescription ?? "").trim() : pasted.trim();

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
			.matchJobDescription({
				jobDescription: posting,
				resumeText,
				company: selectedApplication?.company,
				location: selectedApplication?.location ?? undefined,
				role: selectedApplication?.role,
			})
			.terms.filter((term) => !hidden.has(term.term))
			.map((term) => ({ ...term, label: termAsWritten(engine.surfaceFormsOf(term.term), posting) ?? term.term }));

		return {
			found: terms.filter((term) => term.resumeCount > 0),
			missing: terms.filter((term) => term.resumeCount === 0),
			total: terms.length,
		};
	}, [
		engine,
		posting,
		resumeText,
		hiddenTerms,
		selectedApplication?.company,
		selectedApplication?.location,
		selectedApplication?.role,
	]);

	return {
		application: selectedApplication,
		posting,
		result,
		hiddenTerms: hiddenTerms ?? [],
		contextOnly: Boolean(applicationId) && applicationId !== linkedId,
		applicationLoading: Boolean(applicationId) && applicationQuery.isPending,
		applicationFailed: Boolean(applicationId) && applicationQuery.isError,
		retryApplication: () => void applicationQuery.refetch(),
	};
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
	const providerState = useHasUsableAiProvider();
	const { hasUsableProvider } = providerState;
	const highlightTerm = useEditorStore((state) => state.highlightTerm);
	const locked = useIsResumeLocked();
	const { i18n } = useLingui();
	const hiddenList = formatList(i18n.locale, hiddenTerms);

	const aiLine =
		!providerState.isUnavailable && !hasUsableProvider ? (
			<CheckAiLine lead={<Trans>The assistant needs AI.</Trans>}>
				<Trans>Matching, Add to Skills and hiding a term work without it.</Trans>
			</CheckAiLine>
		) : null;

	if (match.applicationLoading)
		return (
			<p role="status">
				<Trans>Loading…</Trans>
			</p>
		);
	if (match.applicationFailed)
		return (
			<div role="alert" className="flex items-center justify-between gap-2 text-sm text-danger-text">
				<p>
					<Trans>Couldn't load the linked posting.</Trans>
				</p>
				<Button variant="secondary" onClick={match.retryApplication}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	if (!posting)
		return (
			<div className="grid gap-3.5">
				{aiLine}
				<NoPosting application={application} />
			</div>
		);

	const open = result?.missing.find((term) => term.term === openTerm);

	const addToSkills = (term: MatchedTerm) => {
		const written = term.label;
		editWithUndo(
			(draft) => {
				draft.sections.skills.items.push(newSkill(written));
			},
			t`“${ph({ written: isolate(written) })}” added to Skills`,
		);
		setOpenTerm(null);
		useEditorStore.setState({ highlightTerm: term.term });
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
		<div className="flex min-h-full flex-col gap-3.5">
			{aiLine}
			<PostingSource application={application} contextOnly={match.contextOnly} />

			{!result ? (
				<p className="flex items-center gap-2 text-sm text-ink-2">
					<Spinner decorative className="size-3.5" />
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
							<strong className="t-label">
								<Trans>
									{i18n.number(result.found.length)} of {i18n.number(result.total)} posting terms appear
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
							className="h-1.5 overflow-hidden rounded-sm bg-sunken"
						>
							<div
								className="h-full translate-x-(--fill) rounded-sm bg-accent transition-[translate] duration-standard ease-enter rtl:-translate-x-(--fill)"
								style={{ "--fill": `${(result.found.length / result.total) * 100 - 100}%` } as CSSProperties}
							/>
						</div>
					</div>

					{result.missing.length > 0 && (
						<section aria-labelledby="match-missing" className="grid gap-2">
							<h3 id="match-missing" className="t-caption text-ink-3">
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
											"flex h-7 items-center gap-1.5 rounded-sm border border-dashed px-2.5 text-[13px] leading-[18px] font-medium transition-colors duration-quick",
											openTerm === term.term
												? "border-transparent bg-accent-soft text-accent-text"
												: "border-line-2 hover:bg-hover",
										)}
									>
										<Icon name="plus" size={14} className="text-ink-3" />
										{term.label}
									</button>
								))}
							</div>

							{open && (
								<section
									key={open.term}
									aria-label={t`Add “${open.label}”`}
									className={cn(ENTER_CLASS, "grid gap-1.5 rounded-lg border border-line bg-raised px-3.5 py-3")}
								>
									<p className="text-[13px] leading-[19px] text-ink-2">
										<Plural
											value={open.jdCount}
											one={`“${open.label}” appears once in the posting.`}
											other={`“${open.label}” appears #× in the posting.`}
										/>{" "}
										<Trans>If it's part of your experience, add it where it belongs.</Trans>
									</p>
									<div className="grid justify-items-start gap-0.5">
										<Button size="sm" variant="soft" disabled={locked} onClick={() => addToSkills(open)}>
											<Icon name="plus" size={16} />
											<Trans>Add to Skills</Trans>
										</Button>
										{hasUsableProvider && (
											<Button
												size="sm"
												variant="ghost"
												className="-ms-2.5"
												disabled={locked}
												onClick={() => askAssistant(open.label, application ? null : posting)}
											>
												<Icon name="sparkle" size={16} />
												<Trans>Ask the assistant to work it in</Trans>
											</Button>
										)}
										<Button
											size="sm"
											variant="ghost"
											className="-ms-2.5"
											disabled={locked}
											onClick={() => hideTerm(open)}
										>
											<Trans>Not true for me, hide it</Trans>
										</Button>
									</div>
								</section>
							)}
						</section>
					)}

					{result.found.length > 0 && (
						<section aria-labelledby="match-found" className="grid gap-2">
							<h3 id="match-found" className="t-caption text-ink-3">
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
											onClick={() => useEditorStore.setState({ highlightTerm: on ? null : term.term })}
											className={cn(
												"flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[13px] leading-[18px] font-medium transition-colors duration-quick",
												on ? "bg-warn-soft text-warn-text" : "border border-line-2 text-ink-2",
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
					<Trans>Hidden: {hiddenList}</Trans> ·{" "}
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
			{application && <ApplicationFooter application={application} />}
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
	const navigate = useNavigate({ from: "/builder/$resumeId" });
	const search = useSearch({ from: "/builder/$resumeId" });
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const patchResume = usePatchResume();
	const { mutateAsync, isPending } = useMutation({
		mutationFn: (applicationId: string | null) =>
			// The next autosave builds on the linked revision instead of conflicting with it.
			saveResumeMetadata(resumeId, async (expectedUpdatedAt, options) => {
				const resume = await orpc.documents.linkApplication.call(
					{ type: "resume", id: resumeId, applicationId, expectedUpdatedAt },
					options,
				);
				if (!resume) throw new Error(t`Couldn't link the application. Try again.`);
				return resume;
			}),
	});

	const link = async (applicationId: string | null) => {
		try {
			await mutateAsync(applicationId);
			patchResume((resume) => {
				resume.applicationId = applicationId;
			});
			await navigate({
				to: ".",
				search: (previous: typeof search) => ({ ...previous, applicationId: undefined }),
				replace: true,
			});
			return true;
		} catch (error) {
			toastError(error, t`Couldn't link the application. Try again.`);
			return false;
		}
	};

	return { link, isPending };
}

type NewJob = NonNullable<RouterInput["documents"]["copyForJob"]["application"]>;

/**
 * Copies this resume for a job and opens the copy on Job match, leaving this one as it was. Tailoring then happens on
 * the job's own copy, never on the base every later copy starts from. Unsaved edits are saved first, so the copy has
 * what's on screen.
 */
function useMakeCopy() {
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const { mutateAsync, isPending } = useMutation(orpc.documents.copyForJob.mutationOptions());

	/** A copy for an existing job, or for a new one saved with it: both land together, or neither does. */
	const makeCopy = async (job: { applicationId: string; company: string } | { application: NewJob }) => {
		if (!(await savePendingChanges(resumeId))) {
			toast.add({ type: "error", description: t`Save this resume's changes before copying it.` });
			return false;
		}
		const input =
			"application" in job
				? { resumeId, application: job.application }
				: { resumeId, applicationId: job.applicationId };
		const company = "application" in job ? job.application.company : job.company;
		// A retry (a lost response, a second press, Check opened again) sends the same ID, so it's made once.
		const key = `copy-for-job:${JSON.stringify(input)}`;
		try {
			const copyId = await mutateAsync({ ...input, newId: pendingRequestId(key) });
			settleRequestId(key);
			markNew(copyId);
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
			useEditorStore.setState({ pastedPosting: "" });
			toast.add({ description: t`Copy made for ${company}. This resume is unchanged.` });
			// The editor resets when this resume's shell unmounts, so the copy's tab is chosen once it has opened.
			await navigate({ to: "/builder/$resumeId", params: { resumeId: copyId }, search: { mode: "check" } });
			useEditorStore.setState({ checkTab: "match" });
			return true;
		} catch (error) {
			toastError(
				error,
				"application" in job
					? t`Couldn't save the job and its copy. Try again.`
					: t`Couldn't copy the resume. Try again.`,
			);
			return false;
		}
	};

	return { makeCopy, isPending };
}

type CopyOrLinkProps = {
	application: { id: string; company: string; role: string };
	onDone: () => void;
};

/**
 * A job picked for a resume that isn't its copy: make a copy for it (the default, so this resume stays as it is), or
 * link this resume itself.
 */
function CopyOrLink({ application, onDone }: CopyOrLinkProps) {
	const { link, isPending: linking } = useLinkApplication();
	const { makeCopy, isPending: copying } = useMakeCopy();
	const locked = useIsResumeLocked();

	return (
		<div className={cn(ENTER_CLASS, "grid gap-2 border-y border-line py-3")}>
			<p className="text-[13px] leading-[19px] text-ink-2">
				<Trans>
					Tailor a copy for {application.company} so this resume stays as it is for other jobs, or link this resume
					itself.
				</Trans>
			</p>
			<div className="flex flex-wrap gap-1.5">
				<Button
					size="sm"
					variant="soft"
					disabled={copying || linking}
					onClick={() =>
						void makeCopy({ applicationId: application.id, company: application.company }).then((saved) => {
							if (saved) onDone();
						})
					}
				>
					<Icon name="copy" size={16} />
					<Trans>Make a copy for this job</Trans>
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={locked || copying || linking}
					onClick={() =>
						void link(application.id).then((saved) => {
							if (saved) onDone();
						})
					}
				>
					<Trans>Link this resume</Trans>
				</Button>
			</div>
		</div>
	);
}

/** Where the posting comes from, with Change (link another application or unlink) or Save as application. */
function PostingSource({ application, contextOnly }: { application: JobMatch["application"]; contextOnly: boolean }) {
	const [changing, setChanging] = useState(false);
	const [pickedId, setPickedId] = useState<string | null>(null);
	const picked = useApplicationChoice(pickedId);
	const { link } = useLinkApplication();
	const navigate = useNavigate({ from: "/builder/$resumeId" });
	const search = useSearch({ from: "/builder/$resumeId" });

	if (!application) {
		return (
			<div className="grid gap-2 border-b border-line py-2.5">
				<div className="flex items-center gap-3.5">
					<span className="grid size-7 place-items-center rounded-lg bg-sunken text-ink-2">
						<Icon name="copy" size={16} />
					</span>
					<span className="grid min-w-0 flex-1">
						<b className="text-[13px] font-semibold">
							<Trans>Pasted posting</Trans>
						</b>
						<span className="text-xs text-ink-3">
							<Trans>For this visit only</Trans>
						</span>
					</span>
					<Button size="sm" variant="secondary" onClick={() => useEditorStore.setState({ pastedPosting: "" })}>
						<Trans>Clear</Trans>
					</Button>
				</div>
				<SaveAsApplication />
			</div>
		);
	}

	return (
		<div className="grid gap-2 border-b border-line py-2.5">
			<div className="flex items-center gap-3.5">
				<span className="grid size-8 place-items-center rounded-sm bg-sunken text-[12px]/4 font-semibold text-ink-2">
					{application.company.slice(0, 1).toUpperCase()}
				</span>
				<span className="grid min-w-0 flex-1">
					<b className="truncate t-row-title">{application.company}</b>
					<span className="text-xs text-ink-3">
						{application.role} · <Trans>saved job</Trans>
					</span>
				</span>
				<Button
					size="sm"
					variant="link"
					className="h-5 p-0 text-sm/5"
					aria-expanded={changing}
					onClick={() => setChanging(!changing)}
				>
					<Trans>Change</Trans>
				</Button>
			</div>
			{changing && (
				<div className="grid gap-2">
					<ApplicationPicker
						value={picked?.id ?? application.id}
						onChange={(id) => {
							if (!contextOnly) {
								setPickedId(id);
								return;
							}
							void navigate({
								to: ".",
								search: (previous: typeof search) => ({ ...previous, applicationId: id }),
								replace: true,
							});
							setChanging(false);
						}}
					/>
					{!contextOnly && picked && picked.id !== application.id && (
						<CopyOrLink
							key={picked.id}
							application={picked}
							onDone={() => {
								setChanging(false);
								setPickedId(null);
							}}
						/>
					)}
					{!contextOnly && (
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
					)}
				</div>
			)}
		</div>
	);
}

/** The open application with this id, from the list the picker shows. */
function useApplicationChoice(id: string | null) {
	const { data: applications } = useQuery(applicationsListQueryOptions());
	return id ? ((applications ?? []).find((application) => application.id === id) ?? null) : null;
}

function ApplicationPicker({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const choices = (applications ?? []).filter((application) => application.status !== "closed");
	// Linking changes the document's details, which a locked document keeps as they are.
	const locked = useIsResumeLocked();
	const selected = choices.find((application) => application.id === value);

	return (
		<div className="relative">
			{selected && (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute start-2 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-xs bg-sunken t-caption text-ink-2"
				>
					{selected.company.slice(0, 1).toUpperCase()}
				</span>
			)}
			<NativeSelect
				className={selected ? "ps-10" : undefined}
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
						{application.company} · {application.role}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}

/**
 * C2: nothing to match against. Link an existing application first; pasting a posting is the fallback. A linked
 * application without a saved posting takes one here, saved to the application.
 */
function NoPosting({ application }: { application: JobMatch["application"] }) {
	const pasted = useEditorStore((state) => state.pastedPosting);
	const [draft, setDraft] = useState(pasted);
	const [pickedId, setPickedId] = useState<string | null>(null);
	const picked = useApplicationChoice(pickedId);
	const queryClient = useQueryClient();
	const { mutate: savePosting, isPending: saving } = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: (_data, input) =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() }),
				queryClient.invalidateQueries({
					queryKey: orpc.applications.getById.queryKey({ input: { id: input.id } }),
				}),
			]),
		onError: (error) => toastError(error, t`Couldn't save the posting. Try again.`),
	});

	if (application) {
		return (
			<div className="grid gap-2.5 py-3">
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
					variant="secondary"
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
		<div className="grid gap-2.5 py-3">
			<strong className="text-sm font-semibold">
				<Trans>Match against a job</Trans>
			</strong>
			<p className="text-[13px] leading-[19px] text-ink-2">
				<Trans>This resume isn't linked to an application yet. Pick one to make a copy for it.</Trans>
			</p>
			<ApplicationPicker value={pickedId} onChange={setPickedId} />
			{picked && <CopyOrLink key={picked.id} application={picked} onDone={() => setPickedId(null)} />}
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
			<Button
				size="sm"
				variant="secondary"
				className="w-fit"
				disabled={!draft.trim()}
				onClick={() => useEditorStore.setState({ pastedPosting: draft })}
			>
				<Trans>Match this posting</Trans>
			</Button>
			<span className="text-xs leading-[17px] text-ink-3">
				<Trans>A pasted posting can be saved as an application afterwards.</Trans>
			</span>
		</div>
	);
}

/**
 * Saves the pasted posting as a job (company and role are required). By default the job gets its own copy of this
 * resume and the copy opens on Job match; linking this resume itself is the secondary choice.
 */
function SaveAsApplication() {
	const [open, setOpen] = useState(false);
	const [company, setCompany] = useState("");
	const [role, setRole] = useState("");
	const posting = useEditorStore((state) => state.pastedPosting);
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const queryClient = useQueryClient();
	const { link } = useLinkApplication();
	const { makeCopy, isPending: copying } = useMakeCopy();
	const locked = useIsResumeLocked();
	const { mutateAsync: create, isPending: saving } = useMutation(orpc.applications.create.mutationOptions());
	const companyId = useId();
	const busy = copying || saving;

	if (!open) {
		return (
			<Button size="sm" variant="ghost" className="w-fit" onClick={() => setOpen(true)}>
				<Icon name="briefcase" size={16} />
				<Trans>Save as a job…</Trans>
			</Button>
		);
	}

	const pasted = posting.trim();
	const truncated = pasted.length > MAX_POSTING_CHARS;
	const job: NewJob = {
		company: company.trim(),
		role: role.trim(),
		jobDescription: pasted.slice(0, MAX_POSTING_CHARS),
		postingSource: { method: "paste", format: "text", truncated, completeness: truncated ? "incomplete" : "unknown" },
	};

	const save = async (mode: "copy" | "link") => {
		if (mode === "copy") {
			await makeCopy({ application: job });
			return;
		}
		// The job is saved with this resume linked; a retry sends the same ID, so it's saved once.
		const key = `save-job:${resumeId}:${JSON.stringify(job)}`;
		let id: string;
		try {
			id = await create({ ...job, resumeId, newId: pendingRequestId(key) });
		} catch (error) {
			toastError(error, t`Couldn't save the job. Try again.`);
			return;
		}
		await queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		if (!(await link(id))) return;
		settleRequestId(key);
		useEditorStore.setState({ pastedPosting: "" });
		toast.add({ description: t`Saved as a job and linked to this resume` });
	};

	return (
		<form
			className="grid gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				void save("copy");
			}}
		>
			<h3 className="t-row-title">
				<Trans>Save as a job</Trans>
			</h3>
			<div className="grid gap-3">
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
			<p className="text-xs leading-[17px] text-ink-3">
				<Trans>The copy gets the job's posting and keeps this resume as it is for other jobs.</Trans>
			</p>
			<div className="grid justify-items-start gap-1.5">
				<Button size="sm" variant="soft" type="submit" disabled={!company.trim() || !role.trim() || busy}>
					<Icon name="copy" size={16} />
					<Trans>Save job and make a copy</Trans>
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={!company.trim() || !role.trim() || busy || locked}
					onClick={() => void save("link")}
				>
					<Trans>Save and link this resume</Trans>
				</Button>
				<Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</form>
	);
}

/** Pasted postings go with the hand-off: without a linked application the assistant can't see them otherwise. */
const MAX_HANDOFF_POSTING = 6_000;

/** The assistant asks before adding anything, so it gets the term and a request to check first. */
function askAssistant(label: string, pastedPosting: string | null) {
	const request = t`The posting asks for “${label}”. If it's true for me, work it into my resume where it fits. Ask me first.`;
	const posting = pastedPosting?.slice(0, MAX_HANDOFF_POSTING).trim();
	openAssistantFrom({ ask: posting ? `${request}\n\n${t`The posting:`}\n${posting}` : request });
}

function ApplicationFooter({ application }: { application: NonNullable<JobMatch["application"]> }) {
	const { makeCopy, isPending } = useMakeCopy();
	return (
		<div className="pb-2">
			<List cap>
				<ListRow
					title={<Trans>Tailor a copy for {application.company}</Trans>}
					subtitle={<Trans>This resume stays as it is for other jobs</Trans>}
					trailing={
						<Button
							size="sm"
							variant="secondary"
							disabled={isPending}
							onClick={() => void makeCopy({ applicationId: application.id, company: application.company })}
						>
							<Trans>Make a copy</Trans>
						</Button>
					}
				/>
				<ListRow
					title={<Trans>Fit for {application.company}</Trans>}
					subtitle={<Trans>Each requirement, with the evidence for it</Trans>}
					caret
					render={
						<Link
							to="/dashboard/applications/$applicationId/{-$tab}"
							params={{ applicationId: application.id, tab: "fit" }}
						/>
					}
				/>
			</List>
		</div>
	);
}
