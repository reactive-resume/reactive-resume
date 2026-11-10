import { t } from "@lingui/core/macro";
import { View } from "react-native";
import { feedbackLinkLine, storyboardBars, type FeedbackLinkRow } from "./activity-model";
import { useDocumentId } from "./document";
import { useFeedbackLinks, useVisitorStatistics } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { PushScreen, BigNumber, Text, SectionHeading, ListRow, Waveform, Skeleton } from "@/ui";

const CHART = 64;

export function ActivityScreen() {
	const id = useDocumentId();
	const { totals, daily } = useVisitorStatistics(id);
	const links = useFeedbackLinks(id);
	const days = daily.data ?? [];
	const peak = days.reduce((best, day) => (day.views > (best?.views ?? -1) ? day : best), days[0]);
	const top = Math.max(1, peak?.views ?? 0);
	const levels = STORYBOARD ? storyboardBars.map((h) => h / CHART) : days.map((day) => day.views / top);
	const active = ((links.data ?? []) as FeedbackLinkRow[]).filter((link) => link.status === "active");
	return (
		<PushScreen title={t`Visitors and feedback`} backLabel={t`Back to Share`}>
			{totals.isPending ? (
				<View style={{ margin: 24 }}>
					<Skeleton height={140} />
				</View>
			) : totals.isError || !totals.data ? (
				<Text color="dangerText" accessibilityRole="alert" style={{ margin: 24 }}>
					{t`Couldn't load visitors. Try again.`}
				</Text>
			) : totals.data.views === 0 ? (
				<Text color="ink3" style={{ margin: 24 }}>
					{t`No visitors yet. Share your link to see views here.`}
				</Text>
			) : (
				<View style={{ marginHorizontal: 24, marginTop: 20 }}>
					<BigNumber>{String(totals.data.views)}</BigNumber>
					<Text color="ink3" style={{ marginTop: 2 }}>
						{t`views in the last 30 days · ${totals.data.downloads} downloads`}
					</Text>
					<View
						accessible
						accessibilityLabel={
							peak
								? t`Views per day over 30 days, highest ${peak.views} on ${new Date(peak.date).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`
								: t`Views per day over 30 days`
						}
						style={{ marginTop: 16 }}
					>
						<Waveform levels={levels} height={CHART} gap={4} opacity={0.85} />
					</View>
					<View style={{ paddingTop: 10 }}>
						<Text color="ink3">{t`Only you see these.`}</Text>
					</View>
				</View>
			)}
			<SectionHeading title={t`Feedback links`} action={t`New link`} paddingBottom={4} />
			{active.map((link, index) => (
				<ListRow
					key={link.id}
					title={link.label}
					secondary={feedbackLinkLine(link)}
					trailing="caret"
					last={index === active.length - 1}
					boxHidden={index === active.length - 1}
				/>
			))}
		</PushScreen>
	);
}
