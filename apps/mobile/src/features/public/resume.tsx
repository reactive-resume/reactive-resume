import { t } from "@lingui/core/macro";
import { Directory, File } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Share, View, useWindowDimensions } from "react-native";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { getServer } from "@/auth/session";
import { usePublicResume, useDataBackend, useAccount } from "@/data";
import { paperText } from "@/dev/storyboard/paper-text.gen";
import { pageRenderer, type PageRenderResult } from "@/render/page-renderer";
import {
	Button,
	FooterBar,
	IconButton,
	Page,
	PageZoom,
	type PageZoomHandle,
	PushScreen,
	Skeleton,
	Text,
	ZoomBar,
	haptic,
} from "@/ui";

export function PublicResumeScreen() {
	// Storyboard flows view the link as its owner with `as=owner` (the fixture account's username differs from "alex").
	const { username, slug, as } = useLocalSearchParams<{ username: string; slug: string; as?: string }>();
	const query = usePublicResume({ username, slug });
	const account = useAccount();
	const router = useRouter();
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	const owner = fake ? as === "owner" : account.data?.username === username;
	const zoom = useRef<PageZoomHandle>(null);
	const [pageState, setPageState] = useState<{ resume: typeof query.data; result: PageRenderResult } | null>(null);
	const rendered = pageState && pageState.resume === query.data ? pageState.result : null;
	const [failed, setFailed] = useState(false);
	const [reading, setReading] = useState(false);
	const [saving, setSaving] = useState(false);
	const { width } = useWindowDimensions();
	const resume = query.data;
	useEffect(() => {
		let current = true;
		if (resume)
			void pageRenderer
				.render({
					kind: "resume",
					id: resume.id,
					revision: JSON.stringify(resume.data),
					data: resume.data,
					public: true,
					publicPath: { username, slug },
					fixture: "page-public-full",
				})
				.then((result) => {
					if (current) {
						setPageState({ resume, result });
						setFailed(false);
					}
				})
				.catch(() => {
					if (current) setFailed(true);
				});
		return () => {
			current = false;
		};
	}, [resume, username, slug]);
	const url = `${getServer()}/${encodeURIComponent(username)}/${encodeURIComponent(resume?.slug ?? slug)}`;
	const save = async () => {
		if (!rendered || saving) return;
		setSaving(true);
		try {
			const directory = await Directory.pickDirectoryAsync();
			const target = new File(directory, `${slug.replace(/[^a-z0-9-]/gi, "-") || "resume"}.pdf`);
			if (target.exists) throw new Error("File already exists.");
			new File(rendered.pdfFile).copy(target);
			if (!target.exists || target.size === 0) throw new Error("File was not saved.");
			haptic("success");
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	};
	const pageWidth = width - 32;
	return (
		<PushScreen
			back="none"
			bg="sunken"
			scroll={false}
			barCenter={<Text variant="topBarTitle">{fake ? "rx.cv/alex" : `${username}/${resume?.slug ?? slug}`}</Text>}
			barEnd={
				<>
					{owner && resume ? <Button label={t`Edit`} onPress={() => router.push(`/builder/${resume.id}`)} /> : null}
					<IconButton
						icon="share-network"
						label={t`Share`}
						onPress={() => void Share.share({ url, message: url }).catch(() => setFailed(true))}
					/>
				</>
			}
			overlay={
				// COMPONENTS.md §16: P1's zoom bar sits 122 dp above the bottom.
				<View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 122 }}>
					<ZoomBar
						compact
						onFit={() => zoom.current?.fit()}
						onZoomIn={() => zoom.current?.zoomIn()}
						onZoomOut={() => zoom.current?.zoomOut()}
						trailing={{
							label: reading ? t`Show page` : t`Read as text`,
							icon: "text-aa",
							onPress: () => setReading(!reading),
						}}
					/>
				</View>
			}
			footer={
				resume?.showDownloadButtons ? (
					<FooterBar>
						<Button
							label={t`Download PDF`}
							icon="download-simple"
							size="lg"
							tone="primary"
							grow
							disabled={(!rendered && !fake) || saving}
							onPress={() => void save()}
						/>
					</FooterBar>
				) : undefined
			}
		>
			{owner ? <Text variant="body">{t`This is how visitors see it`}</Text> : null}
			{query.isError ? (
				<View style={{ padding: 24, gap: 20 }}>
					<Text variant="body">
						{query.error && "code" in query.error && query.error.code === "NEED_PASSWORD"
							? t`This resume is password protected. Open its public link in your browser to enter the password.`
							: t`This resume isn't shared right now.`}
					</Text>
					<Button label={t`Try again`} onPress={() => void query.refetch()} />
				</View>
			) : reading ? (
				<ScrollView contentContainerStyle={{ padding: 24 }}>
					<Text variant="prose">{resume ? buildMarkdown(getResumeExportData(resume.data, "resume")) : ""}</Text>
				</ScrollView>
			) : (
				<PageZoom ref={zoom}>
					<View style={{ paddingTop: 8, alignItems: "center" }}>
						{fake ? (
							<Page
								source={require("../../../assets/fixtures/page-public-full.png")}
								fixtureText={paperText["P1-Public"]}
								width={pageWidth}
								height={506}
							/>
						) : (
							(rendered?.pages.map((page) => (
								<Page
									key={page.index}
									source={{ uri: page.uri }}
									width={pageWidth}
									height={(pageWidth * page.height) / page.width}
								/>
							)) ?? <Skeleton width={pageWidth} height={506} />)
						)}
					</View>
				</PageZoom>
			)}
			{failed ? (
				<Text
					variant="body"
					color="dangerText"
					style={{ paddingHorizontal: 24 }}
				>{t`Couldn't finish this. Try again.`}</Text>
			) : null}
		</PushScreen>
	);
}
