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
		practice: z.boolean().optional().catch(undefined),
		title: z.string().max(200).optional().catch(undefined),
		note: z.string().max(400).optional().catch(undefined),
		/** The briefing the step belongs to, so its unsaved draft never shows under another plan. */
		plan: z.string().max(100).optional().catch(undefined),
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { storyId } = Route.useParams();
	const { edit, practice, title, note, plan } = Route.useSearch();
	return (
		<StoriesPage
			storyId={storyId}
			edit={edit ?? false}
			practice={practice ?? false}
			start={!storyId && title ? { title, note: note ?? "", plan: plan ?? "" } : undefined}
		/>
	);
}
