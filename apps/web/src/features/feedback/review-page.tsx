import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { getClosedReasonLabel, getStageLabel } from "@/features/applications/stages";
import { ResumePreview } from "@/features/resume/preview/preview";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type FeedbackView = RouterOutput["feedback"]["view"];

/** Why a link didn't open, from the server's reason. */
const unavailableReason = (error: unknown) => {
	const reason = (error as { data?: { reason?: unknown } } | null)?.data?.reason;
	return reason === "revoked" || reason === "expired" ? reason : "missing";
};

/** The page names the reviewer's saved name on this device, so a second comment doesn't ask again. */
const NAME_KEY = "feedback-reviewer-name";
const readName = () => {
	try {
		return localStorage.getItem(NAME_KEY) ?? "";
	} catch {
		return "";
	}
};

type FeedbackReviewPageProps = { token: string };

/**
 * What a feedback link opens: the resume as its owner saved it for review, the applications they chose to share, and
 * comments for them. Nothing here can change the resume.
 */
export function FeedbackReviewPage({ token }: FeedbackReviewPageProps) {
	const query = useQuery({ ...orpc.feedback.view.queryOptions({ input: { token } }), retry: false });

	if (query.isPending)
		return (
			<main id="main-content" className="grid min-h-svh place-items-center">
				<Spinner className="size-6" />
			</main>
		);

	if (query.isError) return <FeedbackUnavailable reason={unavailableReason(query.error)} />;

	return <FeedbackReview token={token} view={query.data} />;
}

type FeedbackUnavailableProps = { reason: "revoked" | "expired" | "missing" };

function FeedbackUnavailable({ reason }: FeedbackUnavailableProps) {
	return (
		<main id="main-content" className="grid min-h-svh place-items-center px-4">
			<div className="grid max-w-md justify-items-center gap-3 text-center">
				<Icon name="link-simple-horizontal-break" size={28} className="text-ink-3" />
				<h1 className="font-display text-[26px] leading-8">
					{reason === "revoked" ? (
						<Trans>This link was turned off</Trans>
					) : reason === "expired" ? (
						<Trans>This link has expired</Trans>
					) : (
						<Trans>This link doesn't open</Trans>
					)}
				</h1>
				<p className="text-sm text-ink-2">
					{reason === "missing" ? (
						<Trans>Check that you copied the whole link, or ask the person who sent it for a new one.</Trans>
					) : (
						<Trans>Ask the person who sent it for a new link. Comments you left are still with them.</Trans>
					)}
				</p>
				<Link to="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
					<Trans>Go to Reactive Resume</Trans>
				</Link>
			</div>
		</main>
	);
}

type FeedbackReviewProps = { token: string; view: FeedbackView };

function FeedbackReview({ token, view }: FeedbackReviewProps) {
	const { i18n } = useLingui();
	const sharedOn = i18n.date(view.sharedAt, { dateStyle: "medium" });
	const owner = view.ownerName;

	return (
		<main id="main-content" className="mx-auto grid w-full max-w-[1180px] gap-6 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<header className="grid gap-1.5">
				<p className="text-xs font-semibold text-ink-3">
					<Trans>Feedback request</Trans>
				</p>
				<h1 className="font-display text-[30px] leading-9 wrap-anywhere">
					<Trans>{owner} asked for your feedback</Trans>
				</h1>
				<p className="max-w-[70ch] text-sm text-ink-2">
					<Trans>
						This is “{view.resumeName}” as they saved it on {sharedOn}. Your comments go only to them and don't change
						the resume.
					</Trans>
				</p>
			</header>

			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
				<FittedResume view={view} />
				<aside aria-label={t`Comments and progress`} className="grid gap-6 lg:sticky lg:top-6">
					<FeedbackComments token={token} view={view} />
					{view.applications.length > 0 && <SharedProgress applications={view.applications} />}
				</aside>
			</div>
		</main>
	);
}

/** The resume's pages scaled to the column, up to their printed width. */
function FittedResume({ view }: { view: FeedbackView }) {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const pageWidth = view.data.metadata.page.format === "letter" ? 612 : 595;

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return (
		<section ref={ref} aria-label={t`Resume`} className="min-w-0 rounded-xl bg-sunken p-4 max-sm:p-2">
			{width > 0 && (
				<ResumePreview
					data={view.data}
					pageLayout="vertical"
					pageGap={16}
					pageScale={Math.min(1.25, width / pageWidth)}
					className="mx-auto w-fit"
					pageClassName="rounded-none shadow-page"
					contentLabel={t`Resume content`}
				/>
			)}
		</section>
	);
}

function FeedbackComments({ token, view }: FeedbackReviewProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const id = useId();
	const [name, setName] = useState(readName);
	const [body, setBody] = useState("");
	const comment = useMutation({
		...orpc.feedback.comment.mutationOptions(),
		onSuccess: (created) => {
			try {
				localStorage.setItem(NAME_KEY, created.authorName);
			} catch {
				// Remembering the name is a convenience; the comment is saved either way.
			}
			queryClient.setQueryData(
				orpc.feedback.view.queryKey({ input: { token } }),
				(current: FeedbackView | undefined) =>
					current ? { ...current, comments: [...current.comments, created] } : current,
			);
			setBody("");
			toast.add({ type: "success", description: t`Comment sent to ${view.ownerName}` });
		},
		onError: (error) => toastError(error, t`Couldn't send your comment. Try again.`, { allowServerMessage: true }),
	});

	const submit = () => {
		if (comment.isPending || !name.trim() || !body.trim()) return;
		comment.mutate({ token, authorName: name.trim(), body: body.trim() });
	};

	return (
		<section aria-labelledby={`${id}-title`} className="grid gap-3 rounded-xl border border-line p-4">
			<h2 id={`${id}-title`} className="text-sm font-semibold">
				<Trans>Comments</Trans>
			</h2>
			{view.comments.length === 0 ? (
				<p className="text-sm text-ink-3">
					<Trans>No comments yet.</Trans>
				</p>
			) : (
				<ol className="grid gap-3">
					{view.comments.map((item) => (
						<li key={item.id} className="grid gap-1 rounded-lg bg-sunken p-3">
							<p className="text-xs text-ink-3">
								<span className="font-semibold text-ink-2">{item.authorName}</span> ·{" "}
								{i18n.date(item.createdAt, { dateStyle: "medium", timeStyle: "short" })}
							</p>
							<p className="text-sm wrap-anywhere whitespace-pre-wrap">{item.body}</p>
						</li>
					))}
				</ol>
			)}
			{view.allowComments ? (
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-name`}>
							<Trans>Your name</Trans>
						</Label>
						<Input
							id={`${id}-name`}
							value={name}
							maxLength={80}
							autoComplete="name"
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-body`}>
							<Trans>Comment</Trans>
						</Label>
						<Textarea
							id={`${id}-body`}
							value={body}
							maxLength={4000}
							rows={5}
							onChange={(event) => setBody(event.target.value)}
						/>
					</div>
					<Button type="submit" className="w-fit" disabled={comment.isPending || !name.trim() || !body.trim()}>
						{comment.isPending ? <Spinner decorative className="size-4" /> : <Icon name="chat-text" />}
						<Trans>Send comment</Trans>
					</Button>
				</form>
			) : (
				<p className="text-sm text-ink-2">
					<Trans>This link is read-only. Reply to {view.ownerName} directly with your thoughts.</Trans>
				</p>
			)}
		</section>
	);
}

type SharedProgressProps = { applications: FeedbackView["applications"] };

/** Only the stage and dates of each application the owner chose. */
function SharedProgress({ applications }: SharedProgressProps) {
	const { i18n } = useLingui();
	const id = useId();
	const stageName = (stage: { status: FeedbackView["applications"][number]["status"]; stageLabel: string | null }) =>
		stage.stageLabel ?? getStageLabel(stage.status);

	return (
		<section aria-labelledby={`${id}-title`} className="grid gap-3 rounded-xl border border-line p-4">
			<div className="grid gap-1">
				<h2 id={`${id}-title`} className="text-sm font-semibold">
					<Trans>Application progress</Trans>
				</h2>
				<p className="text-xs text-ink-3">
					<Trans>Stages and dates only. Notes, contacts and pay stay private.</Trans>
				</p>
			</div>
			<ul className="grid gap-3">
				{applications.map((application, index) => (
					// Shared applications carry no ID, so the list's order is their identity.
					// oxlint-disable-next-line react/no-array-index-key -- the server sends a stable order and no IDs.
					<li key={index} className="grid gap-1.5 border-t border-line pt-3 first:border-t-0 first:pt-0">
						<p className="text-sm font-semibold wrap-anywhere">
							{application.role} · {application.company}
						</p>
						<p className={cn("text-xs text-ink-2")}>
							{stageName(application)}
							{application.closedReason ? ` · ${getClosedReasonLabel(application.closedReason)}` : ""}
							{application.appliedAt ? (
								<>
									{" · "}
									<Trans>Applied {i18n.date(application.appliedAt, { dateStyle: "medium" })}</Trans>
								</>
							) : null}
						</p>
						{application.stages.length > 0 && (
							<ol className="grid gap-0.5 text-xs text-ink-3">
								{application.stages.map((stage) => (
									<li key={`${stage.status}:${stage.at.toISOString()}`}>
										{stageName(stage)} ·{" "}
										{stage.dateUnknown ? <Trans>date unknown</Trans> : i18n.date(stage.at, { dateStyle: "medium" })}
									</li>
								))}
							</ol>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
