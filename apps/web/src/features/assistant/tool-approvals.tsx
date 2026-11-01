import type { CareerStoryData } from "@reactive-resume/schema/career";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { agentApprovalRequests } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

type ApprovalFact = { id: string; text: string; status: string };

type StoryEditorArgs = {
	approvalId: string;
	story: Omit<CareerStoryData, "applicationId">;
	/** The edited story was saved: the proposal as it stood is declined. */
	onSaved: () => void;
	/** Back to the review card; the edits stay for the next Edit first. */
	onCancel: () => void;
};

export type StoryEditorRender = (args: StoryEditorArgs) => ReactNode;

type ToolApprovalsProps = {
	message: UIMessage;
	disabled: boolean;
	/** The user's facts, to show which ones a proposed story rests on. */
	facts?: readonly ApprovalFact[];
	/** The story editor, opened in place by Edit first. Without it, a proposal can only be saved as is or skipped. */
	storyEditor?: StoryEditorRender;
	onDecision: (decision: { id: string; approved: boolean }) => void;
};

export function ToolApprovals({ message, disabled, facts = [], storyEditor, onDecision }: ToolApprovalsProps) {
	const [editing, setEditing] = useState<string | null>(null);
	return agentApprovalRequests(message).map((request) =>
		request.kind === "story" && editing === request.id && storyEditor && !disabled ? (
			<div key={request.id} className="my-3 rounded-lg border border-line bg-raised p-4">
				{storyEditor({
					approvalId: request.id,
					story: request.story,
					onSaved: () => {
						setEditing(null);
						onDecision({ id: request.id, approved: false });
					},
					onCancel: () => setEditing(null),
				})}
			</div>
		) : (
			<div key={request.id} className="my-3 grid gap-3 rounded-lg border border-line bg-raised p-4">
				<p className="text-sm font-medium">
					{request.kind === "search" ? (
						<Trans>Send this exact query to your web search provider?</Trans>
					) : (
						<Trans>Save this story to Knowledge?</Trans>
					)}
				</p>
				{request.kind === "search" ? (
					<p className="text-sm wrap-anywhere whitespace-pre-wrap">{request.text}</p>
				) : (
					<StoryProposal story={request.story} facts={facts} />
				)}
				<div className="flex flex-wrap gap-2">
					<Button size="sm" disabled={disabled} onClick={() => onDecision({ id: request.id, approved: true })}>
						{request.kind === "search" ? <Trans>Search the web</Trans> : <Trans>Save story</Trans>}
					</Button>
					{request.kind === "story" && storyEditor && (
						<Button size="sm" variant="secondary" disabled={disabled} onClick={() => setEditing(request.id)}>
							<Trans>Edit first</Trans>
						</Button>
					)}
					<Button
						size="sm"
						variant={request.kind === "story" ? "ghost" : "secondary"}
						disabled={disabled}
						onClick={() => onDecision({ id: request.id, approved: false })}
					>
						<Trans>Skip</Trans>
					</Button>
				</div>
			</div>
		),
	);
}

type StoryProposalProps = { story: Omit<CareerStoryData, "applicationId">; facts: readonly ApprovalFact[] };

/** The proposed story part by part, as the reader shows a saved one, with the facts it claims to rest on. */
function StoryProposal({ story, facts }: StoryProposalProps) {
	const parts = [
		{ letter: "S", label: t`Situation`, text: story.situation },
		{ letter: "T", label: t`Task`, text: story.task },
		{ letter: "A", label: t`Action`, text: story.action },
		{ letter: "R", label: t`Result`, text: story.result },
		{ letter: "R", label: t`Reflection`, text: story.reflection },
	];
	return (
		<div className="grid gap-3">
			<div className="grid gap-0.5">
				<p className="text-[15px] leading-[22px] font-semibold text-pretty">{story.title}</p>
				{story.tags.length > 0 && <p className="text-xs text-ink-3">{story.tags.join(" · ")}</p>}
			</div>
			<dl className="grid">
				{parts.map((part) => (
					<div
						key={part.label}
						className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-t border-line py-2.5 first:border-t-0"
					>
						<span
							aria-hidden="true"
							className={cn(
								"size-7 rounded-lg text-center font-mono text-[13px] leading-7 font-semibold",
								part.text.trim() ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-3",
							)}
						>
							{part.letter}
						</span>
						<div className="grid min-w-0 gap-0.5">
							<dt className="text-[13px] font-semibold text-ink-2">{part.label}</dt>
							<dd className="text-sm leading-[21px] wrap-anywhere whitespace-pre-line">
								{part.text.trim() || (
									<span className="text-ink-3 italic">
										<Trans>Left blank. Add it later only if you can support it.</Trans>
									</span>
								)}
							</dd>
						</div>
					</div>
				))}
			</dl>
			<div className="grid gap-1.5">
				<p className="text-xs font-semibold text-ink-3">
					<Trans>Backed by</Trans>
				</p>
				{story.factIds.map((id) => {
					const fact = facts.find((item) => item.id === id && item.status === "active");
					return (
						<p
							key={id}
							className={cn(
								"flex items-start gap-2 rounded-md bg-bg px-2.5 py-2 text-[13px] leading-[19px]",
								!fact && "text-warn-text",
							)}
						>
							<Icon
								name={fact ? "link-simple-horizontal" : "warning"}
								size={16}
								className={cn("mt-0.5 shrink-0", fact && "text-accent-text")}
							/>
							{fact ? (
								fact.text
							) : (
								<Trans>A fact that isn't available here. Saving will fail; edit the story first.</Trans>
							)}
						</p>
					);
				})}
				<p className="text-xs text-ink-3">
					<Trans>Check that these facts support what the story claims before saving.</Trans>
				</p>
			</div>
		</div>
	);
}
