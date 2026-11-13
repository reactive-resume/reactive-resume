import { t } from "@lingui/core/macro";
import { setStringAsync } from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";
import { feedbackLinkLine, storyboardBars, type FeedbackLinkRow } from "./activity-model";
import { useDocumentId } from "./document";
import { useFeedbackLink, useFeedbackLinks, useSharingActions, useVisitorStatistics } from "@/data";
import { useCaptureStore } from "@/dev/storyboard/capture";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	PushScreen,
	BigNumber,
	Text,
	SectionHeading,
	ListRow,
	Waveform,
	Skeleton,
	BottomSheet,
	Form,
	TextField,
	Switch,
	useSwitchRow,
	Segmented,
	Button,
	Dialog,
	TextLink,
	haptic,
	showToast,
} from "@/ui";

const CHART = 64;
const DAY = 86_400_000;
type Expiry = "never" | "7" | "30" | "90";

export function ActivityScreen() {
	const id = useDocumentId();
	// Storyboard flows reach "No visitors yet." with `preset=no-visitors`.
	const { preset } = useLocalSearchParams<{ preset?: string }>();
	const { totals, daily } = useVisitorStatistics(id);
	const links = useFeedbackLinks(id);
	const sharing = useSharingActions();
	// The board draws no "By day" link; storyboard captures leave it out.
	const capturing = useCaptureStore((s) => STORYBOARD && s.request !== null && s.ready !== s.request.nonce);
	const [byDay, setByDay] = useState(false);
	const [making, setMaking] = useState(false);
	const [label, setLabel] = useState("");
	const [comments, setComments] = useState(true);
	const [expiry, setExpiry] = useState<Expiry>("30");
	const [open, setOpen] = useState<string | null>(null);
	const [error, setError] = useState("");
	const days = daily.data ?? [];
	const peak = days.reduce((best, day) => (day.views > (best?.views ?? -1) ? day : best), days[0]);
	const top = Math.max(1, peak?.views ?? 0);
	const levels = STORYBOARD ? storyboardBars.map((h) => h / CHART) : days.map((day) => day.views / top);
	const all = (links.data ?? []) as FeedbackLinkRow[];
	const active = all.filter((link) => link.status === "active");
	const past = all.filter((link) => link.status !== "active");
	const views = STORYBOARD && preset === "no-visitors" ? 0 : (totals.data?.views ?? 0);
	const dayLabel = (date: string | Date) =>
		new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "long" });
	const allow = useSwitchRow(comments, setComments);
	const make = async () => {
		const who = label.trim();
		if (!who) return;
		setError("");
		try {
			const link = (await sharing.createFeedback({
				resumeId: id,
				label: who,
				allowComments: comments,
				applicationIds: [],
				expiresAt: expiry === "never" ? null : new Date(Date.now() + Number(expiry) * DAY),
			})) as { url: string };
			setMaking(false);
			setLabel("");
			haptic("success");
			await Share.share({ message: link.url });
		} catch {
			setError(t`Couldn't make the link. Try again.`);
			haptic("error");
		}
	};
	return (
		<PushScreen
			title={t`Visitors and feedback`}
			backLabel={t`Back to Share`}
			overlay={
				<>
					{making ? (
						<BottomSheet title={t`New link`} height={560} keyboard onClose={() => setMaking(false)}>
							<Form>
								<TextField label={t`Who is it for?`} value={label} onChangeText={setLabel} maxLength={80} autoFocus />
								<Text color="ink3" style={{ marginTop: -12 }}>{t`Only you see this.`}</Text>
							</Form>
							<View style={{ marginTop: 12 }}>
								<ListRow
									title={t`Allow comments`}
									{...allow}
									trailing={<Switch value={comments} interactive={false} />}
								/>
							</View>
							<View style={{ marginHorizontal: 24, marginTop: 16, gap: 8 }}>
								<Text variant="formLabel" color="ink2">{t`Link expires`}</Text>
								<Segmented
									accessibilityLabel={t`Link expires`}
									value={expiry}
									onChange={setExpiry}
									options={[
										{ key: "never", label: t`Never` },
										{ key: "7", label: t`7 days` },
										{ key: "30", label: t`30 days` },
										{ key: "90", label: t`90 days` },
									]}
								/>
							</View>
							<View style={{ margin: 24, gap: 12 }}>
								<Button
									label={t`Make link`}
									tone="primary"
									size="lg"
									block
									disabled={!label.trim()}
									onPress={() => void make()}
								/>
								{error ? (
									<Text color="dangerText" accessibilityRole="alert">
										{error}
									</Text>
								) : null}
							</View>
						</BottomSheet>
					) : null}
					{open ? <LinkSheet id={open} onClose={() => setOpen(null)} /> : null}
				</>
			}
		>
			{totals.isPending ? (
				<View style={{ margin: 24 }}>
					<Skeleton height={140} />
				</View>
			) : totals.isError || !totals.data ? (
				<Text color="dangerText" accessibilityRole="alert" style={{ margin: 24 }}>
					{t`Couldn't load visitors. Try again.`}
				</Text>
			) : views === 0 ? (
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
								? t`Views per day over 30 days, highest ${peak.views} on ${dayLabel(peak.date)}`
								: t`Views per day over 30 days`
						}
						style={{ marginTop: 16 }}
					>
						<Waveform levels={levels} height={CHART} gap={4} opacity={0.85} />
					</View>
					<View style={{ paddingTop: 10 }}>
						<Text color="ink3">{t`Only you see these.`}</Text>
					</View>
					{capturing ? null : (
						<View style={{ height: 44, justifyContent: "center" }}>
							<TextLink
								label={byDay ? t`Hide days` : t`By day`}
								icon={byDay ? "caret-up" : "caret-down"}
								onPress={() => setByDay(!byDay)}
							/>
						</View>
					)}
				</View>
			)}
			{byDay
				? days
						.toReversed()
						.map((day, index, list) => (
							<ListRow
								key={String(day.date)}
								title={dayLabel(day.date)}
								value={t`${day.views} views`}
								last={index === list.length - 1}
							/>
						))
				: null}
			<SectionHeading
				title={t`Feedback links`}
				action={t`New link`}
				onAction={() => setMaking(true)}
				paddingBottom={4}
			/>
			{active.map((link, index) => (
				<ListRow
					key={link.id}
					title={link.label}
					secondary={feedbackLinkLine(link)}
					trailing="caret"
					last={index === active.length - 1}
					boxHidden={index === active.length - 1}
					onPress={() => setOpen(link.id)}
				/>
			))}
			{past.length ? (
				<>
					<SectionHeading title={t`Past links`} />
					{past.map((link, index) => (
						<ListRow
							key={link.id}
							title={link.label}
							secondary={link.status === "revoked" ? t`Turned off` : t`Expired`}
							trailing="caret"
							last={index === past.length - 1}
							onPress={() => setOpen(link.id)}
						/>
					))}
				</>
			) : null}
		</PushScreen>
	);
}

/** A feedback link: its comments (newest first), then Copy link and Turn off link…. */
function LinkSheet({ id, onClose }: { id: string; onClose: () => void }) {
	const query = useFeedbackLink(id);
	const sharing = useSharingActions();
	const [confirm, setConfirm] = useState(false);
	const link = query.data as
		| (FeedbackLinkRow & { url: string; comments: { id: string; authorName: string; body: string; createdAt: Date }[] })
		| undefined;
	const comments = (link?.comments ?? []).toSorted(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
	return (
		<BottomSheet title={link?.label ?? ""} height={520} onClose={onClose}>
			{comments.length ? (
				comments.map((comment) => (
					<ListRow key={comment.id} title={comment.authorName} secondary={comment.body} wrapSecondary />
				))
			) : (
				<Text color="ink3" style={{ marginHorizontal: 24, marginVertical: 12 }}>
					{t`No comments yet.`}
				</Text>
			)}
			<View style={{ margin: 24, gap: 12 }}>
				<Button
					label={t`Copy link`}
					block
					disabled={!link}
					onPress={() =>
						link &&
						void setStringAsync(link.url).then(() => {
							haptic("success");
							showToast({ message: t`Link copied` });
						})
					}
				/>
				{link?.status === "active" ? (
					<Button label={t`Turn off link…`} tone="dangerGhost" block onPress={() => setConfirm(true)} />
				) : null}
			</View>
			<Dialog
				open={confirm}
				onClose={() => setConfirm(false)}
				title={t`Turn off this link?`}
				message={t`Anyone who has it can no longer open it.`}
				actions={[
					{
						label: t`Turn off link`,
						tone: "danger",
						onPress: () => {
							setConfirm(false);
							void sharing
								.revokeFeedback({ id })
								.then(() => {
									haptic("light");
									onClose();
								})
								.catch(() => showToast({ message: t`Couldn't turn off the link. Try again.` }));
						},
					},
					{ label: t`Cancel`, tone: "secondary", onPress: () => setConfirm(false) },
				]}
			/>
		</BottomSheet>
	);
}
