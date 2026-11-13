import type { DocumentsSearch } from "@/features/documents/documents-page";
import type { Template } from "@reactive-resume/schema/templates";
import { t } from "@lingui/core/macro";
import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";
import { documentsSearchDefaults, documentsSearchSchema } from "./-documents-search";
import { DocumentsPage } from "@/features/documents/documents-page";
import { useStartDocument } from "@/features/documents/use-start-document";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/documents")({
	head: () => ({ meta: [{ title: getPageTitle(t`Documents`) }] }),
	validateSearch: documentsSearchSchema,
	search: { middlewares: [stripSearchParams(documentsSearchDefaults)] },
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
