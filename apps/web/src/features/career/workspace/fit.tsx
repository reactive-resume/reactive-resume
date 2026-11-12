import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { latest, useDefaultProvider, useGenerate, useSavedItems, useWorkspace } from "../hooks";
import { useCareerTime, GenerateNotice, Working, workingSteps } from "../shared";
import { LocalMatch } from "./fit-local";
import { List, ListRow } from "@/components/calm/list-row";
import { PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { useDialogStore } from "@/dialogs/store";
import { SetUpAi } from "@/features/ai/set-up-ai";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type FitItem = SavedItem & { data: SavedData<"fit"> };
type Requirement = SavedData<"fit">["requirements"][number];

/** With no usable AI connection, where to add one; otherwise nothing. Tabs show their AI buttons only when one is set. */
export function AiNotice({
	needs = <Trans>This needs AI.</Trans>,
	works,
}: { needs?: ReactNode; works?: ReactNode } = {}) {
	const connection = useDefaultProvider();
	if (connection.isUnavailable) return <AiProviderLoadState state={connection} />;
	// N5–N9: the first row under the tab's title.
	if (!connection.provider)
		return (
			<div className="pt-3.5">
				<SetUpAi needs={needs} works={works} />
			</div>
		);
	return null;
}

/** W1–W3: each requirement from the posting against the user's evidence, with gaps closed in place. */
export function FitTab({ application, version, now, go }: WorkspaceTabProps) {
	const navigate = useNavigate();
	const time = useCareerTime();
	const proposing = useRef<AbortController | null>(null);
	const proposalKey = JSON.stringify([getAccountGeneration(), application.id]);
	const [proposalOwner, setProposalOwner] = useState<string | null>(null);
	const proposalPending = proposalOwner === proposalKey;
	useEffect(
		() => () => {
			proposing.current?.abort();
			proposing.current = null;
		},
		[proposalKey],
	);
	const openDialog = useDialogStore((state) => state.openDialog);
	const tailor = () =>
		application.resumeId
			? void navigate({
					to: "/builder/$resumeId",
					params: { resumeId: application.resumeId },
					search: { mode: "check", checkTab: "match", applicationId: application.id },
				})
			: openDialog("document.new", { step: "copy", applicationId: application.id, destination: "job-match" });
	const queryClient = useQueryClient();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const proposeEvidence = async (factId: string) => {
		if (proposing.current) return;
		const controller = new AbortController();
		const account = getAccountGeneration();
		proposing.current = controller;
		setProposalOwner(proposalKey);
		try {
			await workspace.settled();
			if (controller.signal.aborted || account !== getAccountGeneration()) return;
			const result = await client.applications.ai.proposeEvidence(
				{ id: application.id, factId },
				{ signal: controller.signal },
			);
			if (controller.signal.aborted || account !== getAccountGeneration()) return;
			await navigate({
				to: "/builder/$resumeId",
				params: { resumeId: result.resumeId },
				search: { assistant: result.conversation?.thread.id ?? "new" },
			});
		} catch (error) {
			if (!controller.signal.aborted && account === getAccountGeneration())
				toastError(error, t`Couldn't complete this action. Try again.`);
		} finally {
			if (proposing.current === controller) {
				proposing.current = null;
				if (account === getAccountGeneration()) setProposalOwner(null);
			}
		}
	};
	const generate = useGenerate(application.id);
	const connection = useDefaultProvider();
	const { provider } = connection;
	const { data: facts } = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const evidenceState = useQuery(orpc.career.fitEvidence.queryOptions({ input: { applicationId: application.id } }));
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const linkResume = useMutation(orpc.applications.update.mutationOptions());
	const [resumeChoice, setResumeChoice] = useState("");
	const [expanded, setExpanded] = useState<string | null>(null);
	const [evidenceFailure, setEvidenceFailure] = useState(false);
	const hasEvidence = evidenceState.data?.usable === true;
	const forget = useMutation(orpc.career.forgetFact.mutationOptions());
	const readOnly = version?.data.kind === "fit";
	const item = (readOnly ? version : latest(saved.data, "fit")) as FitItem | undefined;

	if (!item && !saved.isPending && !connection.isUnavailable && !connection.provider)
		return <LocalMatch application={application} />;
	if (saved.isPending)
		return (
			<div className="grid gap-4">
				<PageHeader title={t`Fit`} />
				<Skeleton className="h-14 w-2/3" />
				<Skeleton className="h-80 rounded-xl" />
			</div>
		);

	const check = () => {
		if (!hasEvidence || evidenceState.isPending) return;
		void generate.run({ task: "fit" }).catch(() => undefined);
	};

	if (!item)
		return (
			<>
				<PageHeader title={t`Fit`} />
				<EmptyState
					title={<Trans>Check this role against your evidence</Trans>}
					description={
						<Trans>
							Each requirement in the posting is checked against the facts and stories in your Knowledge. Gaps show as
							missing evidence, never missing ability.
						</Trans>
					}
					action={
						provider ? (
							<Button disabled={!hasEvidence || evidenceState.isPending} loading={generate.isPending} onClick={check}>
								<Icon name="list-checks" size={18} />
								{generate.isPending ? <Working steps={workingSteps("fit")} /> : <Trans>Check fit</Trans>}
							</Button>
						) : undefined
					}
				>
					<AiNotice
						needs={<Trans>A fit check needs AI.</Trans>}
						works={<Trans>The posting's terms, your resume and your Knowledge work without it.</Trans>}
					/>
					<GenerateNotice generate={generate} onRetry={check} className="max-w-[420px]" />
					{evidenceState.isError && (
						<div role="alert">
							<p>
								<Trans>Couldn't check your evidence.</Trans>
							</p>
							<Button onClick={() => void evidenceState.refetch()}>
								<Trans>Retry</Trans>
							</Button>
						</div>
					)}
					{!hasEvidence && (
						<div className="grid gap-2 text-sm">
							<p>
								<Trans>
									Fit needs evidence. Add facts to Knowledge or choose a resume to link before sending a request.
								</Trans>
							</p>
							<Link to="/dashboard/career/knowledge">
								<Trans>Add facts</Trans>
							</Link>
							<label htmlFor="fit-evidence">
								<Trans>Resume to use as evidence</Trans>
							</label>
							<select
								id="fit-evidence"
								className="rounded border border-line bg-surface p-2"
								value={resumeChoice}
								onChange={(event) => setResumeChoice(event.target.value)}
							>
								<option value="">{t`Choose a resume`}</option>
								{documents.data
									?.filter((d) => d.type === "resume")
									.map((d) => (
										<option key={d.id} value={d.id}>
											{d.name}
										</option>
									))}
							</select>
							<Button
								type="button"
								size="sm"
								disabled={!resumeChoice || linkResume.isPending}
								onClick={() =>
									linkResume.mutate(
										{ id: application.id, resumeId: resumeChoice },
										{
											onSuccess: () => {
												setEvidenceFailure(false);
												void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
												void queryClient.invalidateQueries({ queryKey: orpc.career.fitEvidence.key() });
											},
											onError: () => setEvidenceFailure(true),
										},
									)
								}
							>
								<Trans>Use this resume as evidence</Trans>
							</Button>
							{evidenceFailure && (
								<p role="alert">
									<Trans>Couldn't link the resume. Try again.</Trans>
								</p>
							)}
						</div>
					)}
				</EmptyState>
			</>
		);

	const evidence = readOnly ? {} : workspace.data.evidence;
	const factText = (id: string) => facts?.find((fact) => fact.id === id)?.text;
	// A requirement closed with "Add evidence" counts as supported while its fact exists.
	const added = (requirement: Requirement) => {
		const id = evidence[requirement.text];
		return id && facts?.some((fact) => fact.id === id) ? id : undefined;
	};
	const statusOf = (requirement: Requirement) => (added(requirement) ? "added" : requirement.status);
	const statuses = item.data.requirements.map(statusOf);
	const supported = statuses.filter((status) => status === "supported" || status === "added").length;
	const partial = statuses.filter((status) => status === "partial").length;
	const missing = statuses.filter((status) => status === "missing").length;

	const workspaceKey = orpc.career.workspace.queryKey({ input: { applicationId: application.id } });
	const onSaved = (requirement: Requirement, factId: string) => {
		// Called after the fact saves, so the evidence is read fresh rather than from this render.
		const current = queryClient.getQueryData<CareerWorkspace>(workspaceKey)?.evidence ?? {};
		workspace.save({ evidence: { ...current, [requirement.text]: factId } });
		void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		// The fact is already saved, so Undo forgets it and reopens the gap.
		toast.add({
			description: t`Saved to Knowledge as a fact`,
			actionProps: {
				children: t`Undo`,
				onClick: () => {
					const current = queryClient.getQueryData<CareerWorkspace>(workspaceKey)?.evidence ?? {};
					const { [requirement.text]: _removed, ...rest } = current;
					workspace.save({ evidence: rest });
					forget.mutate(
						{ id: factId },
						{ onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() }) },
					);
				},
			},
		});
	};

	const resume = documents.data?.find((document) => document.id === application.resumeId);
	const checked =
		time.date(item.createdAt) === time.date(now) ? t`today ${time.time(item.createdAt)}` : time.when(item.createdAt);
	const factCount = item.evidence.factIds.length;
	// The resume the check read is the one linked now; "sent" when it is the version that went to the employer.
	const sent = resume && application.sentResumeVersionId ? time.date(application.appliedAt) : null;
	const provenance = resume ? (
		<Trans>
			The {application.company} posting, checked against{" "}
			<Link to="/builder/$resumeId" params={{ resumeId: resume.id }} className="font-medium text-ink-2">
				{resume.name}
			</Link>
			{sent ? t` (sent ${sent})` : ""} and {factCount} Knowledge facts · {checked}
		</Trans>
	) : (
		<Trans>
			The {application.company} posting, checked against {factCount} Knowledge facts · {checked}
		</Trans>
	);

	return (
		<div>
			<PageHeader
				title={t`Fit`}
				className="[&>div]:min-h-9"
				actions={
					!readOnly && (
						<>
							{provider && (
								<Button
									variant="ghost"
									disabled={!hasEvidence || evidenceState.isPending}
									loading={generate.isPending}
									onClick={check}
								>
									<Icon name="arrow-clockwise" />
									<Trans>Check again</Trans>
								</Button>
							)}
							{application.status === "interview" && missing > 0 && (
								<Button onClick={() => go("prepare")}>
									<Icon name="chalkboard-teacher" />
									{plural(missing, {
										one: "Prepare answers for the # gap",
										other: "Prepare answers for the # gaps",
									})}
								</Button>
							)}
							{application.status === "saved" && (
								<Button onClick={tailor}>
									<Trans>Tailor the resume to this job</Trans>
								</Button>
							)}
						</>
					)
				}
			/>
			{expanded ? (
				<p className="pt-1 text-sm/5 text-ink-3">
					{resume
						? t`${supported + partial} of ${item.data.requirements.length} requirements have evidence · checked ${checked} against ${resume.name} and ${factCount} Knowledge facts`
						: t`${supported + partial} of ${item.data.requirements.length} requirements have evidence · checked ${checked} against ${factCount} Knowledge facts`}
				</p>
			) : (
				<>
					<p className="flex flex-wrap items-baseline gap-3 pt-5">
						<span className="t-big-number">{t`${supported + partial} of ${item.data.requirements.length}`}</span>
						<span className="t-body text-ink-2">
							<Trans>requirements have evidence</Trans>
						</span>
					</p>
					<p className="flex flex-wrap gap-5 pt-2.5 text-[13px]/[18px] text-ink-2">
						<span className="inline-flex items-center gap-1.5">
							<Icon name="check-circle" size={16} className="text-accent-text" />
							{plural(supported, { one: "# supported", other: "# supported" })}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<Icon name="circle-half" size={16} className="text-warn-text" />
							{plural(partial, { one: "# partly supported", other: "# partly supported" })}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<Icon name="question" size={16} className="text-ink-3" />
							{plural(missing, { one: "# with no evidence yet", other: "# with no evidence yet" })}
						</span>
					</p>
					<p className="pt-2 text-[13px]/[18px] text-ink-3">{provenance}</p>
					<div className="flex flex-wrap gap-5 pt-2 text-[13px]/5 text-accent-text">
						{item.data.checks.length > 0 && (
							<button type="button" onClick={() => setExpanded(item.data.requirements[0]?.text ?? null)}>
								<Trans>Against your requirements</Trans> ·{" "}
								{plural(item.data.checks.filter((check) => check.met === true).length, {
									one: "# met",
									other: "# met",
								})}
								,{" "}
								{plural(item.data.checks.filter((check) => check.met === null).length, {
									one: "# not stated",
									other: "# not stated",
								})}
							</button>
						)}
						{item.data.ask && (
							<button type="button" onClick={() => setExpanded(item.data.requirements[0]?.text ?? null)}>
								<Trans>Worth asking</Trans> · {plural(1, { one: "# question", other: "# questions" })}
							</button>
						)}
					</div>
				</>
			)}
			{!readOnly && (
				<>
					<AiNotice
						needs={<Trans>A fit check needs AI.</Trans>}
						works={<Trans>The posting's terms, your resume and your Knowledge work without it.</Trans>}
					/>
					<GenerateNotice generate={generate} onRetry={check} />
				</>
			)}

			<div className={cn("grid items-start gap-10", expanded && "@3xl:grid-cols-[minmax(0,1fr)_272px]")}>
				<div role="table" aria-label={t`Requirements and your evidence`} className="grid">
					<SectionHeading className={expanded ? "pt-[22px]" : "pt-7"} note={item.data.requirements.length}>
						<Trans>Requirements</Trans>
					</SectionHeading>
					{item.data.requirements.map((requirement) => {
						const factId = added(requirement);
						return (
							<RequirementRow
								key={requirement.text}
								requirement={requirement}
								expanded={expanded === requirement.text}
								onExpandedChange={(on) => setExpanded(on ? requirement.text : null)}
								status={statusOf(requirement)}
								showOrigin={Boolean(expanded)}
								evidence={factId ? (factText(factId) ?? requirement.evidence) : requirement.evidence}
								readOnly={readOnly}
								onTailor={tailor}
								onSaved={(id) => onSaved(requirement, id)}
								onPropose={
									provider &&
									application.resumeId &&
									factId &&
									facts?.some((fact) => fact.id === factId && fact.status === "active")
										? () => void proposeEvidence(factId)
										: undefined
								}
								proposalPending={proposalPending}
							/>
						);
					})}
				</div>
				{proposalPending && (
					<Button
						variant="secondary"
						onClick={() => {
							proposing.current?.abort();
							proposing.current = null;
							setProposalOwner(null);
						}}
					>
						<Trans>Stop</Trans>
					</Button>
				)}

				{(item.data.checks.length > 0 || item.data.ask) && (
					<div className={cn("grid items-start gap-8", !expanded && "@xl:grid-cols-2")}>
						{item.data.checks.length > 0 && (
							<section className="grid">
								<SectionHeading className="pt-[22px]">
									<Trans>Against your requirements</Trans>
								</SectionHeading>
								<List tight={Boolean(expanded)}>
									{item.data.checks.map((entry) => (
										<ListRow
											key={entry.label}
											className="min-h-[62px] [&_span.truncate]:whitespace-normal"
											leading={
												<Icon
													name={entry.met === true ? "check-circle" : entry.met === false ? "x-circle" : "question"}
													size={20}
													className={
														entry.met === true
															? "text-accent-text"
															: entry.met === false
																? "text-danger-text"
																: "text-warn-text"
													}
												/>
											}
											title={entry.label}
											subtitle={entry.text}
										/>
									))}
								</List>
								<p className="pt-2 text-[13px]/[18px] text-ink-3">
									<Trans>
										From{" "}
										<Link to="/dashboard/career/preferences" className="font-medium text-ink-2">
											Preferences
										</Link>
										. A question mark means the posting doesn't say.
									</Trans>
								</p>
							</section>
						)}
						{item.data.ask && <WorthAsking ask={item.data.ask} applicationId={application.id} readOnly={readOnly} />}
					</div>
				)}
			</div>
		</div>
	);
}

type RequirementRowProps = {
	expanded: boolean;
	onExpandedChange: (open: boolean) => void;
	requirement: Requirement;
	status: "supported" | "partial" | "missing" | "added";
	evidence: string;
	readOnly: boolean;
	onSaved: (factId: string) => void;
	onTailor: () => void;
	onPropose?: (() => void) | undefined;
	proposalPending: boolean;
	/** W9: with a requirement open, gaps also say where they came from. */
	showOrigin?: boolean;
};

/** One requirement. Below 1024px From and Status sit under the name; on phones each row is a card. */
function RequirementRow({
	expanded,
	onExpandedChange,
	requirement,
	status,
	evidence,
	readOnly,
	onSaved,
	onTailor,
	onPropose,
	proposalPending,
	showOrigin = false,
}: RequirementRowProps) {
	const editing = expanded;
	const setEditing = onExpandedChange;
	const from = requirement.origin === "posting" ? t`Posting` : t`Inferred`;
	const canAdd = !readOnly && (status === "missing" || status === "partial");

	return (
		<div role="row" className="border-b border-line last:border-b-0">
			<ListRow
				role="cell"
				className="border-0 py-2.5"
				leading={
					<Icon
						name={
							status === "supported" || status === "added"
								? "check-circle"
								: status === "partial"
									? "circle-half"
									: "question"
						}
						size={24}
						className={cn(
							"shrink-0",
							status === "supported" || status === "added"
								? "text-accent-text"
								: status === "partial"
									? "text-warn-mark"
									: "text-ink-3",
						)}
					/>
				}
				title={
					<button
						type="button"
						className="w-full text-start"
						aria-expanded={editing}
						onClick={() => setEditing(!editing)}
					>
						{requirement.text}
					</button>
				}
				subtitle={
					<>
						{status === "supported"
							? t`Supported`
							: status === "added"
								? t`Added by you`
								: status === "partial"
									? t`Partly supported`
									: t`No evidence yet`}
						{evidence ? ` · ${evidence}` : ""}
						{showOrigin && (status === "partial" || status === "missing")
							? requirement.origin === "posting"
								? t` · from the posting`
								: t` · inferred from the posting`
							: ""}
					</>
				}
				trailing={
					editing ? (
						<IconButton icon="x" label={t`Close`} size="icon-sm" iconSize={16} onClick={() => setEditing(false)} />
					) : canAdd ? (
						<Button
							variant="link"
							className="h-auto p-0 text-sm/5 text-accent-text"
							onClick={() => setEditing(!editing)}
						>
							<Trans>Add a fact</Trans>
						</Button>
					) : (
						<Icon name="caret-right" size={18} className="text-ink-3" />
					)
				}
			/>
			{editing && (
				<div className="grid gap-2 ps-[38px] pb-4">
					{!canAdd && (
						<>
							<p className="text-xs text-ink-3">{from}</p>
							<p className="text-sm text-ink-2">{evidence}</p>
						</>
					)}
					{canAdd && (
						<EvidenceEditor
							requirement={requirement}
							onCancel={() => setEditing(false)}
							onSaved={(id) => {
								onSaved(id);
								setEditing(false);
							}}
						/>
					)}
					{!readOnly && onPropose && (
						<Button size="sm" variant="ghost" disabled={proposalPending} onClick={onPropose}>
							<Trans>Propose a resume bullet</Trans>
						</Button>
					)}
					<Button size="sm" variant="link" onClick={onTailor}>
						<Trans>Tailor resume for this job</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}

type EvidenceEditorProps = {
	requirement: Requirement;
	onCancel: () => void;
	onSaved: (factId: string) => void;
};

/** W2: what the user did, saved to Knowledge as a shared Experience fact (it's about them, not this job). */
function EvidenceEditor({ requirement, onCancel, onSaved }: EvidenceEditorProps) {
	const [text, setText] = useState("");
	const [touched, setTouched] = useState(false);
	const saveFact = useMutation(orpc.career.saveFact.mutationOptions());
	const empty = !text.trim();

	const save = async () => {
		if (empty) return setTouched(true);
		try {
			const fact = await saveFact.mutateAsync({
				applicationId: null,
				category: "experience",
				text: text.trim(),
				source: { kind: "manual", id: crypto.randomUUID(), quote: text.trim() },
			});
			if (!fact) throw new Error("not saved");
			onSaved(fact.id);
		} catch (error) {
			toastError(error, t`Couldn't save that to Knowledge. Try again.`);
		}
	};

	return (
		<div className="grid w-full gap-2">
			<label className="text-[13px]/[18px] font-medium text-ink-2">{t`What did you do that shows ${requirement.text.toLocaleLowerCase()}?`}</label>
			<Textarea
				// oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's click on Add evidence
				autoFocus
				rows={2}
				value={text}
				aria-label={t`What you did: ${requirement.text}`}
				aria-invalid={touched && empty}
				placeholder={t`For example: “${requirement.text}: I did … at … in 2024, and it led to …”`}
				onChange={(event) => setText(event.target.value)}
				// Checked on Save only: an error appearing on blur would push Cancel away from the pointer mid-click.
				onKeyDown={(event) => {
					if (event.key === "Escape") onCancel();
				}}
				className="min-h-[68px] border-accent text-sm shadow-[0_0_0_3px_var(--accent-soft)]"
			/>
			<p className="text-xs/4 text-ink-3">
				<Trans>
					Say what you did, where and when, and what it led to. It is saved to Knowledge as a fact for all applications.
				</Trans>
			</p>
			{touched && empty && (
				<p role="alert" className="text-xs text-danger-text">
					<Trans>Write what you did.</Trans>
				</p>
			)}
			<div className="flex gap-1.5">
				<Button size="sm" variant="secondary" loading={saveFact.isPending} onClick={() => void save()}>
					<Trans>Save to Knowledge</Trans>
				</Button>
				<Button size="sm" variant="ghost" onClick={onCancel}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</div>
	);
}

type WorthAskingProps = { ask: NonNullable<SavedData<"fit">["ask"]>; applicationId: string; readOnly: boolean };

/** A question for the interviewer that the check surfaced, one click from Prepare's questions. */
function WorthAsking({ ask, applicationId, readOnly }: WorthAskingProps) {
	const workspace = useWorkspace(applicationId);
	const added = workspace.data.questions.some((question) => question.text === ask.text);

	return (
		<section className="grid justify-items-start gap-2.5">
			<SectionHeading className="w-full pt-6">
				<Trans>Worth asking</Trans>
			</SectionHeading>
			<div className="grid gap-0.5">
				<p className="text-sm leading-[21px] text-ink">{ask.text}</p>
				{ask.person && <p className="text-[13px]/[18px] text-ink-3">{t`Ask ${ask.person}`}</p>}
			</div>
			{!readOnly && (
				<Button
					size="sm"
					variant="secondary"
					className="justify-self-end"
					disabled={added}
					onClick={() =>
						workspace.save({ questions: [...workspace.data.questions, { text: ask.text, origin: t`From Fit` }] })
					}
				>
					{added && <Icon name="check" size={16} />}
					{added ? <Trans>In Interview prep</Trans> : <Trans>Add to questions</Trans>}
				</Button>
			)}
		</section>
	);
}
