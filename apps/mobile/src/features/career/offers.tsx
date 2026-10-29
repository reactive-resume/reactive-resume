import type { SavedItem } from "./hooks";
import type { CareerProfileData, OfferTerms } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCareerQueries, useCareerTime, useNow, useOffers } from "./hooks";
import { defaultPair, formatMoney, matchingPlace, meetsMinimum, moneyDifference, sameTerms } from "./offer-compare";
import { OfferEntry } from "./offer-entry";
import { Actions, LoadState } from "./shared";
import { routes } from "@/routes";
import { Banner, Button, Card, EmptyState, Screen, SelectSheet, Text, useTheme } from "@/ui";

type Offer = SavedItem & { data: OfferTerms & { kind: "offer" } };
const periodLabel = (value: OfferTerms["period"]) =>
	value === "year" ? t`Per year` : value === "month" ? t`Per month` : t`Per hour`;
export function OffersScreen() {
	const { t } = useLingui();
	const { space, size } = useTheme();
	const [width, setWidth] = useState(0);
	const tablet = width >= size.panel * 2 + space.s4;
	const router = useRouter();
	const query = useOffers();
	const { profile } = useCareerQueries();
	const offers = (query.data ?? []).filter((item): item is Offer => item.data.kind === "offer");
	const [selected, setSelected] = useState<(string | undefined)[]>([]);
	const defaults = defaultPair(offers);
	const a = offers.find((row) => row.id === selected[0]) ?? offers.find((row) => row.id === defaults[0]);
	const b =
		offers.find((row) => row.id === selected[1] && row.id !== a?.id) ??
		offers.find((row) => row.id === defaults[1] && row.id !== a?.id);
	return (
		<Screen onRefresh={() => Promise.allSettled([query.refetch(), profile.refetch()])}>
			<Text color="ink3">{t`Compared in their original currency and pay period. Comparing doesn't share anything with the coach.`}</Text>
			<OfferEntry primary={!query.isPending && !query.isError && !offers.length} />
			<LoadState query={query} />
			<LoadState query={profile} />
			{!query.isError && !query.isPending && !offers.length ? (
				<EmptyState
					title={t`No offers to compare yet`}
					message={t`Add offer terms manually, or use optional AI extraction in Messages.`}
				/>
			) : null}
			{offers.length ? (
				<>
					<Actions>
						<Button
							variant="secondary"
							label={t`Swap`}
							disabled={!a || !b}
							onPress={() => setSelected([b?.id, a?.id])}
						/>
						<Button
							label={t`Plan what to ask`}
							onPress={() =>
								router.push({
									pathname: routes.career("coach"),
									params: { offers: [a?.id, b?.id].filter((id): id is string => !!id) },
								})
							}
						/>
					</Actions>
					<View
						onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
						style={{ flexDirection: tablet ? "row" : "column", gap: space.s4, alignItems: "stretch" }}
					>
						{[a, b].map((offer, side) => (
							<View key={side} style={{ flex: tablet ? 1 : 0, gap: space.s3 }}>
								<SelectSheet
									label={side === 0 ? t`First offer` : t`Second offer`}
									value={offer?.id ?? null}
									options={offers
										.filter((row) => row.id !== (side === 0 ? b?.id : a?.id))
										.map((row) => ({
											value: row.id,
											label: `${row.application?.company ?? t`Deleted application`} · ${row.application?.role ?? ""} · ${row.data.version === "verbal" ? t`Verbal offer` : t`Written offer`}`,
										}))}
									onChange={(id) => setSelected(side === 0 ? [id, b?.id] : [a?.id, id])}
								/>
								{offer ? (
									<OfferCard offer={offer} other={side === 0 ? b : a} profile={profile.data} />
								) : (
									<EmptyState
										title={t`Save another offer to compare`}
										message={t`Add offer terms manually, or use optional AI extraction in Messages.`}
									/>
								)}
							</View>
						))}
					</View>
					<Banner
						tone="warn"
						message={t`Totals aren't added up. Bonus and equity depend on conditions; equity value is uncertain. Read original offer documents.`}
					/>
				</>
			) : null}
		</Screen>
	);
}

type OfferCardProps = { offer: Offer; other: Offer | undefined; profile: CareerProfileData | undefined };
function OfferCard({ offer, other, profile }: OfferCardProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const time = useCareerTime();
	const now = useNow();
	const data = offer.data;
	const unknown = t`Unknown · ask`;
	const money = (key: "base" | "variable" | "learning") => {
		const amount = data[key];
		if (amount === null) return unknown;
		const difference = other ? moneyDifference(data, other.data, key) : null;
		const note =
			difference === null || difference === 0
				? ""
				: difference > 0
					? t`${formatMoney(time.locale, data.currency, difference)} more`
					: t`${formatMoney(time.locale, data.currency, -difference)} less`;
		return [formatMoney(time.locale, data.currency, amount), periodLabel(data.period), note]
			.filter(Boolean)
			.join(" · ");
	};
	const minimum = profile ? meetsMinimum(data, profile.minBase) : null;
	const deadline = data.respondBy ? new Date(data.respondBy).getTime() - now.getTime() : null;
	const terms = [
		{ label: t`Base salary`, value: money("base") },
		{ label: t`Bonus`, value: money("variable") },
		{ label: t`Bonus conditions`, value: data.variableConditions || unknown },
		{ label: t`Equity`, value: data.equity ? t`${data.equity} · Value uncertain` : unknown },
		{ label: t`Where you work`, value: data.location || unknown },
		{
			label: t`Office days per week`,
			value:
				data.officeDays === null
					? unknown
					: data.officeDays === 0
						? t`Remote`
						: plural(data.officeDays, { one: "# office day a week", other: "# office days a week" }),
		},
		{ label: t`Leave`, value: data.leave || unknown },
		{ label: t`Learning budget`, value: money("learning") },
		{ label: t`Other benefits`, value: data.other || t`Not recorded` },
		{ label: t`Respond by`, value: data.respondBy ? time.when(data.respondBy) : unknown },
	];
	const questions = [
		data.base === null ? t`What is the base salary?` : null,
		data.variable === null ? t`Is there a bonus, and what does it depend on?` : null,
		!data.equity ? t`What equity is included, and on what terms?` : null,
		data.officeDays === null ? t`How many office days are expected?` : null,
		!data.respondBy ? t`When do you need a decision?` : null,
	].filter(Boolean);
	return (
		<Card style={{ gap: space.s3 }}>
			<Text variant="heading">{offer.application?.company ?? t`Deleted application`}</Text>
			<Text>{offer.application?.role}</Text>
			<Text color="ink3">
				{data.version === "verbal" ? t`Verbal offer` : t`Written offer`} · {data.currency} · {periodLabel(data.period)}
			</Text>
			{other && !sameTerms(data, other.data) ? (
				<Banner tone="warn" message={t`Different currencies or pay periods. No money difference is calculated.`} />
			) : null}
			{terms.map((term) => (
				<View key={term.label} style={{ gap: space.s1 }}>
					<Text variant="label">{term.label}</Text>
					<Text color="ink2">{term.value}</Text>
				</View>
			))}
			{deadline !== null && deadline < 48 * 3_600_000 ? (
				<Banner tone="warn" message={deadline < 0 ? t`Response deadline has passed.` : t`Less than 48 hours left.`} />
			) : null}
			{profile ? (
				<View style={{ gap: space.s2 }}>
					<Text variant="title">{t`Your requirements`}</Text>
					{profile.minBase.amount !== null ? (
						<Text>
							{minimum === null
								? t`Minimum salary cannot be compared in these terms.`
								: minimum
									? t`Meets your minimum base salary.`
									: t`Below your minimum base salary.`}
						</Text>
					) : null}
					{profile.maxOfficeDays !== null ? (
						<Text>
							{data.officeDays === null
								? t`Office days are unknown.`
								: data.officeDays <= profile.maxOfficeDays
									? t`Within your office-day limit.`
									: t`Above your office-day limit.`}
						</Text>
					) : null}
					{profile.locations.length ? (
						<Text>
							{data.location && matchingPlace(data.location, profile.locations)
								? t`Matches a preferred location.`
								: t`Location match is unknown.`}
						</Text>
					) : null}
					{profile.noticeWeeks !== null ? (
						<Text>
							{plural(profile.noticeWeeks, {
								one: "Your notice period: # week.",
								other: "Your notice period: # weeks.",
							})}
						</Text>
					) : null}
				</View>
			) : null}
			{questions.length ? (
				<View style={{ gap: space.s2 }}>
					<Text variant="title">{t`Open questions`}</Text>
					{questions.map((question) => (
						<Text key={question}>{question}</Text>
					))}
				</View>
			) : null}
		</Card>
	);
}
