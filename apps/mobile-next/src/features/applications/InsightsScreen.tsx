// J4 · Insights: three numbers, how far applications got, and which channel gets replies. Range from the bar button.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { insights, type InsightsRange } from "./model";
import { RowPlaceholders, useBarMenu } from "./parts";
import { storyboard } from "./storyboard";
import { useApplications } from "@/data";
import { now } from "@/data/clock";
import {
	Button,
	FunnelBars,
	HeroCard,
	ListRow,
	MenuItem,
	PageSubtitle,
	PushScreen,
	SectionHeading,
	ThreeUpStats,
} from "@/ui";

const RANGES: InsightsRange[] = ["30", "90", "all"];
const rangeLabel = (range: InsightsRange) => (range === "all" ? t`All time` : range === "30" ? t`30 days` : t`90 days`);

/** The storyboard's numbers (its 18 applications with sources aren't in the fixture yet). */
function storyboardInsights(range: InsightsRange) {
	const data = storyboard?.insights(range);
	if (!data) return null;
	const labels = { applied: t`Applied`, replied: t`Replied`, interviewed: t`Interviewed`, offer: t`Offer` };
	return {
		...data,
		funnel: data.funnel.map((row) => ({ label: labels[row.key as keyof typeof labels], count: row.count })),
	};
}

export function InsightsScreen() {
	const params = useLocalSearchParams<{ range?: string }>();
	const router = useRouter();
	const range: InsightsRange = RANGES.includes(params.range as InsightsRange) ? (params.range as InsightsRange) : "90";
	const applications = useApplications();
	const menu = useBarMenu();
	const data = storyboard
		? storyboardInsights(range)
		: applications.data
			? insights(applications.data, range, now())
			: null;
	const max = Math.max(1, ...(data?.funnel.map((row) => row.count) ?? [1]));

	return (
		<PushScreen
			title={t`Insights`}
			subtitle={
				<PageSubtitle status>
					{range === "all" ? t`Your whole search so far.` : t`Your search over the last ${range} days.`}
				</PageSubtitle>
			}
			barEnd={menu.wrap(<Button label={rangeLabel(range)} tone="ghost" size="sm" onPress={menu.open} />)}
			overlay={menu.menu(
				RANGES.map((r) => (
					<MenuItem
						key={r}
						label={rangeLabel(r)}
						onPress={() => {
							menu.close();
							router.setParams({ range: r });
						}}
					/>
				)),
				200,
			)}
		>
			{!data ? (
				<View style={{ paddingTop: 20 }}>
					<RowPlaceholders count={4} />
				</View>
			) : data.sent === 0 ? (
				<HeroCard
					title={t`No replies to chart yet`}
					body={t`No replies to chart yet. Once you've sent a few applications, this shows how far they get and how quickly people reply.`}
				>
					<Button
						label={t`Save a job`}
						tone="primary"
						size="lg"
						block
						onPress={() => router.push("/applications/new")}
					/>
				</HeroCard>
			) : (
				<>
					<ThreeUpStats
						items={[
							{ value: String(data.sent), label: t`applied` },
							{ value: data.repliedShare === null ? "–" : `${data.repliedShare}%`, label: t`replied` },
							{ value: data.medianDays === null ? "–" : t`${data.medianDays} d`, label: t`to first reply` },
						]}
					/>
					<SectionHeading title={t`How far they got`} />
					<FunnelBars rows={data.funnel.map((row) => ({ ...row, fraction: row.count / max }))} />
					<SectionHeading title={t`Where replies came from`} />
					{data.sources.length === 0 ? (
						<PageSubtitle
							status
						>{t`Add where each application came from to see which channel works for you.`}</PageSubtitle>
					) : (
						data.sources.map((row, i) => (
							<ListRow
								key={row.source}
								title={row.source}
								secondary={t`${row.applied} applied`}
								value={t`${row.replied} of ${row.applied}`}
								last={i === data.sources.length - 1}
								boxHidden={i === data.sources.length - 1}
							/>
						))
					)}
				</>
			)}
		</PushScreen>
	);
}
