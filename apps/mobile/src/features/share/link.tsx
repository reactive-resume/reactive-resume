import type { ResumeDocument } from "@/draft/types";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Linking, Share, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Rect } from "react-native-svg";
import { flushResume } from "./document";
import { formatTimeSince, normalizeSlug, summarizeViews, validSlug } from "./model";
import { WebPageSettings } from "./web-page";
import { client, orpc } from "@/api/client";
import { getServer } from "@/auth/session";
import { useResumeStore } from "@/draft";
import { resume as draftResume } from "@/draft/runtime";
import { useDocumentOperations } from "@/features/documents/queries";
import {
	Banner,
	Button,
	ConfirmDialog,
	ListRow,
	Sheet,
	Skeleton,
	Switch,
	Text,
	TextField,
	showToast,
	useTheme,
} from "@/ui";

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
	const [dialog, setDialog] = useState<"qr" | "password" | "remove-password" | null>(null);
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const profile = useQuery({ ...orpc.auth.getProfile.queryOptions(), enabled: !offline });
	const username = profile.data?.username;
	const url = username ? `${getServer()}/${encodeURIComponent(username)}/${encodeURIComponent(resume.slug)}` : "";
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

	const saveCheckedSlug = useEffectEvent((value: string, cancelled: () => boolean) =>
		operations.run(async () => {
			const current = await flushResume(resume.id);
			if (cancelled()) return;
			await client.resume.update({ id: resume.id, slug: value, expectedUpdatedAt: current.updatedAt });
			await draftResume.refresh();
		}),
	);

	useEffect(() => {
		if (!changed || !validSlug(slug) || !resume.isPublic || resume.isLocked || offline) return;
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

	const update = async (recipe: (draft: ResumeDocument) => void) => {
		await operations.run(async () => {
			await flushResume(resume.id);
			useResumeStore.getState().updateDocument(recipe);
			await flushResume(resume.id);
		});
	};
	const savePassword = async (remove = false) => {
		if (!remove && (password.length < 6 || password.length > 64 || password !== confirmation)) return;
		const success = await operations.run(async () => {
			await flushResume(resume.id);
			if (remove) await client.resume.removePassword({ id: resume.id });
			else await client.resume.setPassword({ id: resume.id, password });
			await draftResume.refresh();
		});
		if (success) {
			setDialog(null);
			setPassword("");
			setConfirmation("");
		}
	};
	const addressError = !validSlug(slug)
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
						onValueChange={(value) =>
							void update((draft) => {
								draft.isPublic = value;
							})
						}
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
						title={t`Visitors can download the PDF`}
						trailing={
							<Switch
								label={t`Visitors can download the PDF`}
								value={resume.showDownloadButtons}
								disabled={disabled}
								onValueChange={(value) =>
									void update((draft) => {
										draft.showDownloadButtons = value;
									})
								}
							/>
						}
					/>
					<ListRow
						title={t`Require a password`}
						subtitle={
							resume.hasPassword
								? t`Visitors enter it before they see the resume. Share it only with people you trust.`
								: undefined
						}
						trailing={
							<Switch
								label={t`Require a password`}
								value={resume.hasPassword}
								disabled={disabled}
								onValueChange={(value) => {
									setPassword("");
									setConfirmation("");
									setDialog(value ? "password" : "remove-password");
								}}
							/>
						}
					/>
					<ListRow
						title={t`Open public page`}
						leading="arrow-square-out"
						disabled={!shareable}
						onPress={() => void operations.run(() => Linking.openURL(url))}
					/>
					<ListRow title={t`QR code`} leading="qr-code" disabled={!shareable} onPress={() => setDialog("qr")} />
				</>
			)}
			<WebPageSettings resume={resume} offline={offline} username={username} />
			<Statistics
				id={resume.id}
				isPublic={resume.isPublic}
				offline={offline}
				contactHidden={resume.hideContactDetails}
			/>
			<Sheet open={dialog === "qr"} title={t`QR code`} onClose={() => setDialog(null)} detents={[0.5]}>
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
			<Sheet
				open={dialog === "password"}
				title={t`Require a password`}
				onClose={() => {
					if (!operations.busy) {
						setDialog(null);
						setPassword("");
						setConfirmation("");
					}
				}}
				detents={[0.5, 0.9]}
			>
				<View style={{ padding: space.s4, gap: space.s3 }}>
					<TextField
						label={t`Password`}
						value={password}
						onChangeText={setPassword}
						secureTextEntry
						autoComplete="off"
						autoCorrect={false}
						autoCapitalize="none"
						maxLength={64}
						helper={t`Use 6–64 characters.`}
						editable={!operations.busy}
					/>
					<TextField
						label={t`Confirm password`}
						value={confirmation}
						onChangeText={setConfirmation}
						secureTextEntry
						autoComplete="off"
						autoCorrect={false}
						autoCapitalize="none"
						maxLength={64}
						editable={!operations.busy}
						error={confirmation && confirmation !== password ? t`Passwords do not match.` : undefined}
					/>
					{operations.error && <Banner tone="danger" message={operations.error} />}
					<Button
						label={t`Set password`}
						loading={operations.busy}
						disabled={password.length < 6 || password !== confirmation || disabled}
						onPress={() => void savePassword()}
					/>
				</View>
			</Sheet>
			<ConfirmDialog
				open={dialog === "remove-password"}
				title={t`Remove the password?`}
				message={t`Anyone with the link will be able to view your resume.`}
				confirmLabel={t`Remove password`}
				onCancel={() => setDialog(null)}
				onConfirm={() => {
					setDialog(null);
					void savePassword(true);
				}}
			/>
		</View>
	);
}

type StatisticsProps = { id: string; isPublic: boolean; offline: boolean; contactHidden: boolean };
function Statistics({ id, isPublic, offline, contactHidden }: StatisticsProps) {
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
						{contactHidden && (
							<View>
								<Text variant="title">{i18n.number(summary.contactReveals)}</Text>
								<Text variant="caption">{t`asked for contact details`}</Text>
							</View>
						)}
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
