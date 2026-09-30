import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
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
import { useInvalidateApplications } from "../use-application-actions";
import { useDialogStore } from "@/dialogs/store";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Parsed = RouterOutput["applications"]["ai"]["parsePosting"];
type Stage = "saved" | "applied" | "interview";

const STAGES: readonly Stage[] = ["saved", "applied", "interview"];
const MAX_POSTING_CHARS = 20_000;

const isLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

type AddApplicationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdded: (id: string) => void;
};

/**
 * Add an application from a pasted link or posting. The posting is read (the page's own job data, or the AI
 * provider when one is set up) into role and company, which stay editable; the posting itself is saved with the
 * application for Check, the assistant and letters. Add, or Add and tailor a resume.
 */
export function AddApplicationDialog({ open, onOpenChange, onAdded }: AddApplicationDialogProps) {
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
				<AddApplicationForm key={instance} onClose={() => onOpenChange(false)} onAdded={onAdded} />
			</DialogContent>
		</Dialog>
	);
}

type AddApplicationFormProps = { onClose: () => void; onAdded: (id: string) => void };

function AddApplicationForm({ onClose, onAdded }: AddApplicationFormProps) {
	const id = useId();
	const { data: webAccess } = useQuery(orpc.webAccess.status.queryOptions());
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const [query, setQuery] = useState("");
	const search = useMutation(orpc.applications.ai.searchPostings.mutationOptions());
	const [input, setInput] = useState("");
	const [role, setRole] = useState("");
	const [company, setCompany] = useState("");
	const [stage, setStage] = useState<Stage>("saved");
	const [stageDate, setStageDate] = useState(() => new Date().toLocaleDateString("en-CA"));
	const [resumeId, setResumeId] = useState("");
	const [coverLetterId, setCoverLetterId] = useState("");
	const [location, setLocation] = useState("");
	const [salary, setSalary] = useState("");
	const [pasteOpen, setPasteOpen] = useState(false);
	const [pastedText, setPastedText] = useState("");
	const [description, setDescription] = useState<string | null>(null);
	const [reading, setReading] = useState<{ text: string; result: Parsed } | null>(null);
	const { hasUsableProvider } = useHasUsableAiProvider();
	const invalidate = useInvalidateApplications();
	const openDialog = useDialogStore((state) => state.openDialog);

	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const read = useMutation({
		...orpc.applications.ai.parsePosting.mutationOptions(),
		mutationFn: (value) =>
			client.applications.ai.parsePosting(value, controller.current ? { signal: controller.current.signal } : {}),
	});
	const resetRead = () => {
		controller.current?.abort();
		read.reset();
		setReading(null);
	};
	const create = useMutation(orpc.applications.create.mutationOptions());

	const text = (pasteOpen ? pastedText : input).trim();
	const sourceLink = isLink(input.trim()) ? input.trim() : null;
	const link = !pasteOpen && Boolean(sourceLink);
	const readable = text.length > 8 && (link || hasUsableProvider);
	const parsed = reading?.text === text ? reading.result : null;
	const clipped = Boolean(parsed?.postingSource.truncated || (!link && text.length > MAX_POSTING_CHARS));
	const readPosting = () => {
		if (!readable || read.isPending) return;
		const request = new AbortController();
		controller.current = request;
		read.mutate(
			{ input: text },
			{
				onSuccess: (result) => {
					if (request.signal.aborted) return;
					setReading({ text, result });
					setRole((current) => current || result.role);
					setCompany((current) => current || result.company);
					setLocation((current) => current || result.location);
					setSalary((current) => current || result.salary);
					setDescription(result.jobDescription);
				},
				onError: () => {
					if (link && !request.signal.aborted) setPasteOpen(true);
				},
			},
		);
	};

	const ready =
		role.trim().length > 0 &&
		company.trim().length > 0 &&
		(stage === "saved" || Boolean(stageDate)) &&
		!read.isPending &&
		!create.isPending;

	const add = async (tailor: boolean) => {
		if (!ready) return;
		const posting = {
			company: company.trim(),
			role: role.trim(),
			status: stage,
			...(location.trim() ? { location: location.trim() } : {}),
			...(salary.trim() ? { salary: salary.trim() } : {}),
			...(parsed?.requirements.length ? { requirements: parsed.requirements } : {}),
			...(sourceLink ? { sourceUrl: sourceLink } : {}),
			...(stage !== "saved" && stageDate ? { stageEnteredAt: stageDate } : {}),
			...(resumeId ? { resumeId } : {}),
			...(stage !== "saved" && coverLetterId ? { coverLetterId } : {}),
			jobDescription: (description ?? (!link ? text : "")).slice(0, MAX_POSTING_CHARS) || null,
			postingSource:
				parsed?.postingSource ??
				(!link && text
					? {
							method: "paste" as const,
							format: "text" as const,
							truncated: clipped,
							completeness: clipped ? ("incomplete" as const) : ("unknown" as const),
						}
					: null),
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
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't add the application.` }),
			});
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
			<DialogHeader>
				<DialogTitle>
					<Trans>Save a job</Trans>
				</DialogTitle>
				<DialogDescription className="sr-only">
					<Trans>Paste a job link or posting, then check the role and company.</Trans>
				</DialogDescription>
			</DialogHeader>

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
												setRole("");
												setCompany("");
												setLocation("");
												setSalary("");
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
						setDescription(null);
						setPasteOpen(false);
						resetRead();
					}}
					autoFocus
				/>
				{sourceLink && (
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
				{pasteOpen && (
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
				{readable && (
					<Button type="button" variant="secondary" size="sm" disabled={read.isPending} onClick={readPosting}>
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
				{parsed && description !== null && (
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
						{parsed.postingSource.retrievedAt && (
							<p className="text-xs text-ink-3">
								<Trans>
									Retrieved {parsed.postingSource.retrievedAt}. Origin freshness is unknown unless reported.
								</Trans>
							</p>
						)}
					</div>
				)}
				<ReadStatus
					text={text}
					link={link}
					readable={readable}
					pending={read.isPending}
					error={read.error}
					parsed={parsed}
					ai={hasUsableProvider}
				/>
			</div>

			<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-role`}>
						<Trans>Role</Trans>
					</Label>
					<Input id={`${id}-role`} value={role} onChange={(event) => setRole(event.target.value)} />
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-company`}>
						<Trans>Company</Trans>
					</Label>
					<Input id={`${id}-company`} value={company} onChange={(event) => setCompany(event.target.value)} />
				</div>
			</div>

			<div className="grid gap-1.5">
				<span id={`${id}-stage`} className="text-sm font-medium">
					<Trans>Stage</Trans>
				</span>
				<SegmentedControl
					aria-labelledby={`${id}-stage`}
					value={stage}
					onValueChange={(value) => setStage(value as Stage)}
					className="h-auto w-fit max-w-full flex-wrap"
				>
					{STAGES.map((value) => (
						<SegmentedControlItem
							key={value}
							value={value}
							className="min-h-7 max-w-full flex-auto [overflow-wrap:anywhere] whitespace-normal"
						>
							{value === "saved" ? (
								<Trans>Saved</Trans>
							) : value === "applied" ? (
								<Trans>Already applied</Trans>
							) : (
								<Trans>Already interviewing</Trans>
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
					<Input id={`${id}-location`} value={location} onChange={(event) => setLocation(event.target.value)} />
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-salary`}>
						<Trans>Salary</Trans>
					</Label>
					<Input id={`${id}-salary`} value={salary} onChange={(event) => setSalary(event.target.value)} />
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
					className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
				>
					<option value="">{t`None`}</option>
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
						className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
					>
						<option value="">{t`None`}</option>
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
				<Button type="button" variant="secondary" disabled={!ready} onClick={() => void add(false)}>
					{stage === "saved" ? <Trans>Save job</Trans> : <Trans>Record application</Trans>}
				</Button>
				<Button type="button" disabled={!ready} onClick={() => void add(true)}>
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
				<Icon name="error" size={16} className="shrink-0" />
				{getOrpcErrorMessage(error, {
					byCode: { POSTING_UNREADABLE: t`That link couldn't be read. Paste the posting text instead.` },
					fallback: t`The posting couldn't be read. Fill in the role and company.`,
				})}
			</p>
		);
	}
	if (parsed?.filledBy === "ai") {
		return (
			<p className={cn(base, "text-accent-text")} role="status">
				<Icon name="check_circle" size={16} className="shrink-0" />
				<Plural
					value={parsed.requirements.length}
					one="Found role, company, location and # requirement. Saved with the application."
					other="Found role, company, location and # requirements. Saved with the application."
				/>
			</p>
		);
	}
	if (parsed?.filledBy === "page") {
		return (
			<p className={cn(base, "text-accent-text")} role="status">
				<Icon name="check_circle" size={16} className="shrink-0" />
				<Trans>Found the role and company on the page. The posting is saved with the application.</Trans>
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
				<Trans>Fill in the role and company. Connect an AI provider in settings to read them from the posting.</Trans>
			)}
		</p>
	);
}
