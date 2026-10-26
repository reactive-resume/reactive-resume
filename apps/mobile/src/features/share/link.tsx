import type { ResumeDocument } from "@/draft/types";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Linking, Share, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Rect } from "react-native-svg";
import {
	formatTimeSince,
	normalizeSlug,
	publicResumeUrl,
	SLUG_PATTERN,
	summarizeViews,
} from "@reactive-resume/resume/sharing";
import { flushResume } from "./document";
import { WebPageSettings } from "./web-page";
import { client, orpc } from "@/api/client";
import { useFlags } from "@/api/flags";
import { getServer } from "@/auth/session";
import { useResumeStore } from "@/draft";
import { resume as draftResume } from "@/draft/runtime";
import { useDocumentOperations } from "@/features/documents/queries";
import { Banner, Button, ListRow, Sheet, Skeleton, Switch, Text, TextField, showToast, useTheme } from "@/ui";

/** Sharing settings: saved beside the resume, not in its data. */
export type ShareSettings = Partial<
	Pick<
		ResumeDocument,
		"isPublic" | "slug" | "showDownloadButtons" | "showInSearchEngines" | "hideContactDetails" | "isPrimary"
	>
>;

type LinkProps = { resume: ResumeDocument; offline: boolean };

export function LinkTab({ resume, offline }: LinkProps) {
	const { t } = useLingui();
	const { space, colors, size } = useTheme();
	const operations = useDocumentOperations();
	const [slug, setSlug] = useState(resume.slug);
	const savedSlug = useRef(resume.slug);
	const [slugState, setSlugState] = useState<"idle" | "checking" | "saving" | "taken" | "error">("idle");
	const [suggestion, setSuggestion] = useState<string>();
	const [takenBy, setTakenBy] = useState<string>();
	const [retry, setRetry] = useState(0);
	const [qrOpen, setQrOpen] = useState(false);
	const profile = useQuery({ ...orpc.auth.getProfile.queryOptions(), enabled: !offline });
	const username = profile.data?.username;
	// Shared links use the app's alias (`APP_ALIAS_URL`) when the server has one; every public page works there too.
	const flags = useFlags();
	const origin = flags.data?.aliasUrl ?? getServer();
	const url = username ? publicResumeUrl(origin, { username, slug: resume.slug }) : "";
	const changed = slug !== resume.slug;
	const saveStatus = useResumeStore((state) => state.status);
	const shareable =
		!!url && resume.isPublic && !changed && !offline && !operations.busy && ["saved", "idle"].includes(saveStatus);
	const disabled = resume.isLocked || offline || operations.busy;

	useEffect(() => {
		const previous = savedSlug.current;
		savedSlug.current = resume.slug;
		setSlug((value) => (value === previous ? resume.slug : value));
	}, [resume.slug]);

	// Every sharing setting saves one way, like web: straight to the server and never through the draft's undo, after
	// the draft's pending edits so the version check holds; then the draft reloads the server copy.
	const save = (settings: ShareSettings, cancelled = () => false) =>
		operations.run(async () => {
			const current = await flushResume(resume.id);
			if (cancelled()) return;
			await client.resume.update({ id: resume.id, ...settings, expectedUpdatedAt: current.updatedAt });
			await draftResume.refresh();
		});
	const saveCheckedSlug = useEffectEvent((value: string, cancelled: () => boolean) => save({ slug: value }, cancelled));

	useEffect(() => {
		if (!changed || !SLUG_PATTERN.test(slug) || !resume.isPublic || resume.isLocked || offline) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			setSlugState("checking");
			setSuggestion(undefined);
			setTakenBy(undefined);
			void (async () => {
				try {
					const result = await client.resume.checkSlug({ resumeId: resume.id, slug });
					if (cancelled) return;
					if (result.status === "taken") {
						setSuggestion(result.suggestion);
						setTakenBy(result.takenBy);
						setSlugState("taken");
						return;
					}
					setSlugState("saving");
					const success = await saveCheckedSlug(slug, () => cancelled);
					setSlugState(success ? "idle" : "error");
				} catch {
					if (!cancelled) setSlugState("error");
				}
			})();
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [slug, changed, resume.id, resume.isPublic, resume.isLocked, offline, retry]);

	const addressError = !SLUG_PATTERN.test(slug)
		? t`Use lowercase letters, numbers and single dashes.`
		: slugState === "taken"
			? takenBy
				? t`You already use this for “${takenBy}”.`
				: t`Another of your resumes uses this address.`
			: slugState === "error"
				? t`Couldn't check or save this address. Try again.`
				: undefined;

	return (
		<View style={{ gap: space.s4 }}>
			{operations.error && <Banner tone="danger" message={operations.error} />}
			<ListRow
				title={t`Public link`}
				subtitle={
					resume.isPublic ? t`On. Anyone with the link can see your web page.` : t`Off. Only you can see this resume.`
				}
				trailing={
					<Switch
						label={t`Public link`}
						value={resume.isPublic}
						disabled={disabled}
						onValueChange={(value) => void save({ isPublic: value })}
					/>
				}
			/>
			<TextField
				label={t`Address`}
				value={slug}
				onChangeText={(value) => setSlug(normalizeSlug(value))}
				autoCapitalize="none"
				autoCorrect={false}
				editable={resume.isPublic && !disabled && slugState !== "saving"}
				error={resume.isPublic ? addressError : undefined}
				helper={
					!resume.isPublic
						? t`Turn on the link to choose an address.`
						: changed
							? t`Checking… Copy is available after saving.`
							: url
								? t`Live at ${url}`
								: t`Loading your public address…`
				}
			/>
			{suggestion && slugState === "taken" && (
				<Button variant="link" label={t`Try ${suggestion}`} disabled={disabled} onPress={() => setSlug(suggestion)} />
			)}
			{slugState === "error" && (
				<Button label={t`Retry`} variant="secondary" onPress={() => setRetry((value) => value + 1)} />
			)}
			{profile.isError && (
				<Banner
					tone="danger"
					message={t`Couldn't load your public address.`}
					action={{ label: t`Retry`, onPress: () => void profile.refetch() }}
				/>
			)}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				<Button
					variant="secondary"
					label={t`Copy`}
					icon="copy"
					disabled={!shareable}
					onPress={() =>
						void operations.run(async () => {
							await Clipboard.setStringAsync(url);
							showToast({ message: t`Link copied` });
						})
					}
				/>
				<Button
					variant="secondary"
					label={t`Share via…`}
					icon="export"
					disabled={!shareable}
					onPress={() => void operations.run(() => Share.share({ title: resume.name, message: url, url }))}
				/>
			</View>
			{resume.isPublic && (
				<>
					<ListRow
						title={t`Open web page`}
						leading="arrow-square-out"
						disabled={!shareable}
						onPress={() => void operations.run(() => Linking.openURL(url))}
					/>
					<ListRow title={t`QR code`} leading="qr-code" disabled={!shareable} onPress={() => setQrOpen(true)} />
				</>
			)}
			<WebPageSettings
				resume={resume}
				offline={offline}
				username={username}
				origin={origin}
				flags={flags.data}
				operations={operations}
				save={save}
			/>
			<Statistics id={resume.id} isPublic={resume.isPublic} offline={offline} />
			<Sheet open={qrOpen} title={t`QR code`} onClose={() => setQrOpen(false)} detents={[0.5]}>
				<View
					accessible
					accessibilityLabel={t`QR code for ${url}`}
					style={{ alignItems: "center", padding: space.s5, gap: space.s3 }}
				>
					{url && (
						<QRCode
							value={url}
							size={size.hit * 4}
							quietZone={space.s3}
							color={colors.paperInk}
							backgroundColor={colors.paper}
						/>
					)}
					<Text selectable>{url}</Text>
				</View>
			</Sheet>
		</View>
	);
}

type StatisticsProps = { id: string; isPublic: boolean; offline: boolean };
function Statistics({ id, isPublic, offline }: StatisticsProps) {
	const { t, i18n } = useLingui();
	const { colors, space, size } = useTheme();
	const daily = useQuery({
		...orpc.resume.statistics.getDailyById.queryOptions({ input: { id, days: 30 } }),
		enabled: isPublic && !offline,
	});
	const total = useQuery({
		...orpc.resume.statistics.getById.queryOptions({ input: { id } }),
		enabled: isPublic && !offline,
	});
	const summary = summarizeViews(daily.data ?? []);
	return (
		<View style={{ gap: space.s3, paddingTop: space.s4, borderTopWidth: 1, borderColor: colors.line }}>
			<Text variant="heading">{t`Visitors`}</Text>
			<Text variant="caption" color="ink3">{t`Only you see these`}</Text>
			{!isPublic ? (
				<Text color="ink2">
					{t`Publish the web page to count views and downloads. Counts are anonymous, and search engines aren't counted.`}
				</Text>
			) : daily.isError || total.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load statistics.`}
					action={{
						label: t`Retry`,
						onPress: () => {
							void daily.refetch();
							void total.refetch();
						},
					}}
				/>
			) : daily.isPending || total.isPending ? (
				<Skeleton height={size.hit * 2} />
			) : (
				<>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s5 }}>
						<View>
							<Text variant="title">{i18n.number(summary.views)}</Text>
							<Text variant="caption">{t`views · 30 days`}</Text>
						</View>
						<View>
							<Text variant="title">{i18n.number(summary.downloads)}</Text>
							<Text variant="caption">{t`downloads`}</Text>
						</View>
						<View>
							<Text variant="title">
								{total.data?.lastViewedAt ? formatTimeSince(total.data.lastViewedAt, i18n.locale) : "—"}
							</Text>
							<Text variant="caption">{t`since last view`}</Text>
						</View>
					</View>
					<View
						accessible
						accessibilityRole="image"
						accessibilityLabel={t`Daily views over 30 days, peak ${summary.peak}`}
					>
						<Svg width="100%" height={size.hit * 1.5} viewBox="0 0 300 60" preserveAspectRatio="none">
							{summary.bars.map((bar, index) => (
								<Rect
									key={bar.date}
									x={(index * 300) / Math.max(1, summary.bars.length)}
									y={60 - Math.max(3, bar.height * 60)}
									width={300 / Math.max(1, summary.bars.length) - 2}
									height={Math.max(3, bar.height * 60)}
									fill={colors.line2}
								/>
							))}
						</Svg>
					</View>
					<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
						<Text variant="caption">{daily.data?.[0]?.date}</Text>
						<Text variant="caption">{t`Today`}</Text>
					</View>
				</>
			)}
			<Text variant="caption" color="ink3">{t`Download totals can include repeat clicks.`}</Text>
		</View>
	);
}
