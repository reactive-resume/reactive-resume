import { t } from "@lingui/core/macro";
import { setStringAsync } from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { isValidSlug, publicResumeUrl } from "@reactive-resume/resume/sharing";
import { prepareExport, deliverExport } from "../download/export-file";
import { Anchor, useAnchoredMenu, useAnchorRef } from "../shared/anchored-menu";
import { BuilderActions, DocumentState, useBuilderDocument, useDocumentId, useRenderedPage } from "./document";
import { useSession } from "@/auth/session";
import { useAccount, useLocalValue, useResumeStore, useSharing } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Button,
	BottomSheet,
	Form,
	TextField,
	HeroCard,
	PageThumbnail,
	PushScreen,
	SectionHeading,
	ListRow,
	Switch,
	useSwitchRow,
	IconButton,
	Text,
	TextLink,
	Spinner,
	useRowMotion,
	showToast,
	haptic,
} from "@/ui";

export function ShareScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const query = useBuilderDocument(id);
	const document = query.data;
	const { server } = useSession();
	const account = useAccount();
	const draft = useResumeStore();
	// Storyboard flows reach "Download failed. Try again." with `preset=export-fail`.
	const { preset } = useLocalSearchParams<{ preset?: string }>();
	const [busy, setBusy] = useState(false);
	const linkMenu = useAnchoredMenu();
	const linkRef = useAnchorRef();
	// B11: the first time a resume goes public, its address is asked for first. A resume public on arrival has an address.
	const published = useLocalValue<boolean>(`web-page-published:${id}`, false);
	const [asking, setAsking] = useState<string>();
	const [error, setError] = useState("");
	const rendered = useRenderedPage(
		document
			? {
					kind: "resume",
					id,
					revision: document.updatedAt.toISOString(),
					data: document.data,
					fixture: "thumb-resume-B11",
				}
			: undefined,
	);
	const rowMotion = useRowMotion();
	const publicOn = document?.isPublic ?? false;
	const sharing = useSharing(id);
	// Through the open draft when it is this resume's, else straight to the server.
	const setPublic = (next: boolean, slug?: string) => {
		setError("");
		if (draft.document?.id === id) {
			draft.updateDocument((d) => {
				d.isPublic = next;
				if (slug !== undefined) d.slug = slug;
			});
			return Promise.resolve(true);
		}
		return sharing
			.update({ isPublic: next, ...(slug !== undefined ? { slug } : {}) })
			.then(() => true)
			.catch(() => {
				setError(t`Couldn't update sharing. Try again.`);
				return false;
			});
	};
	const toggle = useSwitchRow(publicOn, (next) => {
		if (next && !published.value && document) {
			setAsking(document.slug);
			return;
		}
		void setPublic(next);
	});
	const goLive = async () => {
		if (asking === undefined || !isValidSlug(asking)) return;
		const slug = asking;
		setAsking(undefined);
		if (!(await setPublic(true, slug))) return;
		published.set(true);
		haptic("success");
		showToast({ message: t`Your web page is live` });
	};
	useEffect(() => {
		if (publicOn && !published.value) published.set(true);
	}, [publicOn, published]);
	const username = STORYBOARD ? "alex" : account.data?.username;
	const link = publicResumeUrl(STORYBOARD && document?.isPrimary ? "https://rx.cv" : server, {
		username: username ?? "",
		slug: document?.slug ?? "",
		isPrimary: document?.isPrimary,
	});
	// The full address, also for a primary resume whose row shows the short link.
	const fullLink = publicResumeUrl(STORYBOARD ? "https://rxresu.me" : server, {
		username: username ?? "",
		slug: document?.slug ?? "",
		isPrimary: false,
	});
	const openLinkMenu = () => linkMenu.open(linkRef, [{ label: t`Copy full address`, onPress: () => void copy(true) }]);
	const share = async () => {
		if (!document || busy) return;
		setBusy(true);
		setError("");
		try {
			if (STORYBOARD && preset === "export-fail") throw new Error("Storyboard export failure.");
			await deliverExport(await prepareExport(document, "resume", "pdf", `${document.data.basics.name} Resume`), false);
			showToast({ message: t`Good luck out there.` });
		} catch {
			setError(t`Download failed. Try again.`);
			haptic("error");
		} finally {
			setBusy(false);
		}
	};
	const copy = async (full = false) => {
		try {
			await setStringAsync(full ? fullLink : link);
			showToast({ message: t`Link copied` });
			haptic("success");
		} catch {
			setError(t`Couldn't copy the link. Try again.`);
		}
	};
	return (
		<PushScreen
			title={t`Share`}
			docked
			clipDump
			barEnd={<BuilderActions id={id} />}
			overlay={
				<>
					{linkMenu.menu}
					{asking !== undefined ? (
						<BottomSheet title={t`Your web page address`} height={360} keyboard onClose={() => setAsking(undefined)}>
							<Form>
								<TextField
									label={t`Address`}
									value={asking}
									prefix={`${STORYBOARD ? "rxresu.me" : server.replace(/^https?:\/\//, "")}/${username ?? ""}/`}
									mono
									autoCapitalize="none"
									autoCorrect={false}
									onChangeText={setAsking}
									error={isValidSlug(asking) ? undefined : t`Use Latin letters a–z, numbers and single dashes.`}
								/>
								<Button
									label={t`Publish`}
									tone="primary"
									size="lg"
									block
									disabled={!isValidSlug(asking)}
									onPress={() => void goLive()}
								/>
							</Form>
						</BottomSheet>
					) : null}
				</>
			}
		>
			<DocumentState loading={query.isPending} error={query.isError} retry={() => void query.refetch()} />
			{document && (
				<>
					<HeroCard style={{ marginTop: 20, padding: 24, minHeight: 156 }}>
						<View style={{ flexDirection: "row", gap: 20, alignItems: "center", marginTop: -8 }}>
							<PageThumbnail
								width={72}
								source={rendered.data?.pages[0] ? { uri: rendered.data.pages[0].uri } : undefined}
							/>
							<View style={{ flex: 1, gap: 20 }}>
								<View>
									<Text variant="label" numberOfLines={1}>
										{document.data.basics.name} Resume.pdf
									</Text>
									<Text color="ink3">{t`1 page · A4`}</Text>
								</View>
								<Button
									label={busy ? t`Preparing…` : t`Share PDF`}
									leading={busy ? <Spinner /> : undefined}
									icon="share-network"
									tone="primary"
									size="lg"
									block
									disabled={busy}
									onPress={() => void share()}
								/>
							</View>
						</View>
					</HeroCard>
					<View style={{ paddingHorizontal: 24, height: 44, justifyContent: "center" }}>
						<TextLink label={t`Other formats`} onPress={() => router.push(`/builder/${id}/download`)} />
					</View>
					{error ? (
						<Text color="dangerText" style={{ marginHorizontal: 24 }} accessibilityRole="alert">
							{error}
						</Text>
					) : null}
					<SectionHeading title={t`Web page`} first />
					<ListRow
						title={t`Public link`}
						secondary={document.hasPassword ? t`Public, with a password` : t`Anyone with the link can see it`}
						{...toggle}
						trailing={<Switch value={publicOn} interactive={false} />}
					/>
					{publicOn && (
						<Animated.View entering={rowMotion.foldIn} exiting={rowMotion.foldOut}>
							<Anchor anchorRef={linkRef}>
								<ListRow
									title={link.replace("https://", "")}
									titleVariant="monoUi"
									secondary={document.isPrimary ? t`Your short link` : t`Public link`}
									onPress={openLinkMenu}
									onLongPress={openLinkMenu}
									trailingAction
									trailing={<IconButton icon="copy" iconSize={20} label={t`Copy link`} onPress={() => void copy()} />}
								/>
							</Anchor>
						</Animated.View>
					)}
					<ListRow
						title={t`Web page settings`}
						trailing="caret"
						last
						onPress={() => router.push(`/builder/${id}/share/web-page`)}
					/>
					<SectionHeading title={t`Activity`} />
					<ListRow
						title={t`Visitors and feedback`}
						secondary={STORYBOARD ? t`128 views this month · 3 new comments` : undefined}
						trailing="caret"
						last
						onPress={() => router.push(`/builder/${id}/share/activity`)}
					/>
					<SectionHeading title={t`Versions`} />
					<ListRow title={t`Versions`} trailing="caret" last onPress={() => router.push(`/builder/${id}/versions`)} />
				</>
			)}
		</PushScreen>
	);
}
