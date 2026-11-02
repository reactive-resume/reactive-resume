import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { FeedbackReviewPage } from "@/features/feedback/review-page";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/feedback/$token")({
	component: RouteComponent,
	// A feedback link is private to whoever holds it.
	head: () => ({
		meta: [{ title: getPageTitle(t`Feedback request`) }, { name: "robots", content: "noindex, nofollow" }],
	}),
});

function RouteComponent() {
	const { token } = Route.useParams();
	return <FeedbackReviewPage token={token} />;
}
