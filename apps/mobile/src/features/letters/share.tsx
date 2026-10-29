import type { RouterOutput } from "@/api/client";
import type { LetterDocument } from "@/draft/types";
import type { ExportFormat } from "@/features/share/files";
import type { File } from "expo-file-system";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { letterPageData, useLetterWords } from "./compose";
import { LetterPages } from "./page";
import { useResumes } from "./queries";
import { restoreLetterVersion, saveLetter } from "./save";
import { client, orpc } from "@/api/client";
import { useLetterStore } from "@/draft";
import { useDocumentOperations } from "@/features/documents/queries";
import { exportDirectory, exportFile, shareExport } from "@/features/share/files";
import { letterWords } from "@/features/share/letter";
import { safeFileName } from "@/features/share/model";
import {
	Banner,
	Button,
	ConfirmDialog,
	IconButton,
	ListRow,
	Segmented,
	Sheet,
	Skeleton,
	Text,
	TextField,
	showToast,
	useTheme,
} from "@/ui";

type LetterFormat = ExportFormat | "both";

/** Saves what's typed before a server export or version; throws when the server doesn't have it. */
async function flushLetter(id: string) {
	if (!(await saveLetter(id))) throw new Error(t`Couldn't save your changes. Try again before continuing.`);
	const document = useLetterStore.getState().document;
	if (document?.id !== id) throw new Error(t`Couldn't load the cover letter.`);
	return document;
}

type LetterShareSheetProps = { id: string; open: boolean; onClose: () => void; version?: string | undefined };
/**
 * Download & history for letters (builder.html L7): Download and History. Letters have no public link. Opened from
 * Download in the letter chrome; the letter layout owns the draft, so this only subscribes. `version` opens History on
 * that version, read-only.
 */
export function LetterShareSheet({ id, open, onClose, version }: LetterShareSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const letter = useLetterStore((state) => (state.document?.id === id ? state.document : null));
	const [tab, setTab] = useState<"download" | "history">(version ? "history" : "download");
	const network = useNetworkState();
	const offline = network.isConnected === false || network.isInternetReachable === false;

	return (
		<Sheet open={open} onClose={onClose} title={t`Download & history`} detents={[0.9]}>
			<View style={{ gap: space.s4 }}>
				<Segmented
					label={t`Download & history`}
					value={tab}
					options={[
						{ value: "download", label: t`Download` },
						{ value: "history", label: t`History` },
					]}
					onChange={setTab}
				/>
				{!letter ? (
					<Skeleton height={space.s12} />
				) : tab === "download" ? (
					<LetterDownload letter={letter} offline={offline} />
				) : (
					<LetterHistory letter={letter} offline={offline} version={version} />
				)}
			</View>
		</Sheet>
	);
}

/**
 * Download: the letter as PDF (rendered here, so it works offline), Word, OpenDocument, Markdown or JSON, or, for a
 * letter with a resume, both as two matching PDFs.
 */
function LetterDownload({ letter, offline }: { letter: LetterDocument; offline: boolean }) {
	const { t } = useLingui();
	const { space } = useTheme();
	const resumes = useResumes();
	const resumeId = letter.sourceResumeId;
	const resumeName = resumes.data?.find((item) => item.id === resumeId)?.name;
	const sender = letter.style.basics.name.trim() || letter.name;
	const [format, setFormat] = useState<LetterFormat>("pdf");
	const [name, setName] = useState(safeFileName(t`${sender}-Cover-Letter`).replaceAll(" ", "-"));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const active = useRef(false);

	const formats: { id: LetterFormat; label: string; extension: string; description: string }[] = [
		{
			id: "pdf",
			label: t`PDF · Best for applying`,
			extension: ".pdf",
			description: t`Looks exactly like the page. Use it for applications and email.`,
		},
		...(resumeId
			? [
					{
						id: "both" as const,
						label: t`Resume + letter`,
						extension: t`2 files`,
						description: resumeName
							? t`This letter and “${resumeName}” as two PDFs, named to match.`
							: t`This letter and your resume as two PDFs, named to match.`,
					},
				]
			: []),
		{
			id: "docx",
			label: t`Word`,
			extension: ".docx",
			description: t`For portals or recruiters who ask for Word. Layout is simplified.`,
		},
		{
			id: "odt",
			label: t`OpenDocument`,
			extension: ".odt",
			description: t`For LibreOffice and other open-source editors. Layout is simplified.`,
		},
		{
			id: "md",
			label: t`Markdown`,
			extension: ".md",
			description: t`Plain text with headings. Paste into application forms and notes.`,
		},
		{
			id: "json",
			label: t`JSON`,
			extension: ".json",
			description: t`A backup of this letter. Imports back into Reactive Resume as a letter.`,
		},
	];
	const selected = formats.find((item) => item.id === format) ?? formats[0];
	const local = (as: LetterFormat) => as === "pdf";

	const download = async (as: LetterFormat) => {
		if (active.current) return;
		active.current = true;
		setBusy(true);
		setError(null);
		try {
			// Offline, the PDF renders from what's on this device; everything else needs the saved letter.
			const current = offline && local(as) ? useLetterStore.getState().document : await flushLetter(letter.id);
			if (current?.id !== letter.id) throw new Error(t`Couldn't load the cover letter.`);
			const directory = exportDirectory();
			const pdf = async (fileName: string) =>
				exportFile({
					directory,
					id: current.id,
					name: fileName,
					format: "pdf",
					data: letterPageData(current, await letterWords(current.style.metadata.page.locale)),
					letter: true,
				});

			const files: [File, ExportFormat][] = [];
			if (as === "both" && current.sourceResumeId) {
				// Both files are ready before either is handed off, so a failure leaves a clear retry.
				const resume = await client.resume.getById({ id: current.sourceResumeId });
				const resumeFile = await exportFile({
					directory,
					id: resume.id,
					name: safeFileName(t`${resume.data.basics.name || resume.name}-Resume`).replaceAll(" ", "-"),
					format: "pdf",
					data: resume.data,
				});
				files.push([resumeFile, "pdf"], [await pdf(name), "pdf"]);
			} else if (as === "pdf") {
				files.push([await pdf(name), "pdf"]);
			} else if (as !== "both") {
				files.push([await exportFile({ directory, id: current.id, name, format: as, letter: true }), as]);
			}
			for (const [file, type] of files) await shareExport(file, type);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t`Download failed. Try again.`);
		} finally {
			active.current = false;
			setBusy(false);
		}
	};

	return (
		<View style={{ gap: space.s3 }}>
			{offline ? (
				<Banner
					tone="info"
					message={t`You're offline. Download PDF uses this device. Other formats need a connection. Fonts and images must already be cached.`}
				/>
			) : null}
			{formats.map((item) => (
				<ListRow
					key={item.id}
					title={item.label}
					subtitle={`${item.description} (${item.extension})`}
					selected={format === item.id}
					leading={item.id === "pdf" || item.id === "both" ? "file-pdf" : "file-text"}
					disabled={busy || (offline && !local(item.id))}
					onPress={() => {
						setFormat(item.id);
						setError(null);
					}}
				/>
			))}
			{format !== "both" ? (
				<TextField
					label={t`File name`}
					value={name}
					onChangeText={(value) => setName(safeFileName(value))}
					maxLength={100}
					editable={!busy}
					trailing={<Text color="ink3">{selected?.extension}</Text>}
					helper={t`Recruiters see this name. Your name plus “Cover Letter” works well.`}
				/>
			) : null}
			{error ? <Banner tone="danger" message={error} /> : null}
			<Button
				label={
					busy ? t`Preparing file…` : format === "both" ? t`Download both PDFs` : t`Download ${format.toUpperCase()}`
				}
				icon="download-simple"
				loading={busy}
				disabled={(format !== "both" && !name.trim()) || (offline && !local(format))}
				onPress={() => void download(format)}
			/>
			{error && format !== "pdf" ? (
				<Button
					label={t`Download PDF instead`}
					variant="secondary"
					disabled={busy}
					onPress={() => void download("pdf")}
				/>
			) : null}
			<Text variant="caption" color="ink3">
				{t`Download opens the system share sheet. Choose a storage provider to save the file.`}
			</Text>
		</View>
	);
}

type Version = RouterOutput["coverLetters"]["listVersions"][number];

function versionTitle(version: Version) {
	switch (version.kind) {
		case "named":
			return version.name || t`Named version`;
		case "created":
			return t`Created`;
		case "auto":
			return t`Editing session`;
		case "before-restore":
			return t`Before restore`;
		case "restored":
			return t`Restored a version`;
		case "sent":
			return version.name ? t`Sent to ${version.name}` : t`Sent`;
		default:
			return t`Version`;
	}
}

type LetterHistoryProps = { letter: LetterDocument; offline: boolean; version?: string | undefined };
/** History: sessions, named and sent versions, restore points; a version shows read-only before Restore. */
function LetterHistory({ letter, offline, version: openVersion }: LetterHistoryProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const operations = useDocumentOperations();
	const list = useQuery({
		...orpc.coverLetters.listVersions.queryOptions({ input: { id: letter.id } }),
		enabled: !offline,
	});
	// `version` (Applications' "What you sent") shows that version until the user picks another.
	const [picked, setSelected] = useState<Version | null | undefined>(undefined);
	const selected = picked === undefined ? (list.data?.find((item) => item.id === openVersion) ?? null) : picked;
	const [menu, setMenu] = useState<Version | null>(null);
	const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
	const [name, setName] = useState("");
	const [rename, setRename] = useState("");
	const [restoring, setRestoring] = useState(false);
	const disabled = operations.busy || offline;

	const save = async () => {
		if (
			await operations.run(async () => {
				await flushLetter(letter.id);
				await client.coverLetters.createVersion({ id: letter.id, name: name.trim() });
			})
		) {
			setName("");
			void list.refetch();
			showToast({ message: t`Version saved` });
		}
	};
	const restore = async () => {
		setRestoring(false);
		if (!selected || letter.isLocked) return;
		let current = false;
		if (
			await operations.run(async () => {
				current = await restoreLetterVersion(
					letter.id,
					selected.id,
					() => new Error(t`Couldn't save your changes. Try again before continuing.`),
				);
			})
		) {
			// Finished after the user left or switched letters: the server has it; this editor is gone.
			if (!current) return;
			setSelected(null);
			void list.refetch();
			showToast({ message: t`Version restored. Your previous state is saved as “Before restore”.` });
		}
	};
	const mutateVersion = async (remove: boolean) => {
		if (!menu) return;
		const target = menu;
		if (remove) setMenu(null);
		if (
			await operations.run(async () => {
				if (remove) await client.coverLetters.deleteVersion({ id: letter.id, versionId: target.id });
				else await client.coverLetters.renameVersion({ id: letter.id, versionId: target.id, name: rename.trim() });
			})
		) {
			if (selected?.id === target.id) setSelected(remove ? null : { ...target, name: rename.trim() });
			setMenu(null);
			void list.refetch();
		}
	};

	if (selected) {
		return (
			<View style={{ gap: space.s3 }}>
				<Banner tone="info" icon="clock-counter-clockwise" message={t`Viewing ${versionTitle(selected)} · read-only`} />
				<VersionPage letter={letter} versionId={selected.id} />
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
					<Button
						label={t`Restore this version`}
						disabled={disabled || letter.isLocked}
						loading={operations.busy}
						onPress={() => setRestoring(true)}
					/>
					<Button label={t`Back to now`} variant="ghost" disabled={operations.busy} onPress={() => setSelected(null)} />
				</View>
				{operations.error ? <Banner tone="danger" message={operations.error} /> : null}
				<ConfirmDialog
					open={restoring}
					title={t`Restore this version?`}
					message={t`The current state will be saved as “Before restore” first.`}
					confirmLabel={t`Restore version`}
					onCancel={() => setRestoring(false)}
					onConfirm={() => void restore()}
				/>
			</View>
		);
	}

	return (
		<View style={{ gap: space.s3 }}>
			{offline ? <Banner tone="info" message={t`You're offline. History needs a connection.`} /> : null}
			{operations.error ? <Banner tone="danger" message={operations.error} /> : null}
			<TextField
				label={t`Name this version`}
				placeholder={t`For example, Sent to Lumen`}
				value={name}
				onChangeText={setName}
				maxLength={100}
				editable={!disabled}
				onSubmitEditing={() => {
					if (name.trim() && !disabled) void save();
				}}
			/>
			<Button
				label={t`Save`}
				variant="secondary"
				disabled={disabled || !name.trim()}
				loading={operations.busy}
				onPress={() => void save()}
			/>
			<ListRow title={t`Now`} subtitle={t`The letter as it is`} selected />
			{list.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load versions.`}
					action={{ label: t`Retry`, onPress: () => void list.refetch() }}
				/>
			) : list.isPending && !offline ? (
				<Skeleton height={space.s12} />
			) : (
				list.data?.map((version) => (
					<ListRow
						key={version.id}
						title={versionTitle(version)}
						subtitle={version.createdAt.toLocaleString(i18n.locale)}
						disabled={disabled}
						leading={version.kind === "named" ? "bookmark-simple" : "clock-counter-clockwise"}
						onPress={() => setSelected(version)}
						trailing={
							version.kind === "named" ? (
								<IconButton
									icon="dots-three"
									label={t`Options for ${versionTitle(version)}`}
									disabled={disabled}
									onPress={() => {
										setMenu(version);
										setRename(version.name ?? "");
										setMode("menu");
									}}
								/>
							) : undefined
						}
					/>
				))
			)}
			<Text variant="caption" color="ink3">
				{t`Every editing session adds a version automatically. Named versions are kept until you delete them. Restoring saves the current state first.`}
			</Text>
			<Sheet
				open={!!menu && mode !== "delete"}
				title={mode === "rename" ? t`Rename version` : t`Version options`}
				onClose={() => {
					if (!operations.busy) setMenu(null);
				}}
			>
				<View style={{ gap: space.s3 }}>
					{mode === "menu" ? (
						<>
							<ListRow title={t`Rename…`} leading="pencil-simple" onPress={() => setMode("rename")} />
							<ListRow title={t`Delete`} destructive leading="trash" onPress={() => setMode("delete")} />
						</>
					) : (
						<>
							<TextField label={t`Name`} value={rename} onChangeText={setRename} maxLength={100} editable={!disabled} />
							<Button
								label={t`Save`}
								loading={operations.busy}
								disabled={disabled || !rename.trim()}
								onPress={() => void mutateVersion(false)}
							/>
						</>
					)}
				</View>
			</Sheet>
			<ConfirmDialog
				open={!!menu && mode === "delete"}
				title={t`Delete “${menu ? versionTitle(menu) : ""}”?`}
				message={t`Named versions are kept until you delete them. This can't be undone.`}
				destructive
				confirmLabel={t`Delete version`}
				onCancel={() => setMenu(null)}
				onConfirm={() => void mutateVersion(true)}
			/>
		</View>
	);
}

/** A saved version as it printed, read-only. */
function VersionPage({ letter, versionId }: { letter: LetterDocument; versionId: string }) {
	const { t } = useLingui();
	const { size } = useTheme();
	const version = useQuery(orpc.coverLetters.getVersion.queryOptions({ input: { id: letter.id, versionId } }));
	const words = useLetterWords(version.data?.data.style.metadata.page.locale);
	const versionData = version.data?.data;
	// Memoised: a new object each render would restart the preview every time a render lands.
	const data = useMemo(
		() => (versionData && words ? letterPageData({ ...letter, ...versionData }, words) : null),
		[letter, versionData, words],
	);

	if (version.isError)
		return (
			<Banner
				tone="danger"
				message={t`Couldn't load this version's page.`}
				action={{ label: t`Retry`, onPress: () => void version.refetch() }}
			/>
		);
	return (
		<View style={{ height: size.hit * 10 }}>
			<LetterPages data={data} zoomBar={false} />
		</View>
	);
}
