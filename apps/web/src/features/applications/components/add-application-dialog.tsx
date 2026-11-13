import type { RouterOutput } from "@/libs/orpc/client";
import type { PostingCapture } from "@reactive-resume/schema/applications/capture";
import type { SetStateAction } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { aiModelForTask } from "@reactive-resume/ai/task-models";
import { supportsNativeWebSearch } from "@reactive-resume/ai/types";
import { readPastedPostingHeader } from "@reactive-resume/import/job-posting";
import { postingReadReceipt } from "@reactive-resume/schema/applications/posting-source";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { isolate } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { getCategoryLane, getLaneLabel, laneMoveInput } from "../lanes";
import { useInvalidateApplications } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { PriorNoResponseNotice } from "./prior-no-response-notice";
import { rowGroundClassName } from "@/components/calm/list-row";
import { SetUpAiLine } from "@/components/calm/set-up-ai-line";
import { StageDot } from "@/components/calm/stage-dot";
import { SetUpAiDialog } from "@/features/ai/set-up-ai";
import { useSessionDraft } from "@/features/career/hooks";
import { useNow } from "@/features/career/shared";
import { SetUpWebAccess, WebAccessAttention, webSearchFailure } from "@/features/settings/ai/web-access";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { getOrpcErrorMessage, toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Parsed = RouterOutput["applications"]["ai"]["parsePosting"];
// Adding offers lanes of two stages: still to apply, or already applied. Interviews come later, on the application.
const ADD_CATEGORIES = ["saved", "applied"] as const;
const MAX_POSTING_CHARS = 20_000;
// The longest link or posting kept from a paste.
const MAX_INPUT = 100_000;

const isLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** The site a posting is on, for a result's second line. */
const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
};

type SaveJobDraft = {
	input: string;
	role: string;
	company: string;
	location: string;
	salary: string;
	pasteOpen: boolean;
	pastedText: string;
	description: string | null;
	reading: { text: string; result: Parsed } | null;
	/** Fields the person typed: a read or a header guess never writes over them, also after the dialog reopens. */
	authored: AuthoredField[];
};

type AuthoredField = "role" | "company" | "location" | "salary";
const AUTHORED_FIELDS: readonly AuthoredField[] = ["role", "company", "location", "salary"];

const EMPTY_SAVE_JOB: SaveJobDraft = {
	input: "",
	role: "",
	company: "",
	location: "",
	salary: "",
	pasteOpen: false,
	pastedText: "",
	description: null,
	reading: null,
	authored: [],
};

const draftFromCapture = (capture: PostingCapture): SaveJobDraft => ({
	...EMPTY_SAVE_JOB,
	input: capture.url ?? "",
	role: capture.role ?? "",
	company: capture.company ?? "",
	location: capture.location ?? "",
	pasteOpen: !!capture.description,
	pastedText: capture.description ?? "",
	description: capture.description || null,
});

/** A kept draft from this tab's storage; anything malformed starts a fresh form. */
function parseSaveJobDraft(value: unknown): SaveJobDraft | undefined {
	if (!value || typeof value !== "object") return undefined;
	const draft = { ...EMPTY_SAVE_JOB, ...(value as Partial<SaveJobDraft>) };
	const texts = [draft.input, draft.role, draft.company, draft.location, draft.salary, draft.pastedText];
	if (texts.some((text) => typeof text !== "string" || text.length > MAX_INPUT)) return undefined;
	if (typeof draft.pasteOpen !== "boolean") return undefined;
	if (draft.description !== null && typeof draft.description !== "string") return undefined;
	const reading = draft.reading;
	if (reading !== null && (typeof reading !== "object" || typeof reading.text !== "string" || !reading.result))
		return undefined;
	const authored = Array.isArray(draft.authored)
		? AUTHORED_FIELDS.filter((field) => (draft.authored as unknown[]).includes(field))
		: [];
	return { ...draft, authored };
}

type AddApplicationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdded: (id: string) => void;
	initialCapture?: PostingCapture | null | undefined;
	/** Opened to pick a job inside another flow (Copy for a job, Link to application): saving returns to it. */
	// oxlint-disable-next-line react/no-unused-prop-types -- kept for callers; the dialog has one submit either way
	forPicker?: boolean | undefined;
};

/**
 * Add an application from a pasted link or posting. The posting is read (the page's own job data, or the AI
 * provider when one is set up) into role and company, which stay editable; the posting itself is saved with the
 * application for Check, the assistant and letters. One submit: Save job, or Record application once Applied is
 * chosen. Search postings is the second tab; preparing a resume is the Fit screen's step.
 */
export function AddApplicationDialog({ open, onOpenChange, onAdded, initialCapture }: AddApplicationDialogProps) {
	// A new form mounts on every open (and stays while the dialog animates closed); it restores the kept draft.
	const [instance, setInstance] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);
	const [opener, setOpener] = useState<Element | null>(null);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setInstance((count) => count + 1);
			setOpener(document.activeElement);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				closeLabel={t`Close`}
				finalFocus={opener instanceof HTMLElement ? () => opener : undefined}
				className="sm:max-w-[560px]"
			>
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
	const now = useNow();
	const id = useId();
	const web = useQuery(orpc.webAccess.status.queryOptions());
	const webAccess = web.data;
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const [query, setQuery] = useState("");
	const [tab, setTab] = useState<"link" | "search">("link");
	const [setupOpen, setSetupOpen] = useState(false);
	const search = useMutation({
		...orpc.applications.ai.searchPostings.mutationOptions(),
		onMutate: () => getAccountGeneration(),
		onSettled: (_data, _error, _input, generation) => {
			if (generation === getAccountGeneration()) void web.refetch();
		},
	});
	const searchFailure = webSearchFailure(search.error);
	const nativeSearchFailure = searchFailure ?? webAccess?.testResult?.search?.error;
	// Without a capture, what was pasted and read survives closing the dialog (and a reload in this tab) until saved.
	const kept = useSessionDraft<SaveJobDraft>(
		initialCapture ? null : "save-job",
		initialCapture ? draftFromCapture(initialCapture) : EMPTY_SAVE_JOB,
		parseSaveJobDraft,
	);
	const keep = <K extends keyof SaveJobDraft>(name: K) =>
		[
			kept.value[name],
			(update: SetStateAction<SaveJobDraft[K]>) =>
				kept.setValue((previous) => ({
					...previous,
					[name]:
						typeof update === "function"
							? (update as (value: SaveJobDraft[K]) => SaveJobDraft[K])(previous[name])
							: update,
				})),
		] as const;
	const [input, setInput] = keep("input");
	const [role, setRole] = keep("role");
	const [company, setCompany] = keep("company");
	const { lanes, active, mode } = useApplicationLanes();
	const choices = ADD_CATEGORIES.flatMap((category) => active.filter((lane) => lane.category === category));
	const [laneId, setLaneId] = useState<string | null>(null);
	const lane = choices.find((item) => item.id === laneId) ?? getCategoryLane(lanes, "saved");
	const stage = lane.category;
	const [stageDate, setStageDate] = useState(() => new Date().toLocaleDateString("en-CA"));
	// What was sent with an application already made; both start empty.
	const [resumeId, setResumeId] = useState("");
	const resumes = documents?.filter((document) => document.type === "resume") ?? [];
	const [coverLetterId, setCoverLetterId] = useState("");
	const [location, setLocation] = keep("location");
	const [salary, setSalary] = keep("salary");
	const [authoredFields, setAuthoredFields] = keep("authored");
	const authored = useRef(new Set<AuthoredField>(authoredFields));
	const markAuthored = (field: AuthoredField) => {
		authored.current.add(field);
		setAuthoredFields((current) => (current.includes(field) ? current : [...current, field]));
	};
	const [pasteOpen, setPasteOpen] = keep("pasteOpen");
	const [pastedText, setPastedText] = keep("pastedText");
	const [description, setDescription] = keep("description");
	const [reading, setReading] = keep("reading");
	const providerState = useHasUsableAiProvider();
	const { hasUsableProvider } = providerState;
	const readProvider = providerState.usableProviders[0];
	const nativeCapabilities = useQuery({
		...orpc.ai.capabilities.queryOptions(),
		enabled: nativeSearchFailure === "auth" || nativeSearchFailure === "quota",
	});
	const nativeSearchProvider =
		readProvider && supportsNativeWebSearch(readProvider) && nativeCapabilities.data?.nativeWebSearch === 1
			? readProvider
			: undefined;
	const nativeSearchLabel = nativeSearchProvider?.label ?? "";
	const readAI = readProvider ? { label: readProvider.label, model: aiModelForTask(readProvider, "fast") } : undefined;
	const invalidate = useInvalidateApplications();

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
	const receipt = postingReadReceipt(parsed?.postingSource, i18n.locale, now.getTime());
	const readAt = receipt?.readAt;
	const sourceHost = receipt?.sourceHost ?? t`the posting page`;
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
	// Without AI, a pasted posting's first line usually names the role and company ("Role — Company (City)"): fill what
	// it gives, never over what the person typed. AI or a link still reads the rest; a capture brings its own fields.
	const header = !link && !initialCapture ? readPastedPostingHeader(text) : null;
	const guess = !hasUsableProvider && !parsed ? header : null;
	const headerKey = header ? JSON.stringify(header) : "";
	const guessKey = guess ? headerKey : "";
	// What the fields held before a guess filled them, so they go back if the pasted text stops having a header.
	const beforeGuess = useRef<{ role: string; company: string; location: string; salary: string } | null>(null);
	useEffect(() => {
		const fill = (key: AuthoredField, value: string, apply: (value: string) => void) => {
			if (!authored.current.has(key)) apply(value);
		};
		if (guess) {
			beforeGuess.current ??= { role, company, location, salary };
			const before = beforeGuess.current;
			fill("role", guess.role, setRole);
			fill("company", guess.company, setCompany);
			fill("location", guess.location || before.location, setLocation);
			fill("salary", guess.salary || before.salary, setSalary);
		} else if (!header && beforeGuess.current) {
			const before = beforeGuess.current;
			beforeGuess.current = null;
			fill("role", before.role, setRole);
			fill("company", before.company, setCompany);
			fill("location", before.location, setLocation);
			fill("salary", before.salary, setSalary);
		}
		// oxlint-disable-next-line react/exhaustive-deps -- keyed by the header's content; the field values are read once
	}, [guessKey, headerKey]);

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

	const add = async () => {
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
			// A saved job names no documents: preparing a resume is the Fit screen's step. Applied records what was sent.
			...(stage !== "saved" && resumeId ? { resumeId } : {}),
			...(stage !== "saved" && coverLetterId ? { coverLetterId } : {}),
			jobDescription: postingDescription || null,
			postingSource,
		};
		try {
			const applicationId = await create.mutateAsync(posting);
			kept.clear();
			invalidate();
			toast.add({ description: t`Added ${isolate(role.trim())} at ${isolate(company.trim())}` });
			onClose();
			onAdded(applicationId);
		} catch (error) {
			if (sourceLink) void duplicate.refetch();
			toastError(error, t`Couldn't add the application. Try again.`);
		}
	};

	// One token (a link, or nothing yet) keeps the field one line tall; pasted posting text gets room.
	const oneLine = !/\s/.test(input.trim());
	const searchable = Boolean(webAccess?.search) && query.trim().length >= 2 && !search.isPending && !create.isPending;
	// The service's own name (a brand: "tavily" reads "Tavily"), or the server's SearXNG.
	const searchService = webAccess?.provider
		? webAccess.provider.charAt(0).toUpperCase() + webAccess.provider.slice(1)
		: webAccess?.searxng
			? "SearXNG"
			: null;
	const pickPosting = (url: string) => {
		setInput(url);
		setPasteOpen(false);
		setDescription(null);
		resetRead();
		// The chosen posting replaces what came before: no earlier guess comes back over it.
		beforeGuess.current = null;
		if (!authored.current.has("role")) setRole("");
		if (!authored.current.has("company")) setCompany("");
		if (!authored.current.has("location")) setLocation("");
		if (!authored.current.has("salary")) setSalary("");
		search.reset();
		setTab("link");
	};
	const updateDuplicate = async () => {
		if (!duplicate.data || update.isPending) return;
		try {
			// Fields left empty keep what the saved job already says.
			await update.mutateAsync({
				id: duplicate.data.id,
				role: role.trim() || duplicate.data.role,
				company: company.trim() || duplicate.data.company,
				...(location.trim() ? { location: location.trim() } : {}),
				sourceUrl: sourceLink,
				...(postingDescription.trim() ? { jobDescription: postingDescription, postingSource } : {}),
			});
			kept.clear();
			invalidate();
			onClose();
			onAdded(duplicate.data.id);
		} catch (error) {
			toastError(error, t`Couldn't update the posting. Try again.`);
		}
	};

	return (
		<form
			className={cn("grid", tab === "search" ? "gap-[18px]" : "gap-5")}
			onSubmit={(event) => {
				event.preventDefault();
				void add();
			}}
		>
			<DialogHeader className="pe-9">
				<DialogTitle>
					<Trans>Save a job</Trans>
				</DialogTitle>
				<DialogDescription className="sr-only">
					<Trans>Paste a job link or posting, then check the role and company.</Trans>
				</DialogDescription>
			</DialogHeader>
			{/* The first row under the title; typing the details always works. */}
			{!providerState.isUnavailable && !hasUsableProvider && (
				<SetUpAiLine lead={<Trans>Reading a posting needs AI.</Trans>} onSetUp={() => setSetupOpen(true)}>
					<Trans>Typing the details always works.</Trans>
				</SetUpAiLine>
			)}
			<SetUpAiDialog open={setupOpen} onOpenChange={setSetupOpen} />

			<Tabs
				value={tab}
				onValueChange={(value) => setTab(value as typeof tab)}
				className={tab === "search" ? "gap-[18px]" : "gap-5"}
			>
				<TabsList
					aria-label={t`How to add it`}
					className={cn("w-full max-sm:h-auto max-sm:min-h-11 max-sm:items-stretch", stage === "applied" && "hidden")}
				>
					<TabsTrigger value="link" className="max-sm:min-w-0 max-sm:py-2 max-sm:whitespace-normal">
						<Icon name="link" />
						<Trans>Link or posting text</Trans>
					</TabsTrigger>
					<TabsTrigger value="search" className="max-sm:min-w-0 max-sm:py-2 max-sm:whitespace-normal">
						<Icon name="magnifying-glass" />
						<Trans>Search postings</Trans>
					</TabsTrigger>
				</TabsList>

				<TabsContent value="link" className="grid gap-5">
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-posting`}>{oneLine ? <Trans>Job link</Trans> : <Trans>Posting text</Trans>}</Label>
						<InputGroup className={cn("h-auto min-h-10", !oneLine && "items-end")}>
							{oneLine && (
								<InputGroupAddon>
									<Icon name="link" />
								</InputGroupAddon>
							)}
							<textarea
								// What people paste or write here can be in any language: its own text sets the direction.
								dir="auto"
								id={`${id}-posting`}
								data-slot="input-group-control"
								aria-label={t`Job link or posting text`}
								rows={oneLine ? 1 : 4}
								wrap={oneLine ? "off" : "soft"}
								value={input}
								maxLength={MAX_INPUT}
								placeholder="https://…"
								className={cn(
									"max-h-72 min-w-0 flex-1 resize-none self-stretch bg-transparent py-[9px] text-sm leading-5 outline-none placeholder:text-ink-3",
									oneLine ? "h-[38px] overflow-hidden px-2" : "overflow-y-auto px-[11px]",
								)}
								onChange={(event) => {
									setInput(event.target.value);
									if (!initialCapture) {
										setDescription(null);
										setPasteOpen(false);
									}
									resetRead();
								}}
								onKeyDown={(event) => {
									// A link is one line: Enter saves the job, as in the fields below, and never breaks the link.
									if (event.key === "Enter" && oneLine && !event.nativeEvent.isComposing) {
										event.preventDefault();
										event.currentTarget.form?.requestSubmit();
									}
								}}
								// oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens on the field it is for
								autoFocus
							/>
							{/* Reading needs AI: with none connected the button is left out and the line above says why. */}
							{readAI && (
								<InputGroupAddon align="inline-end" className={oneLine ? "py-0" : "pt-0"}>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										disabled={!text || read.isPending}
										aria-describedby={`${id}-sends`}
										onClick={() => readPosting(true)}
									>
										<Icon name="sparkle" className="text-ink-3" />
										<Trans>Read it</Trans>
									</Button>

									{readable && link && (
										<DropdownMenu>
											<DropdownMenuTrigger
												render={<Button type="button" size="icon-xs" variant="ghost" aria-label={t`Reading options`} />}
											>
												<Icon name="caret-down" />
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem disabled={read.isPending} onClick={() => readPosting(false)}>
													<Trans>Read the page without AI</Trans>
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									)}
								</InputGroupAddon>
							)}
						</InputGroup>
						{((oneLine && !pasteOpen && !initialCapture) || (readable && link)) && (
							<p className="text-xs/4 text-ink-3">
								{oneLine && !pasteOpen && !initialCapture && (
									<Trans>
										Or{" "}
										<button
											type="button"
											className="font-medium text-accent-text hover:underline"
											onClick={() => {
												setPasteOpen(true);
												setDescription(null);
												resetRead();
											}}
										>
											paste the posting text
										</button>
									</Trans>
								)}
								{!readAI && readable && link && (
									<span>
										{oneLine && !pasteOpen && !initialCapture && " · "}
										<button
											type="button"
											className="font-medium text-accent-text hover:underline disabled:opacity-45"
											disabled={read.isPending}
											onClick={() => readPosting(false)}
										>
											<Trans>Read the page without AI</Trans>
										</button>
									</span>
								)}
							</p>
						)}
						{/* A longer paste is cut at the limit: say so, rather than drop the rest silently. */}
						{input.length >= MAX_INPUT && (
							<p role="status" className="text-xs/4 text-warn-text">
								<Trans>Only the first {i18n.number(MAX_INPUT)} characters are kept.</Trans>
							</p>
						)}
						{pasteOpen && !initialCapture && (
							<div className="grid gap-1.5 pt-1.5">
								<Label htmlFor={`${id}-recovery`}>
									<Trans>Pasted description</Trans>
								</Label>
								<Textarea
									// What people paste or write here can be in any language: its own text sets the direction.
									dir="auto"
									id={`${id}-recovery`}
									rows={5}
									value={pastedText}
									className="max-h-72 overflow-y-auto"
									maxLength={100_000}
									onChange={(event) => {
										setPastedText(event.target.value);
										setDescription(null);
										resetRead();
									}}
								/>
								{sourceLink && (
									<p className="text-xs/4 text-ink-3">
										<Trans>The original link stays with this job.</Trans>
									</p>
								)}
							</div>
						)}
						{(clipped || parsed?.postingSource.completeness === "incomplete") && (
							<p className="text-xs/4 text-warn-text" role="alert">
								<Trans>
									This description is clipped or incomplete. Review it or paste the full description before preparing.
								</Trans>
							</p>
						)}
						{parsed?.postingSource.fallbackReason && (
							<p className="text-xs/4 text-warn-text" role="status">
								<Trans>Enhanced reading was unavailable. The built-in reader retrieved this posting.</Trans>
							</p>
						)}
						{/* Pasted text that came back unchanged (AI couldn't read it) is already in a box above: no second copy.
						    A captured posting has no box above, so its text stays here. */}
						{description !== null && (link || Boolean(initialCapture?.description) || description.trim() !== text) && (
							<div className="grid gap-1.5 pt-1.5">
								<Label htmlFor={`${id}-description`}>
									<Trans>Saved description</Trans>
								</Label>
								<Textarea
									// What people paste or write here can be in any language: its own text sets the direction.
									dir="auto"
									id={`${id}-description`}
									rows={5}
									maxLength={MAX_POSTING_CHARS}
									value={description}
									onChange={(event) => setDescription(event.target.value)}
									className="max-h-72 overflow-y-auto"
								/>
								{readAt && (
									<p className="text-xs/4 text-ink-3">
										<Trans>
											Read {readAt} from {sourceHost}. The employer may have changed it since.
										</Trans>
									</p>
								)}
							</div>
						)}
						{initialCapture?.description &&
						!read.error &&
						!read.isPending &&
						!parsed?.enrichmentWarning ? null : providerState.isUnavailable && !link ? (
							<AiProviderLoadState state={providerState} />
						) : (
							<ReadStatus link={link} pending={read.isPending} error={read.error} parsed={parsed} guessed={!!guess} />
						)}
						{/* What Read it sends, while there is something to read and the details are still to fill. */}
						{readAI && (
							<p
								id={`${id}-sends`}
								className={cn(
									"text-xs/4 text-ink-3",
									(!text || parsed || read.isPending || duplicate.data || (role.trim() && company.trim())) && "sr-only",
								)}
							>
								<Trans>
									Read it sends this posting to {readAI.label} · {readAI.model}. Public links also go to the reader and
									the site being read.
								</Trans>
							</p>
						)}
						{initialCapture && (
							<p className="text-xs/4 text-ink-3">
								<Trans>Capture does not use AI. Review every field before saving.</Trans>
							</p>
						)}
					</div>

					{sourceLink && duplicate.isError && (
						<Alert variant="warn" role="alert">
							<Icon name="warning-circle" />
							<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
								<Trans>Duplicate check unavailable. Retry before saving; your server may need updating.</Trans>
								<Button type="button" size="sm" variant="secondary" onClick={() => void duplicate.refetch()}>
									<Trans>Retry</Trans>
								</Button>
							</AlertDescription>
						</Alert>
					)}
					{/* Advice, never a block of the form: the job is already here, so open it or refresh its posting. */}
					{duplicate.data && (
						<Alert variant="info" role="status">
							<Icon name="info" />
							<AlertTitle>
								<Trans>
									You already saved this job: {duplicate.data.role} at {duplicate.data.company}.
								</Trans>
							</AlertTitle>
							<AlertDescription className="grid justify-items-start gap-2">
								<Trans>Open it, or update only its posting details from this link.</Trans>
								<span className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										size="sm"
										variant="secondary"
										onClick={() => {
											if (!duplicate.data) return;
											onClose();
											onAdded(duplicate.data.id);
										}}
									>
										<Trans>Open the application</Trans>
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className="text-current"
										disabled={update.isPending || read.isPending}
										onClick={() => void updateDuplicate()}
									>
										<Trans>Update posting details</Trans>
									</Button>
								</span>
							</AlertDescription>
						</Alert>
					)}
					<fieldset hidden={Boolean(duplicate.data)} className={cn("grid gap-[18px]", duplicate.data && "hidden")}>
						<PriorNoResponseNotice company={company} />

						<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
							<div className="grid gap-1.5">
								<Label htmlFor={`${id}-company`}>
									<Trans>Company</Trans>
								</Label>
								<Input
									id={`${id}-company`}
									value={company}
									onChange={(event) => {
										markAuthored("company");
										setCompany(event.target.value);
									}}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor={`${id}-role`}>
									<Trans>Role</Trans>
								</Label>
								<Input
									id={`${id}-role`}
									value={role}
									onChange={(event) => {
										markAuthored("role");
										setRole(event.target.value);
									}}
								/>
							</div>
						</div>

						<details open={stage === "saved" || !!location || !!salary} className="grid gap-3">
							<summary className={cn("cursor-pointer t-small text-accent-text", stage === "saved" && "hidden")}>
								<Trans>Additional details</Trans>
							</summary>
							<div className="grid gap-1.5">
								<Label htmlFor={`${id}-location`}>
									<Trans>Location</Trans>
								</Label>
								<Input
									id={`${id}-location`}
									value={location}
									onChange={(event) => {
										markAuthored("location");
										setLocation(event.target.value);
									}}
								/>
							</div>
							<details className="grid gap-1.5">
								<summary className="cursor-pointer t-small text-accent-text">
									<Trans>Add salary</Trans>
								</summary>
								<Label htmlFor={`${id}-salary`}>
									<Trans>Salary</Trans>
								</Label>
								<Input
									id={`${id}-salary`}
									value={salary}
									onChange={(event) => {
										markAuthored("salary");
										setSalary(event.target.value);
									}}
								/>
							</details>
						</details>

						<div className="grid gap-1.5">
							<span id={`${id}-stage`} className="text-[13px]/[18px] font-medium text-ink-2">
								<Trans>Stage</Trans>
							</span>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
								<SegmentedControl
									aria-labelledby={`${id}-stage`}
									value={lane.id}
									onValueChange={(value) => setLaneId(value as string)}
									className="h-auto min-h-9 max-w-full flex-wrap"
								>
									{choices.map((choice) => (
										<SegmentedControlItem
											key={choice.id}
											value={choice.id}
											className="min-h-8 max-w-full flex-auto [overflow-wrap:anywhere] whitespace-normal"
										>
											<StageDot status={choice.category} color={choice.color}>
												{null}
											</StageDot>
											{getLaneLabel(choice)}
										</SegmentedControlItem>
									))}
								</SegmentedControl>
								{stage === "saved" && (
									<p className="min-w-0 flex-1 basis-48 text-xs/4 text-ink-3">
										<Trans>Choosing Applied asks which resume and letter you sent.</Trans>
									</p>
								)}
							</div>
						</div>

						{stage !== "saved" && (
							<div className="grid gap-1.5">
								<div className="grid grid-cols-[150px_1fr_1fr] gap-3 max-sm:grid-cols-1">
									<div className="grid gap-1.5">
										<Label htmlFor={`${id}-date`}>
											<Trans>Applied on</Trans>
										</Label>
										<Input
											id={`${id}-date`}
											type="date"
											value={stageDate}
											required
											onChange={(event) => setStageDate(event.target.value)}
										/>
									</div>
									<div className="grid min-w-0 gap-1.5">
										<Label htmlFor={`${id}-resume`}>
											<Trans>Resume you sent</Trans>
										</Label>
										<NativeSelect
											id={`${id}-resume`}
											value={resumeId}
											onChange={(event) => setResumeId(event.target.value)}
										>
											<option value="">{t`None`}</option>
											{resumes.map((document) => (
												<option key={document.id} value={document.id}>
													{document.name}
												</option>
											))}
										</NativeSelect>
									</div>
									<div className="grid min-w-0 gap-1.5">
										<Label htmlFor={`${id}-letter`}>
											<Trans>Letter you sent</Trans>
										</Label>
										<NativeSelect
											id={`${id}-letter`}
											value={coverLetterId}
											onChange={(event) => setCoverLetterId(event.target.value)}
										>
											<option value="">{t`None`}</option>
											{documents
												?.filter((document) => document.type === "letter" && !document.isLocked)
												.map((document) => (
													<option key={document.id} value={document.id}>
														{document.name}
													</option>
												))}
										</NativeSelect>
									</div>
								</div>
								<p className="text-xs/4 text-ink-3">
									<Trans>
										Both are optional. What you pick is kept as it was sent and never changes; your drafts stay
										editable.
									</Trans>
								</p>
							</div>
						)}
					</fieldset>
				</TabsContent>

				<TabsContent value="search" className="grid gap-[18px]">
					<WebAccessAttention failure={searchFailure} />
					{webAccess?.search || query.length > 0 ? (
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-search`}>
								<Trans>Role, company or location</Trans>
							</Label>
							<div className="flex items-center gap-2">
								<InputGroup className="flex-1">
									<InputGroupAddon>
										<Icon name="magnifying-glass" />
									</InputGroupAddon>
									<InputGroupInput
										id={`${id}-search`}
										value={query}
										maxLength={500}
										autoFocus
										onChange={(event) => {
											setQuery(event.target.value);
											search.reset();
										}}
										onKeyDown={(event) => {
											if (event.key === "Enter" && !event.nativeEvent.isComposing) {
												event.preventDefault();
												if (searchable) search.mutate({ query });
											}
										}}
									/>
								</InputGroup>
								<Button
									type="button"
									variant="secondary"
									disabled={!searchable}
									onClick={() => search.mutate({ query })}
								>
									<Trans>Search</Trans>
								</Button>
							</div>
							{searchService && (
								<p className="text-xs/4 text-ink-3">
									<Trans>
										Searches public job pages through {searchService}, your search service. Only these words are sent.
									</Trans>
								</p>
							)}
						</div>
					) : (
						!web.isPending &&
						!searchFailure && (
							<div className="flex flex-wrap items-center justify-between gap-3">
								<p className="min-w-0 flex-1 basis-56 text-[13px]/[18px] text-ink-2">
									<Trans>Searching postings needs a web search service.</Trans>
								</p>
								{!webAccess?.testResult && <SetUpWebAccess />}
							</div>
						)
					)}

					{search.isPending && (
						<p className="text-[13px]/[18px] text-ink-3" role="status">
							<Trans>Searching job postings…</Trans>
						</p>
					)}
					{(nativeSearchFailure === "auth" || nativeSearchFailure === "quota") && nativeSearchProvider && (
						<Button
							type="button"
							variant="secondary"
							className="justify-self-start"
							disabled={query.trim().length < 2 || search.isPending || create.isPending}
							onClick={() => search.mutate({ query, aiProviderId: nativeSearchProvider.id })}
						>
							<Trans>Retry with {nativeSearchLabel}</Trans>
						</Button>
					)}
					{search.error && !searchFailure && (
						<p className="text-[13px]/[18px] text-danger-text" role="alert">
							{getOrpcErrorMessage(search.error, {
								fallback: t`Job search failed. Try again or paste a posting link.`,
							})}
						</p>
					)}
					{search.data?.length === 0 && (
						<p className="text-[13px]/[18px] text-ink-3" role="status">
							<Trans>No postings found. Try different keywords.</Trans>
						</p>
					)}
					{search.data && search.data.length > 0 && (
						<div className="grid">
							<p className="pb-0.5 text-[13px]/[18px] text-ink-3" role="status">
								<Plural value={search.data.length} one="# posting found" other="# postings found" />
							</p>
							<ol className="border-y border-line">
								{search.data.map((result) => {
									const host = hostOf(result.url);
									return (
										<li
											key={result.url}
											className={cn(
												rowGroundClassName,
												"flex min-h-[52px] items-center gap-3.5 border-b border-line py-[7px] last:border-b-0 hover:border-transparent hover:before:bg-hover",
											)}
										>
											<span className="flex min-w-0 flex-1 flex-col gap-px">
												<span className="truncate text-sm/5 font-medium">{result.title}</span>
												<span className="truncate text-[13px]/[18px] text-ink-3">
													{result.description && `${result.description} · `}
													<span className="font-mono text-xs font-medium">{host}</span>
												</span>
											</span>
											<a
												href={result.url}
												target="_blank"
												rel="noreferrer"
												aria-label={t`View posting on ${host}`}
												className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
											>
												<Icon name="arrow-square-out" />
											</a>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												disabled={read.isPending || create.isPending}
												onClick={() => pickPosting(result.url)}
											>
												<Trans>Use posting</Trans>
											</Button>
										</li>
									);
								})}
							</ol>
						</div>
					)}

					<p className="flex items-center gap-1.5 text-xs/4 text-ink-3">
						<Icon name="puzzle-piece" size={16} className="shrink-0" />
						<span>
							<Trans>
								Already on a posting's page? The{" "}
								<a href="/capture-helper.zip" download className="font-medium text-accent-text hover:underline">
									browser helper
								</a>{" "}
								saves it from there.
							</Trans>
						</span>
					</p>
				</TabsContent>
			</Tabs>

			<DialogFooter className={cn(tab === "search" && "mt-0")}>
				<Button type="button" variant="ghost" onClick={onClose}>
					<Trans>Cancel</Trans>
				</Button>
				<Button type="submit" disabled={!ready || !!duplicate.data} loading={create.isPending}>
					{stage === "saved" ? <Trans>Save job</Trans> : <Trans>Record application</Trans>}
				</Button>
			</DialogFooter>
		</form>
	);
}

type ReadStatusProps = {
	link: boolean;
	pending: boolean;
	error: unknown;
	parsed: Parsed | null;
	/** The role and company were filled from the pasted text's first line, without AI. */
	guessed?: boolean;
};

/** What reading the posting found, or why the fields need filling in by hand. */
function ReadStatus({ link, pending, error, parsed, guessed = false }: ReadStatusProps) {
	const base = "flex items-start gap-1.5 text-xs/4";

	// Keep the failure visible when opening paste recovery.
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
					allowServerMessage: true,
					fallback: link
						? t`Couldn't read this page. Paste the posting text.`
						: t`The posting couldn't be read. Fill in the role and company.`,
				})}
			</p>
		);
	}
	if (parsed?.enrichmentWarning || (parsed && (!parsed.role.trim() || !parsed.company.trim()))) {
		return (
			<p className={cn(base, "text-warn-text")} role="status">
				<Icon name="warning-circle" size={16} className="shrink-0" />
				{parsed.enrichmentWarning ? (
					<Trans>AI couldn't fill the details. The posting is retained; complete the fields manually.</Trans>
				) : (
					<Trans>
						Some job details couldn't be read. Fill in the role and company, or paste one job's posting text.
					</Trans>
				)}
			</p>
		);
	}
	if (parsed?.filledBy === "ai") {
		return (
			<div className="grid gap-1.5">
				<p className={cn(base, "text-accent-text")} role="status">
					<Icon name="check-circle" size={16} className="shrink-0" />
					<Plural
						value={parsed.requirements.length}
						one="Found role, company and # requirement. Review the details before saving."
						other="Found role, company and # requirements. Review the details before saving."
					/>
				</p>
				{parsed.requirements.length > 0 && (
					<details className="group text-xs">
						<summary className="w-fit cursor-pointer text-ink-2 hover:text-ink">
							<Trans>Show what it asks for</Trans>
						</summary>
						<ul className="mt-1.5 flex flex-wrap gap-1.5">
							{parsed.requirements.map((requirement) => (
								<li key={requirement} className="rounded-md bg-sunken px-2 py-1">
									{requirement}
								</li>
							))}
						</ul>
					</details>
				)}
			</div>
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

	if (guessed) {
		return (
			<p className={cn(base, "text-ink-2")} role="status">
				<Icon name="check-circle" size={16} className="shrink-0" />
				<Trans>Filled the role and company from the posting's first line. Review them before saving.</Trans>
			</p>
		);
	}

	// Nothing read yet: the field's own help line says what can be done.
	return null;
}
