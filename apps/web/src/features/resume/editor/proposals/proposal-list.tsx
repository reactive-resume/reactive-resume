import type {
	Proposal,
	ProposalEvidence,
	ProposalState,
	RequirementCoverage,
	UnsupportedClaim,
} from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { KeyboardEvent, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { getProposalState } from "@reactive-resume/resume/proposals";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { acceptResumeProposals } from "./proposals";
import { useIsResumeLocked, useResumeStore } from "@/features/resume/builder/draft";
import { ENTER_CLASS, POP_CLASS } from "@/libs/motion";

const claimKindLabel = (kind: UnsupportedClaim["kind"]) =>
	({
		employer: t`Employer`,
		title: t`Job title`,
		date: t`Date`,
		figure: t({ message: "Figure", context: "A number or metric stated in a resume" }),
		skill: t`Skill`,
		responsibility: t`Responsibility`,
		term: t`Not in your resume`,
	})[kind];

const coverageLabel = (status: RequirementCoverage["status"]) =>
	({
		edited: t`An edit addresses it`,
		cited: t`Cited as already shown · check it`,
		missing: t`No evidence found · left as a gap`,
		unassessed: t`Not assessed`,
	})[status];

/** The visible text of a passage's HTML, for the card. */
const passageText = (html: string) =>
	new DOMParser().parseFromString(html, "text/html").body.textContent?.replaceAll("\u00a0", " ").trim() ?? "";

/** What Edit starts from: the new passage, or only the added one (an addition repeats the passage it follows). */
const addedText = ({ before, after }: Pick<Proposal, "before" | "after">) =>
	passageText(before && after.startsWith(before) ? after.slice(before.length) : after);

type ProposalListProps = {
	proposals: readonly Proposal[];
	data: ResumeData;
	/** "Suggest again" on an out-of-date proposal. */
	onSuggestAgain: () => void;
};

/** Check → Writing's change set, applied to the resume. */
export function ProposalList({ proposals, data, onSuggestAgain }: ProposalListProps) {
	const setProposalStatus = useEditorStore((state) => state.setProposalStatus);
	const locked = useIsResumeLocked();
	const applications = useResumeStore((state) => state.proposalApplications);

	return (
		<ChangeSet
			proposals={proposals}
			states={proposals.map((proposal) => getProposalState(data, proposal, applications))}
			locked={locked}
			onAccept={(accepted) => {
				const { applied } = acceptResumeProposals(accepted);
				setProposalStatus(
					applied.map((proposal) => proposal.id),
					"accepted",
				);
			}}
			onReject={(rejected) =>
				setProposalStatus(
					rejected.map((proposal) => proposal.id),
					"rejected",
				)
			}
			onSuggestAgain={onSuggestAgain}
		/>
	);
}

type ChangeSetProps = {
	proposals: readonly Proposal[];
	/** Each proposal's state as the document reads now (out of date once its passage changed). */
	states: readonly ProposalState[];
	locked: boolean;
	onAccept: (proposals: readonly Proposal[]) => void;
	onReject: (proposals: readonly Proposal[]) => void;
	/** "Suggest again" on an out-of-date proposal. */
	onSuggestAgain?: (() => void) | undefined;
	/** The set's title; "n proposed edits" by default. */
	title?: ReactNode;
	/** Rewrite a pending edit's new text before deciding; no Edit button without it. */
	/** Saves a pending edit's new wording; the card shows it only after this resolves. */
	onEdit?: ((proposal: Proposal, text: string) => Promise<void>) | undefined;
	/** The posting's requirements as the assistant read them, gaps included. */
	requirements?: readonly RequirementCoverage[] | undefined;
	/** A cited Knowledge fact's text while it's still switched on; null once it's gone. */
	factText?: ((id: string) => string | null) | undefined;
};

/**
 * A change set: "n proposed edits" with Accept all, then each edit numbered, with where it lands, the old text
 * struck through, the new text and why. A accepts and R rejects the focused edit; ↑ and ↓ move between edits.
 */
export function ChangeSet(props: ChangeSetProps) {
	const { proposals, states, locked, onAccept, onReject, onEdit, onSuggestAgain, title, requirements = [] } = props;
	const [focused, setFocused] = useState(0);
	// Edits whose wording is open for editing, saving or failed to save: none of them can be accepted from here until
	// the wording is saved or cancelled, by any path (its button, Accept all or the A key).
	const [drafting, setDrafting] = useState<ReadonlySet<string>>(new Set());
	const acceptable = (proposal: Proposal, index: number) =>
		!locked && states[index] === "pending" && !drafting.has(proposal.id);
	const accept = (chosen: readonly Proposal[]) => {
		const allowed = chosen.filter((proposal) => acceptable(proposal, proposals.indexOf(proposal)));
		if (allowed.length > 0) onAccept(allowed);
	};
	const pending = proposals.filter((proposal, index) => acceptable(proposal, index));
	const headingId = useId();

	const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
		// Typing a rewrite isn't a shortcut.
		if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest("textarea")) return;
		const item = (event.target as HTMLElement).closest<HTMLElement>("[data-proposal-index]");
		const index = Number(item?.dataset.proposalIndex ?? focused);
		const proposal = proposals[index];

		const move = (next: number) => {
			event.preventDefault();
			const target = Math.min(proposals.length - 1, Math.max(0, next));
			setFocused(target);
			event.currentTarget.querySelector<HTMLElement>(`[data-proposal-index="${target}"]`)?.focus();
		};

		if (event.key === "ArrowDown") return move(index + 1);
		if (event.key === "ArrowUp") return move(index - 1);
		if (!proposal || states[index] !== "pending" || locked) return;
		if (event.key === "a" || event.key === "A") {
			event.preventDefault();
			accept([proposal]);
		}
		if (event.key === "r" || event.key === "R") {
			event.preventDefault();
			onReject([proposal]);
		}
	};

	return (
		<section aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-line">
			<header className="flex min-h-11 items-center justify-between gap-2 border-b border-line bg-bg px-3 py-2">
				<h3 id={headingId} className="text-sm font-semibold">
					{title ?? <Plural value={proposals.length} one="# proposed edit" other="# proposed edits" />}
				</h3>
				{pending.length > 1 && (
					<Button size="sm" disabled={locked} onClick={() => accept(pending)}>
						<Trans>Accept all</Trans>
					</Button>
				)}
			</header>

			{requirements.length > 0 && <Coverage requirements={requirements} factText={props.factText} />}

			<ol aria-label={t`Proposed edits`} onKeyDown={onKeyDown} className="divide-y divide-line">
				{proposals.map((proposal, index) => (
					<ProposalItem
						key={proposal.id}
						proposal={proposal}
						number={index + 1}
						state={states[index] ?? "pending"}
						index={index}
						focusable={index === Math.min(focused, proposals.length - 1)}
						locked={locked}
						onFocus={() => setFocused(index)}
						onAccept={() => accept([proposal])}
						onReject={() => onReject([proposal])}
						// A structural change is reviewed as a whole: its wording can't be rewritten here.
						onEdit={onEdit && !proposal.snapshot ? (text) => onEdit(proposal, text) : undefined}
						onDrafting={(open) =>
							setDrafting((current) => {
								const next = new Set(current);
								if (open) next.add(proposal.id);
								else next.delete(proposal.id);
								return next;
							})
						}
						factText={props.factText}
						onSuggestAgain={onSuggestAgain}
					/>
				))}
			</ol>

			<p className="border-t border-line px-3 py-2 text-xs text-ink-3">
				<Trans>A accepts and R rejects the focused edit. ↑ and ↓ move between edits.</Trans>
			</p>
		</section>
	);
}

type ProposalItemProps = {
	proposal: Proposal;
	number: number;
	state: ProposalState;
	index: number;
	focusable: boolean;
	locked: boolean;
	onFocus: () => void;
	onAccept: () => void;
	onReject: () => void;
	onEdit?: ((text: string) => Promise<void>) | undefined;
	/** The wording opened for editing (true) or closed: saved or cancelled (false). */
	onDrafting: (open: boolean) => void;
	factText?: ((id: string) => string | null) | undefined;
	onSuggestAgain?: (() => void) | undefined;
};

function ProposalItem(props: ProposalItemProps) {
	const { proposal, number, state, index, focusable, locked } = props;
	const labelId = `proposal-${proposal.id}-location`;
	const editId = useId();
	const [draft, setDraftText] = useState<string | null>(null);
	const setDraft = (text: string | null) => {
		if ((text === null) !== (draft === null)) props.onDrafting(text !== null);
		setDraftText(text);
	};
	const [saving, setSaving] = useState<"saving" | "failed" | null>(null);
	const save = async (text: string) => {
		setSaving("saving");
		try {
			await props.onEdit?.(text);
			setDraft(null);
			setSaving(null);
		} catch {
			// The draft stays open with the user's words, so nothing is lost and Accept can't use unsaved wording.
			setSaving("failed");
		}
	};

	return (
		<li
			data-proposal-index={index}
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Roving focus: one edit in the tab order, ↑ and ↓ move between them.
			tabIndex={focusable ? 0 : -1}
			aria-labelledby={labelId}
			onFocus={props.onFocus}
			className="grid gap-2 p-3 outline-none focus-visible:bg-hover"
		>
			<div className="flex items-center gap-2">
				<span
					aria-hidden="true"
					className="grid size-5 shrink-0 place-items-center rounded-sm bg-accent text-[11px] font-bold text-on-accent"
				>
					{number}
				</span>
				<span id={labelId} className="truncate font-mono text-xs text-ink-3">
					<span className="sr-only">
						<Trans>Edit {number}:</Trans>{" "}
					</span>
					{proposal.location}
				</span>
			</div>

			<div className="grid gap-1.5 text-[13px] leading-[19px] whitespace-pre-wrap">
				<del className="text-ink-3">{proposal.snapshot ? proposal.before : passageText(proposal.before)}</del>
				{draft === null ? (
					<ins className="rounded-md bg-accent-soft px-1 py-0.5 no-underline">
						{proposal.snapshot ? proposal.after : passageText(proposal.after)}
					</ins>
				) : (
					<span className="grid gap-1">
						<label htmlFor={editId} className="text-xs font-medium text-ink-2">
							<Trans>Your wording</Trans>
						</label>
						<textarea
							id={editId}
							value={draft}
							rows={3}
							maxLength={2000}
							onChange={(event) => setDraft(event.target.value)}
							className="field-sizing-content rounded-md border border-line-2 bg-raised px-2 py-1 outline-none focus:border-accent"
						/>
					</span>
				)}
				{proposal.edited && draft === null && (
					<span className="text-xs text-ink-3">
						<Trans>Edited by you</Trans>
					</span>
				)}
				{proposal.why && <span className="text-xs text-ink-2">{proposal.why}</span>}
			</div>

			<ProposalReview proposal={proposal} factText={props.factText} />

			{state === "pending" && draft !== null ? (
				<div className="grid gap-1.5">
					{saving === "failed" && (
						<p role="alert" className="text-xs text-danger-text">
							<Trans>Couldn't save your wording. Your text is still here; try again.</Trans>
						</p>
					)}
					<div className="flex gap-1.5">
						<Button
							size="sm"
							disabled={locked || !draft.trim() || saving === "saving"}
							onClick={() => void save(draft)}
						>
							{saving === "saving" ? (
								<Trans>Saving…</Trans>
							) : saving === "failed" ? (
								<Trans>Try again</Trans>
							) : (
								<Trans>Save wording</Trans>
							)}
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={saving === "saving"}
							onClick={() => {
								setDraft(null);
								setSaving(null);
							}}
						>
							<Trans>Cancel</Trans>
						</Button>
					</div>
				</div>
			) : state === "pending" ? (
				<div className="flex gap-1.5">
					<Button size="sm" disabled={locked} onClick={props.onAccept}>
						<Trans>Accept</Trans>
					</Button>
					{props.onEdit && (
						<Button size="sm" variant="secondary" disabled={locked} onClick={() => setDraft(addedText(proposal))}>
							<Trans>Edit</Trans>
						</Button>
					)}
					<Button size="sm" variant="secondary" onClick={props.onReject}>
						<Trans>Reject</Trans>
					</Button>
				</div>
			) : (
				<p
					key={state}
					className={cn(
						ENTER_CLASS,
						"flex min-h-7 items-center gap-2 text-xs font-medium",
						state === "accepted" && "text-accent-text",
						state === "rejected" && "text-ink-3",
						state === "stale" && "text-warn-text",
					)}
				>
					{state === "accepted" && (
						<>
							<Icon name="check" size={16} className={POP_CLASS} />
							<Trans context="A proposed change has been applied">Applied</Trans>
						</>
					)}
					{state === "rejected" && <Trans>Rejected</Trans>}
					{state === "stale" && (
						<>
							<Trans>Out of date: the text has changed since.</Trans>
							{props.onSuggestAgain && (
								<button
									type="button"
									className="text-ink-2 underline underline-offset-2"
									onClick={props.onSuggestAgain}
								>
									<Trans>Suggest again</Trans>
								</button>
							)}
						</>
					)}
				</p>
			)}
		</li>
	);
}

type EvidenceProps = { evidence: readonly ProposalEvidence[]; factText?: ((id: string) => string | null) | undefined };

/** Citations as the assistant made them: pointers to check, never proof. */
function Evidence({ evidence, factText }: EvidenceProps) {
	return (
		<ul className="grid gap-1 ps-3">
			{evidence.map((item) =>
				item.kind === "passage" ? (
					<li key={`passage:${item.location}:${item.text}`}>
						<span className="font-mono text-ink-3">{item.location}</span> {item.text}
					</li>
				) : (
					<li key={`fact:${item.id}`}>
						<span className="font-mono text-ink-3">
							<Trans>Knowledge</Trans>
						</span>{" "}
						{factText?.(item.id) ?? <Trans>A fact that's no longer in Knowledge</Trans>}
					</li>
				),
			)}
		</ul>
	);
}

type ProposalReviewProps = { proposal: Proposal; factText?: ((id: string) => string | null) | undefined };

/** What the edit answers in the posting, what the assistant cites, and what nothing checked backs. */
function ProposalReview({ proposal, factText }: ProposalReviewProps) {
	const { requirement, evidence = [], unresolved = 0, unsupported = [] } = proposal;
	if (!requirement && evidence.length === 0 && unresolved === 0 && unsupported.length === 0) return null;

	return (
		<div className="grid gap-1.5 text-xs leading-4 text-ink-2">
			{requirement && (
				<p>
					<Trans>
						<span className="font-medium text-ink">Posting asks for:</span> {requirement}
					</Trans>
				</p>
			)}
			{evidence.length > 0 ? (
				<details>
					<summary className="cursor-pointer">
						<Plural
							value={evidence.length}
							one="The assistant cites # source · check it says this"
							other="The assistant cites # sources · check they say this"
						/>
					</summary>
					<Evidence evidence={evidence} factText={factText} />
				</details>
			) : (
				requirement && (
					<p>
						<Trans>Nothing cited for this edit.</Trans>
					</p>
				)
			)}
			{unresolved > 0 && (
				<p>
					<Plural
						value={unresolved}
						one="# citation didn't match anything the assistant could read."
						other="# citations didn't match anything the assistant could read."
					/>
				</p>
			)}
			{unsupported.length > 0 && (
				<div className="grid gap-1 rounded-md bg-warn-soft px-2 py-1.5 text-warn-text">
					<p className="flex items-center gap-1.5 font-medium">
						<Icon name="warning-circle" size={14} />
						<Trans>Nothing checked backs these. Confirm each before accepting:</Trans>
					</p>
					<ul className="grid gap-0.5 ps-5">
						{unsupported.map((claim) => (
							<li key={`${claim.kind}:${claim.text}`} className="list-disc">
								{claimKindLabel(claim.kind)}: {claim.text}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

type CoverageProps = {
	requirements: readonly RequirementCoverage[];
	factText?: ((id: string) => string | null) | undefined;
};

/** Every posting requirement as the assistant read it, gaps included. Separate from Check's term list. */
export function Coverage({ requirements, factText }: CoverageProps) {
	const gaps = requirements.filter((item) => item.status === "missing" || item.status === "unassessed").length;

	return (
		<details className="border-b border-line px-3 py-2 text-xs text-ink-2" open={gaps > 0}>
			<summary className="cursor-pointer">
				<Plural
					value={requirements.length}
					one="The assistant's reading of # posting requirement"
					other="The assistant's reading of # posting requirements"
				/>{" "}
				{gaps > 0 && <Plural value={gaps} one="· # gap" other="· # gaps" />}
			</summary>
			<ul className="mt-1.5 grid gap-1.5">
				{requirements.map((item) => (
					<li key={item.text} className="grid gap-0.5">
						<span className="text-ink">{item.text}</span>
						<span className={cn((item.status === "missing" || item.status === "unassessed") && "text-warn-text")}>
							{coverageLabel(item.status)}
						</span>
						{item.evidence.length > 0 && <Evidence evidence={item.evidence} factText={factText} />}
						{(item.unresolved ?? 0) > 0 && (
							<Plural
								value={item.unresolved ?? 0}
								one="# citation didn't match anything the assistant could read."
								other="# citations didn't match anything the assistant could read."
							/>
						)}
					</li>
				))}
			</ul>
			<p className="mt-1.5 text-ink-3">
				<Trans>
					An AI reading to help you edit, not a prediction of how an employer or screening system will respond.
				</Trans>
			</p>
		</details>
	);
}
