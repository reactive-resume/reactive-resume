import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { StoriesPage } from "@/features/career/knowledge/stories";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career/knowledge/stories/{-$storyId}")({
	head: () => ({ meta: [{ title: getPageTitle(t`Stories`) }] }),
	// `edit`: the story editor; with no story id it's a new story. `title` and `note` start a new story from an interview
	// plan's "Draft story" step.
	validateSearch: z.object({
		edit: z.boolean().optional().catch(undefined),
		title: z.string().max(200).optional().catch(undefined),
		note: z.string().max(400).optional().catch(undefined),
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { storyId } = Route.useParams();
	const { edit, title, note } = Route.useSearch();
	return (
		<StoriesPage
			storyId={storyId}
			edit={edit ?? false}
			start={!storyId && title ? { title, note: note ?? "" } : undefined}
		/>
	);
}
