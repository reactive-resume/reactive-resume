import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useRef } from "react";
import { View } from "react-native";
import { interviewPreparationDue } from "@reactive-resume/schema/career-practice";
import { useCareerTime, useNow } from "./hooks";
import { collectInterviews } from "./scheduling";
import { LoadState } from "./shared";
import { useHasAIProvider } from "@/features/ai/providers";
import { useApplication, useApplications } from "@/features/applications/queries";
import { useGenerate } from "@/features/workspace/hooks";
import { AiNotice, GenerateNotice } from "@/features/workspace/parts";
import { workspaceHref } from "@/features/workspace/shell";
import { Button, Text, useTheme } from "@/ui";

type PrepareNowProps = { applicationId: string; interviewId: string; now: Date };

export function PrepareNow({ applicationId, interviewId, now }: PrepareNowProps) {
	const { t, i18n } = useLingui();
	const { when } = useCareerTime();
	const { space } = useTheme();
	const router = useRouter();
	const application = useApplication(applicationId);
	const provider = useHasAIProvider().defaultProvider;
	const generate = useGenerate(applicationId);
	const pending = useRef(false);
	const plan = () => {
		if (pending.current || !provider) return;
		pending.current = true;
		void generate
			.run({ task: "briefing", interviewId })
			.catch(() => undefined)
			.finally(() => {
				pending.current = false;
			});
	};
	if (!application.data || application.isError) return <LoadState query={application} />;
	const round = application.data.activity.find((item) => item.type === "interview" && item.id === interviewId);
	if (application.data.status === "closed" || !round || !interviewPreparationDue(round.at, now)) return null;
	const company = application.data.company;
	const count = i18n.number(3);
	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="title">{t`Prepare for ${company}`}</Text>
			<Text variant="caption" color="ink3">
				{when(round.at)}
			</Text>
			<AiNotice task="briefing" application={application.data} interview />
			<Button
				variant="secondary"
				label={t`Generate briefing now`}
				loading={generate.isPending}
				disabled={!provider}
				onPress={plan}
			/>
			<GenerateNotice generate={generate} onRetry={plan} />
			{generate.data?.item ? <Text accessibilityLiveRegion="polite">{t`Briefing ready`}</Text> : null}
			<Button
				variant="secondary"
				label={t`Practice ${count} questions`}
				onPress={() => router.push(workspaceHref(applicationId, "practise", { round: interviewId, warmup: true }))}
			/>
		</View>
	);
}

export function PracticeHandoff() {
	const { t } = useLingui();
	const router = useRouter();
	const applications = useApplications();
	const now = useNow();
	if (applications.isError) return <LoadState query={applications} />;
	const next = collectInterviews(applications.data ?? [], now).find((item) => item.start >= now);
	if (!next) return null;
	const company = next.application.company;
	return (
		<Button
			variant="link"
			label={t`Practice in ${company}’s workspace`}
			onPress={() =>
				router.push(workspaceHref(next.application.id, "practise", { round: next.interview.id, warmup: true }))
			}
		/>
	);
}
