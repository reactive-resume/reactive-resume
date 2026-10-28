import type { UIMessage } from "ai";
import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import { agentApprovalRequests } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { Button, Text, useTheme } from "@/ui";

type ToolApprovalsProps = {
	message: UIMessage;
	disabled: boolean;
	onDecision: (decision: { id: string; approved: boolean }) => void;
};

export function ToolApprovals({ message, disabled, onDecision }: ToolApprovalsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	return agentApprovalRequests(message).map(({ id, kind, text }) => (
		<View key={id} style={{ gap: space.s3, padding: space.s3 }}>
			<Text>
				{kind === "search" ? (
					<Trans>Send this exact query to your web search provider?</Trans>
				) : (
					<Trans>Save this story to Knowledge?</Trans>
				)}
			</Text>
			<Text selectable>{text}</Text>
			<Button
				disabled={disabled}
				label={kind === "search" ? t`Search the web` : t`Save story`}
				onPress={() => onDecision({ id, approved: true })}
			/>
			<Button
				variant="secondary"
				disabled={disabled}
				label={t`Skip`}
				onPress={() => onDecision({ id, approved: false })}
			/>
		</View>
	));
}
