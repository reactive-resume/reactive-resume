import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	ArrowsClockwiseIcon,
	CaretRightIcon,
	CopyIcon,
	EnvelopeSimpleIcon,
	MagicWandIcon,
	PaperPlaneTiltIcon,
	SparkleIcon,
	SpinnerGapIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { CoverLetterEditorDialog } from "@/features/cover-letters/editor-dialog";
import { orpc } from "@/libs/orpc/client";
import { applicationsListQueryKey } from "../queries";

// Score bands drive the ring color and the label — a job-fit gauge, not a generic percentage.
function band(score: number) {
	if (score >= 75) return { color: "#10b981", label: t`Strong fit` };
	if (score >= 50) return { color: "#f59e0b", label: t`Worth a shot` };
	return { color: "#f43f5e", label: t`A stretch` };
}

function aiGaps(app: Application): string[] {
	const meta = app.aiMetadata as { matchScore?: { gaps?: unknown } } | null | undefined;
	const gaps = meta?.matchScore?.gaps;
	return Array.isArray(gaps) ? gaps.filter((gap): gap is string => typeof gap === "string") : [];
}

// The signature element: a circular resume-fit gauge that animates to the score.
function FitRing({ score }: { score: number }) {
	const size = 60;
	const stroke = 5;
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	const { color } = band(score);
	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden="true">
			<circle
				cx={size / 2}
				cy={size / 2}
				r={r}
				fill="none"
				stroke="currentColor"
				strokeWidth={stroke}
				className="text-muted"
			/>
			<circle
				cx={size / 2}
				cy={size / 2}
				r={r}
				fill="none"
				stroke={color}
				strokeWidth={stroke}
				strokeLinecap="round"
				strokeDasharray={c}
				strokeDashoffset={c - (Math.max(0, Math.min(100, score)) / 100) * c}
				className="transition-[stroke-dashoffset] duration-300 ease-out-strong motion-reduce:transition-none"
			/>
		</svg>
	);
}

type ActionRowProps = {
	icon: React.ReactNode;
	title: React.ReactNode;
	description: React.ReactNode;
	disabled?: boolean;
	pending?: boolean;
	onClick: () => void;
};

function ActionRow({ icon, title, description, disabled, pending, onClick }: ActionRowProps) {
	return (
		<button
			type="button"
			disabled={disabled || pending}
			onClick={onClick}
			className={cn(
				"group/row flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors",
				"hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-45",
			)}
		>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
				{pending ? <SpinnerGapIcon className="animate-spin" /> : icon}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block font-medium text-sm">{title}</span>
				<span className="block truncate text-muted-foreground text-xs">{description}</span>
			</span>
			<CaretRightIcon className="shrink-0 text-muted-foreground/50 transition-transform group-hover/row:translate-x-0.5" />
		</button>
	);
}

type Props = { application: Application };

export function ApplicationAiCopilot({ application }: Props) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<{ kind: string; text: string } | null>(null);
	const [coverLetterId, setCoverLetterId] = useState<string | null>(null);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		void queryClient.invalidateQueries({
			queryKey: orpc.applications.getById.queryKey({ input: { id: application.id } }),
		});
	};

	const matchScore = useMutation(
		orpc.applications.ai.matchScore.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.add({ type: "error", description: error.message || t`Match scoring failed.` }),
		}),
	);
	const tailorResume = useMutation(
		orpc.applications.ai.tailorResume.mutationOptions({
			onSuccess: (result) => {
				invalidate();
				toast.add({ type: "success", description: t`Created "${result.name}" and linked it to this application.` });
			},
			onError: (error) => toast.add({ type: "error", description: error.message || t`Tailoring failed.` }),
		}),
	);
	const draftMessage = useMutation(
		orpc.applications.ai.draftMessage.mutationOptions({
			onSuccess: (result, variables) => {
				if (result.coverLetterId) {
					setDraft(null);
					setCoverLetterId(result.coverLetterId);
					void queryClient.invalidateQueries({ queryKey: orpc.coverLetters.list.key() });
				} else {
					setDraft({ kind: variables.kind, text: result.text });
				}
			},
			onError: (error) => toast.add({ type: "error", description: error.message || t`Drafting failed.` }),
		}),
	);
	const pending = matchScore.isPending || tailorResume.isPending || draftMessage.isPending;
	const canScore = !!application.resumeId && !!application.jobDescription;
	const score = application.matchScore;
	const gaps = aiGaps(application);
	const copyDraft = useCallback(async () => {
		try {
			if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
			await navigator.clipboard.writeText(draft?.text ?? "");
			toast.add({ type: "success", description: t`Copied to clipboard.` });
		} catch {
			toast.add({
				type: "error",
				description: t`Could not copy to clipboard. Please copy the text manually.`,
			});
		}
	}, [draft?.text]);

	return (
		<section className="overflow-hidden rounded-xl border border-primary/15 bg-primary/[0.04]">
			<header className="flex items-center gap-2 px-3.5 pt-3">
				<span className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
					<SparkleIcon weight="fill" className="size-3" />
				</span>
				<span className="font-medium text-sm">
					<Trans>Application Copilot</Trans>
				</span>
			</header>

			{/* Fit gauge — the signature. Adapts to whether prerequisites are met and whether a score exists. */}
			<div className="px-3.5 py-3">
				{!canScore ? (
					<p className="rounded-lg bg-muted/50 p-2.5 text-muted-foreground text-xs">
						<Trans>Link a resume and paste the job description (Edit) to score your fit and tailor a copy.</Trans>
					</p>
				) : score == null ? (
					<button
						type="button"
						disabled={pending}
						onClick={() => matchScore.mutate({ id: application.id })}
						className="flex w-full items-center gap-3 rounded-lg border border-primary/20 border-dashed p-2.5 text-left transition-colors hover:bg-primary/10 disabled:opacity-60"
					>
						<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
							{matchScore.isPending ? (
								<SpinnerGapIcon className="size-5 animate-spin" />
							) : (
								<SparkleIcon className="size-5" />
							)}
						</span>
						<span>
							<span className="block font-medium text-sm">
								{matchScore.isPending ? <Trans>Scoring your fit…</Trans> : <Trans>Score my fit</Trans>}
							</span>
							<span className="block text-muted-foreground text-xs">
								<Trans>See how this resume matches the posting</Trans>
							</span>
						</span>
					</button>
				) : (
					<div className="flex items-center gap-3.5">
						<div className="relative flex items-center justify-center">
							<FitRing score={score} />
							<span className="absolute font-semibold text-base tabular-nums">{score}</span>
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm" style={{ color: band(score).color }}>
									{band(score).label}
								</span>
								<button
									type="button"
									disabled={pending}
									onClick={() => matchScore.mutate({ id: application.id })}
									className="text-muted-foreground text-xs hover:text-foreground disabled:opacity-50"
									title={t`Re-score`}
								>
									<ArrowsClockwiseIcon className={cn("size-3.5", matchScore.isPending && "animate-spin")} />
								</button>
							</div>
							{gaps.length > 0 && (
								<p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
									<Trans>Gaps:</Trans> {gaps.slice(0, 3).join(" · ")}
								</p>
							)}
						</div>
					</div>
				)}
			</div>

			<div className="border-primary/10 border-t px-2 py-2">
				<ActionRow
					icon={<MagicWandIcon />}
					title={<Trans>Tailor my resume</Trans>}
					description={t`Create a copy tuned to this job`}
					disabled={!canScore}
					pending={tailorResume.isPending}
					onClick={() => tailorResume.mutate({ id: application.id })}
				/>
				<ActionRow
					icon={<EnvelopeSimpleIcon />}
					title={<Trans>Draft a cover letter</Trans>}
					description={t`From your resume and the posting`}
					disabled={draftMessage.isPending}
					pending={draftMessage.isPending && draftMessage.variables?.kind === "cover-letter"}
					onClick={() => draftMessage.mutate({ id: application.id, kind: "cover-letter" })}
				/>
				<ActionRow
					icon={<PaperPlaneTiltIcon />}
					title={<Trans>Draft a follow-up</Trans>}
					description={t`A friendly nudge for the recruiter`}
					disabled={draftMessage.isPending}
					pending={draftMessage.isPending && draftMessage.variables?.kind === "follow-up"}
					onClick={() => draftMessage.mutate({ id: application.id, kind: "follow-up" })}
				/>
			</div>

			{draft && (
				<div className="border-primary/10 border-t bg-card/60 p-3">
					<div className="mb-1.5 flex items-center justify-between">
						<span className="font-medium text-xs">
							{draft.kind === "cover-letter" ? <Trans>Cover letter draft</Trans> : <Trans>Follow-up draft</Trans>}
						</span>
						<div className="flex gap-1">
							<button
								type="button"
								className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
								onClick={() => void copyDraft()}
							>
								<CopyIcon className="size-3.5" /> <Trans>Copy</Trans>
							</button>
							<button
								type="button"
								className="text-muted-foreground text-xs hover:text-foreground"
								onClick={() => setDraft(null)}
							>
								<Trans>Dismiss</Trans>
							</button>
						</div>
					</div>
					<p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
						{draft.text}
					</p>
				</div>
			)}
			{coverLetterId && <CoverLetterEditorDialog letterId={coverLetterId} onClose={() => setCoverLetterId(null)} />}
		</section>
	);
}
