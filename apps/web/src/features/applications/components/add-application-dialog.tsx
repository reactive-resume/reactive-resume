import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
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
import { useDialogStore } from "@/dialogs/store";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { getStageLabel } from "../stages";
import { useInvalidateApplications } from "../use-application-actions";

type Parsed = RouterOutput["applications"]["ai"]["parsePosting"];
type Stage = "saved" | "applied" | "interview";

const STAGES: readonly Stage[] = ["saved", "applied", "interview"];
const MAX_POSTING_CHARS = 20_000;
// Reading waits for a pause in typing, so it starts once the paste has landed.
const READ_DELAY_MS = 600;

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
	const { data: firecrawl } = useQuery(orpc.firecrawl.status.queryOptions());
	const [query, setQuery] = useState("");
	const search = useMutation(orpc.applications.ai.searchPostings.mutationOptions());
	const [input, setInput] = useState("");
	const [role, setRole] = useState("");
	const [company, setCompany] = useState("");
	const [stage, setStage] = useState<Stage>("applied");
	const [reading, setReading] = useState<{ text: string; result: Parsed } | null>(null);
	const { hasUsableProvider } = useHasUsableAiProvider();
	const invalidate = useInvalidateApplications();
	const openDialog = useDialogStore((state) => state.openDialog);

	const read = useMutation(orpc.applications.ai.parsePosting.mutationOptions());
	const { mutate: readPosting, reset: resetRead } = read;
	const create = useMutation(orpc.applications.create.mutationOptions());

	const text = input.trim();
	const link = isLink(text);
	// A link can always be read (for the page's own job data); pasted text needs the AI provider.
	const readable = text.length > 8 && (link || hasUsableProvider);
	// A reading belongs to the text it was made from: editing the text drops it.
	const parsed = readable && reading?.text === text ? reading.result : null;

	useEffect(() => {
		resetRead();
		if (!readable) return;

		const timeout = window.setTimeout(() => {
			readPosting(
				{ input: text },
				{
					onSuccess: (result) => {
						setReading({ text, result });
						setRole((current) => current || result.role);
						setCompany((current) => current || result.company);
					},
				},
			);
		}, READ_DELAY_MS);
		return () => window.clearTimeout(timeout);
	}, [text, readable, readPosting, resetRead]);

	const ready = role.trim().length > 0 && company.trim().length > 0 && !read.isPending && !create.isPending;

	const add = async (tailor: boolean) => {
		if (!ready) return;
		const posting = {
			company: company.trim(),
			role: role.trim(),
			status: stage,
			...(parsed?.location ? { location: parsed.location } : {}),
			...(parsed?.salary ? { salary: parsed.salary } : {}),
			...(parsed?.requirements.length ? { requirements: parsed.requirements } : {}),
			...(link ? { sourceUrl: text } : {}),
			// The posting's text: read from the page for a link, or what was pasted.
			...(parsed?.jobDescription
				? { jobDescription: parsed.jobDescription }
				: !link && text
					? { jobDescription: text.slice(0, MAX_POSTING_CHARS) }
					: {}),
		};
		try {
			const applicationId = await create.mutateAsync(posting);
			invalidate();
			toast.add({ description: t`Added ${role.trim()} at ${company.trim()}` });
			onClose();
			onAdded(applicationId);
			if (tailor) openDialog("document.new", { step: "copy", applicationId });
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
				void add(true);
			}}
		>
			<DialogHeader>
				<DialogTitle>
					<Trans>Add an application</Trans>
				</DialogTitle>
				<DialogDescription className="sr-only">
					<Trans>Paste a job link or posting, then check the role and company.</Trans>
				</DialogDescription>
			</DialogHeader>

			{firecrawl?.configured && (
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
						<p className="text-ink-3 text-xs" role="status">
							<Trans>Searching job postings…</Trans>
						</p>
					)}
					{search.error && (
						<p className="text-danger-text text-xs" role="alert">
							{getOrpcErrorMessage(search.error, {
								fallback: t`Job search failed. Try again or paste a posting link.`,
							})}
						</p>
					)}
					{search.data?.length === 0 && (
						<p className="text-ink-3 text-xs" role="status">
							<Trans>No postings found. Try different keywords.</Trans>
						</p>
					)}
					{search.data && search.data.length > 0 && (
						<ul className="grid gap-2">
							{search.data.map((result) => (
								<li key={result.url} className="rounded-lg border border-line p-3">
									<strong className="font-medium text-sm">{result.title}</strong>
									<p className="line-clamp-2 text-ink-3 text-xs">{result.description}</p>
									<div className="mt-2 flex items-center gap-3">
										<a
											href={result.url}
											target="_blank"
											rel="noreferrer"
											className="text-accent-text text-xs hover:underline"
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
												setRole("");
												setCompany("");
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
					maxLength={MAX_POSTING_CHARS}
					placeholder="https://…"
					onChange={(event) => setInput(event.target.value)}
					autoFocus
				/>
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
				<span id={`${id}-stage`} className="font-medium text-sm">
					<Trans>Stage</Trans>
				</span>
				<SegmentedControl
					aria-labelledby={`${id}-stage`}
					value={stage}
					onValueChange={(value) => setStage(value as Stage)}
					className="w-fit"
				>
					{STAGES.map((value) => (
						<SegmentedControlItem key={value} value={value}>
							{getStageLabel(value)}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</div>

			<DialogFooter>
				<Button type="button" variant="secondary" disabled={!ready} onClick={() => void add(false)}>
					<Trans>Add</Trans>
				</Button>
				<Button type="submit" disabled={!ready}>
					<Trans>Add and tailor a resume</Trans>
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
