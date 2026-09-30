import { ORPCError } from "@orpc/client";
import { createFileRoute, lazyRouteComponent, notFound, redirect } from "@tanstack/react-router";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";

export const Route = createFileRoute("/$username/$slug/critique")({
	ssr: false,
	component: lazyRouteComponent(() => import("@/features/resume/public/critique-resume"), "CritiqueResumeRoute"),
	loader: async ({ context, params }) => {
		const { username, slug } = params;
		const view = await context.queryClient.ensureQueryData(
			orpc.resume.critique.getCritiqueView.queryOptions({ input: { username, slug } }),
		);

		return { name: view.data.basics.name || view.name || "Resume" };
	},
	head: ({ loaderData }) => ({
		meta: [{ title: `Feedback on ${loaderData?.name ?? "Resume"} - Reactive Resume` }, createNoindexFollowMeta()],
	}),
	onError: (error) => {
		if (error instanceof ORPCError && error.code === "NEED_PASSWORD") {
			const data = error.data as { username?: string; slug?: string } | undefined;
			const username = data?.username;
			const slug = data?.slug;

			if (username && slug) {
				throw redirect({
					to: "/auth/critique-password",
					search: { redirect: `/${username}/${slug}/critique` },
				});
			}
		}

		throw notFound();
	},
});
