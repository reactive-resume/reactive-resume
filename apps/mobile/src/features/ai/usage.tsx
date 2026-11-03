import type { AiAction, AiUsageSummary } from "@reactive-resume/schema/ai-usage";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { groupAiUsage } from "@reactive-resume/schema/ai-usage";
import { orpc } from "@/api/client";
import { Banner, Button, Card, Text, useTheme } from "@/ui";

export const aiActionLabel = (action: AiAction) =>
	({
		"provider-test": t`Provider test`,
		"import-pdf": t`PDF import`,
		"import-docx": t`Word import`,
		"writing-review": t`Writing review`,
		improve: t`Improve`,
		"parse-posting": t`Read posting`,
		"autofill-posting": t`Fill fields`,
		"match-score": t`MCP match score`,
		"tailor-resume": t`MCP tailoring`,
		"draft-message": t`MCP message draft`,
		"draft-letter": t`Letter draft`,
		"role-suggestions": t`Role suggestions`,
		fit: t`Fit`,
		briefing: t`Briefing`,
		practice: t`Practice`,
		debrief: t`Debrief`,
		reply: t`Reply`,
		answer: t`Form answer`,
		assistant: t`Assistant`,
		"career-chat": t`Career chat`,
		transcription: t`Voice transcription`,
		speech: t`Voice playback`,
	})[action];

type AiResultUsageProps = { usage: AiUsageSummary | null | undefined };
export function AiResultUsage({ usage }: AiResultUsageProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	return (
		<View style={{ gap: space.s1 }}>
			<Text variant="caption" color="ink3">
				{usage
					? t`AI request attempts: ${i18n.number(usage.requests)}`
					: t`AI request history unavailable for this result.`}
			</Text>
			{usage?.models.map((model) => (
				<Text variant="caption" color="ink3" key={JSON.stringify(model)}>
					{model.label} · {model.provider} · {model.model}
				</Text>
			))}
		</View>
	);
}

export function AiUsageSection() {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const query = useQuery(orpc.ai.usage.queryOptions());
	const report = query.data;
	const date = (value: Date) => i18n.date(value, { dateStyle: "medium", timeZone: report?.timezone ?? "UTC" });
	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="title" accessibilityRole="header">{t`AI usage this week`}</Text>
			<Text color="ink3">{t`Request attempts recorded by this server, including failed or cancelled attempts. Retries and each model call in a tool loop count separately; stream chunks, tools themselves and saving do not.`}</Text>
			<Button
				label={t`Refresh usage`}
				variant="secondary"
				disabled={query.isFetching}
				onPress={() => void query.refetch()}
			/>
			{query.isError ? (
				<Banner
					tone="warn"
					message={t`AI usage couldn't be loaded. Try refreshing. Older servers may need an update.`}
				/>
			) : !report ? (
				<Text>{t`Loading usage…`}</Text>
			) : (
				<>
					<Text>{t`AI request attempts: ${i18n.number(report.requests)}`}</Text>
					<Text variant="caption" color="ink3">
						{date(report.start)} – {date(new Date(report.end.getTime() - 1))} · {report.timezone}
					</Text>
					{report.groups.length === 0 && <Text color="ink3">{t`No AI request attempts recorded this week.`}</Text>}
					{groupAiUsage(report).map((provider) => (
						<Card key={JSON.stringify([provider.providerId, provider.provider])} style={{ gap: space.s2 }}>
							<Text variant="label">
								{provider.labels.join(" / ")} · {provider.provider}
							</Text>
							<Text>{t`AI request attempts: ${i18n.number(provider.requests)}`}</Text>
							{provider.groups.map((group) => (
								<Text variant="caption" color="ink2" key={JSON.stringify([group.action, group.model, group.label])}>
									{aiActionLabel(group.action)} · {group.model} · {group.label} · {i18n.number(group.requests)}
								</Text>
							))}
						</Card>
					))}
				</>
			)}
			<Text
				variant="caption"
				color="ink3"
			>{t`Weeks run Monday through Sunday in your account timezone. History starts when this server begins recording; earlier requests aren't reconstructed. Connection labels and models are kept as used, even after a connection is removed.`}</Text>
			<Text
				variant="caption"
				color="ink3"
			>{t`These are attempts, not billing, token counts or costs. An interrupted server can record an attempt before sending it; this report cannot confirm provider receipt.`}</Text>
		</View>
	);
}
