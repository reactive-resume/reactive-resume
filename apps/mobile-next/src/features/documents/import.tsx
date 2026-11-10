import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { needsAIChoice } from "./import-mode";
import { CollectionState } from "./shared";
import {
	createImportedResume,
	providerConnection,
	useAIProviders,
	usePlatformActions,
	useDocumentImport,
	useDataBackend,
	useResume,
} from "@/data";
import {
	Button,
	FooterBar,
	HeroCard,
	Icon,
	IconTile,
	ListRow,
	PushScreen,
	Radio,
	RowLink,
	SectionHeading,
	WorkingLabel,
	Dialog,
	Text,
	TextField,
	haptic,
	useFadeUp,
} from "@/ui";

export function ImportScreen() {
	const { scope } = useDataBackend();
	return <ScopedImportScreen key={scope} />;
}

function ScopedImportScreen() {
	const params = useLocalSearchParams<{ review?: string; state?: string }>();
	const { backend, scope } = useDataBackend();
	const fixtureReview = backend.kind === "fake" && params.review === "1";
	const resume = useResume(fixtureReview ? "resume-lumen" : "");
	const importer = useDocumentImport();
	const actions = usePlatformActions();
	const providers = useAIProviders();
	const provider = providers.data?.find((p) => p.isDefault && p.enabled);
	const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset>();
	const file = selectedFile ?? importer.file;
	const serverReadsPDF = backend.kind === "real" && /\.pdf$/i.test(file?.name ?? "");
	const [language, setLanguage] = useState<string>();
	const [choosingLanguage, setChoosingLanguage] = useState(false);
	const [error, setError] = useState<string | undefined>(
		params.state === "error" ? t`The file couldn't be read as a resume.` : undefined,
	);
	const [reading, setReading] = useState(false);
	const [creatingResume, setCreatingResume] = useState(false);
	const [ai, setAi] = useState(false);
	const router = useRouter();
	const cache = useQueryClient();
	const owner = useRef(scope);
	useEffect(() => {
		owner.current = scope;
		return () => {
			owner.current = null;
		};
	}, [scope]);
	const attempt = useRef(0);
	const visible = useRef(false);
	const creating = useRef<AbortController | null>(null);
	useFocusEffect(
		useCallback(() => {
			visible.current = true;
			return () => {
				visible.current = false;
			};
		}, []),
	);
	useEffect(() => () => creating.current?.abort(), []);
	useEffect(
		() => () => {
			attempt.current++;
		},
		[],
	);
	const fixtureSummary = fixtureReview && !!resume.data && !file;
	const preview = importer.preview;
	const parsed = preview?.kind === "resume" ? preview : undefined;
	const summary = fixtureSummary || !!parsed;
	const summaryStyle = useFadeUp({ start: summary });
	const choose = async () => {
		const run = ++attempt.current;
		const account = scope;
		const current = () => attempt.current === run && owner.current === account;
		try {
			const picked = await DocumentPicker.getDocumentAsync({
				copyToCacheDirectory: true,
				multiple: false,
				type: [
					"application/pdf",
					"application/json",
					"application/zip",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				],
			});
			if (picked.canceled || !picked.assets[0] || !current()) return;
			const asset = picked.assets[0];
			setSelectedFile(asset);
			if (needsAIChoice(asset.name, ai))
				throw new Error(t`Word import needs AI. For a local import, export a PDF or JSON file instead.`);
			setError(undefined);
			setReading(true);
			const result = await importer.read(asset, {
				ai,
				...(provider ? { connection: providerConnection(provider) } : {}),
			});
			if (!current()) return;
			if (result.kind === "backup") {
				setCreatingResume(true);
				creating.current = new AbortController();
				await createImportedResume(result, { signal: creating.current.signal });
				await cache.invalidateQueries();
				router.replace("/documents");
			} else setLanguage(result.language);
			if (visible.current) haptic("success");
		} catch (cause) {
			if (!current()) return;
			setError(cause instanceof Error ? cause.message : t`The file couldn't be read as a resume.`);
			if (visible.current) haptic("error");
		} finally {
			if (current()) {
				setReading(false);
				setCreatingResume(false);
			}
		}
	};
	const create = async () => {
		if (reading) return;
		setReading(true);
		setCreatingResume(true);
		creating.current = new AbortController();
		try {
			if (fixtureSummary && resume.data) {
				const id = await actions.run("resume.import", { data: resume.data.data });
				router.replace(`/builder/${id}`);
				return;
			}
			const result =
				parsed && language
					? await createImportedResume(
							{
								...parsed,
								data: {
									...parsed.data,
									metadata: { ...parsed.data.metadata, page: { ...parsed.data.metadata.page, locale: language } },
								},
							},
							{ signal: creating.current.signal, keepLeftovers: true },
						)
					: await importer.create();
			await cache.invalidateQueries();
			if (result.type === "resume") router.replace(`/builder/${result.id}`);
		} catch {
			setError(t`Couldn't import the file. Your file is kept. Try again.`);
		} finally {
			setReading(false);
			setCreatingResume(false);
		}
	};
	return (
		<PushScreen
			title={t`Import a resume`}
			overlay={
				<Dialog
					open={choosingLanguage}
					onClose={() => setChoosingLanguage(false)}
					title={t`Resume language`}
					actions={[{ label: t`Done`, tone: "primary", onPress: () => setChoosingLanguage(false) }]}
				>
					<TextField label={t`Language code`} value={language ?? "en"} onChangeText={setLanguage} />
				</Dialog>
			}
			back="close"
			presentation="modal"
			footer={
				summary ? (
					<FooterBar>
						<Button
							label={fixtureSummary ? t`English` : (language ?? parsed?.language ?? t`English`)}
							size="lg"
							grow
							onPress={() => setChoosingLanguage(true)}
						/>
						<Button
							label={t`Create resume`}
							size="lg"
							tone="primary"
							grow
							disabled={reading || (!parsed && !fixtureSummary)}
							onPress={() => void create()}
						/>
					</FooterBar>
				) : undefined
			}
		>
			{!file && !summary ? (
				<HeroCard dashed title={t`Choose a file`} body={t`PDF, Word, JSON, LinkedIn .zip`}>
					<View style={{ alignItems: "center", gap: 20 }}>
						<Icon name="download-simple" size={40} color="ink3" />
						<Button
							label={t`Choose a file`}
							onPress={() => {
								void choose();
							}}
						/>
					</View>
				</HeroCard>
			) : (
				<View style={{ paddingTop: 16 }}>
					<ListRow
						wrapTitle
						wrapSecondary
						title={file?.name ?? "alex-morgan-cv.pdf"}
						secondary={file?.size ? t`${Math.ceil(file.size / 1024)} KB` : t`182 KB · 2 pages`}
						leading={<IconTile icon="file-pdf" />}
						trailing={
							<RowLink
								label={t`Change`}
								onPress={() => {
									void choose();
								}}
							/>
						}
						top
						last
					/>
				</View>
			)}
			{file || summary ? (
				<>
					<SectionHeading title={t`How to read it`} />
					<ListRow
						wrapTitle
						wrapSecondary
						title={serverReadsPDF ? t`Read without AI` : t`Read on this device (free)`}
						secondary={
							serverReadsPDF
								? t`Your server reads the PDF. It isn't sent to an AI provider.`
								: t`Nothing leaves your phone`
						}
						leading={<Radio selected={!ai} interactive={false} />}
						onPress={() => setAi(false)}
						accessibilityRole="radio"
						accessibilityState={{ checked: !ai }}
					/>
					<ListRow
						wrapTitle
						wrapSecondary
						title={t`Read with AI`}
						secondary={t`Better with unusual layouts`}
						leading={<Radio selected={ai} interactive={false} />}
						onPress={() => {
							setAi(true);
							if (!provider) router.push("/settings/ai");
							else if (file) {
								setReading(true);
								void importer
									.read(file, { ai: true, connection: providerConnection(provider) })
									.catch(() => setError(t`Couldn't read the file. Your file is kept.`))
									.finally(() => setReading(false));
							}
						}}
						accessibilityRole="radio"
						accessibilityState={{ checked: ai }}
						last
						boxHidden
					/>
				</>
			) : null}
			{reading ? (
				<View style={{ padding: 24, flexDirection: "row", gap: 10 }}>
					<WorkingLabel
						steps={[
							creatingResume
								? t`Creating resume`
								: importer.step === "parsing"
									? t`Finding sections`
									: t`Reading the file`,
							t`Still working`,
						]}
					/>
					<Button
						label={t`Stop`}
						onPress={() => {
							importer.cancel();
							creating.current?.abort();
							setReading(false);
						}}
					/>
				</View>
			) : null}
			{error ? (
				<CollectionState
					message={error}
					action={t`Choose another file`}
					onPress={() => {
						void choose();
					}}
				/>
			) : null}
			{summary ? (
				<Animated.View style={summaryStyle}>
					<View style={{ marginHorizontal: 24, marginTop: 16, flexDirection: "row", alignItems: "center", gap: 10 }}>
						<Icon name="check-circle" size={20} color="accentText" />
						<Text variant="bubble" color="ink2">
							{fixtureSummary
								? t`Read 2 pages · found 5 sections`
								: t`Found ${parsed?.summary.sections.length ?? 0} sections`}
						</Text>
					</View>
					<SectionHeading title={t`Check what was found`} />
					<ListRow
						wrapTitle
						wrapSecondary
						title={t`Basics`}
						// The fixture review stands in for a parsed file; its basics are the storyboard's, not the saved resume's.
						secondary={fixtureSummary ? t`Alex Morgan · Product designer · Lisbon` : parsed?.data.basics.name}
						trailing={<Icon name="check" size={24} color="ink2" />}
					/>
					{fixtureSummary ? (
						<>
							<ListRow wrapTitle wrapSecondary title={t`Experience`} value="4" />
							<ListRow wrapTitle wrapSecondary title={t`Education · Skills · Languages`} value="2 · 12 · 3" />
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`More from your file`}
								secondary={t`Text we couldn't place, to sort later`}
								value="1"
								last
								boxHidden
							/>
						</>
					) : (
						<>
							{parsed?.summary.sections.map((section) => (
								<ListRow key={section.key} title={section.title} value={String(section.entries)} wrapTitle />
							))}
							{parsed?.summary.missingContact ? (
								<CollectionState message={t`Name and contact details weren't found. Add them in Basics.`} />
							) : null}
							{!parsed?.summary.sections.length ? (
								<CollectionState
									message={t`No sections were found in this file.`}
									action={t`Start blank`}
									onPress={() => router.replace("/new")}
								/>
							) : null}
						</>
					)}
				</Animated.View>
			) : null}
		</PushScreen>
	);
}
