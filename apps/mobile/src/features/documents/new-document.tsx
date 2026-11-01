import type { ImportedDocument } from "./import-file";
import type { DocumentPickerAsset } from "expo-document-picker";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
import { getNetworkStateAsync } from "expo-network";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { forEachDatedEntry, hasUnreadableDateText } from "@reactive-resume/schema/resume/dates";
import { importDocument, ImportError } from "./import-file";
import { useNewDocuments } from "./new-documents";
import { documentError, useDocumentRefresh, useDocuments } from "./queries";
import { client, orpc } from "@/api/client";
import { getServer, useSession } from "@/auth/session";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { AddApplicationSheet } from "@/features/applications/add-sheet";
import { routes } from "@/routes";
import { Banner, Button, Card, ListRow, Screen, SelectSheet, Switch, Text, TextField, useTheme } from "@/ui";

type Step = "choose" | "copy" | "import";

export function NewDocument() {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const params = useLocalSearchParams<{
		context?: string;
		step?: string;
		sourceResumeId?: string;
		applicationId?: string;
	}>();
	const jobFirst = params.context === "career" || params.context === "applications";
	const openSaveJob = () => router.replace(routes.newJob());
	const session = useSession();
	const documents = useDocuments();
	const refresh = useDocumentRefresh();
	const ai = useHasAIProvider();
	const [setup, setSetup] = useState(false);
	const [step, setStep] = useState<Step>(params.step === "copy" ? "copy" : "choose");
	const [sourceId, setSourceId] = useState<string | null>(params.sourceResumeId ?? null);
	const [jobId, setJobId] = useState<string | null>(params.applicationId ?? null);
	const [name, setName] = useState<string | null>(null);
	const [aiPdf, setAiPdf] = useState<boolean | null>(null);
	const [asset, setAsset] = useState<DocumentPickerAsset | null>(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<ImportedDocument | null>(null);
	const [applicationLinked, setApplicationLinked] = useState(false);
	const [summary, setSummary] = useState<string | null>(null);
	const [addingJob, setAddingJob] = useState(false);
	const running = useRef(false);
	const mounted = useRef(true);
	const abort = useRef<AbortController | null>(null);
	const cached = useRef<File | null>(null);
	const options = orpc.applications.listSummary.queryOptions({ input: {} });
	const applications = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: step === "copy" && session.status === "signed-in",
	});
	const resumes = (documents.data ?? []).filter((document) => document.type === "resume");
	const source = resumes.find((document) => document.id === sourceId) ?? resumes[0];
	const jobs = (applications.data ?? []).filter((application) => application.status !== "closed");
	const job = jobs.find((application) => application.id === jobId);
	const suggested = (
		job ? `${source?.name.split(" — ")[0] ?? ""} — ${job.company}` : t`${source?.name ?? ""} (copy)`
	).slice(0, 100);
	const cleanupFile = () => {
		try {
			cached.current?.delete();
		} catch {
			/* Cache eviction is best effort; never touch the original picker file. */
		}
		cached.current = null;
	};
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			abort.current?.abort();
			cleanupFile();
		};
	}, []);
	const open = (document: ImportedDocument) => {
		useNewDocuments.getState().markOpened(document);
		router.replace(document.type === "resume" ? routes.builder(document.id) : routes.letter(document.id));
	};
	const run = async (task: (signal: AbortSignal) => Promise<void>) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setError(null);
		const controller = new AbortController();
		abort.current = controller;
		try {
			if (session.status !== "signed-in" || getServer() !== session.server)
				throw new ImportError(t`Sign in to continue.`);
			const network = await getNetworkStateAsync();
			if (network.isConnected === false || network.isInternetReachable === false)
				throw new ImportError(t`You're offline. Try again when you reconnect.`);
			if (getServer() !== session.server || controller.signal.aborted) return;
			await task(controller.signal);
		} catch (cause) {
			if (mounted.current && !controller.signal.aborted)
				setError(cause instanceof ImportError ? cause.message : documentError(cause));
		} finally {
			void refresh();
			running.current = false;
			if (mounted.current) {
				setBusy(false);
				setProgress(null);
			}
		}
	};
	const current = (signal: AbortSignal) => mounted.current && !signal.aborted && getServer() === session.server;
	const linkToApplication = async (document: ImportedDocument, signal: AbortSignal) => {
		if (!current(signal) || document.type !== "resume" || !params.applicationId) return;
		await client.documents.linkApplication({ ...document, applicationId: params.applicationId }, { signal });
		if (current(signal)) setApplicationLinked(true);
	};
	const onCopiedForJob = (resumeId: string) => {
		// Opens this copy with the Assistant on its next-step suggestions for the linked job.
		open({ id: resumeId, type: "resume" });
		router.push({ pathname: routes.assistant(resumeId), params: { prepare: "1" } });
	};
	const create = (kind: "blank" | "sample" | "letter") =>
		run(async (signal) => {
			let document: ImportedDocument;
			if (kind === "letter") {
				const latest = resumes.toSorted((a, b) => b.editedAt.getTime() - a.editedAt.getTime())[0];
				// A number when an untitled letter already exists, so the library can tell them apart until they're named.
				const base = t`Untitled letter`;
				const taken = new Set(
					(await client.documents.list({ type: "letter", q: base }, { signal })).map((letter) =>
						letter.name.toLowerCase(),
					),
				);
				let name = base;
				for (let number = 2; taken.has(name.toLowerCase()); number++) name = `${base} ${number}`;
				const letter = await client.coverLetters.create(
					{
						name,
						recipient: "",
						content: "",
						...(latest ? { resumeId: latest.id } : {}),
						...(params.applicationId ? { applicationId: params.applicationId } : {}),
					},
					{ signal },
				);
				document = { id: letter.id, type: "letter" };
			} else {
				const id = await client.resume.create(
					{
						name: kind === "sample" ? t`Sample resume` : t`Untitled resume`,
						tags: [],
						autoName: kind === "blank",
						withSampleData: kind === "sample",
					},
					{ signal },
				);
				document = { id, type: "resume" };
			}
			if (current(signal)) {
				setCreated(document);
				await linkToApplication(document, signal);
				if (current(signal)) open(document);
			}
		});
	const copy = () =>
		run(async (signal) => {
			if (!source || !(name ?? suggested).trim()) return;
			const id = await client.documents.copyForJob(
				{ resumeId: source.id, name: (name ?? suggested).trim(), ...(job ? { applicationId: job.id } : {}) },
				{ signal },
			);
			if (current(signal)) {
				const document = { id, type: "resume" as const };
				setCreated(document);
				setApplicationLinked(true);
				if (job && ai.hasAIProvider) onCopiedForJob(id);
				else open(document);
			}
		});
	const read = (picked: DocumentPickerAsset) =>
		run(async (signal) => {
			setProgress(t`Reading the file and finding sections…`);
			const document = await importDocument(picked, ai.hasAIProvider, aiPdf ?? false, signal);
			if (!current(signal)) return;
			setCreated(document);
			useNewDocuments.getState().markNew(document);
			cleanupFile();
			await linkToApplication(document, signal);
			if (!current(signal)) return;
			if (document.type === "resume") {
				try {
					const resume = await client.resume.getById({ id: document.id }, { signal });
					const sections = [...Object.values(resume.data.sections), ...resume.data.customSections].filter(
						(section) => section.items.length,
					);
					let flagged = 0;
					forEachDatedEntry(resume.data, (entry) => {
						if (hasUnreadableDateText(entry.dates)) flagged++;
					});
					const entries = sections.reduce((total, section) => total + section.items.length, 0);
					if (current(signal))
						setSummary(
							t`${plural(sections.length, { one: "# section", other: "# sections" })} and ${plural(entries, { one: "# entry", other: "# entries" })} found. ${plural(flagged, { one: "# date needs a quick look.", other: "# dates need a quick look." })}`,
						);
				} catch {
					/* Import already succeeded; a summary failure must not offer a duplicate import. */
				}
			}
		});
	const pick = () =>
		run(async (signal) => {
			const result = await getDocumentAsync({
				multiple: false,
				copyToCacheDirectory: true,
				type: [
					"application/pdf",
					"application/json",
					"application/zip",
					"application/x-zip-compressed",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				],
			});
			if (result.canceled || !current(signal)) return;
			const picked = result.assets[0];
			if (!picked) return;
			cleanupFile();
			cached.current = new File(picked.uri);
			setAsset(picked);
		});
	return (
		<Screen>
			<Stack.Screen
				options={{
					title: t`New`,
					sheetGrabberVisible: !busy,
					gestureEnabled: !busy,
					headerBackVisible: !busy,
				}}
			/>
			{session.status !== "signed-in" ? (
				<Banner
					tone="warn"
					message={t`Sign in to create or import documents.`}
					action={{ label: t`Sign in`, onPress: () => router.replace(routes.signIn()) }}
				/>
			) : (
				<>
					{error && <Banner tone="danger" message={error} />}
					{busy && (
						<View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.s3 }}>
							<ActivityIndicator color={colors.accent} />
							<Text>{progress ?? t`Creating document…`}</Text>
						</View>
					)}
					{created ? (
						<>
							<Text variant="heading">{t`Document ready`}</Text>
							<Text color="ink2">{summary ?? t`Your document was saved. Review it in the editor.`}</Text>
							{created.type === "resume" && params.applicationId && !applicationLinked && (
								<Button
									label={t`Retry linking to application`}
									loading={busy}
									onPress={() => void run((signal) => linkToApplication(created, signal))}
								/>
							)}
							<Button
								label={t`Open in editor`}
								disabled={!!(created.type === "resume" && params.applicationId && !applicationLinked)}
								onPress={() => open(created)}
							/>
							<Button
								label={t`Stay in Documents`}
								variant="secondary"
								onPress={() => router.replace(routes.documents())}
							/>
						</>
					) : (
						<>
							{step === "choose" && (
								<>
									<Text variant="heading">{t`New`}</Text>
									{jobFirst && (
										<Card>
											<ListRow
												title={t`Save a job`}
												subtitle={t`Paste a job link or posting to track it in Applications.`}
												leading="briefcase"
												chevron
												disabled={busy}
												onPress={openSaveJob}
											/>
										</Card>
									)}
									<Card>
										<ListRow
											title={t`Import a resume`}
											subtitle={t`PDF, Word, Reactive Resume, JSON Resume or LinkedIn export.`}
											leading="file-arrow-up"
											chevron
											disabled={busy}
											onPress={() => setStep("import")}
										/>
									</Card>
									<Card>
										<ListRow
											title={t`Copy a resume for a job`}
											subtitle={t`Start from one you have and link the application.`}
											leading="copy"
											chevron
											disabled={busy}
											onPress={() => setStep("copy")}
										/>
									</Card>
									<Card>
										<ListRow
											title={t`Start blank`}
											subtitle={t`Start with your name. Build from there.`}
											leading="file-plus"
											disabled={busy}
											onPress={() => void create("blank")}
										/>
									</Card>
									<Button
										label={t`New cover letter instead`}
										icon="envelope-simple"
										variant="ghost"
										disabled={busy || documents.isPending || documents.isError}
										onPress={() => void create("letter")}
									/>
									<Button
										label={t`Try with a sample resume`}
										icon="sparkle"
										variant="ghost"
										disabled={busy}
										onPress={() => void create("sample")}
									/>
									{!jobFirst && (
										<Button
											label={t`Save a job instead`}
											icon="briefcase"
											variant="ghost"
											disabled={busy}
											onPress={openSaveJob}
										/>
									)}
									<Button
										label={t`Check a PDF with the ATS checker`}
										icon="list-checks"
										variant="ghost"
										disabled={busy}
										onPress={() => router.replace(routes.atsChecker())}
									/>
									{documents.isError && (
										<Banner
											tone="danger"
											message={t`Couldn't load resumes for a new letter.`}
											action={{ label: t`Retry`, onPress: () => void documents.refetch() }}
										/>
									)}
								</>
							)}
							{step === "copy" && (
								<>
									<Text variant="heading">{t`Copy a resume for a job`}</Text>
									{documents.isError && (
										<Banner
											tone="danger"
											message={t`Couldn't load resumes.`}
											action={{ label: t`Retry`, onPress: () => void documents.refetch() }}
										/>
									)}
									{documents.isSuccess && !resumes.length && (
										<Text color="ink2">{t`Create or import a resume first, then return to copy it for this job.`}</Text>
									)}
									<SelectSheet
										label={t`Start from`}
										value={source?.id ?? null}
										options={resumes.map((document) => ({ value: document.id, label: document.name }))}
										disabled={busy}
										onChange={(id) => {
											setSourceId(id);
											setName(null);
										}}
									/>
									{applications.isError && (
										<Banner
											tone="danger"
											message={t`Couldn't load applications.`}
											action={{ label: t`Retry`, onPress: () => void applications.refetch() }}
										/>
									)}
									<SelectSheet
										label={t`For which job?`}
										value={job?.id ?? ""}
										options={[
											{ value: "", label: t`No job yet` },
											...jobs.map((application) => ({
												value: application.id,
												label: `${application.company} · ${application.role}`,
											})),
										]}
										disabled={busy || applications.isPending}
										onChange={(id) => {
											setJobId(id || null);
											setName(null);
										}}
									/>
									<Button
										label={t`Add a job…`}
										icon="plus"
										variant="secondary"
										disabled={busy}
										onPress={() => setAddingJob(true)}
									/>
									{addingJob && (
										<AddApplicationSheet
											onClose={() => setAddingJob(false)}
											onAdded={(id) => {
												setJobId(id);
												setName(null);
												void applications.refetch();
											}}
										/>
									)}
									<TextField
										label={t`Name`}
										value={name ?? suggested}
										onChangeText={setName}
										maxLength={100}
										editable={!busy}
									/>
									<Button
										label={t`Create copy`}
										loading={busy}
										disabled={
											!source ||
											!(name ?? suggested).trim() ||
											(name ?? suggested).length > 100 ||
											documents.isError ||
											applications.isError
										}
										onPress={() => void copy()}
									/>
								</>
							)}
							{step === "import" && (
								<>
									<Text variant="heading">{t`Import a resume`}</Text>
									<Text color="ink2">{t`PDF reads its text layer on your server by default, without AI. Turn on the AI switch to send it to your provider. Word (.docx) needs an AI provider. Current and v4 Reactive Resume JSON, cover letters, JSON Resume and LinkedIn exports (.zip) are supported. Up to 10 MB.`}</Text>
									<View style={{ flexDirection: "row", alignItems: "center", gap: space.s3 }}>
										<Text style={{ flex: 1 }}>{t`Use AI for PDF imports`}</Text>
										<Switch
											label={t`Use AI for PDF imports`}
											value={aiPdf ?? false}
											onValueChange={setAiPdf}
											disabled={busy}
										/>
									</View>
									<Text
										variant="caption"
										color="ink2"
									>{t`Sends this PDF to your configured AI provider instead of reading its text layer.`}</Text>
									{ai.error && (
										<Banner
											tone="warn"
											message={t`Couldn't load AI connections. PDF text and JSON imports still work.`}
											action={{ label: t`Retry`, onPress: ai.retry }}
										/>
									)}
									{!ai.hasAIProvider && (
										<Button
											label={t`Set up AI provider`}
											variant="secondary"
											disabled={busy || ai.isLoading}
											onPress={() => setSetup(true)}
										/>
									)}
									{asset && <Text>{asset.name}</Text>}
									<Button
										label={asset ? t`Choose another file` : t`Choose a file`}
										icon="file-arrow-up"
										disabled={busy}
										onPress={() => void pick()}
									/>
									{asset && <Button label={t`Import file`} loading={busy} onPress={() => void read(asset)} />}
									{busy && (
										<Button
											label={t`Cancel import`}
											variant="ghost"
											onPress={() => {
												abort.current?.abort();
												setProgress(null);
												setError(t`Import canceled. Refresh Documents before retrying if the upload had finished.`);
											}}
										/>
									)}
								</>
							)}
							{step !== "choose" && (
								<Button
									label={t`Back`}
									variant="ghost"
									disabled={busy}
									onPress={() => {
										setStep("choose");
										setError(null);
									}}
								/>
							)}
						</>
					)}
				</>
			)}
			<Button label={t`Close`} variant="ghost" disabled={busy} onPress={() => router.back()} />
			<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
		</Screen>
	);
}
