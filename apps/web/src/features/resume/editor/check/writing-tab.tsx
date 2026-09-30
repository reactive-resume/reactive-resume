import type { WritingNote } from "../store";
import type { CheckIssue } from "./issues";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { collectPassages } from "@reactive-resume/resume/proposals";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { ProposalList } from "../proposals/proposal-list";
import { useEditorStore } from "../store";
import { describeEntry } from "../write/model";
import { getSectionName } from "./issues";
import { mapWritingReview } from "./review";
import { AiProviderPicker } from "@/features/settings/integrations/components/ai-provider-picker";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/** The endpoint's caps; the text and lists are trimmed here so a long resume is never refused. */
const MAX_TEXT_CHARS = 50_000;
const MAX_FINDINGS = 120;
const MAX_PASSAGES = 120;
const MAX_PASSAGE_CHARS = 1_000;

type WritingTabProps = { data: ResumeData; issues: readonly CheckIssue[] };

/**
 * Writing: an opt-in AI review of the wording. It says what it sends before it runs, returns rewrites of bullets
 * and paragraphs as proposals to accept or reject, and is never part of the score. Its errors stay in this tab.
 */
export function WritingTab({ data, issues }: WritingTabProps) {
	const { usableProviders, hasUsableProvider, isLoading } = useHasUsableAiProvider();
	const [providerOverride, setProviderOverride] = useState<string | null>(null);
	const [choosing, setChoosing] = useState(false);
	const review = useEditorStore((state) => state.writingReview);
	const proposals = useEditorStore((state) => state.proposals);
	const setWritingReview = useEditorStore((state) => state.setWritingReview);
	const setProposals = useEditorStore((state) => state.setProposals);

	const provider = usableProviders.find((entry) => entry.id === providerOverride) ?? usableProviders[0];
	const passages = collectPassages(data, {
		summary: getSectionName(data, "summary"),
		sectionTitle: (sectionId) => getSectionName(data, sectionId),
		entryTitle: (type, entry) => describeEntry(type as never, entry as never).title,
		bullet: (n) => t`bullet ${n}`,
		paragraph: (n) => t`paragraph ${n}`,
	}).slice(0, MAX_PASSAGES);

	const { mutate, isPending, error, reset } = useMutation({
		...orpc.ai.atsReview.mutationOptions(),
		onSuccess: (result) => {
			const { proposals: next, notes } = mapWritingReview(result.suggestions, passages);
			setProposals(next);
			setWritingReview({ summary: result.summary, strengths: result.strengths, notes });
		},
	});

	const run = () => {
		reset();
		mutate({
			...(provider ? { aiProviderId: provider.id } : {}),
			extractedText: buildMarkdown(data).slice(0, MAX_TEXT_CHARS),
			findings: issues.slice(0, MAX_FINDINGS).map((issue) => ({
				code: issue.finding.code,
				severity: issue.finding.severity,
				message: issue.title.slice(0, 300),
			})),
			passages: passages.map((passage) => ({
				id: passage.id,
				where: passage.location.slice(0, 200),
				text: passage.text.slice(0, MAX_PASSAGE_CHARS),
			})),
		});
	};

	if (isLoading) return null;

	if (!hasUsableProvider) {
		return (
			<div className="grid gap-3 rounded-xl border border-line p-4">
				<strong className="text-sm font-semibold">
					<Trans>A second opinion on your wording</Trans>
				</strong>
				<p className="text-[13px] leading-[19px] text-ink-2">
					<Trans>
						Connect your own AI provider to have a language model read your bullets and suggest rewrites. Issues and Job
						match need no provider.
					</Trans>
				</p>
				<Link
					to="/dashboard/settings/ai"
					className={buttonVariants({ size: "sm", variant: "secondary", className: "w-fit" })}
				>
					<Trans>Open AI settings</Trans>
				</Link>
			</div>
		);
	}

	if (isPending) {
		return (
			<div aria-busy="true" className="flex items-center gap-2.5 rounded-xl border border-line p-4 text-sm text-ink-2">
				<Spinner />
				<Plural
					value={passages.length}
					one="Reading # passage of your resume…"
					other="Reading # bullets and paragraphs of your resume…"
				/>
			</div>
		);
	}

	if (error) {
		return (
			<div className="grid gap-3">
				<div
					role="alert"
					className="flex gap-2.5 rounded-xl bg-danger-soft p-3 text-[13px] leading-[19px] text-danger-text"
				>
					<Icon name="error" />
					<span>
						{getOrpcErrorMessage(error, {
							byCode: {
								BAD_GATEWAY: t`Couldn't reach your AI provider. Its key may have expired.`,
								BAD_REQUEST: t`The provider returned a review that couldn't be read. Try again.`,
								PRECONDITION_FAILED: t`AI providers are unavailable until ENCRYPTION_SECRET is configured.`,
							},
							fallback: t`The review couldn't finish. Try again.`,
						})}
					</span>
				</div>
				<div className="flex gap-1.5">
					<Button size="sm" onClick={run}>
						<Trans>Retry</Trans>
					</Button>
					<Link to="/dashboard/settings/ai" className={buttonVariants({ size: "sm", variant: "secondary" })}>
						<Trans>Open AI settings</Trans>
					</Link>
				</div>
				<p className="text-xs text-ink-3">
					<Trans>Issues and Job match still work without AI.</Trans>
				</p>
			</div>
		);
	}

	if (!review) {
		return (
			<div className="grid gap-3 rounded-xl border border-line p-4">
				<strong className="text-sm font-semibold">
					<Trans>A second opinion on your wording</Trans>
				</strong>
				<p className="text-[13px] leading-[19px] text-ink-2">
					<Trans>
						The checks are mechanical. This asks a language model how a reader might react to your bullets and suggests
						rewrites. It isn't part of the score.
					</Trans>
				</p>
				<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
					<Icon name="lock" size={16} />
					<span>
						<Trans>
							Sends your resume's text only to {provider?.label} · {provider?.model}, with your key.
						</Trans>
					</span>
					<button
						type="button"
						aria-expanded={choosing}
						className="font-medium text-ink-2 underline underline-offset-2"
						onClick={() => setChoosing(!choosing)}
					>
						<Trans>Change</Trans>
					</button>
				</div>
				{choosing && (
					<AiProviderPicker
						value={provider?.id ?? null}
						providers={usableProviders}
						onValueChange={(value) => {
							setProviderOverride(value);
							setChoosing(false);
						}}
					/>
				)}
				<Button size="sm" variant="secondary" className="w-fit" disabled={passages.length === 0} onClick={run}>
					<Icon name="auto_awesome" size={16} />
					<Trans>Review writing</Trans>
				</Button>
				{passages.length === 0 && (
					<p className="text-xs text-ink-3">
						<Trans>Add a summary or describe a role first; there's nothing to review yet.</Trans>
					</p>
				)}
			</div>
		);
	}

	return (
		<div className="grid gap-3">
			{review.summary && <p className="text-[13px] leading-[19px] text-ink-2">{review.summary}</p>}

			{proposals.length > 0 && <ProposalList proposals={proposals} data={data} onSuggestAgain={run} />}

			{review.notes.map((note) => (
				<WritingNoteCard key={`${note.location}:${note.note}`} note={note} />
			))}

			{review.strengths.length > 0 && (
				<section aria-labelledby="writing-strengths" className="grid gap-1.5">
					<h3 id="writing-strengths" className="pt-1.5 text-xs font-semibold text-ink-3 uppercase">
						<Trans>What's working</Trans>
					</h3>
					<ul className="grid list-disc gap-1 ps-[18px] text-[13px] leading-[19px] text-ink-2">
						{review.strengths.map((strength) => (
							<li key={strength}>{strength}</li>
						))}
					</ul>
				</section>
			)}

			<p className="text-xs leading-[17px] text-ink-3">
				<Trans>A model's opinion, not a verdict. It can be wrong.</Trans>{" "}
				<button type="button" className="font-medium text-ink-2 underline underline-offset-2" onClick={run}>
					<Trans>Run again</Trans>
				</button>
			</p>
		</div>
	);
}

const impactLabel = (impact: WritingNote["impact"]) => ({ high: t`High`, medium: t`Medium`, low: t`Low` })[impact];

function WritingNoteCard({ note }: { note: WritingNote }) {
	const breakpoint = useBreakpoint();

	const showOnPage = () => {
		if (!note.target) return;
		const editor = useEditorStore.getState();
		editor.select(note.target);
		editor.setPageView("page");
		if (breakpoint === "tablet") editor.setDrawerOpen(false);
		if (breakpoint === "mobile") editor.setMobileView("page");
	};

	return (
		<article className="grid gap-1.5 rounded-[10px] border border-line p-3">
			<div className="flex justify-between gap-2">
				<span className="font-mono text-[11px] text-ink-3 uppercase">{note.location}</span>
				<span
					className={cn(
						"h-[18px] rounded px-1.5 text-[11px] leading-[18px] font-semibold",
						note.impact === "high" ? "bg-warn-soft text-warn-text" : "bg-sunken text-ink-2",
					)}
				>
					{impactLabel(note.impact)}
				</span>
			</div>
			<p className="text-[13px] leading-[19px]">
				{note.quote && <i className="text-ink-2">“{note.quote}”</i>} {note.note}
			</p>
			{note.target && (
				<Button size="sm" variant="secondary" className="w-fit" onClick={showOnPage}>
					<Trans>Show on page</Trans>
				</Button>
			)}
		</article>
	);
}
