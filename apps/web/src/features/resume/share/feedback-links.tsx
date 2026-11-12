import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
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
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { CopyLinkButton } from "./copy-link-button";
import { List, ListRow } from "@/components/calm/list-row";
import { useConfirm } from "@/hooks/use-confirm";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type FeedbackLink = RouterOutput["feedback"]["list"][number];

/** Most applications one link shares; the server holds the same limit. */
const MAX_APPLICATIONS = 20;
const EXPIRY_DAYS = ["7", "30", "90", "never"] as const;
type Expiry = (typeof EXPIRY_DAYS)[number];

const expiryLabel = (expiry: Expiry) =>
	expiry === "never" ? t`Never` : expiry === "7" ? t`In 7 days` : expiry === "30" ? t`In 30 days` : t`In 90 days`;

const statusLabel = (status: FeedbackLink["status"]) =>
	status === "active" ? t`Active` : status === "expired" ? t`Expired` : t`Turned off`;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "yesterday", "3 days ago" within a week, otherwise the day: "12 Oct". */
const dayLabel = (date: Date, locale: string) => {
	const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / (24 * 60 * 60 * 1000));
	return days >= 0 && days < 7
		? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")
		: date.toLocaleDateString(locale, { day: "numeric", month: "short" });
};

/** What a link collected: new comments while any wait, otherwise how many were left and that they're done. */
function CommentsNote({ link }: { link: FeedbackLink }) {
	if (link.openCommentCount > 0)
		return <Plural value={link.openCommentCount} one="# new comment" other="# new comments" />;
	if (link.commentCount === 0) return null;
	return link.commentCount === 1 ? (
		<Trans>1 comment, done</Trans>
	) : link.commentCount === 2 ? (
		<Trans>2 comments, both done</Trans>
	) : (
		<Trans>{link.commentCount} comments, all done</Trans>
	);
}

type FeedbackLinksSectionProps = {
	resumeId: string /** Draws its own heading; off where the page title already names it. */;
	titled?: boolean;
};

/**
 * Feedback links: a private link to this version of the resume for one reviewer, such as a coach. The owner sees who
 * each link is for, whether it was opened and what it collected, and can turn it off.
 */
export function FeedbackLinksSection({ resumeId, titled = true }: FeedbackLinksSectionProps) {
	const { i18n } = useLingui();
	const [creating, setCreating] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const links = useQuery(orpc.feedback.list.queryOptions({ input: { resumeId } }));

	return (
		<section aria-labelledby="share-feedback-title" className="grid gap-3">
			<div className={titled ? "grid gap-1" : "sr-only"}>
				<h3 id="share-feedback-title" className="text-sm font-semibold">
					<Trans>Feedback links</Trans>
				</h3>
				<p className="text-[13px] leading-[19px] text-ink-2">
					<Trans>
						Send a coach or friend a private link to this version. They can comment, but can't change it or see anything
						else.
					</Trans>
				</p>
			</div>

			{links.isError ? (
				<p role="alert" className="text-sm text-danger-text">
					<Trans>Couldn't load your feedback links.</Trans>{" "}
					<button type="button" className="underline underline-offset-2" onClick={() => void links.refetch()}>
						<Trans>Try again</Trans>
					</button>
				</p>
			) : links.data && links.data.length > 0 ? (
				<List>
					{links.data.map((link) => (
						<ListRow
							key={link.id}
							variant={link.status === "active" ? "default" : "dim"}
							render={<button type="button" onClick={() => setOpenId(link.id)} />}
							title={link.label}
							subtitle={
								<>
									{link.lastViewedAt ? (
										<Trans>Opened {dayLabel(link.lastViewedAt, i18n.locale)}</Trans>
									) : (
										<Trans>Never opened</Trans>
									)}
									{link.revokedAt ? (
										<>
											{" · "}
											<Trans>turned off {i18n.date(link.revokedAt, { day: "numeric", month: "short" })}</Trans>
										</>
									) : link.commentCount > 0 ? (
										<>
											{" · "}
											<CommentsNote link={link} />
										</>
									) : null}
								</>
							}
							trailing={
								<Badge variant={link.status === "active" ? "accent" : "outline"}>{statusLabel(link.status)}</Badge>
							}
							caret
						/>
					))}
				</List>
			) : null}

			<Button variant="secondary" className="w-fit" onClick={() => setCreating(true)}>
				<Icon name="link-simple-horizontal" size={18} />
				<Trans>New feedback link</Trans>
			</Button>

			<NewFeedbackLinkDialog
				resumeId={resumeId}
				open={creating}
				onOpenChange={setCreating}
				onCreated={(link) => {
					setCreating(false);
					setOpenId(link.id);
				}}
			/>
			{openId && <FeedbackLinkDialog id={openId} onClose={() => setOpenId(null)} />}
		</section>
	);
}

type NewFeedbackLinkDialogProps = {
	resumeId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (link: FeedbackLink) => void;
};

function NewFeedbackLinkDialog({ resumeId, open, onOpenChange, onCreated }: NewFeedbackLinkDialogProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const [label, setLabel] = useState("");
	const [allowComments, setAllowComments] = useState(true);
	const [expiry, setExpiry] = useState<Expiry>("30");
	const [applicationIds, setApplicationIds] = useState<string[]>([]);
	const applications = useQuery({ ...orpc.applications.listSummary.queryOptions({ input: {} }), enabled: open });
	const create = useMutation({
		...orpc.feedback.create.mutationOptions(),
		onSuccess: (link) => {
			void queryClient.invalidateQueries({ queryKey: orpc.feedback.key() });
			setLabel("");
			setApplicationIds([]);
			onCreated(link);
		},
		onError: (error) => toastError(error, t`Couldn't make the link. Try again.`, { allowServerMessage: true }),
	});
	// Open applications first, then the ones that use this resume.
	const choices = (applications.data ?? [])
		.filter((application) => application.status !== "closed")
		.toSorted((a, b) => Number(b.resumeId === resumeId) - Number(a.resumeId === resumeId));

	const toggle = (applicationId: string, on: boolean) =>
		setApplicationIds((current) =>
			on ? [...current, applicationId].slice(0, MAX_APPLICATIONS) : current.filter((item) => item !== applicationId),
		);

	const submit = () => {
		if (create.isPending || !label.trim()) return;
		create.mutate({
			resumeId,
			label: label.trim(),
			allowComments,
			applicationIds,
			expiresAt: expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000),
		});
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
			<DialogContent closeLabel={t`Close`}>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>New feedback link</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								The link opens the resume as it is now. Later edits aren't shared, so every comment is about this
								version.
							</Trans>
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-label`}>
							<Trans>Who is it for?</Trans>
						</Label>
						<Input
							id={`${id}-label`}
							value={label}
							maxLength={80}
							placeholder={t`For example, Careers office`}
							onChange={(event) => setLabel(event.target.value)}
						/>
						<p className="text-xs text-ink-3">
							<Trans>Only you see this.</Trans>
						</p>
					</div>

					<SwitchRow
						checked={allowComments}
						onCheckedChange={setAllowComments}
						label={t`Allow comments`}
						description={t`Off makes the link read-only.`}
					/>

					<div className="grid gap-1.5">
						<span id={`${id}-expiry`} className="text-[13px]/[18px] font-medium text-ink-2">
							<Trans>Link expires</Trans>
						</span>
						<SegmentedControl
							aria-labelledby={`${id}-expiry`}
							value={expiry}
							onValueChange={(value) => setExpiry(value as Expiry)}
							className="w-full"
						>
							{EXPIRY_DAYS.map((value) => (
								<SegmentedControlItem key={value} value={value} className="flex-1">
									{expiryLabel(value)}
								</SegmentedControlItem>
							))}
						</SegmentedControl>
					</div>

					<fieldset className="grid gap-2">
						<legend className="mb-1 text-sm font-medium">
							<Trans>Share application progress (optional)</Trans>
						</legend>
						<p className="text-xs text-ink-3">
							<Trans>The reviewer sees each one's stage and dates. Notes, contacts and pay stay private.</Trans>
						</p>
						{applications.isPending ? (
							<Spinner className="size-4" />
						) : choices.length === 0 ? (
							<p className="text-sm text-ink-3">
								<Trans>No open applications.</Trans>
							</p>
						) : (
							<ul className="grid max-h-48 gap-1 overflow-y-auto">
								{choices.map((application) => {
									const checked = applicationIds.includes(application.id);
									return (
										<li key={application.id}>
											<label
												htmlFor={`${id}-application-${application.id}`}
												className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-sm"
											>
												<Checkbox
													id={`${id}-application-${application.id}`}
													checked={checked}
													disabled={!checked && applicationIds.length >= MAX_APPLICATIONS}
													onCheckedChange={(on) => toggle(application.id, on)}
												/>
												<span className="truncate">
													{application.role} · {application.company}
												</span>
											</label>
										</li>
									);
								})}
							</ul>
						)}
					</fieldset>

					<DialogFooter>
						<Button type="button" variant="ghost" disabled={create.isPending} onClick={() => onOpenChange(false)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={create.isPending || !label.trim()}>
							{create.isPending && <Spinner decorative className="size-4" />}
							<Trans>Make link</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

type FeedbackLinkDialogProps = { id: string; onClose: () => void };

/** One link: copy it, read and tick off its comments, see its activity, or turn it off. */
function FeedbackLinkDialog({ id, onClose }: FeedbackLinkDialogProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const query = useQuery(orpc.feedback.get.queryOptions({ input: { id } }));
	const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.feedback.key() });
	const revoke = useMutation({
		...orpc.feedback.revoke.mutationOptions(),
		onSuccess: () => {
			refresh();
			toast.add({ description: t`Link turned off` });
		},
		onError: (error) => toastError(error, t`Couldn't turn off the link. Try again.`),
	});
	const resolve = useMutation({
		...orpc.feedback.resolveComment.mutationOptions(),
		onSuccess: refresh,
		onError: (error) => toastError(error, t`Couldn't update the comment. Try again.`),
	});
	const link = query.data;
	const date = (value: Date) => i18n.date(value, { dateStyle: "medium", timeStyle: "short" });

	const askRevoke = async () => {
		if (!link) return;
		const ok = await confirm(t`Turn off this link?`, {
			description: t`It stops opening at once. Comments already left are kept. You can make a new link anytime.`,
			confirmText: t`Turn off`,
		});
		if (ok) revoke.mutate({ id: link.id });
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent closeLabel={t`Close`} className="sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle>{link?.label ?? <Trans>Feedback link</Trans>}</DialogTitle>
					<DialogDescription>
						{link ? (
							<Trans>
								“{link.resumeName}” as saved {date(link.createdAt)} · {statusLabel(link.status)}
								{link.expiresAt && link.status === "active"
									? `, ${t`expires ${i18n.date(link.expiresAt, { dateStyle: "medium" })}`}`
									: ""}
							</Trans>
						) : (
							<Trans>Loading…</Trans>
						)}
					</DialogDescription>
				</DialogHeader>

				{query.isError ? (
					<p role="alert" className="text-sm text-danger-text">
						<Trans>Couldn't load this link.</Trans>
					</p>
				) : !link ? (
					<Spinner className="size-5" />
				) : (
					<div className="grid max-h-[60svh] gap-5 overflow-y-auto">
						{link.status === "active" && (
							<div className="flex min-w-0 items-center gap-2">
								<Input readOnly value={link.url} aria-label={t`Feedback link`} className="min-w-0 flex-1" dir="ltr" />
								<CopyLinkButton url={link.url} />
							</div>
						)}

						<section aria-labelledby={`${id}-comments`} className="grid gap-2">
							<h3 id={`${id}-comments`} className="text-sm font-semibold">
								<Trans>Comments</Trans>
							</h3>
							{link.comments.length === 0 ? (
								<p className="text-sm text-ink-3">
									<Trans>No comments yet.</Trans>
								</p>
							) : (
								<ol className="grid divide-y divide-line">
									{link.comments.map((comment) => (
										<li key={comment.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
											<p className="text-xs text-ink-3">
												<span className="font-semibold text-ink-2">{comment.authorName}</span> ·{" "}
												{date(comment.createdAt)}
											</p>
											<p className="text-sm wrap-anywhere whitespace-pre-wrap">{comment.body}</p>
											<label
												htmlFor={`${id}-done-${comment.id}`}
												className="flex w-fit items-center gap-2 text-xs text-ink-2"
											>
												<Checkbox
													id={`${id}-done-${comment.id}`}
													checked={Boolean(comment.resolvedAt)}
													disabled={resolve.isPending}
													onCheckedChange={(resolved) =>
														resolve.mutate({ id: link.id, commentId: comment.id, resolved })
													}
												/>
												<Trans>Done</Trans>
											</label>
										</li>
									))}
								</ol>
							)}
						</section>

						<section aria-labelledby={`${id}-activity`} className="grid gap-2">
							<h3 id={`${id}-activity`} className="text-sm font-semibold">
								<Trans>Activity</Trans>
							</h3>
							<ol className="grid gap-1 text-[13px]/[18px] text-ink-2">
								{link.events.map((event) => (
									<li key={event.id} className="flex items-baseline justify-between gap-4">
										{event.type === "created" ? (
											<Trans>Link made</Trans>
										) : event.type === "viewed" ? (
											<Trans>Opened</Trans>
										) : event.type === "commented" ? (
											<Trans>Comment left</Trans>
										) : (
											<Trans>Link turned off</Trans>
										)}
										<span className="shrink-0 t-mono text-ink-3">
											{i18n.date(event.createdAt, {
												day: "numeric",
												month: "short",
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</li>
								))}
							</ol>
						</section>
					</div>
				)}

				<DialogFooter>
					{link?.status === "active" && (
						<Button
							variant="ghost"
							className="me-auto text-danger-text hover:bg-danger-soft"
							disabled={revoke.isPending}
							onClick={() => void askRevoke()}
						>
							<Trans>Turn off link…</Trans>
						</Button>
					)}
					<Button variant="secondary" onClick={onClose}>
						<Trans>Close</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
