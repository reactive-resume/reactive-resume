import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
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
import { formatMoney } from "../offer-compare";
import { OfferEntry } from "../offer-entry";
import { Swap, useCareerTime, withUndo, Working, workingSteps } from "../shared";
import { AiNotice } from "./fit";
import { getCategoryLane, getDisplayLane, getLaneLabel } from "@/features/applications/lanes";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { offerHintFor, useOfferHints } from "@/features/applications/queries";
import {
	listedApplication,
	STAGE_SCOPE,
	useInvalidateApplications,
} from "@/features/applications/use-application-actions";
import { useApplicationLanes } from "@/features/applications/use-application-lanes";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { orpc } from "@/libs/orpc/client";

type ReplyItem = SavedItem & { data: SavedData<"reply"> };

/** A pay period as words, so an amount is never shown without what it covers. */
const periodLabel = (period: "year" | "month" | "hour") =>
	({
		year: t`per year`,
		month: t`per month`,
		hour: t`per hour`,
	})[period];

/** W15–W17: paste what the employer wrote, read it, reply, and apply the changes it implies only if you choose. */
export function MessagesTab({ application, version, now, offerForm }: WorkspaceTabProps) {
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const readOnly = version?.data.kind === "reply";
	const reply = (readOnly ? version : latest(saved.data, "reply")) as ReplyItem | undefined;

	if (workspace.isPending || saved.isPending)
		return (
			<div className="grid gap-4 @3xl:w-1/2">
				<Skeleton className="h-28 rounded-lg" />
			</div>
		);

	return (
		<div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_280px] @5xl:grid-cols-[minmax(0,1fr)_360px]">
			<div className="grid gap-4">
				{!readOnly && (
					<OfferEntry
						application={application}
						initialOpen={offerForm?.open ?? false}
						{...(offerForm ? { onDone: offerForm.onDone } : {})}
					/>
				)}
				<PasteBox
					key={`paste-${version?.id ?? "live"}`}
					application={application}
					initial={readOnly ? (reply?.data.message ?? "") : workspace.data.message || (reply?.data.message ?? "")}
					readOnly={readOnly}
					onSave={(message) => workspace.save({ message })}
				/>
				{reply && <ReplyCard key={reply.id} reply={reply} application={application} readOnly={readOnly} />}
			</div>
			{reply && reply.data.changes.length > 0 && (
				<ProposalCard key={reply.id} reply={reply} application={application} now={now} readOnly={readOnly} />
			)}
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

	return (
		<div className="grid gap-3">
			<DraftRecovery {...draft} />
			<div className="grid gap-1.5">
				<label htmlFor={`${application.id}-message`} className="text-xs font-medium text-ink-2">
					{t`Paste a message from ${application.company}`}
				</label>
				<Textarea
					id={`${application.id}-message`}
					value={message}
					maxLength={20_000}
					readOnly={readOnly}
					placeholder={t`Paste the email or message, without the signature.`}
					onChange={(event) => setMessage(event.target.value)}
					onBlur={flush}
					className="max-h-72 min-h-[92px] overflow-y-auto px-3.5 py-3 text-sm leading-[22px] pointer-coarse:text-base"
				/>
			</div>
			{!readOnly && (
				<div className="grid justify-items-start gap-2">
					<AiNotice task="reply" application={application} />
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
						<Button
							variant="secondary"
							loading={generate.isPending}
							disabled={!message.trim()}
							onClick={() => void generate.run({ task: "reply", message: message.trim() }).catch(() => undefined)}
						>
							{!generate.isPending && <Icon name="sparkle" size={18} />}
							{generate.isPending ? <Working steps={workingSteps("reply")} /> : <Trans>Read it for me</Trans>}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

type ReplyCardProps = { reply: ReplyItem; application: WorkspaceTabProps["application"]; readOnly: boolean };

/** W16: what they're asking, what isn't confirmed, and a reply to edit and send yourself. */
function ReplyCard({ reply, application, readOnly }: ReplyCardProps) {
	const { i18n } = useLingui();
	const generate = useGenerate(application.id);
	const { provider } = useDefaultProvider();
	const draft = useSessionDraft(`reply:${reply.id}`, reply.data.reply, (value) =>
		typeof value === "string" && value.length <= 4000 ? value : undefined,
	);
	const text = readOnly ? reply.data.reply : draft.value;
	// The employer's language is the default; this is the explicit way back to the words the user reads everything else in.
	const languageName = new Intl.DisplayNames([i18n.locale], { type: "language" }).of(i18n.locale) ?? i18n.locale;

	const copy = async () => {
		await navigator.clipboard.writeText(text);
		toast.add({ description: t`Reply copied` });
	};

	return (
		<section className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:p-[18px]">
			<h2 className="text-base font-semibold">{reply.data.title}</h2>
			{(reply.data.asks.length > 0 || reply.data.unconfirmed.length > 0) && (
				<ul className="grid gap-1.5">
					{reply.data.asks.map((ask) => (
						<li key={ask} className="flex gap-2 text-sm leading-[21px]">
							<Icon name="check" size={17} className="mt-0.5 shrink-0 text-accent-text" />
							{ask}
						</li>
					))}
					{reply.data.unconfirmed.map((open) => (
						<li key={open} className="flex gap-2 text-sm leading-[21px]">
							<Icon name="question" size={17} className="mt-0.5 shrink-0 text-warn-text" />
							{open}
						</li>
					))}
				</ul>
			)}
			{reply.data.reply && (
				<>
					<div className="grid gap-1.5">
						<label htmlFor={`${reply.id}-reply`} className="text-xs font-medium text-ink-2">
							<Trans>Suggested reply · edit before sending</Trans>
						</label>
						<Textarea
							id={`${reply.id}-reply`}
							value={text}
							readOnly={readOnly}
							maxLength={4000}
							onChange={(event) => draft.setValue(event.target.value)}
							className="min-h-[110px] px-3.5 py-3 text-sm leading-[22px] pointer-coarse:text-base"
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button variant="secondary" size="sm" onClick={() => void copy()}>
							<Icon name="copy" size={16} />
							<Trans>Copy reply</Trans>
						</Button>
						<span className="text-xs text-ink-3">
							<Trans>You send it from your own email.</Trans>
						</span>
						{!readOnly && provider && (
							<Button
								variant="ghost"
								size="sm"
								className="ms-auto"
								loading={generate.isPending}
								onClick={() =>
									void generate
										.run({ task: "reply", message: reply.data.message, replyLocale: i18n.locale })
										.catch(() => undefined)
								}
							>
								<Trans>Write a new reply in {languageName}</Trans>
							</Button>
						)}
					</div>
				</>
			)}
		</section>
	);
}

type ProposalCardProps = {
	reply: ReplyItem;
	application: WorkspaceTabProps["application"];
	now: Date;
	readOnly: boolean;
};

/**
 * W16–W17: changes the message implies, each one ticked by default. Nothing changes until Apply; Apply shows at once
 * and commits when its Undo toast closes.
 */
function ProposalCard({ reply, application, now, readOnly }: ProposalCardProps) {
	const { i18n } = useLingui();
	const account = getAccountGeneration();
	const { when, day, timeZone } = useCareerTime();
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const apply = useMutation(orpc.career.applyReply.mutationOptions());
	const workspace = useWorkspace(application.id);
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

	const contact = application.contacts[0]?.name.split(" ")[0];
	const current =
		application.followUpNote ||
		describeNextStep(
			getNextStep(application, now, timeZone, offerHintFor(hints, application.id)),
			application,
			i18n.locale,
			timeZone,
		).title;

	const describe = (change: (typeof changes)[number]) => {
		switch (change.type) {
			case "stage": {
				// A proposed stage lands in that stage's default lane.
				const stage = getLaneLabel(getCategoryLane(lanes, change.stage));
				if (change.stage === application.status)
					return { title: t`Stage stays ${stage}`, detail: t`No change needed. It's already at ${stage}.` };
				if (application.status === "saved")
					return {
						title: t`Mark as applied and move to ${stage}`,
						detail: t`Asks you to confirm the answers and documents, then records them as sent and moves it.`,
					};
				return {
					title: t`Move to ${stage}`,
					detail: t`Moves the application from ${getLaneLabel(getDisplayLane(lanes, application))}.`,
				};
			}
			// One change carries the next step and, when a reply is due, its reminder.
			case "follow-up":
				if (!change.at)
					return { title: t`Next step: ${change.note}`, detail: t`Replaces “${current}” on the application.` };
				return {
					title: t`Follow up on ${when(change.at)}`,
					detail: change.note
						? t`Next step: ${change.note}. Adds a reminder to Today.`
						: t`Adds a reminder to Today if you haven't heard back by then.`,
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
										? t`Bonus ${formatMoney(i18n.locale, offer.currency, offer.variable ?? 0)}${
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
						? t`${terms.join(" · ")}. Opens in Career → Offers.`
						: t`No terms were extracted. Opens in Career → Offers.`,
				};
			}
		}
	};

	const followUp = changes.find((change, index) => change.type === "follow-up" && applied?.changes.includes(index));
	const count = ticked.length;

	const onApply = () => {
		const chosen = ticked;
		// A move from Saved needs the receipt the user confirmed. Nothing is written until that confirmation.
		if (chosen.some(needsSubmission)) {
			setConfirming(chosen);
			return;
		}
		setAppliedNow({ changes: chosen, at: new Date() });
		// A bulk move of this application chosen while the changes wait behind Undo, or are on their way, starts from
		// the stage they save.
		const saved = stageBaselinesFor(queryClient).write(
			STAGE_SCOPE,
			application.id,
			listedApplication(queryClient, application.id),
		);
		withUndo({
			description: t`Application updated`,
			onUndo: () => {
				saved(undefined);
				setAppliedNow(null);
			},
			commit: () =>
				apply.mutateAsync({ id: reply.id, changes: chosen }).then(
					(answer) => {
						saved(savedStageIn(answer, application.id));
						invalidate(application.id);
						void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
						void queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() });
					},
					() => {
						saved(undefined);
						setAppliedNow(null);
						toast.add({
							type: "error",
							description: t`Couldn't update the application. Nothing was changed. Try again.`,
						});
					},
				),
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
		<aside
			className={cn(
				"grid gap-3 rounded-xl border bg-surface p-4 shadow-e1 transition-colors duration-standard",
				applied || readOnly ? "border-line" : "border-info-text",
			)}
		>
			<div className="flex items-center gap-2">
				<Icon name="list-checks" size={18} className="text-info-text" />
				<h2 className="flex-1 text-sm font-semibold">
					<Trans>Proposed changes</Trans>
				</h2>
				<span className="text-xs text-ink-3">
					{applied
						? t({ message: "Applied", context: "A proposed change has been applied" })
						: readOnly
							? t`Not applied`
							: t`Waiting for you`}
				</span>
			</div>

			<ul className="grid gap-2">
				{changes.map((change, index) => {
					const { title, detail } = describe(change);
					const isFixed = fixed(index);
					const id = `${reply.id}-change-${index}`;
					return (
						<li key={id} className={cn("flex gap-2.5 rounded-lg bg-bg px-3 py-2.5", isFixed && "opacity-70")}>
							<Checkbox
								id={id}
								className="mt-px"
								checked={isFixed || selected.includes(index)}
								disabled={isFixed || applied !== null || readOnly}
								onCheckedChange={(checked) =>
									setTicked((rows) => (checked ? [...rows, index] : rows.filter((row) => row !== index)))
								}
							/>
							<label htmlFor={id} className="grid gap-0.5 text-[13px] leading-[19px]">
								<span className="font-semibold">{title}</span>
								<span className="text-ink-2">{detail}</span>
							</label>
						</li>
					);
				})}
			</ul>

			{/* Only a message about scheduling can tempt adding an interview from an unconfirmed time. */}
			{reply.data.unconfirmed.length > 0 && !reply.data.changes.some((change) => change.type === "offer") && (
				<p className="text-xs text-ink-3">
					{contact
						? t`Confirm the time with ${contact} before adding a new interview.`
						: t`Confirm the time before adding a new interview.`}
				</p>
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
						<Button className="h-10 w-full" disabled={count === 0} onClick={onApply}>
							{count === 0 ? t`Nothing to apply` : plural(count, { one: "Apply # change", other: "Apply # changes" })}
						</Button>
					)}
				</Swap>
			)}

			<Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
				<DialogContent className="sm:max-w-[440px]">
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
		</aside>
	);
}
