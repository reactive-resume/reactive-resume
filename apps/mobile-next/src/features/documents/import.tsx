import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { CollectionState } from "./shared";
import { isQueueBundle, restoreQueued, useDataBackend, useResume } from "@/data";
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
	Spinner,
	Text,
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
	const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset>();
	const [error, setError] = useState<string | undefined>(
		params.state === "error" ? t`The file couldn't be read as a resume.` : undefined,
	);
	const [reading, setReading] = useState(false);
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
	useEffect(
		() => () => {
			attempt.current++;
		},
		[],
	);
	const summary = fixtureReview && !!resume.data && !file;
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
			setFile(asset);
			setError(undefined);
			const source = new File(asset.uri);
			if ((asset.size ?? source.size) > 10 * 1024 * 1024)
				throw new Error(t`File is too large. Choose a file up to 10 MB.`);
			setReading(true);
			if (asset.name.toLowerCase().endsWith(".json")) {
				const input: unknown = JSON.parse(await source.text());
				if (!current()) return;
				if (isQueueBundle(input)) {
					await restoreQueued(input);
					if (!current()) return;
					await cache.invalidateQueries();
					haptic("success");
					router.replace("/documents");
					return;
				}
			}
			if (asset.name.toLowerCase().endsWith(".docx") && !ai)
				throw new Error(t`Word import needs AI. For a local import, export a PDF or JSON file instead.`);
			throw new Error(t`Resume import is not available yet. Your file has not been uploaded.`);
		} catch (cause) {
			if (!current()) return;
			setError(cause instanceof Error ? cause.message : t`The file couldn't be read as a resume.`);
			haptic("error");
		} finally {
			if (current()) setReading(false);
		}
	};
	return (
		<PushScreen
			title={t`Import a resume`}
			back="close"
			presentation="modal"
			footer={
				summary ? (
					<FooterBar>
						<Button
							label={t`English`}
							size="lg"
							grow
							onPress={() => setError(t`Resume language selection needs the import service.`)}
						/>
						<Button
							label={t`Create resume`}
							size="lg"
							tone="primary"
							grow
							onPress={() => setError(t`Resume import is not available yet. Your file has not been uploaded.`)}
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
						title={t`Read on this device (free)`}
						secondary={t`Nothing leaves your phone`}
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
							router.push("/settings/ai");
						}}
						accessibilityRole="radio"
						accessibilityState={{ checked: ai }}
						last
					/>
				</>
			) : null}
			{reading ? (
				<View style={{ padding: 24, flexDirection: "row", gap: 10 }}>
					<Spinner />
					<Text variant="body">{t`Reading the file`}</Text>
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
						<Text variant="bubble" color="ink2">{t`Read 2 pages · found 5 sections`}</Text>
					</View>
					<SectionHeading title={t`Check what was found`} />
					<ListRow
						wrapTitle
						wrapSecondary
						title={t`Basics`}
						secondary={[
							resume.data?.data.basics.name,
							resume.data?.data.basics.headline,
							resume.data?.data.basics.location,
						]
							.filter(Boolean)
							.join(" · ")}
						trailing={<Icon name="check" size={24} color="ink2" />}
					/>
					<ListRow wrapTitle wrapSecondary title={t`Experience`} value="4" />
					<ListRow wrapTitle wrapSecondary title={t`Education · Skills · Languages`} value="2 · 12 · 3" />
					<ListRow
						wrapTitle
						wrapSecondary
						title={t`More from your file`}
						secondary={t`Text we couldn't place, to sort later`}
						value="1"
						last
					/>
				</Animated.View>
			) : null}
		</PushScreen>
	);
}
