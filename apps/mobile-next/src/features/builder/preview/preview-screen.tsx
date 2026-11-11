import type { PageZoomHandle } from "@/ui";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ScrollView, View, useWindowDimensions } from "react-native";
import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { prepareExport, deliverExport } from "../download/export-file";
import { useBuilderDocument, useDocumentId, useRenderedPage, DocumentState } from "../share/document";
import { useResumeStore, useVersionActions, useVersionPreview } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { paperText } from "@/dev/storyboard/paper-text.gen";
import {
	PushScreen,
	HeroTarget,
	PageZoom,
	ZoomBar,
	Page,
	Button,
	IconButton,
	IssueMarker,
	Text,
	FooterBar,
	Spinner,
	flyBack,
	haptic,
	showToast,
} from "@/ui";

export function PreviewScreen({ version = false }: { version?: boolean }) {
	const id = useDocumentId();
	const router = useRouter();
	// Storyboard flows reach B18's states with `preset=updating` and `preset=offline`.
	const params = useLocalSearchParams<{ marker?: string; version?: string; name?: string; preset?: string }>();
	const document = useBuilderDocument(id);
	// B15: a version's own page, and Restore this version.
	const versionPreview = useVersionPreview(version ? id : "", version ? (params.version ?? "") : "");
	const versionActions = useVersionActions();
	const [restoring, setRestoring] = useState(false);
	const restore = async () => {
		if (!params.version || restoring) return;
		setRestoring(true);
		try {
			const draft = useResumeStore.getState();
			if (draft.document?.id === id) await draft.flush();
			await versionActions.restoreResume({ resumeId: id, versionId: params.version });
			// The open draft takes the restored resume.
			if (useResumeStore.getState().document?.id === id) {
				await useResumeStore.getState().close();
				await useResumeStore.getState().open(id);
			}
			haptic("success");
			showToast({
				message: params.name
					? t`Restored “${params.name}”. Your previous state is saved as “Before restoring “${params.name}””.`
					: t`Restored. Your previous state is saved as “Before restore”.`,
			});
			router.dismissTo(`/builder/${id}`);
		} catch {
			setShareError(t`Couldn't restore this version. Try again.`);
			haptic("error");
		} finally {
			setRestoring(false);
		}
	};
	const page = useRenderedPage(
		!version && document.data
			? {
					kind: "resume",
					id,
					revision: document.data.updatedAt.toISOString(),
					data: document.data.data,
					fixture: "page-resume-full",
				}
			: undefined,
	);
	const zoom = useRef<PageZoomHandle>(null);
	const [asText, setAsText] = useState(false);
	const [shareError, setShareError] = useState("");
	useEffect(() => {
		let active = true;
		void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
			if (active) setAsText(enabled);
		});
		return () => {
			active = false;
		};
	}, []);
	const textData = document.data ? getResumeExportData(document.data.data, "resume") : null;
	const readable = textData ? buildMarkdown(textData, (section) => getResumeSectionTitle(textData, section)) : "";
	const [index, setIndex] = useState(0);
	const { width } = useWindowDimensions();
	const pageWidth = width - 32;
	const pageHeight = Math.round((pageWidth * 297) / 210);
	const close = () => {
		void flyBack(`resume-page-${id}`);
		router.back();
	};
	const shown = version ? versionPreview.preview : page;
	const current = shown.data?.pages[index];
	const footer = version ? (
		<FooterBar>
			<Button label={t`Back to now`} onPress={close} grow size="lg" />
			<Button
				label={restoring ? t`Restoring…` : t`Restore this version`}
				disabled={restoring || !versionPreview.version.data}
				grow
				size="lg"
				tone="primary"
				onPress={() => void restore()}
			/>
		</FooterBar>
	) : params.marker ? (
		<FooterBar>
			<Button label={t`Review this issue`} onPress={() => router.push(`/builder/${id}/check`)} size="lg" block />
		</FooterBar>
	) : undefined;
	return (
		<PushScreen
			scroll={false}
			back="close"
			onBack={close}
			bg="sunken"
			barCenter={<Text variant="topBarTitle" weight={500}>{t`Page ${index + 1} of ${page.data?.pageCount ?? 1}`}</Text>}
			barEnd={
				<IconButton
					icon="share-network"
					label={t`Share PDF`}
					onPress={() => {
						if (document.data)
							void prepareExport(document.data, "resume", "pdf", `${document.data.data.basics.name} Resume`)
								.then((file) => deliverExport(file, false))
								.catch(() => {
									setShareError(t`Download failed. Try again.`);
									haptic("error");
								});
					}}
				/>
			}
			footer={footer}
			overlay={
				<View
					style={{
						position: "absolute",
						bottom: footer ? 120 : 50,
						left: 0,
						right: 0,
						flexDirection: "row",
						justifyContent: "center",
						alignItems: "center",
						gap: 12,
					}}
				>
					<ZoomBar
						onZoomIn={() => zoom.current?.zoomIn()}
						onZoomOut={() => zoom.current?.zoomOut()}
						onFit={() => zoom.current?.fit()}
						trailing={{
							label: asText ? t`Show page` : t`Read as text`,
							icon: "text-aa",
							onPress: () => setAsText(!asText),
						}}
					/>
				</View>
			}
		>
			{asText && document.data ? (
				<ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
					{readable
						.split("\n\n")
						.filter(Boolean)
						.map((paragraph, i) => (
							<Text
								key={i}
								variant={/^#{1,6} /.test(paragraph) ? "sheetTitle" : "prose"}
								accessibilityRole={/^#{1,6} /.test(paragraph) ? "header" : undefined}
							>
								{paragraph.replace(/^#{1,6} /, "")}
							</Text>
						))}
				</ScrollView>
			) : (
				<PageZoom ref={zoom} onDismiss={close}>
					<View style={{ alignItems: "center", paddingTop: 16 }}>
						{version ? (
							<Text>{t`Couldn't load this version. Try again.`}</Text>
						) : current ? (
							<>
								<HeroTarget id={`resume-page-${id}`}>
									<Page
										source={{ uri: current.uri }}
										width={pageWidth}
										height={pageHeight}
										fixtureText={paperText["B18-Preview"]}
									>
										{page.data?.issueMarkers?.map((marker, n) => {
											const size = page.data?.pages[marker.page];
											if (marker.page !== index || !size) return null;
											return (
												<View
													key={marker.key}
													style={{
														position: "absolute",
														left: (marker.x / size.width) * pageWidth,
														top: (marker.y / size.height) * pageHeight,
													}}
												>
													<IssueMarker
														// The storyboard page's text already reports the number.
														numberTagged={!STORYBOARD}
														n={n + 1}
														label={t`Issue ${n + 1}`}
														onPress={() => router.push(`/builder/${id}/check`)}
													/>
												</View>
											);
										})}
									</Page>
								</HeroTarget>
								<View style={{ paddingTop: 20 }}>
									<Text color="ink3">{t`Tap a section to edit it`}</Text>
								</View>
							</>
						) : (
							<DocumentState
								loading={page.isPending}
								error={page.isError}
								retry={() => void page.refetch()}
								height={pageHeight}
							/>
						)}
					</View>
				</PageZoom>
			)}
			{shareError && (
				<Text color="dangerText" accessibilityRole="alert" style={{ marginHorizontal: 24 }}>
					{shareError}
				</Text>
			)}
			{((page.isFetching && page.data) || (STORYBOARD && params.preset === "updating")) && (
				<View style={{ flexDirection: "row", gap: 8, margin: 16 }}>
					<Spinner />
					<Text>{t`Updating…`}</Text>
				</View>
			)}
			{(page.data?.stale || (STORYBOARD && params.preset === "offline")) && (
				<Text style={{ marginHorizontal: 24 }}>{t`Offline. Showing the last saved page.`}</Text>
			)}
			{(page.data?.pageCount ?? 0) > 1 && (
				<View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
					<Button label={t`Previous page`} disabled={index === 0} onPress={() => setIndex(index - 1)} />
					<Button
						label={t`Next page`}
						disabled={index + 1 === page.data?.pageCount}
						onPress={() => setIndex(index + 1)}
					/>
				</View>
			)}
		</PushScreen>
	);
}
