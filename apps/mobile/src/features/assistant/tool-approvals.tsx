import type { CareerStoryData } from "@reactive-resume/schema/career";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { View } from "react-native";
import { agentApprovalRequests } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { Button, Icon, Text, useTheme } from "@/ui";

type ApprovalFact = { id: string; text: string; status: string };
/** A saved story a proposal may update: its parts show as "Was" where they change (web tool-approvals). */
type ApprovalStory = { id: string; data: Omit<CareerStoryData, "applicationId"> };

type StoryEditorArgs = {
	story: CareerStoryData;
	onChange: (story: CareerStoryData) => void;
	/** The edited story was saved: the proposal as it stood is declined. */
	onSaved: () => void;
	/** Back to the review card; the edits stay for the next Edit first. */
	onClose: () => void;
};
export type StoryEditorRender = (args: StoryEditorArgs) => ReactNode;

type ToolApprovalsProps = {
	message: UIMessage;
	disabled: boolean;
	/** The user's facts, to show which ones a proposed story rests on. */
	facts?: readonly ApprovalFact[];
	/** The user's stories, so a proposed update shows what it changes. */
	stories?: readonly ApprovalStory[] | undefined;
	/** The conversation's scope: a story proposed in a job's workspace stays with that job. */
	applicationId?: string | null;
	/** The story editor Edit first opens. Without it, a proposal can only be saved as is or skipped. */
	storyEditor?: StoryEditorRender | undefined;
	onDecision: (decision: { id: string; approved: boolean }) => void;
};

export function ToolApprovals({
	message,
	disabled,
	facts = [],
	stories = [],
	applicationId = null,
	storyEditor,
	onDecision,
}: ToolApprovalsProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const [editing, setEditing] = useState<string | null>(null);
	const [edits, setEdits] = useState<Record<string, CareerStoryData>>({});
	return agentApprovalRequests(message).map((request) => {
		// An update names a saved story; Edit first (which saves a new story) is left out.
		const updating = request.kind === "story" && request.story.id !== undefined;
		const previous =
			updating && request.kind === "story" ? stories.find((story) => story.id === request.story.id) : undefined;
		return (
			<View
				key={request.id}
				style={{
					gap: space.s3,
					padding: space.s3,
					marginTop: space.s2,
					borderRadius: radius.rLg,
					borderWidth: 1,
					borderColor: colors.line,
					backgroundColor: colors.raised,
				}}
			>
				<Text variant="label">
					{request.kind === "search" ? (
						<Trans>Send this exact query to your web search provider?</Trans>
					) : updating ? (
						previous ? (
							<Trans>Update “{previous.data.title}” in Knowledge?</Trans>
						) : (
							<Trans>Update this story in Knowledge?</Trans>
						)
					) : (
						<Trans>Save this story to Knowledge?</Trans>
					)}
				</Text>
				{request.kind === "search" ? (
					<Text selectable>{request.text}</Text>
				) : (
					<View style={{ gap: space.s2 }}>
						<Text variant="label" selectable>
							{request.story.title}
						</Text>
						{request.story.tags.length > 0 ? (
							<Text variant="caption" color="ink3">
								{request.story.tags.join(" · ")}
							</Text>
						) : null}
						{previous && previous.data.tags.join("\n") !== request.story.tags.join("\n") ? (
							<Text variant="caption" color="ink3">
								{t`Tags were: ${previous.data.tags.join(" · ") || t`none`}`}
							</Text>
						) : null}
						{[
							{ label: t`Situation`, text: request.story.situation, was: previous?.data.situation },
							{ label: t`Task`, text: request.story.task, was: previous?.data.task },
							{ label: t`Action`, text: request.story.action, was: previous?.data.action },
							{ label: t`Result`, text: request.story.result, was: previous?.data.result },
							{ label: t`Reflection`, text: request.story.reflection, was: previous?.data.reflection },
						].map((part) => (
							<View key={part.label} style={{ gap: space.s1 }}>
								<Text variant="caption" color="ink2">
									{part.label}
								</Text>
								{part.text.trim() ? (
									<Text selectable>{part.text}</Text>
								) : (
									<Text color="ink3">
										<Trans>Left blank. Add it later only if you can support it.</Trans>
									</Text>
								)}
								{part.was !== undefined && part.was.trim() !== part.text.trim() ? (
									<Text variant="caption" color="ink3" selectable>
										{t`Was: ${part.was.trim() || t`blank`}`}
									</Text>
								) : null}
							</View>
						))}
						<Text variant="caption" color="ink2">
							<Trans>Backed by</Trans>
						</Text>
						{request.story.factIds.map((id) => {
							const fact = facts.find((item) => item.id === id && item.status === "active");
							return (
								<View key={id} style={{ flexDirection: "row", gap: space.s2 }}>
									<Icon
										name={fact ? "link-simple-horizontal" : "warning-circle"}
										size={16}
										color={fact ? colors.accentText : colors.warnText}
									/>
									<Text color={fact ? "ink" : "warnText"} style={{ flex: 1 }}>
										{fact ? fact.text : <Trans>A fact that isn't available here. Saving will fail.</Trans>}
									</Text>
								</View>
							);
						})}
						{/* An update replaces the facts too: name the ones it no longer rests on (web tool-approvals). */}
						{(previous?.data.factIds ?? [])
							.filter((id) => !request.story.factIds.includes(id))
							.map((id) => (
								<View key={`removed-${id}`} style={{ flexDirection: "row", gap: space.s2 }}>
									<Icon name="x-circle" size={16} color={colors.ink3} />
									<Text color="ink3" style={{ flex: 1 }}>
										{t`No longer backed by: ${facts.find((fact) => fact.id === id)?.text ?? t`a fact that isn't available here`}`}
									</Text>
								</View>
							))}
						<Text variant="caption" color="ink3">
							<Trans>Check that these facts support what the story claims before saving.</Trans>
						</Text>
					</View>
				)}
				<Button
					disabled={disabled}
					label={request.kind === "search" ? t`Search the web` : updating ? t`Update story` : t`Save story`}
					onPress={() => onDecision({ id: request.id, approved: true })}
				/>
				{request.kind === "story" && storyEditor && !updating ? (
					<Button
						variant="secondary"
						disabled={disabled}
						label={t`Edit first`}
						onPress={() => setEditing(request.id)}
					/>
				) : null}
				{request.kind === "story" && storyEditor && editing === request.id && !disabled
					? storyEditor({
							story: edits[request.id] ?? { ...request.story, applicationId },
							onChange: (story) => setEdits((current) => ({ ...current, [request.id]: story })),
							onSaved: () => {
								setEditing(null);
								onDecision({ id: request.id, approved: false });
							},
							onClose: () => setEditing(null),
						})
					: null}
				<Button
					variant="secondary"
					disabled={disabled}
					label={t`Skip`}
					onPress={() => onDecision({ id: request.id, approved: false })}
				/>
			</View>
		);
	});
}
