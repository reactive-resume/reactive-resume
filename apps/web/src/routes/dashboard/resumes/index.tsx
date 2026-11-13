import { createFileRoute, redirect } from "@tanstack/react-router";
import z from "zod";

// The resume library is now Documents (6.0). This stub keeps old links working through 6.0.x (Q2).
const SORTS = { lastUpdatedAt: "edited", createdAt: "created", name: "name" } as const;

export const Route = createFileRoute("/dashboard/resumes/")({
	validateSearch: z.object({
		tags: z.array(z.string()).optional().catch(undefined),
		sort: z.enum(["lastUpdatedAt", "createdAt", "name"]).optional().catch(undefined),
		view: z.enum(["grid", "compact", "list"]).optional().catch(undefined),
	}),
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/dashboard/documents",
			search: {
				type: "resume",
				...(search.tags?.length ? { tags: search.tags } : {}),
				...(search.sort ? { sort: SORTS[search.sort] } : {}),
				...(search.view === "list" ? { view: "list" as const } : {}),
			},
			replace: true,
		});
	},
});
