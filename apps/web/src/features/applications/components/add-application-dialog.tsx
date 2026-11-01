import type { RouterOutput } from "@/libs/orpc/client";
import type { PostingCapture } from "@reactive-resume/schema/applications/capture";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { getCategoryLane, getLaneLabel, laneMoveInput } from "../lanes";
import { useInvalidateApplications } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { PriorNoResponseNotice } from "./prior-no-response-notice";
import { useDialogStore } from "@/dialogs/store";
import { SetUpAi } from "@/features/assistant/provider-setup";
import { SetUpWebAccess, testFailureMessage } from "@/features/settings/ai/web-access";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage, toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Parsed = RouterOutput["applications"]["ai"]["parsePosting"];
// Adding offers lanes of these stages: still to apply, or already applied or interviewing.
const ADD_CATEGORIES = ["saved", "applied", "interview"] as const;
const MAX_POSTING_CHARS = 20_000;

const isLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

type AddApplicationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdded: (id: string) => void;
	initialCapture?: PostingCapture | null | undefined;
};

/**
 * Add an application from a pasted link or posting. The posting is read (the page's own job data, or the AI
 * provider when one is set up) into role and company, which stay editable; the posting itself is saved with the
 * application for Check, the assistant and letters. Add, or Add and tailor a resume.
 */
export function AddApplicationDialog({ open, onOpenChange, onAdded, initialCapture }: AddApplicationDialogProps) {
	// A fresh form for every open, kept in place while the dialog animates closed.
	const [instance, setInstance] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) setInstance((count) => count + 1);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-[560px]">
				<AddApplicationForm
					initialCapture={initialCapture}
					key={instance}
					onClose={() => onOpenChange(false)}
					onAdded={onAdded}
				/>
			</DialogContent>
		</Dialog>
	);
}

type AddApplicationFormProps = {
	onClose: () => void;
	onAdded: (id: string) => void;
	initialCapture?: PostingCapture | null | undefined;
};

function AddApplicationForm({ onClose, onAdded, initialCapture }: AddApplicationFormProps) {
	const id = useId();
	const { data: webAccess } = useQuery(orpc.webAccess.status.queryOptions());
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const [query, setQuery] = useState("");
	const search = useMutation(orpc.applications.ai.searchPostings.mutationOptions());
	const [input, setInput] = useState(initialCapture?.url ?? "");
	const [role, setRole] = useState(initialCapture?.role ?? "");
	const [company, setCompany] = useState(initialCapture?.company ?? "");
	const { lanes, active, mode } = useApplicationLanes();
	const choices = ADD_CATEGORIES.flatMap((category) => active.filter((lane) => lane.category === category));
	const [laneId, setLaneId] = useState<string | null>(null);
	const lane = choices.find((item) => item.id === laneId) ?? getCategoryLane(lanes, "saved");
	const stage = lane.category;
	const [stageDate, setStageDate] = useState(() => new Date().toLocaleDateString("en-CA"));
	const [resumeId, setResumeId] = useState("");
	const [coverLetterId, setCoverLetterId] = useState("");
	const [location, setLocation] = useState(initialCapture?.location ?? "");
	const [salary, setSalary] = useState("");
	const authored = useRef(new Set<"role" | "company" | "location" | "salary">());
	const [pasteOpen, setPasteOpen] = useState(!!initialCapture?.description);
	const [pastedText, setPastedText] = useState(initialCapture?.description ?? "");
	const [description, setDescription] = useState<string | null>(initialCapture?.description || null);
	const [reading, setReading] = useState<{ text: string; result: Parsed } | null>(null);
	const providerState = useHasUsableAiProvider();
	const { hasUsableProvider } = providerState;
	const invalidate = useInvalidateApplications();
	const openDialog = useDialogStore((state) => state.openDialog);

	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const read = useMutation({
		...orpc.applications.ai.parsePosting.mutationOptions(),
		mutationFn: async (value) => {
			const options = controller.current ? { signal: controller.current.signal } : {};
			if (!value.useAI) {
				// Older servers strip useAI. This route was introduced with the explicit no-AI contract.
				try {
					await client.applications.findPosting({ sourceUrl: "" }, options);
				} catch (error) {
					if (options.signal?.aborted) throw error;
					throw new Error(
						t`Reading without AI couldn't be confirmed. Retry, update your server, or enter the details manually.`,
					);
				}
			}
			options.signal?.throwIfAborted();
			return client.applications.ai.parsePosting(value, options);
		},
	});
	const resetRead = () => {
		controller.current?.abort();
		read.reset();
		setReading(null);
	};
	const create = useMutation(orpc.applications.create.mutationOptions());
	const update = useMutation(orpc.applications.update.mutationOptions());
	const duplicate = useQuery({
		...orpc.applications.findPosting.queryOptions({ input: { sourceUrl: isLink(input) ? input.trim() : "" } }),
		enabled: isLink(input),
		select: (data) => data.application,
		retry: false,
	});

	const text = (initialCapture?.description ? (description ?? "") : pasteOpen ? pastedText : input).trim();
	const sourceLink = isLink(input.trim()) ? input.trim() : null;
	const link = !pasteOpen && Boolean(sourceLink);
	const postingDescription = (description ?? (!link ? text : "")).slice(0, MAX_POSTING_CHARS);
	const readable = text.length > 8 && (link || hasUsableProvider);
	const parsed = reading?.text === text ? reading.result : null;
	const clipped = Boolean(
		initialCapture?.truncated || parsed?.postingSource.truncated || (!link && text.length > MAX_POSTING_CHARS),
	);
	const postingSource = postingDescription
		? {
				...(parsed?.postingSource ?? {
					method: "paste" as const,
					format: "text" as const,
					completeness: "unknown" as const,
				}),
				truncated: clipped,
				...(clipped ? { completeness: "incomplete" as const } : {}),
			}
		: null;
	const readPosting = (useAI = false) => {
		if (!readable || read.isPending) return;
		const request = new AbortController();
		controller.current = request;
		read.mutate(
			{ input: text, useAI },
			{
				onSuccess: (result) => {
					if (request.signal.aborted) return;
					setReading({ text, result });
					setRole((current) => (authored.current.has("role") ? current : result.role));
					setCompany((current) => (authored.current.has("company") ? current : result.company));
					setLocation((current) => (authored.current.has("location") ? current : result.location));
					setSalary((current) => (authored.current.has("salary") ? current : result.salary));
					setDescription(result.jobDescription);
				},
				onError: (error) => {
					if (link && !request.signal.aborted && error instanceof ORPCError && error.code === "POSTING_UNREADABLE")
						setPasteOpen(true);
				},
			},
		);
	};

	const ready =
		role.trim().length > 0 &&
		company.trim().length > 0 &&
		(stage === "saved" || Boolean(stageDate)) &&
		!read.isPending &&
		!create.isPending &&
		!update.isPending &&
		(!sourceLink || !duplicate.isPending);

	const add = async (tailor: boolean) => {
		if (!ready || duplicate.data) return;
		const posting = {
			company: company.trim(),
			role: role.trim(),
			...laneMoveInput(lane, mode),
			...(location.trim() ? { location: location.trim() } : {}),
			...(salary.trim() ? { salary: salary.trim() } : {}),
			...(parsed?.requirements.length ? { requirements: parsed.requirements } : {}),
			...(sourceLink ? { sourceUrl: sourceLink } : {}),
			...(stage !== "saved" && stageDate ? { stageEnteredAt: stageDate } : {}),
			...(resumeId ? { resumeId } : {}),
			...(stage !== "saved" && coverLetterId ? { coverLetterId } : {}),
			jobDescription: postingDescription || null,
			postingSource,
		};
		try {
			const applicationId = await create.mutateAsync(posting);
			invalidate();
			toast.add({ description: t`Added ${role.trim()} at ${company.trim()}` });
			onClose();
			if (tailor)
				openDialog("document.new", { step: "copy", applicationId, ...(resumeId ? { sourceResumeId: resumeId } : {}) });
			else onAdded(applicationId);
		} catch (error) {
			if (sourceLink) void duplicate.refetch();
			toastError(error, t`Couldn't add the application. Try again.`);
		}
	};

	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void add(false);
			}}
		>
			{!providerState.isUnavailable && !hasUsableProvider && <SetUpAi />}
			{hasUsableProvider && (
				<p className="text-xs text-ink-3">
					<Trans>
						Reading with AI sends this posting to {providerState.usableProviders[0]?.label} ·{" "}
						{providerState.usableProviders[0]?.model}. Public links also go to the reader and the site being read. You
						can fill details manually.
					</Trans>
				</p>
			)}
			{webAccess?.testResult && !webAccess.testResult.search.success && (
				<div role="alert" className="grid gap-2 text-sm text-warn-text">
					<p>
						{webAccess.provider} · {testFailureMessage(webAccess.testResult.search.error)}
					</p>
					<SetUpWebAccess />
				</div>
			)}
			<DialogHeader>
				<DialogTitle>
					<Trans>Save a job</Trans>
				</DialogTitle>
				<DialogDescription className="sr-only">
					<Trans>Paste a job link or posting, then check the role and company.</Trans>
				</DialogDescription>
			</DialogHeader>
			<p className="text-xs text-ink-3">
				<Trans>Capture a posting from your browser with the helper, or paste its URL/text below.</Trans>{" "}
				<a href="/capture-helper.zip" download className="text-accent-text underline">
					<Trans>Download browser helper</Trans>
				</a>
			</p>

			{webAccess?.search && (
				<section className="grid gap-2" aria-labelledby={`${id}-search-label`}>
					<Label id={`${id}-search-label`} htmlFor={`${id}-search`}>
						<Trans>Search job postings</Trans>
					</Label>
					<div className="flex gap-2">
						<Input
							id={`${id}-search`}
							value={query}
							maxLength={500}
							placeholder={t`Role, company or location`}
							onChange={(event) => {
								setQuery(event.target.value);
								search.reset();
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.nativeEvent.isComposing) {
									event.preventDefault();
									if (query.trim().length >= 2 && !search.isPending) search.mutate({ query });
								}
							}}
						/>
						<Button
							type="button"
							variant="secondary"
							disabled={query.trim().length < 2 || search.isPending || create.isPending}
							onClick={() => search.mutate({ query })}
						>
							<Trans>Search</Trans>
						</Button>
					</div>
					{search.isPending && (
						<p className="text-xs text-ink-3" role="status">
							<Trans>Searching job postings…</Trans>
						</p>
					)}
					{search.error && (
						<p className="text-xs text-danger-text" role="alert">
							{getOrpcErrorMessage(search.error, {
								fallback: t`Job search failed. Try again or paste a posting link.`,
							})}
						</p>
					)}
					{search.data?.length === 0 && (
						<p className="text-xs text-ink-3" role="status">
							<Trans>No postings found. Try different keywords.</Trans>
						</p>
					)}
					{search.data && search.data.length > 0 && (
						<ul className="grid gap-2">
							{search.data.map((result) => (
								<li key={result.url} className="rounded-lg border border-line p-3">
									<strong className="text-sm font-medium">{result.title}</strong>
									<p className="line-clamp-2 text-xs text-ink-3">{result.description}</p>
									<div className="mt-2 flex items-center gap-3">
										<a
											href={result.url}
											target="_blank"
											rel="noreferrer"
											className="text-xs text-accent-text hover:underline"
										>
											<Trans>View posting</Trans>
										</a>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={read.isPending || create.isPending}
											onClick={() => {
												setInput(result.url);
												setPasteOpen(false);
												setDescription(null);
												resetRead();
												if (!authored.current.has("role")) setRole("");
												if (!authored.current.has("company")) setCompany("");
												if (!authored.current.has("location")) setLocation("");
												if (!authored.current.has("salary")) setSalary("");
												search.reset();
											}}
										>
											<Trans>Use posting</Trans>
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</section>
			)}

			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-posting`}>
					<Trans>Job link or posting text</Trans>
				</Label>
				<Textarea
					id={`${id}-posting`}
					rows={4}
					value={input}
					maxLength={100_000}
					placeholder="https://…"
					onChange={(event) => {
						setInput(event.target.value);
						if (!initialCapture) {
							setDescription(null);
							setPasteOpen(false);
						}
						resetRead();
					}}
					autoFocus
				/>
				{sourceLink && !initialCapture && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							setPasteOpen(true);
							setDescription(null);
							resetRead();
						}}
					>
						<Trans>Paste description instead</Trans>
					</Button>
				)}
				{pasteOpen && !initialCapture && (
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-recovery`}>
							<Trans>Pasted description</Trans>
						</Label>
						<Textarea
							id={`${id}-recovery`}
							rows={5}
							value={pastedText}
							maxLength={100_000}
							onChange={(event) => {
								setPastedText(event.target.value);
								setDescription(null);
								resetRead();
							}}
						/>
						<p className="text-xs text-ink-3">
							<Trans>The original link stays with this job.</Trans>
						</p>
					</div>
				)}
				{readable && link && (
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={read.isPending}
						onClick={() => readPosting(false)}
					>
						<Trans>Read posting</Trans>
					</Button>
				)}
				{(clipped || parsed?.postingSource.completeness === "incomplete") && (
					<p className="text-xs text-warn-text" role="alert">
						<Trans>
							This description is clipped or incomplete. Review it or paste the full description before preparing.
						</Trans>
					</p>
				)}
				{parsed?.enrichmentWarning && (
					<p className="text-xs text-warn-text" role="status">
						<Trans>AI couldn't fill the details. The posting is retained; complete the fields manually.</Trans>
					</p>
				)}
				{parsed?.postingSource.fallbackReason && (
					<p className="text-xs text-warn-text" role="status">
						<Trans>Enhanced reading was unavailable. The built-in reader retrieved this posting.</Trans>
					</p>
				)}
				{description !== null && (
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-description`}>
							<Trans>Saved description</Trans>
						</Label>
						<Textarea
							id={`${id}-description`}
							rows={5}
							maxLength={MAX_POSTING_CHARS}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
						{parsed?.postingSource.retrievedAt && (
							<p className="text-xs text-ink-3">
								<Trans>
									Retrieved {parsed.postingSource.retrievedAt}. Origin freshness is unknown unless reported.
								</Trans>
							</p>
						)}
					</div>
				)}
				{initialCapture?.description && !read.error && !read.isPending ? null : providerState.isUnavailable && !link ? (
					<AiProviderLoadState state={providerState} />
				) : (
					<ReadStatus
						text={text}
						link={link}
						readable={readable}
						pending={read.isPending}
						error={read.error}
						parsed={parsed}
						ai={hasUsableProvider}
					/>
				)}
			</div>

			{initialCapture && (
				<p className="text-xs text-ink-2">
					<Trans>Capture does not use AI. Review every field before saving.</Trans>
				</p>
			)}
			{sourceLink && duplicate.isError && (
				<p role="alert">
					<Trans>Duplicate check unavailable. Retry before saving; your server may need updating.</Trans>
					<Button type="button" onClick={() => void duplicate.refetch()}>
						<Trans>Retry</Trans>
					</Button>
				</p>
			)}
			{duplicate.data && (
				<div role="status" className="grid gap-2 rounded-lg border border-line p-3">
					<p>
						<Trans>
							Already tracked: {duplicate.data.role} at {duplicate.data.company}. Open it or update only its posting
							details.
						</Trans>
					</p>
					<Button
						type="button"
						variant="secondary"
						onClick={() => {
							if (duplicate.data) {
								onClose();
								onAdded(duplicate.data.id);
							}
						}}
					>
						<Trans>Open tracked job</Trans>
					</Button>
					<Button
						type="button"
						disabled={!ready}
						onClick={async () => {
							if (!duplicate.data || !ready) return;
							try {
								await update.mutateAsync({
									id: duplicate.data.id,
									role: role.trim(),
									company: company.trim(),
									...(location.trim() ? { location: location.trim() } : {}),
									sourceUrl: sourceLink,
									...(postingDescription.trim() ? { jobDescription: postingDescription, postingSource } : {}),
								});
								invalidate();
								onClose();
								onAdded(duplicate.data.id);
							} catch (error) {
								toastError(error, t`Couldn't update the posting. Try again.`);
							}
						}}
					>
						<Trans>Update posting details</Trans>
					</Button>
				</div>
			)}
			{providerState.usableProviders[0] && (
				<div className="grid gap-1.5">
					<p className="text-xs text-ink-3">
						<Trans>
							Optional AI sends only this posting to {providerState.usableProviders[0].label} (
							{providerState.usableProviders[0].provider}).
						</Trans>
					</p>
					<Button
						type="button"
						variant="secondary"
						disabled={!text || read.isPending}
						onClick={() => readPosting(true)}
					>
						<Trans>Read with AI</Trans>
					</Button>
				</div>
			)}

			<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-role`}>
						<Trans>Role</Trans>
					</Label>
					<Input
						id={`${id}-role`}
						value={role}
						onChange={(event) => {
							authored.current.add("role");
							setRole(event.target.value);
						}}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-company`}>
						<Trans>Company</Trans>
					</Label>
					<Input
						id={`${id}-company`}
						value={company}
						onChange={(event) => {
							authored.current.add("company");
							setCompany(event.target.value);
						}}
					/>
				</div>
			</div>
			<PriorNoResponseNotice company={company} />

			<div className="grid gap-1.5">
				<span id={`${id}-stage`} className="text-sm font-medium">
					<Trans>Stage</Trans>
				</span>
				<SegmentedControl
					aria-labelledby={`${id}-stage`}
					value={lane.id}
					onValueChange={(value) => setLaneId(value as string)}
					className="h-auto w-fit max-w-full flex-wrap"
				>
					{choices.map((choice) => (
						<SegmentedControlItem
							key={choice.id}
							value={choice.id}
							className="min-h-7 max-w-full flex-auto [overflow-wrap:anywhere] whitespace-normal"
						>
							{choice.systemKey && !choice.label ? (
								choice.category === "saved" ? (
									<Trans>Saved</Trans>
								) : choice.category === "applied" ? (
									<Trans>Already applied</Trans>
								) : (
									<Trans>Already interviewing</Trans>
								)
							) : (
								getLaneLabel(choice)
							)}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</div>

			<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-location`}>
						<Trans>Location</Trans>
					</Label>
					<Input
						id={`${id}-location`}
						value={location}
						onChange={(event) => {
							authored.current.add("location");
							setLocation(event.target.value);
						}}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-salary`}>
						<Trans>Salary</Trans>
					</Label>
					<Input
						id={`${id}-salary`}
						value={salary}
						onChange={(event) => {
							authored.current.add("salary");
							setSalary(event.target.value);
						}}
					/>
				</div>
			</div>
			{stage !== "saved" && (
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-date`}>
						<Trans>Application date</Trans>
					</Label>
					<Input
						id={`${id}-date`}
						type="date"
						value={stageDate}
						required
						onChange={(event) => setStageDate(event.target.value)}
					/>
				</div>
			)}
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-resume`}>
					{stage === "saved" ? <Trans>Resume (optional)</Trans> : <Trans>Resume submitted (optional)</Trans>}
				</Label>
				<select
					id={`${id}-resume`}
					value={resumeId}
					onChange={(event) => setResumeId(event.target.value)}
					className="h-9 rounded-md border border-control-border bg-surface px-2 text-sm"
				>
					<option value="">{t`No resume selected`}</option>
					{documents
						?.filter((document) => document.type === "resume")
						.map((document) => (
							<option key={document.id} value={document.id}>
								{document.name}
							</option>
						))}
				</select>
			</div>
			{stage !== "saved" && (
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-letter`}>
						<Trans>Cover letter submitted (optional)</Trans>
					</Label>
					<select
						id={`${id}-letter`}
						value={coverLetterId}
						onChange={(event) => setCoverLetterId(event.target.value)}
						className="h-9 rounded-md border border-control-border bg-surface px-2 text-sm"
					>
						<option value="">{t`No cover letter selected`}</option>
						{documents
							?.filter((document) => document.type === "letter")
							.map((document) => (
								<option key={document.id} value={document.id}>
									{document.name}
								</option>
							))}
					</select>
				</div>
			)}
			<DialogFooter>
				<Button type="button" variant="secondary" disabled={!ready || !!duplicate.data} onClick={() => void add(false)}>
					{stage === "saved" ? <Trans>Save job</Trans> : <Trans>Record application</Trans>}
				</Button>
				<Button type="button" disabled={!ready || !!duplicate.data} onClick={() => void add(true)}>
					<Trans>Save and prepare resume</Trans>
				</Button>
			</DialogFooter>
		</form>
	);
}

type ReadStatusProps = {
	text: string;
	link: boolean;
	readable: boolean;
	pending: boolean;
	error: unknown;
	parsed: Parsed | null;
	ai: boolean;
};

/** What reading the posting found, or why the fields need filling in by hand. */
function ReadStatus({ text, link, readable, pending, error, parsed, ai }: ReadStatusProps) {
	const base = "flex items-start gap-1.5 text-xs leading-[17px]";

	if (!text) {
		return (
			<p className={cn(base, "text-ink-3")}>
				<Trans>We read the page and save the posting for Check, the assistant and your letter.</Trans>
			</p>
		);
	}
	if (pending) {
		return (
			<p className={cn(base, "text-ink-2")} role="status">
				{link ? <Trans>Reading the link…</Trans> : <Trans>Reading the posting…</Trans>}
			</p>
		);
	}
	if (error) {
		return (
			<p className={cn(base, "text-warn-text")} role="alert">
				<Icon name="warning-circle" size={16} className="shrink-0" />
				{getOrpcErrorMessage(error, {
					byCode: { POSTING_UNREADABLE: t`That link couldn't be read. Paste the posting text instead.` },
					fallback: t`The posting couldn't be read. Fill in the role and company.`,
				})}
			</p>
		);
	}
	if (parsed && (!parsed.role.trim() || !parsed.company.trim())) {
		return (
			<p className={cn(base, "text-warn-text")} role="status">
				<Icon name="warning-circle" size={16} className="shrink-0" />
				<Trans>Some job details couldn't be read. Fill in the role and company, or paste one job's posting text.</Trans>
			</p>
		);
	}
	if (parsed?.filledBy === "ai") {
		return (
			<p className={cn(base, "text-accent-text")} role="status">
				<Icon name="check-circle" size={16} className="shrink-0" />
				<Plural
					value={parsed.requirements.length}
					one="Found role, company and # requirement. Review the details before saving."
					other="Found role, company and # requirements. Review the details before saving."
				/>
			</p>
		);
	}
	if (parsed?.filledBy === "page") {
		return (
			<p className={cn(base, "text-accent-text")} role="status">
				<Icon name="check-circle" size={16} className="shrink-0" />
				<Trans>Found the role and company on the page. Review the details before saving.</Trans>
			</p>
		);
	}

	return (
		<p className={cn(base, "text-ink-3")}>
			{link && readable ? (
				<Trans>The page had no job details to read. Fill in the role and company.</Trans>
			) : ai ? (
				<Trans>Fill in the role and company. The posting is saved with the application.</Trans>
			) : (
				<Trans>Fill in the role and company, or use Set up AI to read them from the posting.</Trans>
			)}
		</p>
	);
}
