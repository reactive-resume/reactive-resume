import type { CheckIssue } from "./issues";
import type { WritingNote } from "./review";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Dispatch, SetStateAction } from "react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import {
	applyProposal,
	blockText,
	canApply,
	collectPassages,
	getProposalState,
} from "@reactive-resume/resume/proposals";
import { editWithUndo } from "./actions";
import { getSectionName } from "./issues";
import { mapWritingReview } from "./review";
import { client } from "@/api/client";
import { useResumeStore } from "@/draft";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { ReportAiContent } from "@/features/ai/report-content";
import { Banner, Button, Card, SelectSheet, Skeleton, Text, useTheme } from "@/ui";

type WritingProps = {
	id: string;
	data: ResumeData;
	issues: CheckIssue[];
	offline: boolean;
	locked: boolean;
	review: WritingReview | null;
	setReview: Dispatch<SetStateAction<WritingReview | null>>;
};
export type WritingReview = { summary: string; strengths: string[]; proposals: Proposal[]; notes: WritingNote[] };

export function Writing({ id, data, issues, offline, locked, review, setReview }: WritingProps) {
	const { t } = useLingui();
	const applications = useResumeStore((state) => state.proposalApplications);
	const { space } = useTheme();
	const providers = useHasAIProvider();
	const [setup, setSetup] = useState(false);
	const [providerId, setProviderId] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState(false);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const provider = providers.usableProviders.find((entry) => entry.id === providerId) ?? providers.defaultProvider;
	const passages = collectPassages(data, {
		summary: getSectionName(data, "summary"),
		sectionTitle: (id) => getSectionName(data, id),
		// coordinator: M3-T5 fields.ts labels replace this id seam after merge.
		entryTitle: (_type, entry) => String(entry.company ?? entry.school ?? entry.name ?? entry.id ?? ""),
		bullet: (n) => t`bullet ${n}`,
		paragraph: (n) => t`paragraph ${n}`,
	}).slice(0, 120);

	const run = async () => {
		if (controller.current || offline || !provider || !passages.length) return;
		const request = new AbortController();
		controller.current = request;
		setPending(true);
		setError(false);
		try {
			const result = await client.ai.atsReview(
				{
					aiProviderId: provider.id,
					extractedText: buildMarkdown(data).slice(0, 50_000),
					findings: issues.slice(0, 120).map((issue) => ({
						code: issue.finding.code,
						severity: issue.finding.severity,
						message: issue.title.slice(0, 300),
					})),
					passages: passages.map((passage) => ({
						id: passage.id,
						where: passage.location.slice(0, 200),
						text: passage.text.slice(0, 1000),
					})),
				},
				{ signal: request.signal },
			);
			if (!request.signal.aborted)
				setReview({
					summary: result.summary,
					strengths: result.strengths,
					...mapWritingReview(result.suggestions, passages),
				});
		} catch {
			if (!request.signal.aborted) setError(true);
		} finally {
			if (!request.signal.aborted) setPending(false);
			if (controller.current === request) controller.current = null;
		}
	};

	const accept = (proposal: Proposal) => {
		const current = useResumeStore.getState();
		if (!current.data || !canApply(current.data, proposal)) return;
		if (
			editWithUndo(
				id,
				(draft) => {
					applyProposal(draft, proposal);
				},
				t`Rewrite accepted`,
				[proposal],
			)
		)
			setReview(
				(review) =>
					review && {
						...review,
						proposals: review.proposals.map((entry) =>
							entry.id === proposal.id ? { ...entry, status: "accepted" } : entry,
						),
					},
			);
	};

	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="title">{t`A second opinion on your wording`}</Text>
			<Text color="ink2">{t`The checks are mechanical. This asks a language model how a reader might react to your bullets and suggests rewrites. It isn't part of the score.`}</Text>
			{providers.isLoading ? (
				<Skeleton height={space.s12} />
			) : providers.error ? (
				<Banner
					tone="danger"
					message={t`Couldn't load AI providers.`}
					action={{ label: t`Retry`, onPress: providers.retry }}
				/>
			) : !providers.hasAIProvider ? (
				<Button label={t`Connect an AI provider`} onPress={() => setSetup(true)} />
			) : (
				<>
					<SelectSheet
						label={t`AI provider`}
						value={provider?.id ?? null}
						options={providers.usableProviders.map((entry) => ({
							value: entry.id,
							label: `${entry.label} · ${entry.model}`,
						}))}
						onChange={setProviderId}
					/>
					<Text
						variant="callout"
						color="ink3"
					>{t`Sends your resume's text only to ${provider?.label} · ${provider?.model}, with your key.`}</Text>
					{error && (
						<Banner
							tone="danger"
							message={t`Couldn't reach your AI provider. Try again or check its key in AI settings.`}
						/>
					)}
					<Button
						label={error ? t`Retry` : review ? t`Run again` : t`Review writing`}
						loading={pending}
						disabled={offline || pending || !passages.length}
						onPress={() => void run()}
					/>
					{pending && (
						<Button
							variant="ghost"
							label={t`Cancel`}
							onPress={() => {
								controller.current?.abort();
								controller.current = null;
								setPending(false);
							}}
						/>
					)}
					{!passages.length && (
						<Text color="ink3">{t`Add a summary or describe a role first; there's nothing to review yet.`}</Text>
					)}
				</>
			)}
			{review && (
				<>
					<Text>{review.summary}</Text>
					<ReportAiContent source="writing" text={JSON.stringify(review, null, 2)} />
					{review.proposals.map((proposal) => {
						const state = getProposalState(data, proposal, applications);
						const stale = state === "stale";
						return (
							<Card key={proposal.id} style={{ gap: space.s2 }}>
								<Text variant="caption" color="ink3">
									{proposal.location}
								</Text>
								<Text color="ink2">{blockText(proposal.before)}</Text>
								<Text color="accentText">{blockText(proposal.after)}</Text>
								<Text variant="callout">{proposal.why}</Text>
								{stale ? (
									<Text color="warnText">{t`This passage changed. Run the review again.`}</Text>
								) : state === "pending" ? (
									<View style={{ flexDirection: "row", gap: space.s2, flexWrap: "wrap" }}>
										<Button label={t`Accept`} disabled={locked} onPress={() => accept(proposal)} />
										<Button
											variant="ghost"
											label={t`Reject`}
											onPress={() =>
												setReview({
													...review,
													proposals: review.proposals.map((entry) =>
														entry.id === proposal.id ? { ...entry, status: "rejected" } : entry,
													),
												})
											}
										/>
									</View>
								) : (
									<Text color="ink3">{state === "accepted" ? t`Applied` : t`Rejected`}</Text>
								)}
							</Card>
						);
					})}
					{review.notes.map((note, index) => (
						<Card key={index}>
							<Text variant="caption">{note.location}</Text>
							<Text>{note.note}</Text>
						</Card>
					))}
					<Text variant="title">{t`What's working`}</Text>
					{review.strengths.map((strength, index) => (
						<Text key={index}>{strength}</Text>
					))}
					<Text variant="callout" color="ink3">{t`A model's opinion, not a verdict. It can be wrong.`}</Text>
				</>
			)}
			<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
		</View>
	);
}
