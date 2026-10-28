import type { UIMessage } from "ai";
import { Trans } from "@lingui/react/macro";
import { agentApprovalRequests } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { Button } from "@reactive-resume/ui/components/button";

type ToolApprovalsProps = {
	message: UIMessage;
	disabled: boolean;
	onDecision: (decision: { id: string; approved: boolean }) => void;
};

export function ToolApprovals({ message, disabled, onDecision }: ToolApprovalsProps) {
	return agentApprovalRequests(message).map(({ id, kind, text }) => (
		<div key={id} className="bg-surface-2 my-3 grid gap-3 rounded-lg border border-line p-4">
			<p className="text-sm font-medium">
				{kind === "search" ? (
					<Trans>Send this exact query to your web search provider?</Trans>
				) : (
					<Trans>Save this story to Knowledge?</Trans>
				)}
			</p>
			<p className="text-sm wrap-anywhere whitespace-pre-wrap">{text}</p>
			<div className="flex gap-2">
				<Button size="sm" disabled={disabled} onClick={() => onDecision({ id, approved: true })}>
					{kind === "search" ? <Trans>Search the web</Trans> : <Trans>Save story</Trans>}
				</Button>
				<Button size="sm" variant="secondary" disabled={disabled} onClick={() => onDecision({ id, approved: false })}>
					<Trans>Skip</Trans>
				</Button>
			</div>
		</div>
	));
}
