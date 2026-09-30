import type { RouterOutput } from "@/libs/orpc/client";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/client";
import { createFileRoute, lazyRouteComponent, notFound, redirect } from "@tanstack/react-router";
import { getResumeSocialMeta } from "@reactive-resume/resume/social-meta";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";

type LoaderData = Omit<RouterOutput["resume"]["getBySlug"], "data"> & { data: ResumeData };

export const Route = createFileRoute("/$username/$slug")({
	component: lazyRouteComponent(() => import("@/features/resume/public/public-resume"), "PublicResumeRoute"),
	notFoundComponent: lazyRouteComponent(
		() => import("@/features/resume/public/public-resume"),
		"SharedResumeUnavailable",
	),
	loader: async ({ context, params }) => {
		const { username, slug } = params;
		const resume = await context.queryClient.ensureQueryData(
			orpc.resume.getBySlug.queryOptions({ input: { username, slug } }),
		);

		// A renamed resume's old address still finds it for 30 days; send visitors to the current one.
		if (resume.slug !== slug) {
			throw redirect({ to: "/$username/$slug", params: { username, slug: resume.slug }, replace: true });
		}

		return { resume: resume as LoaderData };
	},
	head: ({ loaderData }) => {
		const resume = loaderData?.resume;
		const name = resume ? resume.data.basics.name || resume.name || "Resume" : "Reactive Resume";

		if (!resume) {
			return { meta: [{ title: `${name} - Reactive Resume` }, createNoindexFollowMeta()] };
		}

		const social = getResumeSocialMeta(resume.data, resume.name || "Resume");

		return {
			meta: [
				{ title: `${social.name} - Reactive Resume` },
				{ name: "description", content: social.description },
				createNoindexFollowMeta(),
			],
		};
	},
	onError: (error) => {
		if (error instanceof ORPCError && error.code === "NEED_PASSWORD") {
			const data = error.data as { username?: string; slug?: string } | undefined;
			const username = data?.username;
			const slug = data?.slug;

			if (username && slug) {
				throw redirect({
					to: "/auth/resume-password",
					search: { redirect: `/${username}/${slug}` },
				});
			}
		}

		throw notFound();
	},
});
