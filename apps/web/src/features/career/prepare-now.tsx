import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { CareerLoadError } from "./load-state";
import { useNow } from "./shared";
import { collectInterviews } from "@/features/applications/interviews";
import { applicationsListQueryOptions } from "@/features/applications/queries";

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
