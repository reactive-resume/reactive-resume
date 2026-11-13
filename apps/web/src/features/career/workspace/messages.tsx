import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { replyPlaceholders } from "@reactive-resume/schema/applications/reply";
import { savedStageIn, stageBaselinesFor } from "@reactive-resume/schema/applications/stage-baselines";
import { offerTermKeys } from "@reactive-resume/schema/career-offer";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
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
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { isolate } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { formatDateOnly } from "@reactive-resume/utils/timezone";
import { DraftRecovery } from "../draft-recovery";
import {
	latest,
	useDebouncedSave,
	useDefaultProvider,
	useGenerate,
	useSavedItems,
	useSessionDraft,
	useWorkspace,
} from "../hooks";
import { formatBonus, formatMoney } from "../offer-compare";
import { OfferEntry, OfferForm, OfferSheet } from "../offer-entry";
import { Swap, useCareerTime, GenerateNotice, Working, workingSteps } from "../shared";
import { AiNotice } from "./fit";
import { List, ListRow } from "@/components/calm/list-row";
import { PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { StageDot } from "@/components/calm/stage-dot";
import { getCategoryLane, getDisplayLane, getLaneLabel } from "@/features/applications/lanes";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { offerHintFor, useOfferHints } from "@/features/applications/queries";
import {
	listedApplication,
	STAGE_SCOPE,
	useInvalidateApplications,
} from "@/features/applications/use-application-actions";
import { useApplicationLanes } from "@/features/applications/use-application-lanes";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type ReplyItem = SavedItem & { data: SavedData<"reply"> };

/** A pay period as words, so an amount is never shown without what it covers. */
// The longest message kept from a paste.
const MAX_MESSAGE = 20_000;

const periodLabel = (period: "year" | "month" | "hour") =>
	({
		year: t`per year`,
		month: t`per month`,
		hour: t`per hour`,
	})[period];

/** W15–W17: paste what the employer wrote, read it, reply, and apply the changes it implies only if you choose. */
export function MessagesTab({ application, version, now, offerForm }: WorkspaceTabProps) {
	const [pasting, setPasting] = useState(false);
	const [editingDeadline, setEditingDeadline] = useState(false);
	const connection = useDefaultProvider();
	const time = useCareerTime();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const readOnly = version?.data.kind === "reply";
	const reply = (readOnly ? version : latest(saved.data, "reply")) as ReplyItem | undefined;
	const [hidden, setHidden] = useState<string[]>([]);
	const isDismissed = (id: string) => {
		if (hidden.includes(id)) return true;
		try {
			return localStorage.getItem(`career-reply-dismissed:${id}`) === "1";
		} catch {
			return false;
		}
	};
	const offer = application.status === "offer" ? latest(saved.data, "offer") : undefined;
	const deadlineDays = offer?.data.respondBy ? Math.floor((+new Date(offer.data.respondBy) - +now) / 86_400_000) : 0;
	const deadlineRelative =
		deadlineDays > 0
			? plural(deadlineDays, { one: "in # day", other: "in # days" })
			: offer?.data.respondBy
				? time.relative(offer.data.respondBy, now).toLocaleLowerCase(time.locale)
				: "";

	if (workspace.isPending || saved.isPending)
		return (
			<div className="grid gap-4">
				<PageHeader title={t`Messages`} />
				<Skeleton className="h-28 rounded-lg" />
			</div>
		);
	const message = reply?.data.message ?? workspace.data.message;
	const hasAside = Boolean(reply || message.trim() || offer);
	const pending = Boolean(reply && reply.data.changes.length > 0 && !reply.data.applied && !isDismissed(reply.id));
	const readBy = reply?.aiUsage?.models[0];
	const wroteOn =
		reply && time.date(reply.createdAt) === time.date(now) ? t`today` : reply ? time.date(reply.createdAt) : "";
	// Pasted text minus the signature and quoted history: what the reply was read from.
	const trimmed = Boolean(
		reply && workspace.data.message.trim() && workspace.data.message.trim() !== reply.data.message.trim(),
	);

	return (
		<div>
			<PageHeader
				title={t`Messages`}
				className="[&>div]:min-h-9 [&>p]:pt-0 [&>p]:text-sm/6"
				actions={
					!readOnly && (
						<Button
							variant="ghost"
							onClick={() => {
								setPasting(true);
							}}
						>
							<Icon name="plus" />
							<Trans>Paste a message</Trans>
						</Button>
					)
				}
				subtitle={
					reply && pending
						? readBy
							? t`${isolate(application.company)} wrote back ${wroteOn}. Read by ${readBy.label} · ${readBy.model}. Nothing changes until you apply it.`
							: t`${isolate(application.company)} wrote back ${wroteOn}. Nothing changes until you apply it.`
						: offer?.data.respondBy
							? t`Reply to the offer by ${time.format(offer.data.respondBy, { weekday: "long", day: "numeric", month: "short" })} · ${deadlineRelative}. You send from your own email; nothing is sent from here.`
							: t`You send from your own email; nothing is sent from here.`
				}
			/>
			{!readOnly && (
				<AiNotice
					needs={<Trans>Reading a message and drafting a reply need AI.</Trans>}
					works={<Trans>Saving, writing, copying and logging work without it.</Trans>}
				/>
			)}
			<div
				className={cn(
					"grid items-start gap-10",
					hasAside &&
						(application.status === "offer"
							? "@3xl:grid-cols-[minmax(0,1fr)_264px]"
							: "@3xl:grid-cols-[minmax(0,1fr)_304px]"),
				)}
			>
				<div>
					{!readOnly && offerForm?.open && (
						<OfferEntry application={application} initialOpen onDone={offerForm.onDone} />
					)}
					{reply && reply.data.changes.length > 0 && !(isDismissed(reply.id) && !reply.data.applied) && (
						<ProposalCard
							key={reply.id}
							reply={reply}
							application={application}
							now={now}
							readOnly={readOnly}
							onDismiss={() => {
								setHidden((list) => [...list, reply.id]);
								try {
									localStorage.setItem(`career-reply-dismissed:${reply.id}`, "1");
								} catch {
									// Storage is blocked: it stays hidden for this visit.
								}
							}}
						/>
					)}
					{reply ? (
						<ReplyCard key={reply.id} reply={reply} application={application} readOnly={readOnly} />
					) : (
						<ReplyCard reply={null} application={application} readOnly={readOnly} />
					)}
				</div>
				{hasAside && (
					<aside>
						{message.trim() && (
							<>
								<SectionHeading
									className="pt-[22px]"
									note={reply ? wroteOn : undefined}
								>{t`From ${isolate(application.company)}`}</SectionHeading>
								<p className="mt-0.5 rounded-lg bg-sunken px-3.5 py-3 text-[13px]/[18px] whitespace-pre-wrap text-ink-2">
									{message}
								</p>
							</>
						)}
						{reply && (
							<>
								<ul className="grid pt-3">
									{reply.data.asks.map((ask) => (
										<li key={ask} className="flex gap-2 py-1 text-[13px]/[18px]">
											<Icon name="check" size={16} className="shrink-0 text-accent-text" />
											{ask}
										</li>
									))}
									{reply.data.unconfirmed.map((open) => (
										<li key={open} className="flex gap-2 py-1 text-[13px]/[18px]">
											<Icon name="question" size={16} className="shrink-0 text-warn-text" />
											{open}
										</li>
									))}
								</ul>
								{trimmed && (
									<p className="pt-3 text-[13px]/[18px] text-ink-3">
										<Trans>Saved with this application. The signature was left out.</Trans>
									</p>
								)}
							</>
						)}
						{/* N9: a message saved without AI says so, and what AI would have read out is shown as set by hand. */}
						{!reply && message.trim() && (
							<p className="pt-2 text-xs text-ink-3">
								<Trans>Saved with this application · not sent to any AI</Trans>
							</p>
						)}
						{!readOnly && offer && (
							<List cap className="mt-3.5">
								{!connection.isLoading && !connection.provider && offer.data.respondBy && (
									<ListRow
										leading={<Icon name="calendar-blank" size={20} className="text-ink-3" />}
										title={
											<span className="block text-[13px]/[18px]">{t`Reply by ${time.day(offer.data.respondBy)}`}</span>
										}
										subtitle={t`Set by you`}
										trailing={
											<button
												type="button"
												className="text-xs/4 text-accent-text hover:underline"
												onClick={() => setEditingDeadline(true)}
											>
												<Trans>Edit</Trans>
											</button>
										}
									/>
								)}
								<ListRow
									leading={<Icon name="scales" size={20} className="text-ink-3" />}
									title={<span className="block text-sm/5">{t`Offer terms`}</span>}
									subtitle={
										offer.aiUsage ? t`Saved ${time.date(offer.createdAt)} · compare in Offers` : t`Entered by you`
									}
									render={<Link to="/dashboard/career/offers" search={{ a: offer.id }} />}
									caret
								/>
							</List>
						)}
					</aside>
				)}
			</div>
			{offer && editingDeadline && (
				<OfferSheet open onClose={() => setEditingDeadline(false)}>
					<OfferForm
						sheet
						application={application}
						offer={offer}
						onClose={() => setEditingDeadline(false)}
						onSaved={() => setEditingDeadline(false)}
					/>
				</OfferSheet>
			)}
			<Dialog open={pasting} onOpenChange={setPasting}>
				<DialogContent closeLabel={t`Close`}>
					<DialogHeader>
						<DialogTitle>
							<Trans>Paste a message</Trans>
						</DialogTitle>
					</DialogHeader>
					<PasteBox
						application={application}
						initial={workspace.data.message}
						readOnly={false}
						onSave={(message) => workspace.save({ message })}
					/>
				</DialogContent>
			</Dialog>
		</div>
	);
}

type PasteBoxProps = {
	application: WorkspaceTabProps["application"];
	initial: string;
	readOnly: boolean;
	onSave: (message: string) => void;
};

/** W15: the employer's message, kept with the application, and "Read it for me". */
function PasteBox({ application, initial, readOnly, onSave }: PasteBoxProps) {
	const { i18n } = useLingui();
	const draft = useSessionDraft(
		readOnly ? null : `message:${application.id}`,
		initial,
		(value) => (typeof value === "string" && value.length <= 20000 ? value : undefined),
		true,
	);
	const { value: message, setValue: setMessage } = draft;
	const generate = useGenerate(application.id);
	const { provider } = useDefaultProvider();
	const flush = useDebouncedSave(readOnly || draft.restored ? initial : message, initial, onSave);
	const read = () => void generate.run({ task: "reply", message: message.trim() }).catch(() => undefined);

	return (
		<div className="grid gap-3">
			<DraftRecovery {...draft} />
			<div className="grid gap-1.5">
				<label htmlFor={`${application.id}-message`} className="text-xs font-medium text-ink-2">
					{t`Paste a message from ${isolate(application.company)}`}
				</label>
				<Textarea
					// What people paste or write here can be in any language: its own text sets the direction.
					dir="auto"
					id={`${application.id}-message`}
					value={message}
					maxLength={MAX_MESSAGE}
					readOnly={readOnly}
					placeholder={t`Paste the email or message, without the signature.`}
					onChange={(event) => setMessage(event.target.value)}
					onBlur={flush}
					className="max-h-72 min-h-[92px] overflow-y-auto px-3.5 py-3 text-sm leading-[22px] pointer-coarse:text-base"
				/>
				{/* A longer paste is cut at the limit: say so, rather than drop the rest silently. */}
				{message.length >= MAX_MESSAGE && (
					<p role="status" className="text-xs text-warn-text">
						<Trans>Only the first {i18n.number(MAX_MESSAGE)} characters are kept.</Trans>
					</p>
				)}
			</div>
			{!readOnly && (
				<div className="grid justify-items-start gap-2">
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={!message.trim()}
						onClick={() => {
							onSave(message);
							toast.add({ description: t`Message saved with this application` });
						}}
					>
						<Trans>Save message without AI</Trans>
					</Button>
					{provider && (
						<Button variant="secondary" loading={generate.isPending} disabled={!message.trim()} onClick={read}>
							{!generate.isPending && <Icon name="sparkle" size={18} />}
							{generate.isPending ? <Working steps={workingSteps("reply")} /> : <Trans>Read it for me</Trans>}
						</Button>
					)}
					<GenerateNotice generate={generate} onRetry={read} />
				</div>
			)}
		</div>
	);
}

type ReplyCardProps = { reply: ReplyItem | null; application: WorkspaceTabProps["application"]; readOnly: boolean };

/** W16: what they're asking, what isn't confirmed, and a reply to edit and send yourself. */
function ReplyCard({ reply, application, readOnly }: ReplyCardProps) {
	const { i18n } = useLingui();
	const [account] = useState(getAccountGeneration);
	const [accountId] = useState(getAccountId);
	const invalidate = useInvalidateApplications();
	const logReply = useMutation({
		...orpc.applications.logReply.mutationOptions(),
		mutationFn: (input: { id: string; expectedVersion: string }) => {
			if (!accountId) throw new Error("Signed-in account required");
			return client.applications.logReply(input, { context: { accountId } });
		},
	});
	const copying = useRef(false);
	const [logging, setLogging] = useState(false);
	const generate = useGenerate(application.id);
	const { provider } = useDefaultProvider();
	const draft = useSessionDraft(`reply:${reply?.id ?? application.id}`, reply?.data.reply ?? "", (value) =>
		typeof value === "string" && value.length <= 4000 ? value : undefined,
	);
	const text = readOnly && reply ? reply.data.reply : draft.value;
	const placeholders = replyPlaceholders(text);
	const [editingReply, setEditingReply] = useState(false);
	const highlight = useRef<HTMLDivElement>(null);
	// The employer's language is the default; this is the explicit way back to the words the user reads everything else in.
	const languageName = new Intl.DisplayNames([i18n.locale], { type: "language" }).of(i18n.locale) ?? i18n.locale;

	const rewrite = () => {
		if (reply)
			void generate
				.run({ task: "reply", message: reply.data.message, replyLocale: i18n.locale })
				.catch(() => undefined);
	};

	const copy = async (log = false) => {
		if ((log && (!application.replyVersion || !text.trim())) || copying.current || account !== getAccountGeneration())
			return;
		copying.current = true;
		setLogging(log);
		let copied = false;
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			if (account !== getAccountGeneration()) return;
			if (log && application.replyVersion) {
				await logReply.mutateAsync({ id: application.id, expectedVersion: application.replyVersion });
				if (account !== getAccountGeneration()) return;
				invalidate(application.id);
			}
			toast.add({ description: log ? t`Reply copied and logged as replied` : t`Reply copied` });
		} catch (error) {
			if (account !== getAccountGeneration()) return;
			if (copied) invalidate(application.id);
			if (copied && error instanceof ORPCError && error.code === "CONFLICT") {
				toast.add({
					type: "error",
					description: t`Reply copied. Nothing was logged because the application changed. Review it again before logging.`,
				});
				return;
			}
			if (copied && error instanceof ORPCError && error.code === "BAD_REQUEST") {
				toast.add({
					type: "error",
					description: t`Reply copied. Nothing was logged. Review the application before logging again.`,
				});
				return;
			}
			toast.add({
				type: "error",
				description: copied
					? t`Reply copied. Logging wasn't confirmed. Check the timeline before trying again.`
					: t`Couldn't copy the reply. Nothing was logged. Try again.`,
			});
		} finally {
			copying.current = false;
			setLogging(false);
		}
	};

	return (
		<section className="grid gap-3">
			{(reply?.data.reply || !reply) && (
				<>
					<div className="grid gap-0">
						<SectionHeading
							className={reply?.data.changes.length ? "pt-7" : "pt-[22px]"}
							note={t`edit before sending`}
							action={
								reply &&
								!readOnly &&
								provider && (
									<span className="flex items-center gap-1">
										<Button
											size="sm"
											variant="ghost"
											loading={generate.isPending}
											onClick={() =>
												void generate.run({ task: "reply", message: reply.data.message }).catch(() => undefined)
											}
										>
											<Icon name="sparkle" size={16} />
											<Trans>Redraft</Trans>
										</Button>
										{languageName && (
											<DropdownMenu>
												<DropdownMenuTrigger
													render={<Button size="icon-sm" variant="ghost" aria-label={t`Reply language`} />}
												>
													<Icon name="translate" size={16} />
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={rewrite}>
														<Trans>Write a new reply in {languageName}</Trans>
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										)}
									</span>
								)
							}
						>
							{reply?.data.changes.length ? t`Suggested reply` : t`Your reply`}
						</SectionHeading>
						<label htmlFor={`${reply?.id ?? application.id}-reply`} className="sr-only">
							<Trans>Suggested reply · edit before sending</Trans>
						</label>
						<div className="relative">
							{!editingReply && (
								<div
									aria-hidden="true"
									className="min-h-[170px] w-full rounded-md border border-control-border bg-raised px-3 py-2.5 text-start text-sm/[22px] [&>p+p]:mt-1.5"
								>
									{text.split(/\n\s*\n/).map((paragraph, index) => (
										<p key={index} className="whitespace-pre-wrap">
											{paragraph.split(/(\[[^\]\n]+\])/g).map((part, position) =>
												placeholders.includes(part) ? (
													<mark key={position} className="bg-warn-soft text-warn-text">
														{part}
													</mark>
												) : (
													part
												),
											)}
										</p>
									))}
								</div>
							)}
							{editingReply && placeholders.length > 0 && (
								<div
									ref={highlight}
									aria-hidden="true"
									dir="auto"
									className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2.5 text-sm/[22px] wrap-break-word whitespace-pre-wrap pointer-coarse:text-base"
								>
									{text.split(/(\[[^\]\n]+\])/g).map((part, index) =>
										placeholders.includes(part) ? (
											<mark key={index} className="bg-warn-soft text-warn-text">
												{part}
											</mark>
										) : (
											part
										),
									)}
								</div>
							)}
							<Textarea
								// What people paste or write here can be in any language: its own text sets the direction.
								dir="auto"
								id={`${reply?.id ?? application.id}-reply`}
								value={text}
								readOnly={readOnly}
								maxLength={4000}
								onChange={(event) => draft.setValue(event.target.value)}
								onBlur={() => setEditingReply(false)}
								onFocus={() => setEditingReply(true)}
								className={cn(
									"relative min-h-[170px] resize-none px-3 py-2.5 text-sm leading-[22px] pointer-coarse:text-base",
									placeholders.length > 0 && "bg-transparent text-transparent caret-ink dark:bg-transparent",
									!editingReply && "absolute inset-0 h-full min-h-0 opacity-0",
								)}
								onScroll={(event) => {
									if (highlight.current) highlight.current.scrollTop = event.currentTarget.scrollTop;
								}}
							/>
						</div>
						{placeholders.length > 0 && (
							<p role="status" className="mt-0.5 flex min-h-6 items-center gap-1.5 text-xs/4 text-ink-3">
								<Icon name="warning-circle" size={14} className="text-warn-text" />
								<Trans>Replace the marked placeholder before sending.</Trans>
							</p>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant={(reply?.data.changes.length ?? 0) > 0 && !reply?.data.applied ? "secondary" : "primary"}
							onClick={() => void copy()}
						>
							<Icon name="copy" size={18} />
							<Trans>Copy reply</Trans>
						</Button>
						{!readOnly && application.status !== "saved" && application.status !== "closed" && (
							<Button
								variant="ghost"
								loading={logging}
								disabled={!application.replyVersion || !text.trim()}
								onClick={() => void copy(true)}
							>
								<Icon name="check" size={18} />
								<Trans>Copy and log as replied</Trans>
							</Button>
						)}
						<span className="text-xs text-ink-3">
							{!reply?.data.changes.length && <Trans>You send it from your own email.</Trans>}
						</span>
					</div>
					{!readOnly &&
						!application.replyVersion &&
						application.status !== "saved" &&
						application.status !== "closed" && (
							<p className="text-xs text-ink-3">
								<Trans>Logging records contact and clears the follow-up reminder; nothing is sent.</Trans>{" "}
								{!application.replyVersion && (
									<Trans>Update the server to enable reply logging. Copy reply is still available.</Trans>
								)}
							</p>
						)}
					{!readOnly && <GenerateNotice generate={generate} onRetry={rewrite} className="w-fit" />}
				</>
			)}
		</section>
	);
}

type ProposalCardProps = {
	/** Hides the proposal in this browser; nothing on the application changes. */
	onDismiss?: (() => void) | undefined;
	reply: ReplyItem;
	application: WorkspaceTabProps["application"];
	now: Date;
	readOnly: boolean;
};

/**
 * W16–W17: changes the message implies, each one ticked by default. Nothing changes until Apply; Apply saves at once,
 * and its toast's Undo reverses exactly what it changed while nothing else has changed it since.
 */
function ProposalCard({ reply, application, now, readOnly, onDismiss }: ProposalCardProps) {
	const { i18n } = useLingui();
	const account = getAccountGeneration();
	const { when, day, timeZone } = useCareerTime();
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const apply = useMutation(orpc.career.applyReply.mutationOptions());
	const workspace = useWorkspace(application.id);
	const undo = useMutation(orpc.career.undoReply.mutationOptions());
	const [generation] = useState(getAccountGeneration);
	const { lanes } = useApplicationLanes();
	const hints = useOfferHints(application.status === "offer");
	const changes = reply.data.changes;
	const [confirming, setConfirming] = useState<number[] | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// A stage the application is already at has nothing to apply. From Saved, the move is one change with its receipt.
	const fixed = (index: number) => {
		const change = changes[index];
		return change?.type === "stage" && change.stage === application.status;
	};
	const needsSubmission = (index: number) => {
		const change = changes[index];
		return application.status === "saved" && change?.type === "stage";
	};
	const open = changes.flatMap((_, index) => (fixed(index) ? [] : [index]));
	const [ticked, setTicked] = useState<number[]>(open);
	const [appliedNow, setAppliedNow] = useState<{ changes: number[]; at: Date } | null>(null);
	const applied =
		appliedNow ??
		(reply.data.applied ? { changes: reply.data.applied.changes, at: new Date(reply.data.applied.at) } : null);
	const selected = applied ? applied.changes : ticked;

	const contact = application.contacts[0]?.name;
	const current =
		application.followUpNote ||
		describeNextStep(
			getNextStep(application, now, timeZone, offerHintFor(hints, application.id)),
			application,
			i18n.locale,
			timeZone,
		).title;

	const overdue = Boolean(application.followUpAt && new Date(application.followUpAt) < now);
	const describe = (change: (typeof changes)[number], index: number) => {
		switch (change.type) {
			case "stage": {
				// A proposed stage lands in that stage's default lane.
				const stage = getLaneLabel(getCategoryLane(lanes, change.stage));
				if (change.stage === application.status)
					// Applied, the stage is now the one it moved to: say so, rather than "stays".
					return applied?.changes.includes(index)
						? { title: t`Moved to ${stage}`, detail: "" }
						: { title: t`Stage stays ${stage}`, detail: t`No change needed. It's already at ${stage}.` };
				if (application.status === "saved")
					return {
						title: t`Mark as applied and move to ${stage}`,
						detail: t`Asks you to confirm the answers and documents, then records them as sent and moves it.`,
					};
				return {
					title: t`Move to ${stage}`,
					detail: t`Moves the application from ${getLaneLabel(getDisplayLane(lanes, application))}`,
					from: getDisplayLane(lanes, application),
					to: getCategoryLane(lanes, change.stage),
				};
			}
			// One change carries the next step and, when a reply is due, its reminder.
			case "follow-up":
				if (!change.at)
					return { title: t`Next step: ${change.note}`, detail: t`Replaces “${current}” on the application.` };
				// The date is the application's next step, shown with it in Applications; it doesn't schedule a reminder.
				if (change.note)
					return {
						title: t`Next step: ${change.note}`,
						detail: overdue
							? t`By ${day(change.at)} · replaces the overdue “${current}”`
							: t`By ${day(change.at)} · replaces “${current}”`,
					};
				return {
					title: t`Follow up on ${when(change.at)}`,
					detail: change.note
						? t`Next step: ${change.note}. Sets the application's follow-up date.`
						: t`Sets the application's follow-up date, in case you haven't heard back by then.`,
				};
			case "offer": {
				const offer = reply.data.offer;
				// Every term the message stated, so a missing deadline or bonus is visible before applying.
				const terms =
					offer === null
						? []
						: offerTermKeys(offer).map((key) =>
								key === "base"
									? t`Base ${formatMoney(i18n.locale, offer.currency, offer.base ?? 0)} ${periodLabel(offer.period)}`
									: key === "variable"
										? t`Bonus ${formatBonus(i18n.locale, offer) ?? ""}${
												offer.variableConditions ? ` (${offer.variableConditions})` : ""
											}`
										: key === "equity"
											? t`Equity ${offer.equity}`
											: key === "startDate"
												? t`Starts ${formatDateOnly(offer.startDate ?? "", i18n.locale)}`
												: t`Respond by ${day(offer.respondBy ?? "")}`,
							);
				return {
					title: t`Save these offer terms to compare`,
					detail: terms.length
						? t`${terms.join(" · ").replace(/[\s.。]+$/u, "")}. Opens in Career → Offers.`
						: t`No terms were extracted. Opens in Career → Offers.`,
				};
			}
		}
	};

	const offer = reply.data.offer;
	const unknown = t`Not stated`;
	const amount = (value: number | null) =>
		offer && value !== null ? formatMoney(i18n.locale, offer.currency, value) : unknown;
	const terms: Array<[string, string]> = offer
		? [
				[t`Offer type`, offer.version === "written" ? t`Written offer` : t`Verbal offer`],
				[t`Currency`, offer.currency],
				[t`Pay period`, offer.period === "year" ? t`Per year` : offer.period === "month" ? t`Per month` : t`Per hour`],
				[t`Base salary`, amount(offer.base)],
				[t`Bonus`, formatBonus(i18n.locale, offer) ?? unknown],
				[t`Bonus conditions`, offer.variableConditions || unknown],
				[t`Equity`, offer.equity || unknown],
				[t`Where you work`, offer.location || unknown],
				[t`Office days a week`, offer.officeDays === null ? unknown : String(offer.officeDays)],
				[t`Leave`, offer.leave || unknown],
				[t`Learning budget`, amount(offer.learning)],
				[t`Other benefits`, offer.other || unknown],
				[t`Respond by`, offer.respondBy ? when(offer.respondBy) : unknown],
			]
		: [];

	const followUp = changes.find((change, index) => change.type === "follow-up" && applied?.changes.includes(index));
	const count = ticked.length;

	const refresh = () => {
		invalidate(application.id);
		void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
		void queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() });
	};

	// Saved before it shows as applied: leaving the page right after can't lose it. Undo is the server's reverse.
	const onApply = async () => {
		if (generation !== getAccountGeneration()) return;
		const chosen = ticked;
		// A move from Saved needs the receipt the user confirmed. Nothing is written until that confirmation.
		if (chosen.some(needsSubmission)) {
			setConfirming(chosen);
			return;
		}
		const saved = stageBaselinesFor(queryClient).write(
			STAGE_SCOPE,
			application.id,
			listedApplication(queryClient, application.id),
		);
		try {
			const answer = await apply.mutateAsync({ id: reply.id, changes: chosen });
			if (generation !== getAccountGeneration()) return;
			saved(savedStageIn(answer, application.id));
		} catch (error) {
			toastError(error, t`Couldn't update the application. Nothing was changed. Try again.`, {
				allowServerMessage: true,
			});
			return;
		} finally {
			saved(undefined);
		}
		setAppliedNow({ changes: chosen, at: new Date() });
		refresh();
		toast.add({
			description: t`Application updated`,
			actionProps: {
				children: t`Undo`,
				onClick: () => {
					if (generation !== getAccountGeneration()) return;
					const reverted = stageBaselinesFor(queryClient).write(
						STAGE_SCOPE,
						application.id,
						listedApplication(queryClient, application.id),
					);
					void undo
						.mutateAsync({ id: reply.id })
						.then(
							(answer) => {
								if (generation !== getAccountGeneration()) return;
								reverted(savedStageIn(answer, application.id));
								setAppliedNow(null);
								refresh();
							},
							(error: unknown) =>
								toastError(error, t`Couldn't undo the update. The application is unchanged.`, {
									allowServerMessage: true,
								}),
						)
						.finally(() => reverted(undefined));
				},
			},
		});
	};

	const confirmedAnswers = workspace.current().answers.filter((answer) => answer.answer.trim()).length;
	const confirmedDocuments = [
		...(application.resumeId ? [t`the linked resume`] : []),
		...(application.coverLetterId ? [t`the linked cover letter`] : []),
	];
	const records =
		confirmedAnswers || confirmedDocuments.length
			? t`Records ${[
					...(confirmedAnswers
						? [plural(confirmedAnswers, { one: "# written answer", other: "# written answers" })]
						: []),
					...confirmedDocuments,
				].join(", ")} as sent, and moves this application. You submit on the employer's site yourself.`
			: t`No documents or answers are linked. This records the application as sent, and moves it. You submit on the employer's site yourself.`;

	const confirmSubmission = async () => {
		if (!confirming || getAccountGeneration() !== account) return;
		const saved = stageBaselinesFor(queryClient).write(
			STAGE_SCOPE,
			application.id,
			listedApplication(queryClient, application.id),
		);
		setSubmitting(true);
		try {
			const current = await workspace.settled();
			if (getAccountGeneration() !== account) return;
			const result = await apply.mutateAsync({
				id: reply.id,
				changes: confirming,
				submission: {
					answers: current.answers,
					expectedAnswers: current.answers,
					expectedDocuments: { resumeId: application.resumeId, coverLetterId: application.coverLetterId },
				},
			});
			saved(savedStageIn(result, application.id));
			setAppliedNow({ changes: confirming, at: new Date() });
			setConfirming(null);
			invalidate(application.id);
			void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() });
		} catch {
			// The single transaction rolled back: the application is still Saved and nothing was recorded.
			toast.add({
				type: "error",
				description: t`Couldn't confirm the application move. Reload this application before retrying.`,
			});
		} finally {
			saved(undefined);
			setSubmitting(false);
		}
	};

	return (
		<section className={cn("grid gap-0", applied && "mt-[22px] rounded-xl border border-line px-5 py-2")}>
			<SectionHeading
				className={applied ? "sr-only" : "pt-[22px]"}
				note={
					applied
						? t({ message: "Applied", context: "A proposed change has been applied" })
						: readOnly
							? t`Not applied`
							: t`from this message`
				}
			>
				<Trans>Proposed changes</Trans>
			</SectionHeading>

			<ul className="grid">
				{changes.map((change, index) => {
					const described = describe(change, index);
					const { title } = described;
					const appliedChange = applied?.changes.includes(index);
					const before = reply.data.applied?.undo?.before;
					const detail = appliedChange
						? change.type === "stage" && before
							? t`Was ${getLaneLabel(lanes.find((lane) => lane.id === before.laneId) ?? getCategoryLane(lanes, before.status))}`
							: change.type === "follow-up" && change.at
								? t`Follow-up set for ${day(change.at)}`
								: described.detail
						: described.detail;
					const isFixed = fixed(index);
					const id = `${reply.id}-change-${index}`;
					return (
						<li
							key={id}
							className={cn(
								"flex items-start gap-3.5 border-b border-line py-2.5 last:border-b-0",
								isFixed && !applied && "opacity-70",
							)}
						>
							{appliedChange ? (
								<Icon name="check-circle" className="mt-px text-accent-text" size={18} />
							) : (
								<Checkbox
									id={id}
									className="mt-px"
									checked={isFixed || selected.includes(index)}
									disabled={isFixed || applied !== null || readOnly}
									onCheckedChange={(checked) =>
										setTicked((rows) => (checked ? [...rows, index] : rows.filter((row) => row !== index)))
									}
								/>
							)}
							<label htmlFor={id} className="grid flex-1 gap-px">
								<span className="text-[15px]/[22px] font-medium">{title}</span>
								{detail && <span className="text-[13px]/[18px] text-ink-3">{detail}</span>}
							</label>
							{appliedChange && (
								<span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-xs text-accent-text">
									{t({ message: "Applied", context: "A proposed change has been applied" })}
								</span>
							)}
							{!applied && "from" in described && described.from && described.to && (
								<span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[13px]/[18px] text-ink-2">
									<StageDot status={described.from.category} color={described.from.color}>
										{getLaneLabel(described.from)}
									</StageDot>
									<Icon name="arrow-right" size={14} className="text-ink-3" />
									<StageDot status={described.to.category} color={described.to.color}>
										{getLaneLabel(described.to)}
									</StageDot>
								</span>
							)}
						</li>
					);
				})}
			</ul>

			{offer && changes.some((change) => change.type === "offer") && (
				<div className="grid gap-2 border-t border-line pt-3">
					<h3 className="text-xs font-semibold text-ink-2">
						<Trans>Offer terms</Trans>
					</h3>
					<dl className="grid gap-2 text-xs">
						{terms.map(([label, value]) => (
							<div key={label} className="grid gap-0.5">
								<dt className="text-ink-3">{label}</dt>
								<dd className="wrap-anywhere whitespace-pre-wrap">{value}</dd>
							</div>
						))}
					</dl>
				</div>
			)}

			{/* Only a message about scheduling can tempt adding an interview from an unconfirmed time. */}
			{!applied &&
				reply.data.unconfirmed.length > 0 &&
				!reply.data.changes.some((change) => change.type === "offer") && (
					<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3.5 border-b border-line py-2.5 ps-8">
						<div className="contents">
							<p className="col-span-2 text-[15px]/[22px] font-medium">
								<Trans>No interview added</Trans>
							</p>
							<p className="text-[13px]/[18px] text-ink-3">
								{contact
									? t`The message gives no time. Confirm one with ${contact}, then schedule the call.`
									: t`The message gives no time. Confirm one, then schedule the call.`}
							</p>
						</div>
						{!readOnly && (
							<Link
								to="/dashboard/applications/$applicationId/{-$tab}"
								params={{ applicationId: application.id, tab: "messages" }}
								search={{ edit: "interview" }}
								className="text-sm/5 font-medium text-accent-text"
							>
								<Trans>Schedule…</Trans>
							</Link>
						)}
					</div>
				)}

			{!readOnly && (
				<Swap id={applied ? "applied" : "pending"}>
					{applied ? (
						<p className="flex items-center gap-1.5 text-[13px] text-accent-text">
							<Icon name="check-circle" size={17} />
							{followUp?.type === "follow-up" && followUp.at
								? t`Applied. Follow-up set for ${day(followUp.at)}.`
								: t`Applied. The application is updated.`}
						</p>
					) : (
						<div className="mt-4 flex flex-wrap items-center gap-2">
							<Button disabled={count === 0} loading={apply.isPending} onClick={() => void onApply()}>
								{count === 0 ? t`Nothing to apply` : plural(count, { one: "Apply # change", other: "Apply # changes" })}
							</Button>
							{onDismiss && (
								<Button variant="ghost" onClick={onDismiss}>
									<Trans>Dismiss</Trans>
								</Button>
							)}
							<span className="ps-2 text-xs text-ink-3">
								<Trans>Undo is offered afterwards.</Trans>
							</span>
						</div>
					)}
				</Swap>
			)}

			<Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
				<DialogContent closeLabel={t`Close`} className="sm:max-w-[440px]">
					<DialogHeader>
						<DialogTitle>
							<Trans>Mark as applied and move it?</Trans>
						</DialogTitle>
						<DialogDescription>{records}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" disabled={submitting} onClick={() => setConfirming(null)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button loading={submitting} onClick={() => void confirmSubmission()}>
							<Trans>Mark as applied and move</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
