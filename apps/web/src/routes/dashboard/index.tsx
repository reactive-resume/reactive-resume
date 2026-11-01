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
		// "Use this template" in the gallery: a blank resume in that template, once signed in.
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
	const startTemplate = useEffectEvent((template: Template) => {
		void navigate({ search: (previous: DocumentsSearch) => ({ ...previous, template: undefined }), replace: true });
		void startBlank(template);
	});
	useEffect(() => {
		if (!search.template || started.current) return;
		started.current = true;
		startTemplate(search.template);
	}, [search.template]);

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
