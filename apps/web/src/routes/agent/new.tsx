import { createFileRoute, redirect } from "@tanstack/react-router";
import z from "zod";

export const Route = createFileRoute("/agent/new")({
	validateSearch: z.object({ resumeId: z.string().optional().catch(undefined) }),
	beforeLoad: ({ search }) => {
		if (!search.resumeId) throw redirect({ to: "/dashboard/documents", replace: true });
		throw redirect({
			to: "/builder/$resumeId",
			params: { resumeId: search.resumeId },
			search: { assistant: "new" },
			replace: true,
		});
	},
});
