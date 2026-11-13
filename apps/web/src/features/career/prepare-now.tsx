import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { interviewPreparationDue } from "@reactive-resume/schema/career-practice";
import { Button } from "@reactive-resume/ui/components/button";
import { useDefaultProvider, useGenerate } from "./hooks";
import { CareerLoadError, CareerLoading } from "./load-state";
import { GenerateNotice, useCareerTime, useNow } from "./shared";
import { AiNotice } from "./workspace/fit";
import { collectInterviews } from "@/features/applications/interviews";
import { applicationDetailQueryOptions, applicationsListQueryOptions } from "@/features/applications/queries";

type PrepareNowProps = { applicationId: string; interviewId: string; now: Date };

/** The same owned context, recipient disclosure and generation path as Interview prep, without creating a schedule. */
export function PrepareNow({ applicationId, interviewId, now }: PrepareNowProps) {
	const { i18n } = useLingui();
	const { when } = useCareerTime();
	const application = useQuery(applicationDetailQueryOptions(applicationId));
	const connection = useDefaultProvider();
	const generate = useGenerate(applicationId);
	const pending = useRef(false);
	const plan = () => {
		if (pending.current || !connection.provider) return;
		pending.current = true;
		void generate
			.run({ task: "briefing", interviewId })
			.catch(() => undefined)
			.finally(() => {
				pending.current = false;
			});
	};
	if (application.isError) return <CareerLoadError onRetry={() => void application.refetch()} />;
	if (!application.data) return <CareerLoading />;
	const round = application.data.activity.find((item) => item.type === "interview" && item.id === interviewId);
	if (application.data.status === "closed" || !round || !interviewPreparationDue(round.at, now)) return null;
	const company = application.data.company;
	const count = i18n.number(3);
	return (
		<div className="grid gap-3 border-t border-line pt-3">
			<h3 className="text-sm font-semibold">{t`Prepare for ${company}`}</h3>
			<time dateTime={round.at.toISOString()} className="text-sm text-ink-3">
				{when(round.at)}
			</time>
			<AiNotice needs={<Trans>A briefing needs AI.</Trans>} works={<Trans>Reminders work without it.</Trans>} />
			<Button variant="secondary" loading={generate.isPending} disabled={!connection.provider} onClick={plan}>
				<Trans>Generate briefing now</Trans>
			</Button>
			<GenerateNotice generate={generate} onRetry={plan} />
			{generate.data?.item && (
				<p role="status" className="text-sm text-accent-text">
					<Trans>Briefing ready</Trans>
				</p>
			)}
			<Button
				variant="secondary"
				nativeButton={false}
				render={
					<Link
						to="/dashboard/applications/$applicationId/{-$tab}"
						params={{ applicationId, tab: "practise" }}
						search={{ round: interviewId, warmup: true }}
					/>
				}
			>
				<Trans>Practice {count} questions</Trans>
			</Button>
		</div>
	);
}

/** Practice uses the upcoming round's saved questions; opening it sends no chat content or AI request. */
export function PracticeHandoff({ applicationId }: { applicationId: string | null }) {
	const applications = useQuery(applicationsListQueryOptions());
	const now = useNow();
	if (applications.isError) return <CareerLoadError onRetry={() => void applications.refetch()} />;
	const next = collectInterviews(
		(applications.data ?? []).filter((item) => item.status !== "closed" && item.id === applicationId),
	).find((item) => item.start >= now);
	if (!next) return null;
	const company = next.application.company;
	return (
		<div className="border-b border-line px-4 py-2">
			<Button
				variant="link"
				nativeButton={false}
				className="h-auto max-w-full text-start whitespace-normal"
				render={
					<Link
						to="/dashboard/applications/$applicationId/{-$tab}"
						params={{ applicationId: next.application.id, tab: "practise" }}
						search={{ round: next.interview.id, warmup: true }}
					/>
				}
			>{t`Practice in ${company}’s workspace`}</Button>
		</div>
	);
}
