import type { ApplicationSummary } from "@/features/applications/types";
import type { LetterDraft } from "@/features/letters/store";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import type { ReactElement, ReactNode } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import { Fragment, useId, useRef, useState } from "react";
import { coverLetterTextToHtml, defaultCoverLetterSignOff, greetingName } from "@reactive-resume/resume/cover-letter";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Switch } from "@reactive-resume/ui/components/switch";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { useLetterActions } from "./letter-bar";
import { List, ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import { templates } from "@/dialogs/resume/template/data";
import { SetUpAi } from "@/features/ai/set-up-ai";
import { AiResultUsage } from "@/features/ai/usage";
import { getDisplayLane, getLaneLabel } from "@/features/applications/lanes";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useApplicationLanes } from "@/features/applications/use-application-lanes";
import { useLetterWords } from "@/features/letters/compose";
import { countWords, LETTER_LENGTH, letterLength } from "@/features/letters/length";
import {
	discardLetterDraft,
	dismissLetterDraftFailure,
	startLetterDraft,
	stopLetterDraft,
	useLetterEditorStore,
} from "@/features/letters/store";
import { useLetterMode } from "@/features/letters/use-letter-mode";
import { PanelBody, PanelFoot } from "@/features/resume/editor/chrome/panel";
import { ACCENTS, FONT_PAIRINGS, matchFontPairing, rgbaToHex } from "@/features/resume/editor/design/presets";
import { useEditorStore } from "@/features/resume/editor/store";
import { CustomFields } from "@/features/resume/editor/write/basics-card";
import { TextField, validateEmail, WebsiteField } from "@/features/resume/editor/write/fields";
import { RichTextEditor } from "@/features/resume/editor/write/rich-text-editor";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getAccountGeneration } from "@/libs/auth/account-scope";
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

type SectionProps = {
	id: string;
	title: ReactNode;
	note?: ReactNode;
	action?: ReactNode;
	first?: boolean;
	children: ReactNode;
};

/** A part of the panel under its 22px serif heading (`SectionHeading`), rows and fields 12px apart. */
function Section({ id, title, note, action, first = false, children }: SectionProps) {
	return (
		<section aria-labelledby={id} className="flex flex-col">
			<SectionHeading id={id} note={note} action={action} className={first ? "pt-6" : undefined}>
				{title}
			</SectionHeading>
			<div className="flex flex-col gap-3">{children}</div>
		</section>
	);
}

/**
 * Write (L1): the application the letter is for, its recipient and sender, then the body with its greeting, sign-off
 * and length. The page beside it updates as you type. A locked letter reads as five plain lines (L5).
 */
export function LetterWritePanel() {
	const letter = useLetterEditorStore((state) => state.letter);
	const draft = useLetterEditorStore((state) => state.draft);
	const status = useLetterEditorStore((state) => state.status);
	const { data: applications } = useQuery(applicationsListQueryOptions());
	// While History shows an older version on the page, Write would edit the current letter beside it: hold it.
	const viewingVersion = useEditorStore((state) => state.historyVersionId !== null);
	if (!letter) return null;

	const application = applications?.find((item) => item.id === letter.sourceApplicationId) ?? null;
	// While the letter changed elsewhere, typing would only pile onto edits that can't save. Reload first.
	const conflict = status === "conflict";
	const disabled = letter.isLocked || conflict || viewingVersion;

	if (letter.isLocked) return <LockedLetter letter={letter} application={application} />;

	return (
		<PanelBody className="pb-0">
			{viewingVersion && (
				<p className="mb-4 flex items-center gap-2.5 rounded-md bg-sunken px-3.5 py-3 t-small text-ink-2">
					<Icon name="clock-counter-clockwise" size={18} className="shrink-0" />
					<Trans>You're viewing an earlier version. Go back to now in History to edit.</Trans>
				</p>
			)}
			{conflict && (
				<p className="mb-4 flex items-center gap-2.5 rounded-md bg-warn-soft px-3.5 py-3 t-small text-warn-text">
					<Icon name="cloud-warning" size={18} className="shrink-0" />
					<Trans>This letter changed in another tab. Reload above to keep editing; your edits stay in a copy.</Trans>
				</p>
			)}
			<ForSection letter={letter} application={application} applications={applications ?? []} disabled={disabled} />
			{/* While a draft is up, the panel holds only the decision (L4). */}
			{draft.phase === "idle" && <ToSection letter={letter} application={application} disabled={disabled} />}
			{draft.phase === "idle" && <FromSection letter={letter} disabled={disabled} />}
			<BodySection
				letter={letter}
				application={application}
				disabled={disabled}
				// While a draft shows, the length is the draft's.
				lengthOf={draft.phase === "streaming" || draft.phase === "ready" ? draft.text : letter.content}
			/>
			{/* While a draft is up the panel holds only the decision (L4). */}
			{draft.phase === "idle" && <DesignNote letter={letter} />}
		</PanelBody>
	);
}

type LockedLetterProps = { letter: CoverLetter; application: ApplicationSummary | null };

/**
 * L5: a locked letter reads as it went out. The note holds Unlock; the fields become five plain lines; the version
 * sent is one row away; the next step is a copy that opens unlocked.
 */
function LockedLetter({ letter, application }: LockedLetterProps) {
	const { i18n } = useLingui();
	const { lanes } = useApplicationLanes();
	const { duplicate, setLocked } = useLetterActions();
	const [unlocking, setUnlocking] = useState(false);
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	const { data: versions } = useQuery(orpc.coverLetters.listVersions.queryOptions({ input: { id: letter.id } }));
	const lane = application ? getDisplayLane(lanes, application) : null;
	const sent = application?.sentCoverLetterVersionId && application.coverLetterId === letter.id ? application : null;
	const sentVersion = versions?.find((version) => version.id === sent?.sentCoverLetterVersionId);
	const resume = resumes?.find((item) => item.id === letter.sourceResumeId);
	const company = sent?.company ?? "";
	const sentOn = sent?.appliedAt ? i18n.date(sent.appliedAt, { day: "numeric", month: "short" }) : "";
	const dateLabel = letter.letterDate
		? i18n.date(new Date(`${letter.letterDate}T00:00:00`), { day: "numeric", month: "long", year: "numeric" })
		: t`Not set`;
	const language = (() => {
		try {
			return new Intl.DisplayNames([i18n.locale], { type: "language" }).of(letter.style.metadata.page.locale);
		} catch {
			return letter.style.metadata.page.locale;
		}
	})();
	const words = countWords(letter.content);
	const pages = useEditorStore((state) => Math.max(1, state.rendered.pageCount));
	const recipient = [letter.recipientName || t`Hiring team`, letter.recipientCompany].filter(Boolean).join(" · ");

	const rows: [ReactNode, ReactNode][] = [
		[<Trans key="to">To</Trans>, letter.layout === "structured" ? recipient : t`As written on the page`],
		[<Trans key="date">Date</Trans>, dateLabel],
		[
			<Trans key="from">From</Trans>,
			resume ? (letter.senderLinked ? t`Details from “${resume.name}”` : t`Its own details`) : t`Its own details`,
		],
		[<Trans key="language">Language</Trans>, language],
		[
			<Trans key="length">Length</Trans>,
			<>
				<Plural value={words} one="# word" other="# words" />
				{" · "}
				<Plural value={pages} one="# page" other="# pages" />
			</>,
		],
	];

	return (
		<PanelBody className="pb-0">
			<div role="status" className="flex flex-col gap-1 rounded-lg bg-sunken px-3.5 pt-3 pb-3.5">
				<div className="flex items-center gap-2.5">
					<Icon name="lock-simple" size={18} className="shrink-0 text-ink-2" />
					<span className="flex-1 text-sm/5 font-semibold">
						<Trans>This letter is locked.</Trans>
					</span>
					<Button
						size="sm"
						variant="secondary"
						loading={unlocking}
						onClick={() => {
							setUnlocking(true);
							void setLocked(false).finally(() => setUnlocking(false));
						}}
					>
						<Trans>Unlock</Trans>
					</Button>
				</div>
				{sent && (
					<span className="t-small text-ink-2">
						<Trans>
							It is recorded as sent to {company} on {sentOn}. Its application link stays with that submission.
						</Trans>
					</span>
				)}
			</div>

			{application && (
				<div className="mt-3.5">
					<ApplicationRow
						application={application}
						letter={letter}
						color={lane?.color}
						stage={lane ? getLaneLabel(lane) : undefined}
					/>
				</div>
			)}

			<dl className="mt-[13px] grid grid-cols-[92px_minmax(0,1fr)]">
				{rows.map(([label, value], index) => (
					<Fragment key={index}>
						<dt className="border-b border-line py-2.5 text-sm/5 text-ink-3">{label}</dt>
						<dd className="truncate border-b border-line py-2.5 text-sm/5 text-ink">{value}</dd>
					</Fragment>
				))}
			</dl>

			{sentVersion && (
				<List className="mt-3.5">
					<ListRow
						render={
							<button
								type="button"
								onClick={() => {
									useEditorStore.getState().setHistoryOpen(true);
									useEditorStore.setState({ historyVersionId: sentVersion.id });
								}}
							/>
						}
						leading={<Icon name="paper-plane-tilt" size={20} className="text-ink-3" />}
						title={<Trans>The version sent</Trans>}
						subtitle={
							<Trans>
								{i18n.date(sentVersion.createdAt, { weekday: "short", day: "numeric", month: "short" })} · kept in
								History
							</Trans>
						}
						caret
					/>
				</List>
			)}

			<div className="mt-auto flex flex-col gap-2 border-t border-line pt-3 pb-5">
				<Button variant="secondary" className="w-fit" onClick={() => void duplicate()}>
					<Icon name="copy" />
					<Trans>Duplicate as a new letter</Trans>
				</Button>
				<p className="text-xs/4 text-ink-3">
					<Trans>
						Start the next one from this. The copy opens unlocked, with its own recipient, date and history.
					</Trans>
				</p>
			</div>
		</PanelBody>
	);
}

/** Today's date in the person's own time zone, as `YYYY-MM-DD`. */
const todayDate = () => new Date().toLocaleDateString("en-CA");

type ForSectionProps = {
	letter: CoverLetter;
	application: ApplicationSummary | null;
	applications: ApplicationSummary[];
	disabled: boolean;
};

/** FOR: the application the letter is for. Linking one fills the recipient; without one, drafting uses the resume. */
function ForSection({ letter, application, applications, disabled }: ForSectionProps) {
	const { lanes } = useApplicationLanes();
	const lane = application ? getDisplayLane(lanes, application) : null;
	const submitted = Boolean(application?.sentCoverLetterVersionId && application.coverLetterId === letter.id);
	const choices = applications.filter((item) => item.status !== "closed" || item.id === application?.id);

	const choose = (next: ApplicationSummary | null) =>
		void updateLetter({
			applicationId: next?.id ?? null,
			// The recipient comes from the application: its company, and its first contact when it has one.
			...(next && letter.layout === "structured"
				? { recipientCompany: next.company, recipientName: next.contacts[0]?.name ?? "" }
				: {}),
		}).catch(failed);

	const menu = (trigger: ReactElement) => (
		<DropdownMenu>
			<DropdownMenuTrigger disabled={disabled || submitted} render={trigger} />
			<DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
				{choices.map((item) => (
					<DropdownMenuItem
						key={item.id}
						disabled={Boolean(item.sentCoverLetterVersionId && item.coverLetterId !== letter.id)}
						className="data-disabled:opacity-60"
						onClick={() => choose(item)}
					>
						<Icon name="briefcase" />
						<span className="grid min-w-0">
							<span className="truncate">{item.role}</span>
							<span className="truncate text-xs text-ink-3">{item.company}</span>
							{item.sentCoverLetterVersionId && item.coverLetterId !== letter.id && (
								<span className="text-xs text-ink-3">
									<Trans>Letter already sent</Trans>
								</span>
							)}
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
							<Icon name="link-simple-horizontal-break" />
							<Trans>No application</Trans>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<section aria-label={t`Application`} className="flex flex-col">
			{application ? (
				<ApplicationRow
					application={application}
					letter={letter}
					color={lane?.color}
					stage={lane ? getLaneLabel(lane) : undefined}
					change={menu}
				/>
			) : (
				<div className="flex items-start gap-3 border-b border-line pb-3">
					<span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-line-2" />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="text-[15px]/[22px] font-medium text-ink">
							<Trans>Not linked to a job</Trans>
						</span>
						<span className="t-small text-ink-3">
							<Trans>Without one, you fill in the recipient yourself and drafting uses only your resume.</Trans>
						</span>
					</span>
					{menu(
						<Button size="sm" variant="secondary">
							<Trans>Link an application</Trans>
						</Button>,
					)}
				</div>
			)}
		</section>
	);
}

type ApplicationRowProps = {
	application: ApplicationSummary;
	letter: CoverLetter;
	color: string | undefined;
	stage: string | undefined;
	/** Wraps the title in the menu that changes the application. */
	change?: (trigger: ReactElement) => ReactNode;
};

/** The job the letter is for: stage dot, company and role, where it stands, and Open (J3). */
function ApplicationRow({ application, letter, color, stage, change }: ApplicationRowProps) {
	const { i18n } = useLingui();
	const sent = Boolean(application.sentCoverLetterVersionId && application.coverLetterId === letter.id);
	const sentOn =
		sent && application.appliedAt ? i18n.date(application.appliedAt, { day: "numeric", month: "short" }) : null;
	const company = application.company;
	const role = application.role;

	return (
		<div className="flex items-center gap-3 border-b border-line pt-0.5 pb-3">
			<span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-line-2" style={{ background: color }} />
			<span className="flex min-w-0 flex-1 flex-col">
				{change ? (
					change(
						<button
							type="button"
							title={t`Change application`}
							className="truncate rounded-xs text-start text-[15px]/[22px] font-medium text-ink hover:underline"
						>
							<Trans>
								For {company} · {role}
							</Trans>
						</button>,
					)
				) : (
					<span className="truncate text-[15px]/[22px] font-medium text-ink">
						<Trans>
							For {company} · {role}
						</Trans>
					</span>
				)}
				<span className="truncate t-small text-ink-3">
					{sentOn ? (
						<Trans>
							{stage} · letter sent {sentOn}
						</Trans>
					) : (
						<Trans>{stage} · not applied yet</Trans>
					)}
				</span>
			</span>
			<Link
				to="/dashboard/applications/$applicationId"
				params={{ applicationId: application.id }}
				className="rounded-xs text-sm font-medium text-accent-text hover:underline"
			>
				<Trans>Open</Trans>
			</Link>
		</div>
	);
}

type LetterSectionProps = { letter: CoverLetter; application: ApplicationSummary | null; disabled: boolean };

/** TO: name or team, company and date for structured letters; older (freeform) letters keep their recipient block. */
function ToSection({ letter, application, disabled }: LetterSectionProps) {
	const id = useId();
	const edit = useLetterEditorStore((state) => state.edit);

	if (letter.layout === "freeform") {
		return (
			<Section id="letter-to" title={<Trans>Recipient</Trans>} first>
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
		<Section id="letter-to" title={<Trans>Recipient</Trans>} first>
			<div className="mt-1 grid grid-cols-2 gap-3">
				<div className="grid gap-2">
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
				<div className="grid gap-2">
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
			</div>
			<p className="-mt-1.5 text-xs/4 text-ink-3">
				{greetingName(letter.recipientName) ? (
					application ? (
						<Trans>Filled from the application. The greeting follows the name.</Trans>
					) : (
						<Trans>The greeting follows the name.</Trans>
					)
				) : (
					<Trans>No name yet, so the greeting reads “Dear hiring team”.</Trans>
				)}
			</p>
			{/* The hint belongs to the name above it; the date the page prints comes after. */}
			<LetterDateField letter={letter} disabled={disabled} />
		</Section>
	);
}

/**
 * The letter's date as it prints ("7 November 2026"), with Today: a letter reused later should carry the day it's
 * sent. The native date input lies over the field, so typing and the browser's picker still work.
 */
function LetterDateField({ letter, disabled }: { letter: CoverLetter; disabled: boolean }) {
	const id = useId();
	const edit = useLetterEditorStore((state) => state.edit);
	const words = useLetterWords(letter.style.metadata.page.locale);
	return (
		<div className="grid gap-2">
			<Label htmlFor={`${id}-date`}>
				<Trans>Date</Trans>
			</Label>
			<div className="flex items-center gap-2">
				<div
					className={cn(
						"relative flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md border border-control-border bg-raised px-[11px] text-sm text-ink transition-[border-color,box-shadow] duration-quick pointer-coarse:h-11",
						"has-[input:focus]:border-accent has-[input:focus]:shadow-[0_0_0_3px_var(--accent-soft)]",
						disabled && "bg-sunken text-ink-3",
					)}
				>
					<Icon name="calendar-blank" size={18} className="shrink-0 text-ink-3" />
					<span aria-hidden="true" className={cn("truncate", !letter.letterDate && "text-ink-3")}>
						{letter.letterDate ? words.formatDate(letter.letterDate) : t`No date`}
					</span>
					<input
						id={`${id}-date`}
						type="date"
						value={letter.letterDate ?? ""}
						disabled={disabled}
						className="absolute inset-0 cursor-pointer opacity-0"
						onClick={(event) => {
							try {
								event.currentTarget.showPicker();
							} catch {
								// Some browsers open it themselves, or not at all; typing still works.
							}
						}}
						onChange={(event) => edit({ letterDate: event.target.value || null })}
					/>
				</div>
				<Button
					variant="secondary"
					className="shrink-0"
					disabled={disabled}
					onClick={() => edit({ letterDate: todayDate() })}
				>
					<Trans>Today</Trans>
				</Button>
			</div>
		</div>
	);
}

/** FROM: the resume the sender's details come from, and whether they stay live or are copied into the letter. */
type FromSectionProps = { letter: CoverLetter; disabled: boolean };

function FromSection({ letter, disabled: readOnly }: FromSectionProps) {
	const disabled = useLetterEditorStore((state) => state.changing) || readOnly;
	const edit = useLetterEditorStore((state) => state.edit);
	const id = useId();
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	const resume = resumes?.find((item) => item.id === letter.sourceResumeId);
	// A linked letter names its resume in the switch; the list opens from Change.
	const [choosing, setChoosing] = useState(false);
	const showResumes = choosing || !letter.sourceResumeId;

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
		<Section id="letter-from" title={<Trans>Sender</Trans>}>
			{letter.sourceResumeId ? (
				<ListRow
					wrap
					title={
						<button
							type="button"
							aria-label={t`Change resume`}
							disabled={disabled}
							className="rounded-xs text-start hover:underline"
							onClick={() => setChoosing(!choosing)}
						>
							<Trans>Use details from “{resume?.name ?? t`the resume`}”</Trans>
						</button>
					}
					subtitle={
						letter.senderLinked
							? t`Linked. The header (name, contact details, links and photo) updates when the resume does.`
							: t`Off. Edit this letter’s details below. Turning this on replaces them with the resume’s current details.`
					}
					trailing={
						<Switch
							aria-label={t`Use details from “${resume?.name ?? t`the resume`}”`}
							checked={letter.senderLinked}
							disabled={disabled}
							onCheckedChange={setLinked}
							className="mt-px"
						/>
					}
					className="items-start border-b-0 py-2.5"
				/>
			) : (
				<p className="t-small text-ink-3">
					<Trans>Enter your details below. Choosing a resume replaces them and links its design.</Trans>
				</p>
			)}
			{(!letter.sourceResumeId || !letter.senderLinked) && (
				<fieldset disabled={disabled} className="grid min-w-0 grid-cols-2 gap-3">
					<SenderPhoto picture={letter.style.picture} disabled={disabled} />
					<TextField
						label={<Trans>Full name</Trans>}
						wide
						autoComplete="name"
						value={letter.style.basics.name}
						onChange={(name) => edit({ sender: { name } })}
					/>
					<TextField
						label={<Trans>Headline</Trans>}
						wide
						value={letter.style.basics.headline}
						onChange={(headline) => edit({ sender: { headline } })}
					/>
					<TextField
						label={<Trans>Email</Trans>}
						wide
						type="email"
						autoComplete="email"
						validate={validateEmail}
						value={letter.style.basics.email}
						onChange={(email) => edit({ sender: { email } })}
					/>
					<TextField
						label={<Trans>Phone</Trans>}
						type="tel"
						autoComplete="tel"
						value={letter.style.basics.phone}
						onChange={(phone) => edit({ sender: { phone } })}
					/>
					<TextField
						label={<Trans>Location</Trans>}
						value={letter.style.basics.location}
						onChange={(location) => edit({ sender: { location } })}
					/>
					<WebsiteField
						label={<Trans>Website</Trans>}
						value={letter.style.basics.website}
						allowInlineLink={false}
						onChange={(website) => edit({ sender: { website: { url: website.url, label: website.label } } })}
					/>
					<CustomFields
						fields={letter.style.basics.customFields}
						locked={disabled}
						edit={(_key, mutate) => {
							// The latest list, so quick edits in a row build on each other.
							const fields = useLetterEditorStore.getState().letter?.style.basics.customFields ?? [];
							const customFields = structuredClone(fields);
							mutate(customFields);
							edit({ sender: { customFields } });
						}}
					/>
				</fieldset>
			)}
			{showResumes && (
				<div className="grid gap-2">
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
			)}
		</Section>
	);
}

type SenderPhotoProps = { picture: CoverLetter["style"]["picture"]; disabled: boolean };

/** The photo the letter copied from its resume, which it can leave off. Uploading one is the resume's job. */
function SenderPhoto({ picture, disabled }: SenderPhotoProps) {
	const edit = useLetterEditorStore((state) => state.edit);
	if (!picture.url) return null;

	return (
		<div className="col-span-full flex items-center gap-3 rounded-lg bg-bg p-2.5">
			<img src={picture.url} alt="" className="size-10 shrink-0 rounded-md object-cover" />
			<p className="min-w-0 flex-1 text-xs leading-4 text-ink-2">
				{picture.hidden ? <Trans>Photo hidden from the page.</Trans> : <Trans>Photo on the page.</Trans>}
			</p>
			<Switch
				aria-label={t`Show photo`}
				checked={!picture.hidden}
				disabled={disabled}
				onCheckedChange={(shown) => edit({ sender: { picture: { hidden: !shown } } })}
			/>
		</div>
	);
}

/**
 * The body, edited here while the page updates. Empty, it offers a draft from the posting and the resume. A draft
 * shows on a green wash until it's kept: it never replaces typed text by itself.
 */
function BodySection({ letter, application, disabled, lengthOf }: LetterSectionProps & { lengthOf: string }) {
	const account = getAccountGeneration();
	const sessionId = useLetterEditorStore.getState().sessionId;
	const words = useLetterWords(letter.style.metadata.page.locale);
	const edit = useLetterEditorStore((state) => state.edit);
	const draft = useLetterEditorStore((state) => state.draft);
	const [writing, setWriting] = useState(false);
	const structured = letter.layout === "structured";
	const name = greetingName(letter.recipientName);
	const showEditor = writing || countWords(letter.content) > 0;
	const count = countWords(lengthOf);
	const paragraphs = (lengthOf.match(/<p[\s>]/g) ?? []).length || (count > 0 ? 1 : 0);
	const { hasUsableProvider } = useHasUsableAiProvider();
	const canDraft = Boolean(letter.sourceResumeId || application);

	const keep = (text: string, aiOperationIds: string[]) => {
		const current = useLetterEditorStore.getState();
		if (
			getAccountGeneration() !== account ||
			current.sessionId !== sessionId ||
			current.letter?.id !== letter.id ||
			current.letter.revision !== letter.revision ||
			draft.phase !== "ready" ||
			current.draft !== draft ||
			current.letter.isLocked
		)
			return;
		edit({ content: coverLetterTextToHtml(text), aiOperationIds });
		discardLetterDraft();
		setWriting(true);
		toast.add({ description: t`Draft kept. Edit anything you like.` });
		focusBody();
	};

	if (draft.phase !== "idle")
		return (
			<>
				<DraftBox draft={draft} letter={letter} application={application} onKeep={keep} />
				<section aria-labelledby="letter-length" className="flex flex-col">
					<SectionHeading id="letter-length" note={<Plural value={count} one="# word" other="# words" />}>
						<Trans>Length</Trans>
					</SectionHeading>
					<LengthLine content={lengthOf} scale />
				</section>
				{structured && (
					<Section id="letter-framing" title={<Trans>Greeting and sign-off</Trans>}>
						<div className="grid grid-cols-2 gap-3">
							<LetterFramingField
								letter={letter}
								field="greeting"
								defaultValue={name ? words.greeting(name) : words.teamGreeting}
								disabled={disabled}
								compact
							/>
							<LetterFramingField
								letter={letter}
								field="signOff"
								defaultValue={defaultCoverLetterSignOff(letter, words)}
								disabled={disabled}
								compact
							/>
						</div>
						<p className="-mt-1.5 text-xs/4 text-ink-3">
							<Trans>
								The greeting follows the recipient's name. Clear either one to leave it out; clearing the sign-off also
								removes your name under it.
							</Trans>
						</p>
					</Section>
				)}
			</>
		);

	const body = (
		<Section
			id="letter-body"
			title={<Trans>Letter</Trans>}
			note={
				count > 0 ? (
					<>
						<Plural value={paragraphs} one="# paragraph" other="# paragraphs" />
						{" · "}
						<Plural value={count} one="# word" other="# words" />
					</>
				) : undefined
			}
		>
			{draft.phase === "idle" && showEditor && canDraft && hasUsableProvider && (
				<div className="flex flex-col items-start gap-1.5">
					<Button variant="soft" size="sm" disabled={disabled} onClick={() => void startLetterDraft("draft")}>
						<Icon name="sparkle" />
						{application ? <Trans>Draft from the posting</Trans> : <Trans>Draft from your resume</Trans>}
					</Button>
					<p className="self-stretch text-xs/4 text-ink-3">
						<Trans>Proposes a draft. Your text stays until you accept.</Trans>
					</p>
				</div>
			)}

			{showEditor ? (
				<RichTextEditor
					id={BODY_ID}
					label={t`Letter body`}
					value={letter.content}
					disabled={disabled}
					heightClassName="min-h-[240px]"
					improve={{ letter: true, applicationId: application?.id }}
					onChange={(content, options) => {
						const current = useLetterEditorStore.getState();
						if (
							getAccountGeneration() !== account ||
							current.sessionId !== sessionId ||
							current.letter?.id !== letter.id ||
							current.letter.isLocked
						)
							return;
						edit({
							content,
							...(options?.aiOperationIds?.length || options?.removedAiOperationIds?.length
								? {
										aiOperationIds: [
											...new Set([...(current.letter.aiOperationIds ?? []), ...(options.aiOperationIds ?? [])]),
										].filter((id) => !options.removedAiOperationIds?.includes(id)),
									}
								: {}),
						});
					}}
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

			{(letter.aiOperationIds?.length ?? 0) > 0 && <AiResultUsage usage={letter.aiUsage} />}

			<LengthLine content={lengthOf} />
		</Section>
	);

	return structured ? (
		<>
			{body}
			<Section id="letter-framing" title={<Trans>Greeting and sign-off</Trans>}>
				<LetterFramingField
					letter={letter}
					field="greeting"
					defaultValue={name ? words.greeting(name) : words.teamGreeting}
					disabled={disabled}
				/>
				<LetterFramingField
					letter={letter}
					field="signOff"
					defaultValue={defaultCoverLetterSignOff(letter, words)}
					disabled={disabled}
				/>
				<p className="-mt-1.5 text-xs/4 text-ink-3">
					<Trans>
						Clear the greeting or sign-off to omit it. Clearing the sign-off also removes the automatic signature.
					</Trans>
				</p>
			</Section>
		</>
	) : (
		body
	);
}

type LetterFramingFieldProps = {
	letter: CoverLetter;
	field: "greeting" | "signOff";
	defaultValue: string;
	disabled: boolean;
	/** One line, two to a row (L4). */
	compact?: boolean;
};

function LetterFramingField({ letter, field, defaultValue, disabled, compact = false }: LetterFramingFieldProps) {
	const id = useId();
	const edit = useLetterEditorStore((state) => state.edit);
	return (
		<div className="grid gap-2">
			<div className="flex h-5 items-center justify-between gap-2">
				<Label htmlFor={id} className="flex-1">
					{field === "greeting" ? <Trans>Greeting</Trans> : <Trans>Sign-off</Trans>}
				</Label>
				{letter[field] !== null && !compact && (
					<button
						type="button"
						disabled={disabled}
						className="rounded-xs text-[13px]/[18px] font-medium text-accent-text hover:underline disabled:opacity-60"
						onClick={() => edit({ [field]: null })}
					>
						<Trans>Use default</Trans>
					</button>
				)}
			</div>
			{compact ? (
				<Input
					id={id}
					value={letter[field] ?? defaultValue}
					maxLength={2_000}
					disabled={disabled}
					onChange={(event) => edit({ [field]: event.target.value })}
				/>
			) : (
				<Textarea
					id={id}
					value={letter[field] ?? defaultValue}
					maxLength={2_000}
					rows={1}
					disabled={disabled}
					className="min-h-10"
					onChange={(event) => edit({ [field]: event.target.value })}
				/>
			)}
		</div>
	);
}

type EmptyBodyProps = {
	letter: CoverLetter;
	application: ApplicationSummary | null;
	disabled: boolean;
	onWrite: () => void;
};

function EmptyBody({ letter, application, disabled, onWrite }: EmptyBodyProps) {
	const providerState = useHasUsableAiProvider();
	const { hasUsableProvider } = providerState;
	const hasResume = Boolean(letter.sourceResumeId);
	const company = application?.company;
	const canDraft = hasResume || Boolean(application);

	return (
		<div className="grid justify-items-start gap-3">
			<p className="t-body text-ink-2">
				{/* Without a provider, drafting isn't on offer yet: say what would make it so. */}
				{canDraft && !providerState.isUnavailable && !hasUsableProvider ? (
					company && hasResume ? (
						<Trans>Start typing, or connect an AI provider to draft from the {company} posting and your resume.</Trans>
					) : company ? (
						<Trans>Start typing, or connect an AI provider to draft from the {company} posting.</Trans>
					) : (
						<Trans>Start typing, or connect an AI provider to draft from your resume.</Trans>
					)
				) : company && hasResume ? (
					<Trans>Start typing, or draft from the {company} posting and your resume.</Trans>
				) : company ? (
					<Trans>Start typing, or draft from the {company} posting.</Trans>
				) : hasResume ? (
					<Trans>Start typing, or draft from your resume.</Trans>
				) : (
					<Trans>Start typing. To draft one, link a resume or an application first.</Trans>
				)}
			</p>
			<div className="flex flex-wrap gap-1.5">
				{canDraft && hasUsableProvider && (
					<Button size="sm" variant="soft" disabled={disabled} onClick={() => void startLetterDraft("draft")}>
						<Icon name="sparkle" />
						{application ? <Trans>Draft from the posting</Trans> : <Trans>Draft from your resume</Trans>}
					</Button>
				)}
				<Button size="sm" variant="ghost" disabled={disabled} onClick={onWrite}>
					<Trans>Write it myself</Trans>
				</Button>
			</div>
			{canDraft && <AiProviderLoadState state={providerState} />}
			{canDraft && !providerState.isUnavailable && !hasUsableProvider && (
				<SetUpAi
					needs={<Trans>A draft needs AI.</Trans>}
					works={<Trans>Writing it yourself works without it.</Trans>}
				/>
			)}
		</div>
	);
}

type DraftBoxProps = {
	draft: Exclude<LetterDraft, { phase: "idle" }>;
	letter: CoverLetter;
	application: ApplicationSummary | null;
	onKeep: (text: string, aiOperationIds: string[]) => void;
};

/** The draft on its green wash, then the dark chip: Keep, Shorter, More personal, Discard. */
function DraftBox({ draft, letter, application, onKeep }: DraftBoxProps) {
	const reducedMotion = useReducedMotion();
	const { usableProviders } = useHasUsableAiProvider();
	const [pick, setPick] = useState<{ draft: LetterDraft; index: number } | null>(null);
	// Retrying repeats the last request.
	const last = useRef<{
		variant: "draft" | "shorter" | "personal";
		previous?: string;
		previousAiOperationIds?: string[];
	}>({ variant: "draft" });
	const run = (variant: "draft" | "shorter" | "personal", previous?: string, previousAiOperationIds: string[] = []) => {
		last.current = previous ? { variant, previous, previousAiOperationIds } : { variant };
		void startLetterDraft(variant, previous, previousAiOperationIds);
	};

	if (draft.phase === "failed") {
		const gateway = draft.error instanceof ORPCError && draft.error.code === "BAD_GATEWAY";
		return (
			<div role="alert" className="grid gap-2.5 rounded-xl bg-danger-soft p-3 text-[13px] text-danger-text">
				<span className="flex gap-2">
					<Icon name="warning-circle" size={18} className="shrink-0" />
					{gateway && draft.provider ? (
						<Trans>Drafting stopped: {draft.provider} didn't respond. Nothing on the page changed.</Trans>
					) : (
						<Trans>Drafting stopped. Nothing on the page changed.</Trans>
					)}
				</span>
				<div className="flex gap-1.5">
					<Button
						size="sm"
						variant="secondary"
						onClick={() => run(last.current.variant, last.current.previous, last.current.previousAiOperationIds)}
					>
						<Trans>Try again</Trans>
					</Button>
					<Button size="sm" variant="ghost" onClick={dismissLetterDraftFailure}>
						<Trans>Dismiss</Trans>
					</Button>
				</div>
			</div>
		);
	}

	const streaming = draft.phase === "streaming";
	// Earlier versions stay side by side with the newest: "2 of 3", and Accept or a revision uses the one shown.
	const currentVersion = { text: draft.text, aiOperationIds: draft.aiOperationIds ?? [] };
	const all = streaming ? [currentVersion] : [...draft.versions, currentVersion];
	const index = pick?.draft === draft ? Math.min(pick.index, all.length - 1) : all.length - 1;
	const shown = all[index] ?? currentVersion;
	// Reduced motion shows the whole draft at once.
	const text = streaming && reducedMotion ? "" : shown.text;
	const used =
		letter.sourceResumeId && application
			? t`Uses only your resume and the posting`
			: application
				? t`Uses only the posting`
				: t`Uses only your resume`;
	// Drafts go to the default connection, so that is the one named.
	const provider = usableProviders.find((item) => item.isDefault) ?? usableProviders[0];
	const sources = provider ? `${used} · ${provider.label} · ${provider.model}` : used;

	return (
		<section aria-labelledby="letter-draft" className="flex flex-col">
			<SectionHeading
				id="letter-draft"
				className="items-center pt-6"
				note={
					draft.phase === "ready" && all.length > 1 ? (
						<Trans>
							{i18n.number(index + 1)} of {i18n.number(all.length)}
						</Trans>
					) : undefined
				}
			>
				{streaming ? <Trans>Writing a draft</Trans> : <Trans>A draft to review</Trans>}
				{draft.phase === "ready" && all.length > 1 && (
					<span className="ms-auto flex items-center gap-1 font-sans">
						<IconButton
							icon="caret-left"
							size="icon-sm"
							label={t`Previous version`}
							disabled={index === 0}
							onClick={() => setPick({ draft, index: index - 1 })}
						/>
						<IconButton
							icon="caret-right"
							size="icon-sm"
							label={t`Next version`}
							disabled={index === all.length - 1}
							onClick={() => setPick({ draft, index: index + 1 })}
						/>
					</span>
				)}
			</SectionHeading>
			{/* The draft itself is on the page, washed green; screen readers hear it here as it grows. */}
			<p aria-live="polite" aria-busy={streaming} className="sr-only">
				{text}
			</p>
			<p className="flex items-start gap-2 t-small text-ink-3">
				<Icon name="sparkle" size={16} className="mt-px shrink-0" />
				<span>{sources}</span>
			</p>
			{streaming && (
				<Button size="sm" variant="secondary" className="mt-3 w-fit" onClick={stopLetterDraft}>
					<Trans>Stop</Trans>
				</Button>
			)}
			{draft.phase === "ready" && (
				<div className={cn(ENTER_CLASS, "mt-3.5 flex flex-wrap items-center gap-1")}>
					<Button variant="soft" onClick={() => onKeep(shown.text, shown.aiOperationIds)}>
						<Trans>Accept</Trans>
					</Button>
					<Button variant="ghost" onClick={discardLetterDraft}>
						<Trans>Reject</Trans>
					</Button>
					<span className="ms-auto flex gap-1">
						{(
							[
								["shorter", t`Shorter`],
								["personal", t`More personal`],
							] as const
						).map(([variant, label]) => (
							<Button
								key={variant}
								size="sm"
								variant="secondary"
								onClick={() => run(variant, shown.text, shown.aiOperationIds)}
							>
								{label}
							</Button>
						))}
					</span>
				</div>
			)}
			<p className="mt-3 text-xs/4 text-ink-3">
				{draft.phase === "ready" && draft.stopped && index === all.length - 1 ? (
					<Trans>Stopped before the end. Accept it and finish it yourself, or reject it.</Trans>
				) : (
					<Trans>
						The draft sits on the page with a green wash. Nothing is kept until you accept, and it never replaces text
						you typed.
					</Trans>
				)}
			</p>
		</section>
	);
}

/** Length: the word count against the 180 to 320 band most recruiters read, as a hint rather than a rule. */
function LengthLine({ content, scale = false }: { content: string; scale?: boolean }) {
	const words = countWords(content);
	const length = letterLength(words);
	const percent = (value: number) => `${(value / LETTER_LENGTH.scale) * 100}%`;

	return (
		<div className={cn("flex flex-col gap-1.5", !scale && "pt-1")}>
			{!scale && (
				<div className="flex items-center justify-between gap-3">
					<span className="text-[13px]/[18px] font-medium text-ink-2">
						<Trans>Length</Trans>
					</span>
					<span className="t-mono text-ink-3">
						<Plural value={words} one="# word" other="# words" />
					</span>
				</div>
			)}
			<div aria-hidden="true" className="relative h-1.5 rounded-xs border border-control-border bg-sunken">
				<span
					className="absolute -inset-y-px border border-accent bg-accent-soft"
					style={{
						insetInlineStart: percent(LETTER_LENGTH.min),
						width: percent(LETTER_LENGTH.max - LETTER_LENGTH.min),
					}}
				/>
				<span
					className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink"
					style={{ insetInlineStart: percent(Math.min(words, LETTER_LENGTH.scale)) }}
				/>
			</div>
			{scale && (
				<div aria-hidden="true" className="relative h-4 t-mono text-ink-3">
					{[0, LETTER_LENGTH.min, LETTER_LENGTH.max, LETTER_LENGTH.scale].map((mark, index, marks) => (
						<span
							key={mark}
							className={cn(
								"absolute top-0",
								index === 0 ? "start-0" : index === marks.length - 1 ? "end-0" : "-translate-x-1/2 rtl:translate-x-1/2",
							)}
							style={index > 0 && index < marks.length - 1 ? { insetInlineStart: percent(mark) } : undefined}
						>
							{i18n.number(mark)}
						</span>
					))}
				</div>
			)}
			<p className={scale ? "t-small text-ink-2" : "text-xs/4 text-ink-3"}>
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
		</div>
	);
}

/** DESIGN: what the letter looks like, and where to change it. */
function DesignNote({ letter }: { letter: CoverLetter }) {
	const { i18n } = useLingui();
	const [, setMode] = useLetterMode();
	const { metadata } = letter.style;
	const pairingLabel = FONT_PAIRINGS.find((option) => option.id === matchFontPairing(metadata))?.label;
	const accent = ACCENTS.find((option) => option.hex === rgbaToHex(metadata.design.colors.primary))?.label;
	const pairing = pairingLabel && i18n._(pairingLabel);
	const summary = [templates[metadata.template].name, pairing && t`${pairing} type`, accent && i18n._(accent)]
		.filter(Boolean)
		.join(", ");

	return (
		<PanelFoot className="mt-auto block pt-8">
			<span>
				{letter.designLinked ? (
					<Trans>Matches the resume ({summary}).</Trans>
				) : (
					<Trans>Its own design ({summary}).</Trans>
				)}{" "}
				<button
					type="button"
					onClick={() => setMode("design")}
					className="font-medium text-accent-text hover:underline"
				>
					<Trans>Change it in Design.</Trans>
				</button>
			</span>
		</PanelFoot>
	);
}
