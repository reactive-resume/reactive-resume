import { createFileRoute } from "@tanstack/react-router";
import { Homepage } from "@/features/homepage/page";
import { getHomepageMeta } from "@/libs/seo";

// An instance's root resume (`ROOT_RESUME_ID`) is served by the server as a web page; the app only shows the home.
export const Route = createFileRoute("/_home/")({
	component: Homepage,
	head: () => {
		const { title, description } = getHomepageMeta();
		return { meta: [{ title }, { name: "description", content: description }] };
	},
});
