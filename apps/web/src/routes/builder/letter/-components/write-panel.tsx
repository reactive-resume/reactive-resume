import type { Application } from "@/features/applications/types";
import type { LetterDraft } from "@/features/letters/store";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import { useId, useRef, useState } from "react";
import { coverLetterTextToHtml, greetingName } from "@reactive-resume/resume/cover-letter";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { templates } from "@/dialogs/resume/template/data";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { getStageColor, getStageLabel } from "@/features/applications/stages";
import { useLetterWords } from "@/features/letters/compose";
import { countWords, LETTER_LENGTH, letterLength } from "@/features/letters/length";
import { discardLetterDraft, startLetterDraft, useLetterEditorStore } from "@/features/letters/store";
import { useLetterMode } from "@/features/letters/use-letter-mode";
import { ACCENTS, FONT_PAIRINGS, matchFontPairing, rgbaToHex } from "@/features/resume/editor/design/presets";
import { RichTextEditor } from "@/features/resume/editor/write/rich-text-editor";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

const BODY_ID = "letter-body-editor";

const focusBody = () => window.setTimeout(() => document.getElementById(BODY_ID)?.focus(), 50);

const failed = (error: unknown) =>
	toast.add({
		type: "error",
		description: getOrpcErrorMessage(error, { fallback: t`Couldn't save that change. Try again.` }),
	});

/** Saves what's typed, then changes the letter on the server (links, the application, the resume). */
const updateLetter = (changes: Omit<Parameters<typeof client.coverLetters.update>[0], "id" | "expectedRevision">) =>
	useLetterEditorStore.getState().change((letter) =>
		client.coverLetters.update({
			id: letter.id,
			expectedRevision: letter.revision,
			sessionId: useLetterEditorStore.getState().sessionId,
			...changes,
		}),
	);

type SectionProps = { id: string; title: ReactNode; aside?: ReactNode; children: ReactNode };

function Section({ id, title, aside, children }: SectionProps) {
	return (
		<section aria-labelledby={id} className="grid gap-3 px-4 py-5">
			<div className="flex items-center justify-between gap-3">
				<h2 id={id} className="text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
					{title}
				</h2>
				{aside}
			</div>
			{children}
		</section>
	);
}

/**
 * Write: who the letter is for (the application), to (recipient, company, date) and from (the resume, live or
 * copied), then the body with its length guide and a note on the design. The page beside it updates as you type.
 */
export function LetterWritePanel() {
	const letter = useLetterEditorStore((state) => state.letter);
	const draft = useLetterEditorStore((state) => state.draft);
	const { data: applications } = useQuery(applicationsListQueryOptions());
	if (!letter) return null;

	const application = applications?.find((item) => item.id === letter.sourceApplicationId) ?? null;
	const disabled = letter.isLocked;

	return (
		<div className="divide-y divide-line">
			{letter.isLocked && (
				<p className="flex items-center gap-2 bg-sunken px-4 py-2.5 text-sm text-ink-2">
					<Icon name="lock" size={18} />
					<Trans>This letter is locked. Unlock it from its menu to edit.</Trans>
				</p>
			)}
			<ForSection letter={letter} application={application} applications={applications ?? []} disabled={disabled} />
			<ToSection letter={letter} application={application} disabled={disabled} />
			<FromSection letter={letter} disabled={disabled} />
			<BodySection letter={letter} application={application} disabled={disabled} />
			{/* While a draft shows, the length is the draft's. */}
			<LengthSection content={draft.phase === "streaming" || draft.phase === "ready" ? draft.text : letter.content} />
			<DesignNote letter={letter} />
		</div>
	);
}

type ForSectionProps = {
	letter: CoverLetter;
	application: Application | null;
	applications: Application[];
	disabled: boolean;
};

/** FOR: the application the letter is for. Linking one fills the recipient; without one, drafting uses the resume. */
function ForSection({ letter, application, applications, disabled }: ForSectionProps) {
	const choices = applications.filter((item) => item.status !== "closed" || item.id === application?.id);

	const choose = (next: Application | null) =>
		void updateLetter({
			applicationId: next?.id ?? null,
			// The recipient comes from the application: its company, and its first contact when it has one.
			...(next && letter.layout === "structured"
				? { recipientCompany: next.company, recipientName: next.contacts[0]?.name ?? "" }
				: {}),
		}).catch(failed);

	const menu = (trigger: ReactElement) => (
		<DropdownMenu>
			<DropdownMenuTrigger disabled={disabled} render={trigger} />
			<DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
				{choices.map((item) => (
					<DropdownMenuItem key={item.id} onClick={() => choose(item)}>
						<Icon name="work" />
						<span className="grid min-w-0">
							<span className="truncate">{item.role}</span>
							<span className="truncate text-xs text-ink-3">{item.company}</span>
						</span>
					</DropdownMenuItem>
				))}
				{choices.length === 0 && (
					<p className="px-2 py-1.5 text-sm text-ink-2">
						<Trans>No applications yet. Add one in Applications first.</Trans>
					</p>
				)}
				{application && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => choose(null)}>
							<Icon name="link_off" />
							<Trans>No application</Trans>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<Section id="letter-for" title={<Trans>For</Trans>}>
			{application ? (
				<div className="flex items-center gap-3 rounded-xl border border-line p-3">
					<span
						aria-hidden="true"
						className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken font-semibold text-ink-2"
					>
						{application.company.charAt(0).toUpperCase()}
					</span>
					<span className="grid min-w-0 flex-1">
						<span className="truncate text-sm font-medium">{application.role}</span>
						<span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
							<span className="truncate">{application.company}</span>
							<span aria-hidden="true">·</span>
							<span
								aria-hidden="true"
								className="size-1.5 shrink-0 rounded-full"
								style={{ background: getStageColor(application.status) }}
							/>
							{getStageLabel(application.status)}
						</span>
					</span>
					{menu(
						<Button size="sm" variant="secondary">
							<Trans>Change</Trans>
						</Button>,
					)}
				</div>
			) : (
				<>
					{menu(
						<Button variant="secondary" className="w-full justify-start gap-2">
							<Icon name="work" />
							<Trans>Link an application</Trans>
							<Icon name="expand_more" className="ms-auto text-ink-3" />
						</Button>,
					)}
					<p className="text-xs text-ink-3">
						<Trans>Without one, you fill in the recipient yourself and drafting uses only your resume.</Trans>
					</p>
				</>
			)}
		</Section>
	);
}

type LetterSectionProps = { letter: CoverLetter; application: Application | null; disabled: boolean };

/** TO: name or team, company and date for structured letters; older (freeform) letters keep their recipient block. */
function ToSection({ letter, application, disabled }: LetterSectionProps) {
	const id = useId();
	const edit = useLetterEditorStore((state) => state.edit);

	if (letter.layout === "freeform") {
		return (
			<Section id="letter-to" title={<Trans>To</Trans>}>
				<RichTextEditor
					label={t`Recipient`}
					value={letter.recipient}
					disabled={disabled}
					heightClassName="min-h-[64px] max-h-[200px]"
					onChange={(recipient) => edit({ recipient })}
				/>
				<p className="text-xs text-ink-3">
					<Trans>This letter keeps its recipient as written.</Trans>
				</p>
			</Section>
		);
	}

	return (
		<Section id="letter-to" title={<Trans>To</Trans>}>
			<div className="grid grid-cols-2 gap-3">
				<div className="col-span-2 grid gap-1.5">
					<Label htmlFor={`${id}-name`}>
						<Trans>Name or team</Trans>
					</Label>
					<Input
						id={`${id}-name`}
						value={letter.recipientName}
						maxLength={200}
						placeholder={t`Hiring team`}
						disabled={disabled}
						onChange={(event) => edit({ recipientName: event.target.value })}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-company`}>
						<Trans>Company</Trans>
					</Label>
					<Input
						id={`${id}-company`}
						value={letter.recipientCompany}
						maxLength={200}
						disabled={disabled}
						onChange={(event) => edit({ recipientCompany: event.target.value })}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-date`}>
						<Trans>Date</Trans>
					</Label>
					<Input
						id={`${id}-date`}
						type="date"
						value={letter.letterDate ?? ""}
						disabled={disabled}
						onChange={(event) => edit({ letterDate: event.target.value || null })}
					/>
				</div>
			</div>
			<p className="text-xs text-ink-3">
				{application ? (
					<Trans>Filled from the application. The greeting follows the name.</Trans>
				) : (
					<Trans>The greeting follows the name.</Trans>
				)}
			</p>
		</Section>
	);
}

/** FROM: the resume the sender's details come from, and whether they stay live or are copied into the letter. */
function FromSection({ letter, disabled }: { letter: CoverLetter; disabled: boolean }) {
	const id = useId();
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	const resume = resumes?.find((item) => item.id === letter.sourceResumeId);

	const setResume = (resumeId: string | null) =>
		void updateLetter({
			resumeId,
			// A letter taking a resume for the first time takes its details and design with it.
			...(resumeId && !letter.sourceResumeId ? { senderLinked: true, designLinked: true } : {}),
		}).catch(failed);

	const setLinked = (senderLinked: boolean) =>
		void updateLetter({ senderLinked })
			.then(() =>
				toast.add({
					description: senderLinked ? t`Linked to the resume again` : t`Sender details copied into the letter`,
				}),
			)
			.catch(failed);

	return (
		<Section id="letter-from" title={<Trans>From</Trans>}>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-resume`}>
					<Trans>Resume</Trans>
				</Label>
				<NativeSelect
					id={`${id}-resume`}
					value={letter.sourceResumeId ?? ""}
					disabled={disabled}
					onChange={(event) => setResume(event.target.value || null)}
				>
					<option value="">{t`No resume`}</option>
					{resumes?.map((item) => (
						<option key={item.id} value={item.id}>
							{item.name}
						</option>
					))}
				</NativeSelect>
			</div>
			{letter.sourceResumeId ? (
				<SwitchRow
					label={t`Use details from “${resume?.name ?? t`the resume`}”`}
					description={
						letter.senderLinked
							? t`Linked. Name, email, phone and city update when the resume does.`
							: t`Off. The letter keeps its own copy of your details.`
					}
					checked={letter.senderLinked}
					disabled={disabled}
					onCheckedChange={setLinked}
				/>
			) : (
				<p className="text-xs text-ink-3">
					<Trans>Your name and contact details come from a resume.</Trans>
				</p>
			)}
		</Section>
	);
}

/**
 * The body, edited here while the page updates. Empty, it offers a draft from the posting and the resume. A draft
 * shows on a green wash until it's kept: it never replaces typed text by itself.
 */
function BodySection({ letter, application, disabled }: LetterSectionProps) {
	const words = useLetterWords();
	const edit = useLetterEditorStore((state) => state.edit);
	const draft = useLetterEditorStore((state) => state.draft);
	const [writing, setWriting] = useState(false);
	const structured = letter.layout === "structured";
	const name = greetingName(letter.recipientName);
	const showEditor = writing || countWords(letter.content) > 0;

	return (
		<Section id="letter-body" title={<Trans>Letter</Trans>}>
			{structured && <p className="text-sm text-ink-2">{name ? words.greeting(name) : words.teamGreeting}</p>}

			{draft.phase !== "idle" ? (
				<DraftBox
					draft={draft}
					letter={letter}
					application={application}
					onKeep={(text) => {
						edit({ content: coverLetterTextToHtml(text) });
						discardLetterDraft();
						setWriting(true);
						toast.add({ description: t`Draft kept. Edit anything you like.` });
						focusBody();
					}}
				/>
			) : showEditor ? (
				<RichTextEditor
					id={BODY_ID}
					label={t`Letter body`}
					value={letter.content}
					disabled={disabled}
					heightClassName="min-h-[240px]"
					onChange={(content) => edit({ content })}
				/>
			) : (
				<EmptyBody
					letter={letter}
					application={application}
					disabled={disabled}
					onWrite={() => {
						setWriting(true);
						focusBody();
					}}
				/>
			)}

			{structured && (
				<p className="text-sm text-ink-2">
					{words.signOff}
					{letter.style.basics.name && (
						<>
							<br />
							{letter.style.basics.name}
						</>
					)}
				</p>
			)}
		</Section>
	);
}

type EmptyBodyProps = { letter: CoverLetter; application: Application | null; disabled: boolean; onWrite: () => void };

function EmptyBody({ letter, application, disabled, onWrite }: EmptyBodyProps) {
	const { hasUsableProvider } = useHasUsableAiProvider();
	const hasResume = Boolean(letter.sourceResumeId);
	const company = application?.company;
	const canDraft = hasResume || Boolean(application);

	return (
		<div className="grid justify-items-start gap-3 rounded-xl border border-dashed border-line-2 p-4">
			<p className="text-sm text-ink-2">
				{company && hasResume ? (
					<Trans>Start typing, or draft from what we know: the {company} posting and your resume.</Trans>
				) : company ? (
					<Trans>Start typing, or draft from what we know: the {company} posting.</Trans>
				) : hasResume ? (
					<Trans>Start typing, or draft from what we know: your resume.</Trans>
				) : (
					<Trans>Start typing. To draft one, link a resume or an application first.</Trans>
				)}
			</p>
			<div className="flex flex-wrap gap-1.5">
				{canDraft && hasUsableProvider && (
					<Button
						size="sm"
						disabled={disabled}
						className="bg-accent-soft text-accent-text hover:bg-accent-soft hover:brightness-95"
						onClick={() => void startLetterDraft("draft")}
					>
						<Icon name="auto_awesome" size={16} />
						{application ? <Trans>Draft from the posting</Trans> : <Trans>Draft from your resume</Trans>}
					</Button>
				)}
				<Button size="sm" variant="ghost" disabled={disabled} onClick={onWrite}>
					<Trans>Write it myself</Trans>
				</Button>
			</div>
			{canDraft && !hasUsableProvider && (
				<p className="text-xs text-ink-3">
					<Trans>Drafting needs an AI provider.</Trans>{" "}
					<Link to="/dashboard/settings/ai" className={buttonVariants({ variant: "link", size: "sm" })}>
						<Trans>Open AI settings</Trans>
					</Link>
				</p>
			)}
		</div>
	);
}

type DraftBoxProps = {
	draft: Exclude<LetterDraft, { phase: "idle" }>;
	letter: CoverLetter;
	application: Application | null;
	onKeep: (text: string) => void;
};

/** The draft on its green wash, then the dark chip: Keep, Shorter, More personal, Discard. */
function DraftBox({ draft, letter, application, onKeep }: DraftBoxProps) {
	const reducedMotion = useReducedMotion();
	// Retrying repeats the last request.
	const last = useRef<{ variant: "draft" | "shorter" | "personal"; previous?: string }>({ variant: "draft" });
	const run = (variant: "draft" | "shorter" | "personal", previous?: string) => {
		last.current = previous ? { variant, previous } : { variant };
		void startLetterDraft(variant, previous);
	};

	if (draft.phase === "failed") {
		const gateway = draft.error instanceof ORPCError && draft.error.code === "BAD_GATEWAY";
		return (
			<div role="alert" className="grid gap-2.5 rounded-xl bg-danger-soft p-3 text-[13px] text-danger-text">
				<span className="flex gap-2">
					<Icon name="error" size={18} className="shrink-0" />
					{gateway && draft.provider ? (
						<Trans>Drafting stopped: {draft.provider} didn't respond. Nothing on the page changed.</Trans>
					) : (
						<Trans>Drafting stopped. Nothing on the page changed.</Trans>
					)}
				</span>
				<div className="flex gap-1.5">
					<Button size="sm" variant="secondary" onClick={() => run(last.current.variant, last.current.previous)}>
						<Trans>Try again</Trans>
					</Button>
					<Button size="sm" variant="ghost" onClick={discardLetterDraft}>
						<Trans>Dismiss</Trans>
					</Button>
				</div>
			</div>
		);
	}

	const streaming = draft.phase === "streaming";
	// Reduced motion shows the whole draft at once.
	const text = streaming && reducedMotion ? "" : draft.text;
	const sources =
		letter.sourceResumeId && application
			? t`Draft · uses only your resume and the posting`
			: application
				? t`Draft · uses only the posting`
				: t`Draft · uses only your resume`;

	return (
		<div className="grid gap-2">
			<div
				aria-live="polite"
				aria-busy={streaming}
				className={cn(
					"min-h-[120px] rounded-lg bg-accent-soft px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap outline-[1.5px] transition-[outline-color] duration-standard outline-solid",
					draft.phase === "ready" ? "outline-accent" : "outline-transparent",
				)}
			>
				{text}
				{streaming && (
					<span className="text-ink-3">
						{reducedMotion ? <Trans>Drafting…</Trans> : <span aria-hidden="true">▍</span>}
					</span>
				)}
			</div>
			{streaming && (
				<Button size="sm" variant="ghost" className="w-fit" onClick={discardLetterDraft}>
					<Trans>Stop</Trans>
				</Button>
			)}
			{draft.phase === "ready" && (
				<div
					className={cn(ENTER_CLASS, "flex flex-wrap items-center gap-1 rounded-xl bg-ink p-1 ps-3 text-bg shadow-e3")}
				>
					<span className="me-auto flex items-center gap-1.5 py-1 text-[13px] font-medium">
						<Icon name="auto_awesome" size={16} />
						{sources}
					</span>
					<button
						type="button"
						onClick={() => onKeep(draft.text)}
						className="h-8 rounded-lg bg-accent px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-hover"
					>
						<Trans>Keep</Trans>
					</button>
					{(
						[
							["shorter", t`Shorter`],
							["personal", t`More personal`],
						] as const
					).map(([variant, label]) => (
						<button
							key={variant}
							type="button"
							onClick={() => run(variant, draft.text)}
							className="h-8 rounded-lg px-2.5 text-[13px] hover:bg-[oklch(1_0_0/0.12)]"
						>
							{label}
						</button>
					))}
					<button
						type="button"
						onClick={discardLetterDraft}
						className="h-8 rounded-lg px-2.5 text-[13px] hover:bg-[oklch(1_0_0/0.12)]"
					>
						<Trans>Discard</Trans>
					</button>
				</div>
			)}
		</div>
	);
}

/** Length: the word count against the 180 to 320 band most recruiters read, as a hint rather than a rule. */
function LengthSection({ content }: { content: string }) {
	const words = countWords(content);
	const length = letterLength(words);
	const color = length === "empty" ? "text-ink-3" : length === "comfortable" ? "text-accent-text" : "text-warn-text";
	const fill = length === "empty" ? "bg-line-2" : length === "comfortable" ? "bg-accent" : "bg-warn";
	const percent = (value: number) => `${(value / LETTER_LENGTH.scale) * 100}%`;

	return (
		<Section
			id="letter-length"
			title={<Trans>Length</Trans>}
			aside={
				<span className={cn("font-mono text-xs font-medium", color)}>
					<Plural value={words} one="# word" other="# words" />
				</span>
			}
		>
			<div aria-hidden="true" className="relative h-1.5 overflow-hidden rounded-full bg-sunken">
				<span
					className="absolute inset-y-0 bg-line-2"
					style={{
						insetInlineStart: percent(LETTER_LENGTH.min),
						width: percent(LETTER_LENGTH.max - LETTER_LENGTH.min),
					}}
				/>
				<span
					className={cn(
						"absolute inset-y-0 start-0 w-full translate-x-(--fill) rounded-full transition-[translate] duration-quick ease-enter rtl:-translate-x-(--fill)",
						fill,
					)}
					style={
						{
							"--fill": `${(Math.min(words, LETTER_LENGTH.scale) / LETTER_LENGTH.scale) * 100 - 100}%`,
						} as CSSProperties
					}
				/>
			</div>
			<p className="text-xs text-ink-3">
				{length === "empty" ? (
					<Trans>Most recruiters read 180–320 words. The shaded band shows the range.</Trans>
				) : length === "short" ? (
					<Trans>Short and direct. Fine if the posting asks for brevity.</Trans>
				) : length === "comfortable" ? (
					<Trans>A comfortable length, and it fits on one page.</Trans>
				) : (
					<Trans>Getting long. Try “Shorter”, or cut the least specific paragraph.</Trans>
				)}
			</p>
		</Section>
	);
}

/** DESIGN: what the letter looks like, and where to change it. */
function DesignNote({ letter }: { letter: CoverLetter }) {
	const [, setMode] = useLetterMode();
	const { metadata } = letter.style;
	const pairing = FONT_PAIRINGS.find((option) => option.id === matchFontPairing(metadata))?.label;
	const accent = ACCENTS.find((option) => option.hex === rgbaToHex(metadata.design.colors.primary))?.label;
	const summary = [templates[metadata.template].name, pairing && t`${pairing} type`, accent].filter(Boolean).join(", ");

	return (
		<Section id="letter-design" title={<Trans>Design</Trans>}>
			<p className="text-sm text-ink-2">
				{letter.designLinked ? (
					<Trans>Matches the resume ({summary}).</Trans>
				) : (
					<Trans>Its own design ({summary}).</Trans>
				)}{" "}
				<button
					type="button"
					onClick={() => setMode("design")}
					className="font-medium text-accent-text underline underline-offset-2"
				>
					<Trans>Change it in Design.</Trans>
				</button>
			</p>
		</Section>
	);
}
