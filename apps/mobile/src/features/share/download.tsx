import type { ExportFormat } from "./files";
import type { ResumeDocument } from "@/draft/types";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useRef, useState } from "react";
import { View } from "react-native";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { composeCoverLetter, createCoverLetterResumeData } from "@reactive-resume/resume/cover-letter";
import { getDefaultFileName } from "@reactive-resume/utils/file";
import { flushResume } from "./document";
import { exportDirectory, exportFile, printResume, shareExport } from "./files";
import { letterWords } from "./letter";
import { safeFileName } from "./model";
import { client } from "@/api/client";
import { useLetterStore, useResumeStore } from "@/draft";
import { useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import { Banner, Button, ListRow, SelectSheet, Switch, Text, TextField, showToast, useTheme } from "@/ui";

type DownloadProps = { resume: ResumeDocument; offline: boolean };
export function DownloadTab({ resume, offline }: DownloadProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { space } = useTheme();
	const issues = lintResumeForAts(resume.data).findings.length;
	const applications = useApplications();
	const linked = applications.data?.find(
		(item) => item.coverLetterId && (item.id === resume.applicationId || item.resumeId === resume.id),
	);
	const [withLetter, setWithLetter] = useState(false);
	const [format, setFormat] = useState<ExportFormat>("pdf");
	// Named like web's download, in the resume's own language: "Layla-Haddad-Lebenslauf".
	const [name, setName] = useState(safeFileName(getDefaultFileName(resume)));
	const [busy, setBusy] = useState(false);
	const [exportReady, setExportReady] = useState(false);
	const active = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const formats: { id: ExportFormat; label: string; description: string }[] = [
		{
			id: "pdf",
			label: t`PDF · Best for applying`,
			description: t`Looks exactly like the page. Use it for applications and email.`,
		},
		{ id: "docx", label: t`Word`, description: t`For portals or recruiters who ask for Word. Layout is simplified.` },
		{
			id: "odt",
			label: t`OpenDocument`,
			description: t`For LibreOffice and other open-source editors. Layout is simplified.`,
		},
		{ id: "md", label: t`Markdown`, description: t`Plain text with headings. Paste into application forms and notes.` },
		{
			id: "json",
			label: t`JSON`,
			description: t`Complete data backup. Imports back into Reactive Resume or JSON Resume tools.`,
		},
	];
	const download = async (chosen: ExportFormat, print = false, includeLetter = withLetter) => {
		if (active.current) return;
		active.current = true;
		setBusy(true);
		setExportReady(false);
		setError(null);
		try {
			if (chosen !== "pdf" || !offline) await flushResume(resume.id);
			const current = useResumeStore.getState().document;
			if (current?.id !== resume.id) throw new Error(t`Couldn't load the resume.`);
			if (print) {
				await printResume(current.data, name);
				return;
			}
			const directory = exportDirectory();
			const file = await exportFile({ directory, id: resume.id, name, format: chosen, data: current.data });
			// Generate both files before handing either to another app, so failures leave a clear retry path.
			let letterFile;
			if (includeLetter && linked?.coverLetterId) {
				const letter = useLetterStore.getState();
				if (letter.document?.id === linked.coverLetterId) {
					await letter.flush();
					const latest = useLetterStore.getState();
					if (latest.conflict || !["saved", "idle"].includes(latest.status))
						throw new Error(t`Save the cover letter before exporting it.`);
				}
				const savedLetter = await client.coverLetters.getById({ id: linked.coverLetterId });
				const composed =
					chosen === "pdf"
						? composeCoverLetter(savedLetter, await letterWords(savedLetter.style.metadata.page.locale))
						: null;

				letterFile = await exportFile({
					directory,
					id: linked.coverLetterId,
					// Named as web names it, in the letter's own language: "Layla-Haddad-Anschreiben".
					name: safeFileName(
						getDefaultFileName(
							{ name: savedLetter.name, slug: "", data: createCoverLetterResumeData(savedLetter) },
							"cover-letter",
						),
					),
					format: chosen,
					letter: true,
					...(composed ? { data: createCoverLetterResumeData({ ...savedLetter, ...composed }) } : {}),
				});
			}
			await shareExport(file, chosen);
			if (letterFile) await shareExport(letterFile, chosen);
			setExportReady(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t`Couldn't export. Try again.`);
		} finally {
			active.current = false;
			setBusy(false);
		}
	};
	return (
		<View style={{ gap: space.s3 }}>
			{offline && (
				<Banner
					tone="info"
					message={t`You're offline. Download PDF uses this device. Other formats and linked letters need a connection. Fonts and images must already be cached.`}
				/>
			)}
			<TextField
				label={t`File name`}
				value={name}
				onChangeText={(value) => setName(safeFileName(value))}
				maxLength={100}
				editable={!busy}
				trailing={<Text color="ink3">.{format}</Text>}
				helper={t`Recruiters see this name. Your name plus “Resume” works well.`}
			/>
			{error && <Banner tone="danger" message={error} />}
			<Button
				label={busy ? t`Preparing file…` : format === "pdf" ? t`Share PDF` : t`Download ${format.toUpperCase()}`}
				icon="export"
				fullWidth
				loading={busy}
				disabled={!name.trim() || (offline && format !== "pdf") || (offline && withLetter)}
				onPress={() => void download(format)}
			/>
			{exportReady && (
				<ListRow
					title={t`Get resume feedback on Discord`}
					subtitle={t`Ask the community. Remove personal details before posting.`}
					leading="discord-logo"
					external
					onPress={() => {
						void openBrowserAsync("https://discord.gg/9kAqrGcwn5").catch(() =>
							showToast({ message: t`Couldn't open the browser. Try again.` }),
						);
					}}
				/>
			)}
			{((error && format !== "pdf") || (offline && (format !== "pdf" || withLetter))) && (
				<Button
					label={t`Share PDF instead`}
					variant="secondary"
					disabled={busy || !name.trim()}
					onPress={() => {
						setWithLetter(false);
						setFormat("pdf");
						void download("pdf", false, false);
					}}
				/>
			)}
			<SelectSheet
				label={t`File format`}
				value={format}
				placeholder={formats.find((item) => item.id === format)?.label}
				options={(offline ? formats.filter((item) => item.id === "pdf") : formats).map((item) => ({
					value: item.id,
					label: item.label,
					description: `${item.description} (.${item.id})`,
				}))}
				disabled={busy}
				onChange={(value) => {
					setFormat(value);
					setError(null);
					setExportReady(false);
				}}
			/>
			{linked?.coverLetterId && (
				<ListRow
					title={t`Also download the ${linked.company} cover letter`}
					trailing={
						<Switch
							label={t`Also download the cover letter`}
							value={withLetter}
							onValueChange={setWithLetter}
							disabled={busy || (offline && !withLetter)}
						/>
					}
				/>
			)}
			{applications.isError && (
				<Banner
					tone="warn"
					message={t`Couldn't check for a linked cover letter.`}
					action={{ label: t`Retry`, onPress: () => void applications.refetch() }}
				/>
			)}
			{issues > 0 && (
				<Text color="ink2">
					{plural(issues, {
						one: "Check has # thing to review. You can still download.",
						other: "Check has # things to review. You can still download.",
					})}
				</Text>
			)}
			<Button
				label={t`Print`}
				icon="printer"
				variant="secondary"
				disabled={busy}
				onPress={() => void download("pdf", true)}
			/>
			<Button
				label={t`Review Check`}
				variant="link"
				disabled={busy}
				onPress={() => router.push(routes.builder(resume.id, "check"))}
			/>
			<Text
				color="ink3"
				variant="caption"
			>{t`Download opens the system share sheet. Choose a storage provider to save the file. A linked letter opens as a second file.`}</Text>
		</View>
	);
}
