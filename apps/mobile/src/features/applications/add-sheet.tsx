import type { RouterOutput } from "@/api/client";
import type { PostingCapture } from "@reactive-resume/schema/applications/capture";
import type { ApplicationClosedReason } from "@reactive-resume/schema/applications/data";
import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { parseDateOnly } from "./date";
import { applicationError } from "./error";
import { LaneNotice } from "./lane-notice";
import { useApplicationLanes } from "./lane-queries";
import { getLaneLabel, laneInput, resolveLane } from "./lanes";
import { PriorNoResponse } from "./prior-no-response";
import { useApplicationMutations } from "./queries";
import { CLOSED_REASONS, getClosedReasonLabel } from "./stages";
import { client, orpc } from "@/api/client";
import { getAccountScope, getServer, useSession } from "@/auth/session";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { WebAccessAttention } from "@/features/ai/web-access";
import { WallClockField } from "@/features/application-detail/date-field";
import { useUserTime } from "@/features/application-detail/hooks";
import { routes } from "@/routes";
import {
	Banner,
	Button,
	ChipInput,
	ConfirmDialog,
	EditorSheet,
	ListRow,
	Segmented,
	SelectSheet,
	Text,
	TextArea,
	TextField,
	useTheme,
} from "@/ui";

type ParsedPosting = RouterOutput["applications"]["ai"]["parsePosting"];
type AddApplicationSheetProps = {
	onClose: () => void;
	initialCapture?: PostingCapture | undefined;
	/** Opened to pick a job inside another flow (Copy for a job, Link to application): returns the new job there. */
	onAdded?: ((id: string) => void) | undefined;
};
const isLink = (value: string) => {
	try {
		const url = new URL(value.trim());
		return ["http:", "https:"].includes(url.protocol) && !!url.hostname;
	} catch {
		return false;
	}
};
const today = () => {
	const date = new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** Mounted until an explicit close/discard; unmounting cancels transient posting requests. */
export function AddApplicationSheet({ onClose, initialCapture, onAdded }: AddApplicationSheetProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { timeZone } = useUserTime();
	const { space } = useTheme();
	const session = useSession();
	const accountScope = getAccountScope();
	const providers = useHasAIProvider();
	const documentsOptions = orpc.documents.list.queryOptions({ input: { trashed: false } });
	const documents = useQuery({ ...documentsOptions, queryKey: [...documentsOptions.queryKey, session.server] });
	const webOptions = orpc.webAccess.status.queryOptions();
	const web = useQuery({ ...webOptions, queryKey: [...webOptions.queryKey, session.server] });
	const { create, update } = useApplicationMutations();
	const lanes = useApplicationLanes();
	const [mode, setMode] = useState<"link" | "text">(initialCapture?.description ? "text" : "link");
	const [input, setInput] = useState(initialCapture?.description || initialCapture?.url || "");
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<RouterOutput["applications"]["ai"]["searchPostings"] | null>(null);
	const [parsed, setParsed] = useState<ParsedPosting | null>(null);
	const [company, setCompany] = useState(initialCapture?.company ?? "");
	const [role, setRole] = useState(initialCapture?.role ?? "");
	const [location, setLocation] = useState(initialCapture?.location ?? "");
	const [salary, setSalary] = useState("");
	const authored = useRef(new Set<"role" | "company" | "location" | "salary">());
	const [source, setSource] = useState("");
	const [sourceUrl, setSourceUrl] = useState(initialCapture?.url ?? "");
	const [description, setDescription] = useState(initialCapture?.description ?? "");
	const [laneId, setLaneId] = useState("");
	const selectedLane = lanes.active.find((item) => item.id === laneId);
	const lane = selectedLane ?? resolveLane(lanes.lanes, { status: "saved" });
	const laneAvailable = !laneId || !!selectedLane;
	const stage = lane.category;
	const [reason, setReason] = useState<ApplicationClosedReason>("not-selected");
	const [priorToOpen, setPriorToOpen] = useState<string | null>(null);
	const [initialDate] = useState(today);
	const [stageDate, setStageDate] = useState(initialDate);
	const [resumeId, setResumeId] = useState("");
	const [letterId, setLetterId] = useState("");
	const [tags, setTags] = useState<string[]>([]);
	const [followUpDate, setFollowUpDate] = useState("");
	const [followUpNote, setFollowUpNote] = useState("");
	const [notes, setNotes] = useState("");
	const [setup, setSetup] = useState(false);
	const [review, setReview] = useState(!!initialCapture?.description);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [confirmSearchExit, setConfirmSearchExit] = useState(false);
	const [busy, setBusy] = useState<"read" | "fill" | "search" | "save" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const lock = useRef(false);
	const active = useRef(true);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			controller.current?.abort();
		};
	}, []);

	const run = async (action: NonNullable<typeof busy>, work: (signal: AbortSignal) => Promise<void>) => {
		if (lock.current) return;
		lock.current = true;
		setBusy(action);
		setError(null);
		const request = new AbortController();
		controller.current = request;
		try {
			await work(request.signal);
		} catch (cause) {
			if (active.current && !request.signal.aborted && getServer() === session.server) {
				if (action === "read" && mode === "link" && cause instanceof ORPCError && cause.code === "POSTING_UNREADABLE") {
					setSourceUrl(input.trim());
					setMode("text");
					setInput("");
					setDescription("");
					setParsed(null);
				}
				setError(
					action === "save"
						? t`Couldn't confirm the save. Check Applications before retrying to avoid a duplicate.`
						: applicationError(cause),
				);
			}
		} finally {
			lock.current = false;
			if (active.current) setBusy(null);
		}
	};
	const current = (signal: AbortSignal) =>
		active.current && !signal.aborted && getServer() === session.server && getAccountScope() === accountScope;
	const read = (useAI = false) =>
		void run("read", async (signal) => {
			if (!current(signal)) return;
			const result = await client.applications.ai.parsePosting(
				{ input: input.trim(), useAI },
				{ signal, context: { scope: accountScope ?? undefined } },
			);
			if (!current(signal)) return;
			setParsed(result);
			setCompany((value) => (authored.current.has("company") ? value : result.company));
			setRole((value) => (authored.current.has("role") ? value : result.role));
			setLocation((value) => (authored.current.has("location") ? value : result.location));
			setSalary((value) => (authored.current.has("salary") ? value : result.salary));
			setSourceUrl(result.sourceUrl ?? (mode === "link" ? input.trim() : sourceUrl));
			setDescription(result.jobDescription);
			setReview(true);
		});
	const fill = () =>
		void run("fill", async (signal) => {
			const result = await client.applications.ai.autofill({ jobDescription: description.trim() }, { signal });
			if (!current(signal)) return;
			setCompany((value) => (authored.current.has("company") ? value : result.company));
			setRole((value) => (authored.current.has("role") ? value : result.role));
			setLocation((value) => (authored.current.has("location") ? value : result.location));
			setSalary((value) => (authored.current.has("salary") ? value : result.salary));
		});
	const search = () =>
		void run("search", async (signal) => {
			setResults(null);
			const result = await client.applications.ai.searchPostings({ query: query.trim() }, { signal });
			if (current(signal)) setResults(result);
		});
	const changeInput = (value: string) => {
		setInput(value);
		setParsed(null);
		setError(null);
		setDescription(mode === "text" ? value : "");
	};
	const duplicateOptions = orpc.applications.findPosting.queryOptions({ input: { sourceUrl: sourceUrl.trim() } });
	const duplicate = useQuery({
		...duplicateOptions,
		select: (data) => data.application,
		queryKey: [...duplicateOptions.queryKey, session.server],
		enabled: !!sourceUrl.trim(),
		retry: false,
	});
	const validDate = stage === "saved" || !!parseDateOnly(stageDate);
	const validFollowUp = !followUpDate || !!parseDateOnly(followUpDate);
	const validUrl = !sourceUrl.trim() || isLink(sourceUrl);
	const ready =
		company.trim() &&
		role.trim() &&
		validDate &&
		validFollowUp &&
		validUrl &&
		lanes.ready &&
		laneAvailable &&
		!busy &&
		(!sourceUrl.trim() || !duplicate.isPending);
	const clipped = !!initialCapture?.truncated || !!parsed?.postingSource.truncated || description.length > 20_000;
	const postingSource: ParsedPosting["postingSource"] | null = description
		? {
				...(parsed?.postingSource ?? { method: "paste", format: "text", completeness: "unknown" }),
				truncated: clipped,
				...(clipped ? { completeness: "incomplete" } : {}),
			}
		: null;
	const save = () =>
		void run("save", async (signal) => {
			if (!ready || duplicate.data) return;
			const text = description.slice(0, 20_000);
			const followUpAt = followUpDate ? fromZonedDateTime(followUpDate, "09:00", timeZone) : null;
			if (followUpDate && !followUpAt)
				throw new Error(t`This date or time does not exist in your timezone. Choose another time.`);
			const id = await create.mutateAsync({
				company: company.trim(),
				role: role.trim(),
				...laneInput(lane, lanes.supported),
				...(stage === "closed" ? { closedReason: lane.closedReason ?? reason } : {}),
				location: location.trim() || null,
				salary: salary.trim() || null,
				source: source.trim() || null,
				sourceUrl: sourceUrl.trim() || null,
				jobDescription: text || null,
				requirements: parsed?.requirements ?? [],
				postingSource,
				...(stage !== "saved" ? { stageEnteredAt: stageDate } : {}),
				resumeId: resumeId || null,
				coverLetterId: letterId || null,
				tags,
				notes: notes || null,
				followUpAt,
				followUpDateOnly: false,
				followUpNote: followUpNote.trim() || null,
			});
			if (!current(signal)) return;
			onClose();
			if (onAdded) onAdded(id);
			else router.push(routes.applicationDetails(id));
		});
	const dirty = !!(
		input ||
		query ||
		parsed ||
		company ||
		role ||
		location ||
		salary ||
		source ||
		sourceUrl ||
		description ||
		laneId !== "" ||
		stageDate !== initialDate ||
		resumeId ||
		letterId ||
		tags.length ||
		followUpDate ||
		followUpNote ||
		notes
	);
	const openSearchSettings = () => {
		if (lock.current) return;
		onClose();
		router.push("/settings/ai-web-access");
	};
	const docs = documents.data ?? [];
	return (
		<>
			<EditorSheet
				onClose={onClose}
				dirty={dirty}
				pending={busy === "save"}
				title={review ? t`Review job details` : t`Save a job`}
				footer={
					<>
						{review ? (
							<Button
								label={t`Save job`}
								fullWidth
								loading={busy === "save"}
								disabled={!ready || !!duplicate.data}
								onPress={save}
							/>
						) : null}
						{busy === "read" || busy === "search" || busy === "fill" ? (
							<Button label={t`Cancel request`} variant="ghost" onPress={() => controller.current?.abort()} />
						) : null}
					</>
				}
			>
				<View style={{ gap: space.s4 }}>
					<WebAccessAttention />
					{error && <Banner tone="danger" message={error} />}
					{initialCapture && (
						<Banner
							tone="info"
							message={t`Shared posting for ${session.server}. Review before saving. Only shared text or URL was received; browser cookies and login sessions stay in the browser. If this browser shares only a URL, select and share the posting text or paste it here.`}
						/>
					)}
					{sourceUrl && duplicate.isError && (
						<>
							<Banner
								tone="warn"
								message={t`Duplicate check unavailable. Retry before saving; your server may need updating.`}
							/>
							<Button label={t`Retry`} onPress={() => void duplicate.refetch()} />
						</>
					)}
					{duplicate.data && (
						<>
							<Banner
								tone="info"
								message={t`Already tracked: ${duplicate.data.role} at ${duplicate.data.company}. Open it or update only its posting details.`}
							/>
							<Button
								label={t`Open tracked job`}
								onPress={() => {
									if (duplicate.data) {
										onClose();
										router.push(routes.applicationDetails(duplicate.data.id));
									}
								}}
							/>
							<Button
								label={t`Update posting details`}
								disabled={!ready}
								onPress={() =>
									void run("save", async () => {
										if (!duplicate.data || !ready) return;
										await update.mutateAsync({
											id: duplicate.data.id,
											role: role.trim(),
											company: company.trim(),
											...(location.trim() ? { location: location.trim() } : {}),
											sourceUrl: sourceUrl.trim() || null,
											...(description.trim() ? { jobDescription: description.slice(0, 20_000), postingSource } : {}),
										});
										onClose();
										if (onAdded) onAdded(duplicate.data.id);
										else router.push(routes.applicationDetails(duplicate.data.id));
									})
								}
							/>
						</>
					)}
					{busy === "save" && (
						<Banner tone="info" message={t`Saving the job. Wait for confirmation before making another change.`} />
					)}
					{!review ? (
						<>
							<Text color="ink2">{t`Use your browser’s Share action to send one posting URL or selected text to Reactive Resume. Receiving shares requires the latest store build; URL and paste import remain available.`}</Text>
							{Platform.OS === "ios" && (
								<Text color="ink2">{t`On iOS, choose Keep for review, then reopen app in the Share extension. Reopen Reactive Resume yourself within 15 minutes. Sign in here before sharing.`}</Text>
							)}

							<Text color="ink2">{t`Paste a job link or posting, then check the role and company. Nothing is saved until you choose Save job.`}</Text>
							<Segmented
								value={mode}
								options={[
									{ value: "link", label: t`Link` },
									{ value: "text", label: t`Text` },
								]}
								onChange={(value) => {
									if (lock.current) return;
									setMode(value);
									setInput("");
									setParsed(null);
									setDescription("");
								}}
							/>
							{mode === "link" ? (
								<TextField
									label={t`Job posting link`}
									value={input}
									onChangeText={changeInput}
									editable={!busy}
									autoCapitalize="none"
									keyboardType="url"
									maxLength={5000}
								/>
							) : (
								<TextArea
									label={t`Pasted description`}
									value={input}
									onChangeText={changeInput}
									editable={!busy}
									maxLength={100_000}
								/>
							)}
							{mode === "text" && !providers.hasAIProvider && (
								<>
									<Banner
										tone="info"
										message={
											providers.error
												? t`AI providers couldn't be loaded. Retry or fill the details manually.`
												: t`Connect an AI provider to read details from pasted text. Manual entry works without AI.`
										}
									/>
									{providers.error ? (
										<Button label={t`Retry provider lookup`} onPress={providers.retry} />
									) : (
										<Button
											label={t`Connect AI provider`}
											variant="secondary"
											disabled={providers.isLoading}
											onPress={() => setSetup(true)}
										/>
									)}
								</>
							)}
							{providers.defaultProvider && (
								<Text color="ink3">{t`Optional AI sends only this posting to ${providers.defaultProvider.label} (${providers.defaultProvider.provider}).`}</Text>
							)}
							{providers.hasAIProvider && (
								<>
									<Button label={t`Read with AI`} disabled={!!busy || !input.trim()} onPress={() => read(true)} />
									{providers.defaultProvider ? (
										<Text variant="caption" color="ink3">
											{t`Sends the posting text to ${providers.defaultProvider.label} to read it.`}
										</Text>
									) : null}
								</>
							)}
							<Text
								variant="callout"
								color="ink3"
							>{t`AI reads pasted text only when you ask. Links can use the page’s own job data without AI.`}</Text>
							{mode === "link" && (
								<Button
									label={t`Read posting`}
									loading={busy === "read"}
									disabled={!!busy || !isLink(input)}
									onPress={() => read(false)}
								/>
							)}
							<Button
								label={t`Fill details manually`}
								variant="secondary"
								disabled={!!busy}
								onPress={() => {
									if (mode === "link" && isLink(input)) setSourceUrl(input.trim());
									setReview(true);
								}}
							/>
							<Text variant="title">{t`Search job postings`}</Text>
							<TextField
								label={t`Role, company or location`}
								value={query}
								maxLength={500}
								editable={!busy}
								onChangeText={(value) => {
									setQuery(value);
									setResults(null);
								}}
							/>
							<Text color="ink2">{t`Uses the web search service set up in Settings. Search results wait for your review.`}</Text>
							{!web.data?.search && (
								<Button
									label={t`Set up web search`}
									variant="link"
									disabled={!!busy}
									onPress={() => {
										if (lock.current) return;
										if (dirty) setConfirmSearchExit(true);
										else openSearchSettings();
									}}
								/>
							)}
							<Button
								label={t`Search`}
								loading={busy === "search"}
								disabled={!!busy || query.trim().length < 2 || !web.data?.search}
								onPress={search}
							/>
							{results?.length === 0 && <Text>{t`No postings found. Try different keywords.`}</Text>}
							{results?.map((result) => (
								<ListRow
									key={result.url}
									title={result.title}
									subtitle={`${result.description}\n${result.url}`}
									disabled={!!busy}
									accessibilityHint={t`Use posting link; review before saving`}
									onPress={() => {
										setMode("link");
										setInput(result.url);
										setSourceUrl(result.url);
										setParsed(null);
										setDescription("");
										setResults(null);
									}}
								/>
							))}
						</>
					) : (
						<>
							{parsed && (
								<Banner
									tone={parsed.enrichmentWarning || parsed.filledBy === "none" ? "warn" : "info"}
									message={
										parsed.enrichmentWarning
											? t`AI enrichment was unavailable. Review the page details or fill them manually.`
											: t`Review the details before saving. Retrieved content does not establish that the posting is still open.`
									}
								/>
							)}
							{!detailsOpen && (!validUrl || !validFollowUp) ? (
								<Banner
									tone="danger"
									message={
										!validUrl
											? t`Use an http or https job posting link before saving.`
											: t`Choose a valid follow-up date before saving.`
									}
									action={{ label: t`Show details`, onPress: () => setDetailsOpen(true) }}
								/>
							) : null}
							{clipped && (
								<Banner
									tone="warn"
									message={t`Description is clipped to 20,000 characters. Review it before preparing.`}
									action={detailsOpen ? undefined : { label: t`Show details`, onPress: () => setDetailsOpen(true) }}
								/>
							)}
							<TextField
								label={t`Company`}
								value={company}
								onChangeText={(value) => {
									authored.current.add("company");
									setCompany(value);
								}}
								editable={!busy}
							/>
							<TextField
								label={t`Role / title`}
								value={role}
								onChangeText={(value) => {
									authored.current.add("role");
									setRole(value);
								}}
								editable={!busy}
							/>
							<LaneNotice unavailable={!laneAvailable} />
							<PriorNoResponse
								company={company}
								disabled={!!busy}
								onOpen={(id) => {
									if (!lock.current && !busy) setPriorToOpen(id);
									return false;
								}}
							/>
							<SelectSheet
								label={t`Lane`}
								value={laneId || lane.id}
								options={lanes.active.map((item) => ({ value: item.id, label: getLaneLabel(item) }))}
								onChange={setLaneId}
								disabled={!!busy || !lanes.ready}
							/>
							{stage === "closed" && !lane.closedReason && (
								<SelectSheet
									label={t`Reason`}
									value={reason}
									options={CLOSED_REASONS.map((value) => ({ value, label: getClosedReasonLabel(value) }))}
									onChange={setReason}
									disabled={!!busy}
								/>
							)}
							{stage !== "saved" && (
								<WallClockField
									label={t`Application date`}
									mode="date"
									value={stageDate}
									onChange={setStageDate}
									disabled={!!busy}
									error={!validDate ? t`Enter a valid date.` : undefined}
								/>
							)}
							<Button
								label={detailsOpen ? t`Hide details` : t`More details`}
								variant="secondary"
								disabled={!!busy}
								onPress={() => setDetailsOpen((value) => !value)}
							/>
							{detailsOpen ? (
								<View style={{ gap: space.s4 }}>
									<TextField
										label={t`Location`}
										value={location}
										onChangeText={(value) => {
											authored.current.add("location");
											setLocation(value);
										}}
										editable={!busy}
									/>
									<TextField
										label={t`Salary range`}
										value={salary}
										onChangeText={(value) => {
											authored.current.add("salary");
											setSalary(value);
										}}
										editable={!busy}
									/>
									<TextField label={t`Source`} value={source} onChangeText={setSource} editable={!busy} />
									<TextField
										label={t`Job posting link`}
										value={sourceUrl}
										onChangeText={setSourceUrl}
										editable={!busy}
										autoCapitalize="none"
										keyboardType="url"
										error={!validUrl ? t`Use an http or https link.` : undefined}
									/>

									{documents.isError && (
										<Button label={t`Retry loading documents`} onPress={() => void documents.refetch()} />
									)}
									<SelectSheet
										label={t`Resume`}
										value={resumeId}
										options={[
											{ value: "", label: t`No resume selected` },
											...docs.filter((doc) => doc.type === "resume").map((doc) => ({ value: doc.id, label: doc.name })),
										]}
										onChange={setResumeId}
										disabled={!!busy}
									/>
									{
										<SelectSheet
											label={stage === "saved" ? t`Cover letter (optional)` : t`Cover letter submitted (optional)`}
											value={letterId}
											options={[
												{ value: "", label: t`No cover letter selected` },
												...docs
													.filter((doc) => doc.type === "letter" && !doc.isLocked)
													.map((doc) => ({ value: doc.id, label: doc.name })),
											]}
											onChange={setLetterId}
											disabled={!!busy}
										/>
									}
									<ChipInput
										label={t`Tags`}
										values={tags}
										onChange={(values) => {
											if (!lock.current) setTags(values);
										}}
									/>
									<WallClockField
										label={t`Follow-up date`}
										mode="date"
										clearable
										value={followUpDate}
										onChange={setFollowUpDate}
										disabled={!!busy}
										error={!validFollowUp ? t`Enter a valid date.` : undefined}
									/>
									<TextField
										label={t`Follow-up note`}
										value={followUpNote}
										onChangeText={setFollowUpNote}
										editable={!busy}
									/>
									{providers.defaultProvider && (
										<Text color="ink3">{t`Optional AI sends only this posting to ${providers.defaultProvider.label} (${providers.defaultProvider.provider}).`}</Text>
									)}
									<TextArea label={t`Notes`} value={notes} onChangeText={setNotes} editable={!busy} />
									<TextArea
										label={t`Saved description`}
										value={description}
										maxLines={12}
										onChangeText={setDescription}
										editable={!busy}
									/>

									{parsed?.requirements.length ? <Text color="ink2">{parsed.requirements.join(" · ")}</Text> : null}
									<Button
										label={t`Fill empty fields with AI`}
										variant="secondary"
										disabled={!!busy || !description.trim() || description.length > 20_000 || !providers.hasAIProvider}
										loading={busy === "fill"}
										onPress={fill}
									/>
									{!providers.hasAIProvider && (
										<Button label={t`Connect AI provider`} variant="link" onPress={() => setSetup(true)} />
									)}
								</View>
							) : null}
							<Button label={t`Back to posting`} variant="ghost" disabled={!!busy} onPress={() => setReview(false)} />
						</>
					)}
				</View>
			</EditorSheet>
			<ConfirmDialog
				open={confirmSearchExit && !busy}
				title={t`Discard changes?`}
				message={t`Your unsaved job details will be discarded before opening web search settings.`}
				confirmLabel={t`Discard changes`}
				cancelLabel={t`Keep editing`}
				destructive
				onConfirm={openSearchSettings}
				onCancel={() => setConfirmSearchExit(false)}
			/>
			<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
			<ConfirmDialog
				open={priorToOpen !== null && !busy}
				title={t`Discard changes?`}
				message={t`Your unsaved job details will be discarded before opening this application.`}
				confirmLabel={t`Discard changes`}
				cancelLabel={t`Keep editing`}
				destructive
				onConfirm={() => {
					if (!priorToOpen || lock.current || busy) return;
					onClose();
					router.push(routes.applicationDetails(priorToOpen));
				}}
				onCancel={() => setPriorToOpen(null)}
			/>
		</>
	);
}
