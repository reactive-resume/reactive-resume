import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { offerTermsSchema, type OfferTerms } from "@reactive-resume/schema/career";
import { betterBase, betterLeave } from "./model";
import { ResourceState } from "./shared";
import { useDataBackend } from "@/data";
import { useOfferComparison, useCareerActions } from "@/data";
import { now } from "@/data/clock";
import {
	BottomSheet,
	Button,
	Card,
	FooterBar,
	IconButton,
	ListRow,
	PushScreen,
	Text,
	TextField,
	Touch,
	useTheme,
} from "@/ui";

export function OffersScreen() {
	const { scope } = useDataBackend();
	return <ScopedOffersScreen key={scope} />;
}

function ScopedOffersScreen() {
	const comparison = useOfferComparison();
	const query = comparison.offers;
	const profile = comparison.preferences;
	const actions = useCareerActions();
	const [editingId, setEditingId] = useState<string>();
	const [fields, setFields] = useState<Record<string, string>>({});
	const [editError, setEditError] = useState(false);
	const [saving, setSaving] = useState(false);
	const router = useRouter();
	const { colors } = useTheme();
	const { fontScale } = useWindowDimensions();
	const [choosing, setChoosing] = useState<"counter" | "edit" | null>(null);
	const [lastLine, setLastLine] = useState<{ y: number; width: number } | null>(null);
	const offers = (query.data ?? []).filter((o) => o.data.kind === "offer");
	const firstTerms = offers[0]?.data;
	const mixedPay =
		firstTerms?.kind === "offer" &&
		offers.some(
			(o) =>
				o.data.kind === "offer" && (o.data.currency !== firstTerms.currency || o.data.period !== firstTerms.period),
		);
	const rows = [t`Base, a year`, t`Bonus`, t`Equity`, t`Work`, t`Holidays`, t`Start`, t`Reply by`];
	const terms = (data: OfferTerms) => [
		data.base === null
			? "—"
			: new Intl.NumberFormat("en", { style: "currency", currency: data.currency, maximumFractionDigits: 0 }).format(
					data.base,
				),
		data.variablePercent != null
			? `${data.variablePercent}%`
			: data.variable === null
				? "—"
				: new Intl.NumberFormat("en", { style: "currency", currency: data.currency }).format(data.variable),
		data.equity || "—",
		data.location || "—",
		data.leave || "—",
		data.startDate
			? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
					new Date(data.startDate),
				)
			: "—",
		data.respondBy
			? new Intl.DateTimeFormat("en-GB", {
					// A reply due within the week names its day ("Fri 13 Nov").
					...(new Date(data.respondBy).getTime() - now().getTime() < 7 * 86_400_000 ? { weekday: "short" } : {}),
					day: "numeric",
					month: "short",
					timeZone: "UTC",
				})
					.format(new Date(data.respondBy))
					.replace(",", "")
			: "—",
	];
	const edit = (id: string) => {
		const offer = offers.find((item) => item.id === id);
		if (offer?.data.kind !== "offer") return;
		setChoosing(null);
		setEditingId(id);
		const data = offer.data;
		setFields(
			Object.fromEntries(
				["base", "variable", "currency", "period", "equity", "location", "leave", "startDate", "respondBy"].map(
					(key) => [key, String(data[key as keyof typeof data] ?? "")],
				),
			),
		);
		setEditError(false);
	};
	const counter = (id: string) => {
		const offer = offers.find((o) => o.id === id);
		const applicationId = offer?.applicationId;
		if (applicationId) {
			setChoosing(null);
			router.push({
				pathname: `/applications/${applicationId}/messages`,
				params: { offer: id, company: offer.application?.company ?? offer.title },
			});
		}
	};
	return (
		<>
			<PushScreen
				title={t`Compare offers`}
				subtitle={
					<View style={{ paddingTop: 6, paddingHorizontal: 24 }}>
						<Text
							variant="body"
							color="ink3"
							onTextLayout={(e) => {
								const line = e.nativeEvent.lines.at(-1);
								if (line) setLastLine({ y: line.y, width: line.width });
							}}
						>
							{mixedPay
								? t`Different currencies or pay periods. Amounts are not compared.`
								: t`"Better for you" follows your priorities: ${lowerFirst(profile.data?.priorities ?? "—")}.`}
						</Text>
						{lastLine ? (
							<Touch
								onPress={() => router.push("/career/knowledge/priorities")}
								feedback="none"
								accessibilityRole="link"
								accessibilityLabel={t`Change`}
								hitSlop={{ top: 12, bottom: 12 }}
								style={{ position: "absolute", top: 6 + lastLine.y, left: 24 + lastLine.width + 4 }}
							>
								<Text variant="body" color="accentText">{t`Change`}</Text>
							</Touch>
						) : null}
					</View>
				}
				barEnd={
					<IconButton
						icon="sparkle"
						label={t`Ask the coach`}
						onPress={() =>
							router.push({ pathname: "/career/coach", params: { offers: offers.map((o) => o.id).join(",") } })
						}
					/>
				}
				footer={
					offers.length ? (
						<FooterBar stacked={fontScale > 1.5}>
							<Button
								label={t`Edit`}
								size="lg"
								grow
								onPress={() => (offers.length > 1 ? setChoosing("edit") : offers[0] && edit(offers[0].id))}
							/>
							<Button
								label={t`Draft a counter`}
								size="lg"
								grow
								tone="primary"
								onPress={() => (offers.length > 1 ? setChoosing("counter") : offers[0] && counter(offers[0].id))}
							/>
						</FooterBar>
					) : undefined
				}
			>
				<ResourceState pending={query.isPending} error={query.isError} retry={() => void query.refetch()}>
					{!offers.length ? (
						<View style={{ padding: 24, gap: 12 }}>
							<Text variant="heading">{t`No offers to compare yet`}</Text>
							<Text variant="body">{t`Add each offer's terms to compare it. Nothing is filled in for you.`}</Text>
						</View>
					) : fontScale > 1.5 || offers.length > 2 ? (
						<View style={{ padding: 24, gap: 20 }}>
							{offers.map((offer) => (
								<Card key={offer.id}>
									<Text variant="sheetTitle">{offer.application?.company ?? offer.title}</Text>
									{offer.data.kind === "offer"
										? terms(offer.data).map((value, i) => (
												<Text key={rows[i]} variant="body">
													{rows[i]} · {value}
													{i === 0 ? ` / ${offer.data.kind === "offer" ? offer.data.period : ""}` : ""}
												</Text>
											))
										: null}
								</Card>
							))}
						</View>
					) : (
						<View style={{ marginHorizontal: 24, paddingTop: 12 }}>
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									height: 63,
									borderBottomWidth: 1,
									borderBottomColor: colors.line,
									gap: 12,
								}}
							>
								<View style={{ width: 110 }} />
								{offers.slice(0, 2).map((o) => (
									<Text key={o.id} variant="topBarTitle" style={{ flex: 1, textAlign: "right" }}>
										{o.application?.company ?? o.title}
									</Text>
								))}
							</View>
							{rows.map((label, index) => (
								<View
									key={label}
									style={{
										minHeight: 52,
										flexDirection: "row",
										alignItems: "center",
										gap: 12,
										borderBottomWidth: 1,
										borderBottomColor: colors.line,
									}}
								>
									<Text variant="ui" color="ink3" style={{ width: 110 }}>
										{index === 0 && !mixedPay && offers[0]?.data.kind === "offer"
											? t`Base, a ${offers[0].data.period}`
											: index === 0
												? t`Base`
												: label}
									</Text>
									{offers.slice(0, 2).map((o, i) => {
										const other = offers[1 - i];
										if (o.data.kind !== "offer") return null;
										const data = o.data;
										const winner =
											other?.data.kind === "offer" &&
											(index === 0
												? betterBase(data, other.data)
												: index === 4
													? betterLeave(data, other.data)
													: index === 3 && /remote/i.test(profile.data?.priorities ?? "")
														? /^remote$/i.test(data.location) && !/^remote$/i.test(other.data.location)
														: false);
										return (
											<View key={o.id} style={{ flex: 1, alignItems: "flex-end" }}>
												<Text
													onPress={() => edit(o.id)}
													variant="textLink"
													weight={winner ? 600 : 400}
													color={winner ? "accentText" : "ink"}
												>
													{terms(data)[index]}
													{index === 0 && mixedPay ? ` / ${data.period}` : ""}
												</Text>
												{winner ? <Text variant="caption" color="accentText">{t`Better for you`}</Text> : null}
											</View>
										);
									})}
								</View>
							))}
						</View>
					)}
				</ResourceState>
			</PushScreen>
			{editingId ? (
				<BottomSheet
					title={t`Edit terms`}
					height={640}
					keyboard
					onClose={() => setEditingId(undefined)}
					footer={
						<FooterBar>
							<Button
								label={t`Save`}
								disabled={saving}
								onPress={() => {
									const offer = offers.find((item) => item.id === editingId);
									if (offer?.data.kind !== "offer" || saving) return;
									const parsed = offerTermsSchema.safeParse({
										...offer.data,
										...fields,
										base: fields.base ? Number(fields.base) : null,
										variable: fields.variable ? Number(fields.variable) : null,
										startDate: fields.startDate || null,
										respondBy: fields.respondBy || null,
									});
									if (!parsed.success) {
										setEditError(true);
										return;
									}
									setSaving(true);
									void actions
										.updateOffer({ id: offer.id, terms: parsed.data, expected: offer.data })
										.then(() => setEditingId(undefined))
										.catch(() => setEditError(true))
										.finally(() => setSaving(false));
								}}
							/>
						</FooterBar>
					}
				>
					<View style={{ padding: 24, gap: 12 }}>
						{Object.entries(fields).map(([key, value]) => (
							<TextField
								key={key}
								label={
									(
										{
											base: t`Base`,
											variable: t`Bonus`,
											currency: t`Currency`,
											period: t`Pay period`,
											equity: t`Equity`,
											location: t`Work`,
											leave: t`Holidays`,
											startDate: t`Start`,
											respondBy: t`Reply by`,
										} as Record<string, string>
									)[key]
								}
								value={value}
								onChangeText={(next) => setFields((current) => ({ ...current, [key]: next }))}
							/>
						))}
						{editError ? (
							<Text
								variant="body"
								color="dangerText"
							>{t`Couldn't save the offer. Check its terms and try again.`}</Text>
						) : null}
					</View>
				</BottomSheet>
			) : null}
			{choosing ? (
				<BottomSheet title={t`Which offer?`} height={300} onClose={() => setChoosing(null)}>
					{offers.map((o) => (
						<ListRow
							key={o.id}
							title={o.application?.company ?? o.title}
							trailing="caret"
							disabled={choosing === "counter" && !o.applicationId}
							onPress={() => (choosing === "edit" ? edit(o.id) : counter(o.id))}
						/>
					))}
				</BottomSheet>
			) : null}
		</>
	);
}

const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase() + value.slice(1);
