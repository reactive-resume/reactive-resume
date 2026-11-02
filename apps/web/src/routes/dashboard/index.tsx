import type { DocumentsSearch } from "@/features/documents/documents-page";
import type { Template } from "@reactive-resume/schema/templates";
import { t } from "@lingui/core/macro";
import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";
import z from "zod";
import { templateSchema } from "@reactive-resume/schema/templates";
import { DocumentsPage } from "@/features/documents/documents-page";
import { useStartDocument } from "@/features/documents/use-start-document";
import { getPageTitle } from "@/libs/seo";

const defaults = { type: "all", q: "", tags: [], public: false, sort: "edited" } satisfies DocumentsSearch;

export const Route = createFileRoute("/dashboard/")({
	head: () => ({ meta: [{ title: getPageTitle(t`Documents`) }] }),
	validateSearch: z.object({
		type: z.enum(["all", "resume", "letter"]).default("all").catch("all"),
		q: z
			.string()
			.transform((value) => value.slice(0, 500))
			.default("")
			.catch(""),
		tags: z
			.array(z.string())
			.transform((tags) => [...new Set(tags.filter(Boolean).map((tag) => tag.slice(0, 40)))].slice(0, 20))
			.default([])
			.catch([]),
		public: z.boolean().default(false).catch(false),
		sort: z.enum(["edited", "name", "created"]).default("edited").catch("edited"),
		// Without one, the page uses the last view picked on this device.
		view: z.enum(["grid", "list"]).optional().catch(undefined),
		// Older links opened letters here; they open in the letter editor now.
		letter: z.string().optional().catch(undefined),
		// A blank resume to start once signed in: "Use this template" in the gallery (with its template) and the ATS
		// checker's "Start a blank resume".
		new: z.literal("resume").optional().catch(undefined),
		template: templateSchema.optional().catch(undefined),
	}),
	search: { middlewares: [stripSearchParams(defaults)] },
	beforeLoad: ({ search }) => {
		if (search.letter) {
			throw redirect({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: search.letter }, replace: true });
		}
	},
	component: RouteComponent,
});

function RouteComponent() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const { startBlank } = useStartDocument();
	const started = useRef(false);
	const requested = search.new === "resume" || search.template !== undefined;
	const startRequested = useEffectEvent(async (template: Template | undefined) => {
		// Off the address first, so Back from the new resume doesn't make another; back on it if creating failed,
		// so reloading tries again.
		const without = (previous: DocumentsSearch) => ({ ...previous, new: undefined, template: undefined });
		void navigate({ search: without, replace: true });
		if (await startBlank(template)) return;
		void navigate({ search: (previous: DocumentsSearch) => ({ ...previous, new: "resume", template }), replace: true });
	});
	useEffect(() => {
		if (!requested || started.current) return;
		started.current = true;
		void startRequested(search.template);
	}, [requested, search.template]);

	return (
		<DocumentsPage
			search={search}
			onSearchChange={(patch) =>
				void navigate({
					resetScroll: false,
					search: (previous: DocumentsSearch) => ({ ...previous, ...patch }),
					replace: true,
				})
			}
		/>
	);
}
