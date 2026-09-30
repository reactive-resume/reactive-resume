import type { Proposal, ProposalState } from "@reactive-resume/resume/proposals";
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
import { useIsResumeLocked } from "@/features/resume/builder/draft";
import { ENTER_CLASS, POP_CLASS } from "@/libs/motion";

/** The visible text of a passage's HTML, for the card. */
const passageText = (html: string) =>
	new DOMParser().parseFromString(html, "text/html").body.textContent?.replaceAll("\u00a0", " ").trim() ?? "";

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

	return (
		<ChangeSet
			proposals={proposals}
			states={proposals.map((proposal) => getProposalState(data, proposal))}
			locked={locked}
			onAccept={(accepted) => {
				acceptResumeProposals(accepted);
				setProposalStatus(
					accepted.map((proposal) => proposal.id),
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
};

/**
 * A change set: "n proposed edits" with Accept all, then each edit numbered, with where it lands, the old text
 * struck through, the new text and why. A accepts and R rejects the focused edit; ↑ and ↓ move between edits.
 */
export function ChangeSet({ proposals, states, locked, onAccept, onReject, onSuggestAgain, title }: ChangeSetProps) {
	const [focused, setFocused] = useState(0);
	const pending = proposals.filter((_, index) => states[index] === "pending");
	const headingId = useId();

	const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
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
			onAccept([proposal]);
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
					<Button size="sm" disabled={locked} onClick={() => onAccept(pending)}>
						<Trans>Accept all</Trans>
					</Button>
				)}
			</header>

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
						onAccept={() => onAccept([proposal])}
						onReject={() => onReject([proposal])}
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
	onSuggestAgain?: (() => void) | undefined;
};

function ProposalItem(props: ProposalItemProps) {
	const { proposal, number, state, index, focusable, locked } = props;
	const labelId = `proposal-${proposal.id}-location`;

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
					className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent"
				>
					{number}
				</span>
				<span id={labelId} className="truncate font-mono text-[11px] text-ink-3 uppercase">
					<span className="sr-only">
						<Trans>Edit {number}:</Trans>{" "}
					</span>
					{proposal.location}
				</span>
			</div>

			<div className="grid gap-1.5 text-[13px] leading-[19px]">
				<del className="text-ink-3">{passageText(proposal.before)}</del>
				<ins className="rounded-[3px] bg-accent-soft px-1 py-0.5 no-underline">{passageText(proposal.after)}</ins>
				{proposal.why && <span className="text-xs text-ink-2">{proposal.why}</span>}
			</div>

			{state === "pending" ? (
				<div className="flex gap-1.5">
					<Button size="sm" disabled={locked} onClick={props.onAccept}>
						<Trans>Accept</Trans>
					</Button>
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
							<Trans>Applied</Trans>
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
