import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { List, ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import { StageDot } from "@/components/calm/stage-dot";
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
		<main id="main-content" className="grid min-h-svh place-items-center px-5 py-10">
			<div className="flex max-w-[400px] flex-col items-center gap-2 text-center">
				<Icon
					name={reason === "revoked" ? "link-break" : reason === "expired" ? "clock" : "question"}
					size={32}
					className="text-ink-3"
				/>
				<h1 className="pt-1 t-section-title">
					{reason === "revoked" ? (
						<Trans>This link was turned off</Trans>
					) : reason === "expired" ? (
						<Trans>This link has expired</Trans>
					) : (
						<Trans>This link doesn't open</Trans>
					)}
				</h1>
				<p className="text-ink-2 t-ui">
					{reason === "missing" ? (
						<Trans>Check that you copied the whole link, or ask the person who sent it for a new one.</Trans>
					) : (
						<Trans>Ask the person who sent it for a new link. Comments you left are still with them.</Trans>
					)}
				</p>
				<Link to="/" className={buttonVariants({ variant: "secondary", className: "mt-2.5" })}>
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
		<div className="flex min-h-svh flex-col lg:h-svh">
			<header
				data-design="ebar"
				className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg ps-5 pe-4 max-sm:ps-4"
			>
				<div className="flex min-w-0 flex-col px-1">
					<span className="truncate text-[15px]/5 font-semibold">{view.resumeName}</span>
					<span className="truncate font-normal text-ink-3 t-caption">
						<Trans>
							{owner}'s resume · as saved {sharedOn} · read-only
						</Trans>
					</span>
				</div>
				<Link to="/" className="ms-auto flex shrink-0 items-center gap-2 rounded-xs text-ink-3 t-caption">
					<BrandIcon variant="icon" alt="" className="size-[18px]" />
					<span className="max-sm:sr-only">Reactive Resume</span>
				</Link>
			</header>

			<main id="main-content" className="flex min-h-0 flex-1 flex-col lg:flex-row">
				<FittedResume view={view} />
				<aside
					aria-label={t`Comments and progress`}
					className="shrink-0 border-line bg-bg px-6 pt-5 pb-10 max-lg:border-t max-sm:px-4 lg:w-[392px] lg:overflow-y-auto lg:border-s"
				>
					<h1 className="wrap-anywhere t-page-title">
						{view.allowComments ? (
							<Trans>{owner} asked for your feedback</Trans>
						) : (
							<Trans>{owner} asked you to take a look</Trans>
						)}
					</h1>
					<p className="pt-2 text-ink-3 t-small">
						{view.allowComments ? (
							<Trans>Your comments go only to {owner} and don't change the resume.</Trans>
						) : (
							<Trans>
								“{view.resumeName}” as saved on {sharedOn}.
							</Trans>
						)}
					</p>
					<FeedbackComments token={token} view={view} />
					{view.applications.length > 0 && <SharedProgress applications={view.applications} />}
				</aside>
			</main>
		</div>
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
		<section
			ref={ref}
			data-design="canvas"
			aria-label={t`Resume`}
			className="min-w-0 flex-1 bg-sunken px-6 pt-7 pb-10 max-sm:px-2 max-sm:pt-2 lg:overflow-y-auto dark:bg-raised"
		>
			{width > 0 && (
				<ResumePreview
					data={view.data}
					pageLayout="vertical"
					pageGap={16}
					pageScale={Math.min(1.25, width / pageWidth)}
					className="mx-auto w-fit"
					pageClassName="rounded-paper shadow-page"
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

	// A link made without comments has none to show: one sentence stands in for the whole section.
	if (!view.allowComments && view.comments.length === 0)
		return (
			<Alert variant="info" className="mt-3.5">
				<Icon name="info" />
				<AlertDescription>
					<Trans>This link is read-only. Reply to {view.ownerName} directly with your thoughts.</Trans>
				</AlertDescription>
			</Alert>
		);

	return (
		<section aria-labelledby={`${id}-title`}>
			<SectionHeading
				id={`${id}-title`}
				className="pt-[22px] pb-0"
				note={view.comments.length > 0 ? view.comments.length : undefined}
			>
				<Trans>Comments</Trans>
			</SectionHeading>
			{view.comments.length === 0 ? (
				<p className="pt-1 text-ink-3 t-small">
					<Trans>No comments yet.</Trans>
				</p>
			) : (
				<ol>
					{view.comments.map((item) => (
						<li key={item.id} className="flex flex-col gap-1 border-b border-line py-3 first:pt-1">
							<p className="text-xs/4 text-ink-3">
								<b className="font-semibold text-ink-2">{item.authorName}</b> ·{" "}
								{i18n.date(item.createdAt, { dateStyle: "medium", timeStyle: "short" })}
							</p>
							<p className="text-sm/[21px] wrap-anywhere whitespace-pre-wrap">{item.body}</p>
						</li>
					))}
				</ol>
			)}
			{view.allowComments ? (
				<form
					className="mt-4 flex flex-col gap-3.5"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<div className="flex flex-col gap-1.5">
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
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${id}-body`}>
							<Trans>Comment</Trans>
						</Label>
						<Textarea
							id={`${id}-body`}
							value={body}
							maxLength={4000}
							rows={3}
							className="min-h-[84px]"
							onChange={(event) => setBody(event.target.value)}
						/>
					</div>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<Button type="submit" disabled={comment.isPending || !name.trim() || !body.trim()}>
							{comment.isPending ? <Spinner decorative className="size-4" /> : <Icon name="chat-text" />}
							<Trans>Send comment</Trans>
						</Button>
						<span className="text-xs/4 text-ink-3">
							<Trans>{view.ownerName} sees your name with it.</Trans>
						</span>
					</div>
				</form>
			) : (
				<Alert variant="info" className="mt-3.5">
					<Icon name="info" />
					<AlertDescription>
						<Trans>This link is read-only. Reply to {view.ownerName} directly with your thoughts.</Trans>
					</AlertDescription>
				</Alert>
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
		<section aria-labelledby={`${id}-title`}>
			<SectionHeading id={`${id}-title`} className="pt-[26px]">
				<Trans>Application progress</Trans>
			</SectionHeading>
			<p className="text-ink-3 t-small">
				<Trans>Stages and dates only. Notes, contacts and pay stay private.</Trans>
			</p>
			<List className="mt-1.5">
				{applications.map((application, index) => (
					// Shared applications carry no ID, so the list's order is their identity.
					// oxlint-disable-next-line react/no-array-index-key -- the server sends a stable order and no IDs.
					<ListRow key={index}>
						<span className="flex min-w-0 flex-1 flex-col gap-px">
							<span className="text-[15px]/[22px] font-medium wrap-anywhere">
								{application.role} · {application.company}
							</span>
							<StageDot status={application.status} className="text-ink-3 t-small">
								{stageName(application)}
								{application.closedReason ? ` · ${getClosedReasonLabel(application.closedReason)}` : ""}
								{application.appliedAt ? (
									<>
										{" · "}
										{application.status === "applied" ? (
											i18n.date(application.appliedAt, { dateStyle: "medium" })
										) : (
											<Trans>applied {i18n.date(application.appliedAt, { dateStyle: "medium" })}</Trans>
										)}
									</>
								) : null}
							</StageDot>
							{application.stages.length > 1 && (
								<ol className="pt-1 font-normal text-ink-3 t-caption">
									{application.stages.map((stage) => (
										<li key={`${stage.status}:${stage.at.toISOString()}`}>
											{stageName(stage)} ·{" "}
											{stage.dateUnknown ? <Trans>date unknown</Trans> : i18n.date(stage.at, { dateStyle: "medium" })}
										</li>
									))}
								</ol>
							)}
						</span>
					</ListRow>
				))}
			</List>
		</section>
	);
}
