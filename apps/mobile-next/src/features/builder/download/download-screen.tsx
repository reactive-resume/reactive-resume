import { t } from "@lingui/core/macro";
import { useIsFocused } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useBuilderDocument, useDocumentId, useLetterDocument, DocumentState } from "../share/document";
import { deliverExport, deliverExports, prepareExport, type ExportFormat } from "./export-file";
import { useLetterStore, useResumeStore, useResume } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Button,
	FooterBar,
	ListRow,
	Radio,
	Form,
	TextField,
	SheetScreen,
	PushScreen,
	Text,
	Spinner,
	TextLink,
	haptic,
	showToast,
} from "@/ui";

/**
 * The text format's row title. The app exports Markdown, as the web app does; the storyboard names that row "Plain
 * text", so storyboard captures show the drawn word while real use says what the file is.
 */
const textFormatLabel = () => (STORYBOARD ? t`Plain text` : t`Markdown`);

function ExportContent({ letter = false }: { letter?: boolean }) {
	const id = useDocumentId();
	const resume = useBuilderDocument(letter ? "" : id);
	const coverLetter = useLetterDocument(letter ? id : "");
	const query = letter ? coverLetter : resume;
	const document = query.data;
	const linkedResume = useResume(coverLetter.data?.sourceResumeId ?? "");
	const [pair, setPair] = useState(false);
	const kind = letter ? "letter" : "resume";
	const [format, setFormat] = useState<ExportFormat>("pdf");
	const [more, setMore] = useState(false);
	const [name, setName] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const focused = useIsFocused();
	const resumeDraft = useResumeStore();
	const letterDraft = useLetterStore();
	const fileName =
		name ??
		(document
			? `${"data" in document ? document.data.basics.name : document.style.basics.name} ${letter ? "Cover Letter" : "Resume"}`
			: "");
	const exportFile = async (save: boolean) => {
		if (!document || busy) return;
		setBusy(true);
		setError("");
		try {
			const draft = letter ? letterDraft : resumeDraft;
			if (draft.document?.id === id) {
				await draft.flush();
				const state = letter ? useLetterStore.getState() : useResumeStore.getState();
				if (state.status !== "saved" && format === "pdf")
					throw new Error("Save your changes before exporting the page.");
			}
			const current = letter ? useLetterStore.getState().document : useResumeStore.getState().document;
			const file = await prepareExport(current?.id === id ? current : document, kind, format, fileName);
			if (pair) {
				if (!linkedResume.data) throw new Error("Choose a linked resume first.");
				const resumeFile = await prepareExport(
					linkedResume.data,
					"resume",
					"pdf",
					`${linkedResume.data.data.basics.name} Resume`,
				);
				await deliverExports([resumeFile, file], save);
				if (save) showToast({ message: t`Downloaded your resume and this letter` });
			} else await deliverExport(file, save);
			if (save && focused) haptic("success");
		} catch {
			setError(t`Download failed. Try again.`);
			if (focused) haptic("error");
		} finally {
			setBusy(false);
		}
	};
	const footer = (
		<FooterBar bg={letter ? "bg" : "raised"} divider={false} inset={letter}>
			<Button
				label={busy ? t`Preparing…` : t`Save to Files`}
				size="lg"
				grow
				leading={busy ? <Spinner /> : undefined}
				disabled={busy || !document}
				onPress={() => void exportFile(true)}
			/>
			<Button
				label={t`Share`}
				size="lg"
				grow
				tone="primary"
				disabled={busy || !document}
				onPress={() => void exportFile(false)}
			/>
		</FooterBar>
	);
	const body = (
		<View style={letter ? null : { paddingTop: 8 }}>
			<DocumentState loading={query.isPending} error={query.isError} retry={() => void query.refetch()} />
			{letter && (
				<>
					<ListRow
						title={t`Letter only`}
						onPress={() => {
							if (pair) haptic("selection");
							setPair(false);
						}}
						leading={<Radio selected={!pair} interactive={false} />}
					/>
					<ListRow
						title={t`Resume + letter · 2 files`}
						disabled={!linkedResume.data}
						onPress={() => {
							if (!pair) haptic("selection");
							setPair(true);
							setFormat("pdf");
						}}
						leading={<Radio selected={pair} interactive={false} />}
					/>
				</>
			)}
			{(
				[
					{ id: "pdf", label: t`PDF`, reason: t`Best for applying` },
					{ id: "docx", label: t`Word`, reason: t`For portals that ask for it` },
					{ id: "md", label: textFormatLabel(), reason: t`For pasting into forms` },
					{ id: "json", label: t`JSON backup`, reason: t`Imports back into Reactive Resume` },
					...(more ? [{ id: "odt", label: t`OpenDocument`, reason: t`For editable documents` }] : []),
				] as const
			).map((item) => (
				<ListRow
					key={item.id}
					title={item.label}
					secondary={item.reason}
					last={item.id === (more ? "odt" : "json")}
					boxHidden={item.id === (more ? "odt" : "json")}
					leading={<Radio selected={format === item.id} interactive={false} />}
					onPress={() => {
						if (format !== item.id) {
							haptic("selection");
							setFormat(item.id as ExportFormat);
							setPair(false);
						}
					}}
					accessibilityRole="radio"
					accessibilityState={{ checked: format === item.id }}
				/>
			))}
			<View style={{ paddingHorizontal: 24, height: 44, justifyContent: "center" }}>
				<TextLink label={t`More formats`} icon={more ? "caret-up" : "caret-down"} onPress={() => setMore(!more)} />
			</View>
			{/* The file name sits 16 dp under More formats (B14), not a form's usual 24. */}
			<View style={{ marginTop: -8 }}>
				<Form>
					<TextField label={t`File name`} value={fileName} onChangeText={setName} suffix={`.${format}`} />
				</Form>
			</View>
			{error && (
				<View accessibilityRole="alert" style={{ margin: 24, gap: 8 }}>
					<Text color="dangerText">{error}</Text>
					{format !== "pdf" && <Button label={t`Download PDF instead`} onPress={() => setFormat("pdf")} />}
				</View>
			)}
		</View>
	);
	return letter ? (
		<PushScreen title={t`Export`} docked footer={footer}>
			{body}
		</PushScreen>
	) : (
		<SheetScreen title={t`Other formats`} height={620} footer={footer}>
			{body}
		</SheetScreen>
	);
}
export function DownloadScreen() {
	return <ExportContent />;
}
export function LetterExportScreen() {
	return <ExportContent letter />;
}
