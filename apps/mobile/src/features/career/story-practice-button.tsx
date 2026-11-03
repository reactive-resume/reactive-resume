import type { Story } from "./hooks";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { canUseCareerStory } from "@reactive-resume/schema/career-practice";
import { useCareerTime, useNow } from "./hooks";
import { collectInterviews } from "./scheduling";
import { useApplications } from "@/features/applications/queries";
import { useFacts } from "@/features/workspace/hooks";
import { workspaceHref } from "@/features/workspace/shell";
import { Banner, Button, SelectSheet, Text } from "@/ui";

type StoryPracticeButtonProps = { story: Story };

export function StoryPracticeButton({ story }: StoryPracticeButtonProps) {
	const { t } = useLingui();
	const router = useRouter();
	const now = useNow();
	const time = useCareerTime();
	const applications = useApplications();
	const facts = useFacts(null);
	const [choice, setChoice] = useState<string | null>(null);
	if (applications.isError || facts.isError)
		return (
			<Banner
				tone="danger"
				message={t`Couldn't load interviews. Retry`}
				action={{
					label: t`Retry`,
					onPress: () => {
						void applications.refetch();
						void facts.refetch();
					},
				}}
			/>
		);
	if (applications.isPending || facts.isPending)
		return <Button variant="ghost" label={t`Loading interviews…`} onPress={() => {}} disabled />;
	const upcoming = collectInterviews(applications.data ?? [], now).slice(0, 5);
	const usable = canUseCareerStory(story, facts.data ?? [], null);
	if (!usable)
		return (
			<View>
				<Button
					variant="ghost"
					label={t({ message: "Practice", context: "Button: rehearse interview answers" })}
					onPress={() => {}}
					disabled
				/>
				<Text color="ink3">
					{story.data.factIds.length
						? t`A fact this story uses is switched off or changed since. Edit the story to check it.`
						: t`Link a fact to practice this story`}
				</Text>
			</View>
		);
	const practise = (id: string) => {
		const interview = upcoming.find((item) => item.interview.id === id);
		if (interview)
			router.push(
				workspaceHref(interview.application.id, "practise", {
					speak: true,
					story: story.id,
					round: interview.interview.id,
				}),
			);
	};
	if (!upcoming.length)
		return (
			<Button
				variant="secondary"
				icon="microphone"
				label={t({ message: "Practice", context: "Button: rehearse interview answers" })}
				onPress={() => router.setParams({ practice: story.id })}
			/>
		);
	const next = upcoming[0];
	if (upcoming.length === 1 && next)
		return (
			<Button
				variant="secondary"
				icon="microphone"
				label={t({
					message: `Practice for ${next.application.company}`,
					context: "Button: rehearse interview answers",
				})}
				onPress={() => practise(next.interview.id)}
			/>
		);
	return (
		<SelectSheet
			label={t`Practice for which interview?`}
			value={choice}
			options={upcoming.map((item) => ({
				value: item.interview.id,
				label: `${item.application.company} · ${time.when(item.start)}`,
			}))}
			onChange={(id) => {
				setChoice(id);
				practise(id);
			}}
		/>
	);
}
