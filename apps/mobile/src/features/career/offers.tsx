import type { SavedItem } from "./hooks";
import type { ApplicationSummary } from "@/features/applications/types";
import type { CareerProfileData, OfferTerms } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { selectOfferPair } from "@reactive-resume/schema/career-offer";
import { formatDateOnly } from "@reactive-resume/utils/timezone";
import { useCareerQueries, useCareerTime, useNow, useOffers } from "./hooks";
import { client } from "./hooks";
import { formatMoney, matchingPlace, meetsMinimum, moneyDifference, sameTerms } from "./offer-compare";
import { OfferEntry, OfferForm } from "./offer-entry";
import { Actions, LoadState } from "./shared";
import { withUndo } from "./undo";
import { useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import { Banner, Button, Card, EmptyState, Screen, SelectSheet, Text, showToast, useTheme } from "@/ui";

type Offer = SavedItem & { data: Extract<SavedItem["data"], { kind: "offer" }> };
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
	const applications = useApplications();
	const [hidden, setHidden] = useState<string[]>([]);
	const [editing, setEditing] = useState<Offer | null>(null);
	const offers = (query.data ?? []).filter(
		(item): item is Offer => item.data.kind === "offer" && !hidden.includes(item.id),
	);
	// Deleting waits out its Undo toast, as everywhere else saved work is deleted.
	const remove = (offer: Offer) => {
		setHidden((ids) => [...ids, offer.id]);
		withUndo({
			message: t`Offer deleted`,
			restore: () => setHidden((ids) => ids.filter((id) => id !== offer.id)),
			failed: () => showToast({ message: t`Couldn't delete that offer. Try again.` }),
			commit: () => client.career.deleteSavedItem({ id: offer.id }).then(() => query.refetch()),
		});
	};
	const params = useLocalSearchParams<{ a?: string; b?: string }>();
	const routeKey = JSON.stringify([params.a, params.b]);
	const [selection, setSelection] = useState<{ route: string; ids: (string | undefined)[] }>({
		route: routeKey,
		ids: [],
	});
	if (selection.route !== routeKey) setSelection({ route: routeKey, ids: [] });
	const selected = selection.route === routeKey ? selection.ids : [];
	const setSelected = (ids: (string | undefined)[]) => setSelection({ route: routeKey, ids });
	const pair = selectOfferPair(offers, { a: selected[0] ?? params.a, b: selected[1] ?? params.b });
	const a = offers.find((row) => row.id === pair.a);
	const b = offers.find((row) => row.id === pair.b);
	const sameApplication = !!a?.applicationId && a.applicationId === b?.applicationId;
	const earlier = sameApplication
		? offers.filter((offer) => offer.id === a?.id || offer.id === b?.id).at(-1)
		: undefined;
	const time = useCareerTime();
	return (
		<Screen onRefresh={() => Promise.allSettled([query.refetch(), profile.refetch(), applications.refetch()])}>
			<Text color="ink3">{t`Compared in their original currency and pay period. Comparing doesn't share anything with the coach.`}</Text>
			{earlier && (
				<Text variant="title">{t`Changes since ${earlier.data.version === "verbal" ? t`Verbal offer` : t`Written offer`}`}</Text>
			)}
			{applications.data && <OfferEntry primary={!query.isPending && !query.isError && !offers.length} />}
			{editing ? (
				<OfferForm
					offer={editing}
					{...(editing.applicationId && editing.application
						? {
								application: {
									id: editing.applicationId,
									company: editing.application.company,
									role: editing.application.role,
								},
							}
						: {})}
					onClose={() => setEditing(null)}
				/>
			) : null}
			<LoadState query={query} />
			<LoadState query={profile} />
			<LoadState query={applications} />
			{applications.data && <OfferStageApplications offers={offers} applications={applications.data} />}
			{!query.isError && !query.isPending && !applications.isPending && !applications.isError && !offers.length ? (
				<EmptyState
					variant="card"
					title={t`No offers to compare yet`}
					message={t`Add offer terms manually, including accepted offers, or use optional AI extraction in Messages. Closing as accepted does not record terms.`}
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
											label: `${row.application?.company ?? t`Deleted application`} · ${row.application?.role ?? ""} · ${row.data.version === "verbal" ? t`Verbal offer` : t`Written offer`} · ${time.when(row.createdAt)} · #${offers.filter((item) => item.applicationId === row.applicationId).findIndex((item) => item.id === row.id) + 1} · ${offers.find((item) => item.applicationId === row.applicationId)?.id === row.id ? t`Latest` : ""} · ${row.application?.closedReason === "accepted" ? t`Accepted` : row.application?.status === "closed" ? t`Closed` : row.application?.status === "offer" ? t`Offer` : t`In progress`}`,
										}))}
									onChange={(id) => setSelected(side === 0 ? [id, b?.id] : [a?.id, id])}
								/>
								{offer ? (
									<OfferCard
										offer={offer}
										other={side === 0 ? b : a}
										profile={profile.data}
										onEdit={() => setEditing(offer)}
										onDelete={() => remove(offer)}
									/>
								) : (
									<EmptyState
										variant="card"
										title={t`Save another offer to compare`}
										message={t`Add offer terms manually, including accepted offers, or use optional AI extraction in Messages. Closing as accepted does not record terms.`}
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

type OfferStageApplicationsProps = { offers: Offer[]; applications: ApplicationSummary[] };

/**
 * Applications in the Offer stage that have no saved terms yet, as on web. They're listed so none is missed, each with
 * its own Add offer form; nothing is compared until the user enters the terms.
 */
function OfferStageApplications({ offers, applications }: OfferStageApplicationsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const withTerms = new Set(offers.map((offer) => offer.applicationId));
	const pending = applications.filter(
		(application) => application.status === "offer" && !withTerms.has(application.id),
	);
	if (pending.length === 0) return null;
	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="title">{t`In the Offer stage, terms not added`}</Text>
			<Text color="ink3">{t`Add each offer's terms to compare it. Nothing is filled in for you.`}</Text>
			{pending.map((application) => (
				<Card key={application.id} style={{ gap: space.s3 }}>
					<Text weight={600}>{application.company}</Text>
					<Text color="ink2">{application.role}</Text>
					<OfferEntry application={{ id: application.id, company: application.company, role: application.role }} />
				</Card>
			))}
		</View>
	);
}

type OfferCardProps = {
	offer: Offer;
	other: Offer | undefined;
	profile: CareerProfileData | undefined;
	onEdit: () => void;
	onDelete: () => void;
};
function OfferCard({ offer, other, profile, onEdit, onDelete }: OfferCardProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const time = useCareerTime();
	const now = useNow();
	const data = offer.data;
	const deciding = offer.application?.status !== "closed";
	const sameApplication = !!offer.applicationId && offer.applicationId === other?.applicationId;
	// A blank is only "not in the message" if nobody checked it by hand; typed-in blanks were left blank.
	const unknown = !deciding
		? t`Not recorded`
		: data.origin === "message" && !data.editedAt
			? t`Not found in the message · ask`
			: data.origin
				? t`Left blank · ask`
				: t`Not recorded · ask`;
	const origin =
		data.origin === "message"
			? data.editedAt
				? t`Read from a message, edited by you`
				: t`Read from a message`
			: data.origin === "manual"
				? t`Entered by you`
				: null;
	const money = (key: "base" | "variable" | "learning") => {
		const amount = data[key];
		if (amount === null) return unknown;
		const difference = other ? moneyDifference(data, other.data, key) : null;
		const delta =
			difference === null
				? ""
				: `${difference > 0 ? "+" : "−"}${formatMoney(time.locale, data.currency, Math.abs(difference))}`;
		const version = other?.data.version === "verbal" ? t`Verbal offer` : t`Written offer`;
		const note =
			difference === null || difference === 0
				? ""
				: sameApplication
					? t`${delta} vs ${version}`
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
		{
			label: t`Bonus`,
			// A percentage or a condition without an amount is shown as written, never turned into money.
			value:
				data.variable === null && data.variableConditions
					? t`${data.variableConditions} · No amount stated · value uncertain`
					: money("variable"),
		},
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
		{
			label: t`Starts`,
			value: data.startDate ? formatDateOnly(data.startDate, time.locale) : unknown,
		},
		{ label: t`Respond by`, value: data.respondBy ? time.when(data.respondBy) : unknown },
	];
	const questions = [
		data.base === null ? t`What is the base salary?` : null,
		data.variable === null && !data.variableConditions ? t`Is there a bonus, and what does it depend on?` : null,
		!data.equity ? t`What equity is included, and on what terms?` : null,
		data.officeDays === null ? t`How many office days are expected?` : null,
		!data.startDate ? t`When would you start?` : null,
		!data.respondBy ? t`When do you need a decision?` : null,
	].filter(Boolean);
	return (
		<Card style={{ gap: space.s3 }}>
			<Text variant="heading">{offer.application?.company ?? t`Deleted application`}</Text>
			<Text>{offer.application?.role}</Text>
			<Text>
				{offer.application?.closedReason === "accepted"
					? t`Accepted`
					: offer.application?.status === "closed"
						? t`Closed`
						: offer.application?.status === "offer"
							? t`Offer`
							: t`In progress`}
			</Text>
			<Text color="ink3">
				{data.version === "verbal" ? t`Verbal offer` : t`Written offer`} · {data.currency} · {periodLabel(data.period)}
			</Text>
			{origin ? <Text color="ink3">{origin}</Text> : null}
			<Actions>
				<Button variant="secondary" size="sm" icon="pencil-simple" label={t`Edit terms`} onPress={onEdit} />
				<Button variant="ghost" size="sm" icon="trash" label={t`Delete offer`} onPress={onDelete} />
			</Actions>
			{other && !sameTerms(data, other.data) ? (
				<Banner tone="warn" message={t`Different currencies or pay periods. No money difference is calculated.`} />
			) : null}
			{terms.map((term) => (
				<View key={term.label} style={{ gap: space.s1 }}>
					<Text variant="label">{term.label}</Text>
					<Text color="ink2">{term.value}</Text>
				</View>
			))}
			{deciding && deadline !== null && deadline < 48 * 3_600_000 ? (
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
			{deciding &&
			questions.length &&
			(!sameApplication || (other && new Date(offer.createdAt) >= new Date(other.createdAt))) ? (
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
