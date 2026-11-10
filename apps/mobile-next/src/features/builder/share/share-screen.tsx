import { t } from "@lingui/core/macro";
import { setStringAsync } from "expo-clipboard";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { publicResumeUrl } from "@reactive-resume/resume/sharing";
import { prepareExport, deliverExport } from "../download/export-file";
import { BuilderActions, DocumentState, useBuilderDocument, useDocumentId, useRenderedPage } from "./document";
import { useSession } from "@/auth/session";
import { useAccount, useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Button,
	HeroCard,
	PageThumbnail,
	PushScreen,
	SectionHeading,
	ListRow,
	Switch,
	useSwitchRow,
	IconButton,
	Text,
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
	const [busy, setBusy] = useState(false);
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
	const toggle = useSwitchRow(publicOn, (next) => {
		if (draft.document?.id !== id) {
			setError(t`Couldn't update sharing. Try again.`);
			return;
		}
		draft.updateDocument((d) => {
			d.isPublic = next;
		});
	});
	const username = STORYBOARD ? "alex" : account.data?.username;
	const link = publicResumeUrl(STORYBOARD && document?.isPrimary ? "https://rx.cv" : server, {
		username: username ?? "",
		slug: document?.slug ?? "",
		isPrimary: document?.isPrimary,
	});
	const share = async () => {
		if (!document || busy) return;
		setBusy(true);
		setError("");
		try {
			await deliverExport(await prepareExport(document, "resume", "pdf", `${document.data.basics.name} Resume`), false);
			showToast({ message: t`Good luck out there.` });
		} catch {
			setError(t`Download failed. Try again.`);
			haptic("error");
		} finally {
			setBusy(false);
		}
	};
	const copy = async () => {
		try {
			await setStringAsync(link);
			showToast({ message: t`Link copied` });
			haptic("success");
		} catch {
			setError(t`Couldn't copy the link. Try again.`);
		}
	};
	return (
		<PushScreen title={t`Share`} docked barEnd={<BuilderActions id={id} />}>
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
						<Button
							label={t`Other formats`}
							tone="accentGhost"
							size="lg"
							style={{ marginStart: -16 }}
							onPress={() => router.push(`/builder/${id}/download`)}
						/>
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
							<ListRow
								title={link.replace("https://", "")}
								secondary={document.isPrimary ? t`Your short link` : t`Public link`}
								trailing={<IconButton icon="copy" iconSize={20} label={t`Copy link`} onPress={() => void copy()} />}
							/>
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
