import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { latest, useDefaultProvider, useGenerate, useSavedItems, useWorkspace } from "../hooks";
import { PrivacyLine, StatusPill, Swap, Working, workingSteps } from "../shared";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type FitItem = SavedItem & { data: SavedData<"fit"> };
type Requirement = SavedData<"fit">["requirements"][number];

type AiNoticeProps = { className?: string };

/**
 * What an AI button in a workspace tab sends, and where; or, with no usable connection, where to add one. Tabs show
 * their AI buttons only when `useDefaultProvider().provider` is set.
 */
export function AiNotice({ className }: AiNoticeProps) {
	const connection = useDefaultProvider();
	const { provider } = connection;
	if (connection.isUnavailable) return <AiProviderLoadState state={connection} />;
	if (!provider)
		return (
			<Link
				to="/dashboard/settings/ai"
				className={cn(
					"flex w-fit items-center gap-1.5 text-[13px] text-accent-text underline-offset-4 hover:underline",
					className,
				)}
			>
				<Icon name="key" size={16} />
				<Trans>Connect an AI provider in Settings</Trans>
			</Link>
		);
	return (
		<PrivacyLine className={cn(className)}>
			{t`Sends this application's posting, notes and documents, plus Knowledge that's switched on, to ${provider.label}.`}
		</PrivacyLine>
	);
}

/** W1–W3: each requirement from the posting against the user's evidence, with gaps closed in place. */
export function FitTab({ application, version }: WorkspaceTabProps) {
	const queryClient = useQueryClient();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const generate = useGenerate(application.id);
	const { provider } = useDefaultProvider();
	const { data: facts } = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const forget = useMutation(orpc.career.forgetFact.mutationOptions());
	const readOnly = version?.data.kind === "fit";
	const item = (readOnly ? version : latest(saved.data, "fit")) as FitItem | undefined;

	if (saved.isPending)
		return (
			<div className="grid gap-4">
				<Skeleton className="h-14 w-2/3" />
				<Skeleton className="h-80 rounded-xl" />
			</div>
		);

	const check = () => void generate.run({ task: "fit" }).catch(() => undefined);

	if (!item)
		return (
			<div className="grid justify-items-center gap-3 rounded-xl border border-dashed border-line-2 p-7 text-center">
				<h2 className="font-display text-[22px] leading-7 font-medium">
					<Trans>Check this role against your evidence</Trans>
				</h2>
				<p className="max-w-[420px] text-sm text-ink-2">
					<Trans>
						Each requirement in the posting is checked against the facts and stories in your Knowledge. Gaps show as
						missing evidence, never missing ability.
					</Trans>
				</p>
				<AiNotice className="max-w-[420px] text-start" />
				{provider && (
					<Button loading={generate.isPending} onClick={check}>
						<Icon name="list-checks" size={18} />
						{generate.isPending ? <Working steps={workingSteps("fit")} /> : <Trans>Check fit</Trans>}
					</Button>
				)}
			</div>
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

	return (
		<div className="grid gap-5">
			<div className="grid items-end gap-x-6 gap-y-2 @xl:grid-cols-[minmax(0,1fr)_auto]">
				<div className="grid gap-1">
					<h2 className="font-display text-[22px] leading-7 font-medium">{item.data.headline}</h2>
					<p className="max-w-[560px] text-sm leading-[19px] text-ink-2">{item.data.summary}</p>
				</div>
				<p className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs font-medium text-ink-2">
					{t`${supported} supported · ${partial} partly · ${missing} missing`}
					{item.outdated && !readOnly && provider && (
						<Button
							variant="link"
							size="sm"
							className="font-sans text-[13px] tracking-normal normal-case"
							loading={generate.isPending}
							onClick={check}
						>
							{generate.isPending ? <Working steps={workingSteps("fit")} /> : <Trans>Check again</Trans>}
						</Button>
					)}
				</p>
			</div>
			{item.outdated && !readOnly && <AiNotice className="-mt-2" />}

			<div
				role="table"
				aria-label={t`Requirements and your evidence`}
				className="grid gap-3 @xl:gap-0 @xl:overflow-hidden @xl:rounded-xl @xl:border @xl:border-line @xl:bg-surface"
			>
				<div
					role="row"
					className="hidden grid-cols-[minmax(0,1.1fr)_90px_170px_minmax(0,1.6fr)] gap-x-4 px-4 py-3 text-[13px] text-ink-2 @3xl:grid"
				>
					<span role="columnheader">
						<Trans>Requirement</Trans>
					</span>
					<span role="columnheader">
						<Trans>From</Trans>
					</span>
					<span role="columnheader">
						<Trans>Status</Trans>
					</span>
					<span role="columnheader">
						<Trans>Your evidence</Trans>
					</span>
				</div>
				{item.data.requirements.map((requirement) => {
					const factId = added(requirement);
					return (
						<RequirementRow
							key={requirement.text}
							requirement={requirement}
							status={statusOf(requirement)}
							evidence={factId ? (factText(factId) ?? requirement.evidence) : requirement.evidence}
							readOnly={readOnly}
							onSaved={(id) => onSaved(requirement, id)}
						/>
					);
				})}
			</div>

			{(item.data.checks.length > 0 || item.data.ask) && (
				<div className="grid items-start gap-4 @xl:grid-cols-2">
					{item.data.checks.length > 0 && (
						<section className="grid gap-2.5 rounded-xl border border-line bg-surface p-4">
							<h3 className="text-sm font-semibold">
								<Trans>Against your requirements</Trans>
							</h3>
							<ul className="grid gap-2">
								{item.data.checks.map((entry) => (
									<li key={entry.label} className="flex gap-2 text-sm leading-[21px]">
										<Icon
											name={entry.met === true ? "check-circle" : entry.met === false ? "x-circle" : "question"}
											size={18}
											className={cn(
												"mt-px shrink-0",
												entry.met === true && "text-accent-text",
												entry.met === false && "text-danger-text",
												entry.met === null && "text-warn-text",
											)}
										/>
										<span>
											<strong className="font-semibold">{entry.label}.</strong> {entry.text}
										</span>
									</li>
								))}
							</ul>
						</section>
					)}
					{item.data.ask && <WorthAsking ask={item.data.ask} applicationId={application.id} readOnly={readOnly} />}
				</div>
			)}
		</div>
	);
}

type RequirementRowProps = {
	requirement: Requirement;
	status: "supported" | "partial" | "missing" | "added";
	evidence: string;
	readOnly: boolean;
	onSaved: (factId: string) => void;
};

/** One requirement. Below 1024px From and Status sit under the name; on phones each row is a card. */
function RequirementRow({ requirement, status, evidence, readOnly, onSaved }: RequirementRowProps) {
	const [editing, setEditing] = useState(false);
	const from = requirement.origin === "posting" ? t`Posting` : t`Inferred`;
	const canAdd = !readOnly && (status === "missing" || status === "partial");

	return (
		<div
			role="row"
			className="grid gap-x-4 gap-y-2 border-line p-4 @max-xl:rounded-xl @max-xl:border @max-xl:bg-surface @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] @xl:border-t @3xl:grid-cols-[minmax(0,1.1fr)_90px_170px_minmax(0,1.6fr)]"
		>
			<div role="cell" className="grid content-start gap-2">
				<p className="text-sm leading-5 font-semibold">{requirement.text}</p>
				<div className="flex flex-wrap items-center gap-2 @3xl:hidden">
					<StatusPill status={status} />
					<span className="text-[13px] text-ink-3">{from}</span>
				</div>
			</div>
			<p role="cell" className="hidden text-[13px] leading-5 text-ink-2 @3xl:block">
				{from}
			</p>
			<div role="cell" className="hidden @3xl:block">
				<StatusPill status={status} />
			</div>
			<div role="cell" className="grid content-start justify-items-start gap-2.5">
				<p className={cn("text-sm leading-5", status === "missing" ? "text-ink-2" : "text-ink")}>{evidence}</p>
				{canAdd && (
					<Swap id={editing ? "editor" : "action"} className="w-full">
						{editing ? (
							<EvidenceEditor requirement={requirement} onCancel={() => setEditing(false)} onSaved={onSaved} />
						) : (
							<Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
								<Icon name="plus" size={16} />
								{status === "missing" ? <Trans>Add evidence</Trans> : <Trans>Clarify</Trans>}
							</Button>
						)}
					</Swap>
				)}
			</div>
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
				className="min-h-14 border-accent text-sm shadow-[0_0_0_3px_var(--accent-soft)]"
			/>
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
		<section className="grid justify-items-start gap-2.5 rounded-xl border border-line bg-surface p-4">
			<h3 className="text-sm font-semibold">{ask.person ? t`Worth asking ${ask.person}` : t`Worth asking`}</h3>
			<p className="text-sm leading-[21px] text-ink-2">{ask.text}</p>
			{!readOnly && (
				<Button
					size="sm"
					variant="secondary"
					disabled={added}
					onClick={() =>
						workspace.save({ questions: [...workspace.data.questions, { text: ask.text, origin: t`From Fit` }] })
					}
				>
					<Icon name={added ? "check" : "plus"} size={16} />
					{added ? <Trans>Added to Prepare</Trans> : <Trans>Add to questions</Trans>}
				</Button>
			)}
		</section>
	);
}
