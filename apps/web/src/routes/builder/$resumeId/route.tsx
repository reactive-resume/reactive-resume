import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import z from "zod";
import { EditorPending } from "./-components/editor-pending";
import { EditorShell } from "./-components/editor-shell";
import { useBuilderResumeUpdateSubscription, useResumeCleanup, useResumeStore } from "@/features/resume/builder/draft";
import { EDITOR_MODES } from "@/features/resume/editor/store";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";

const searchSchema = z.object({
	// Write is the default and stays out of the URL.
	mode: z.enum(EDITOR_MODES).optional().catch(undefined),
	// Opens History on this version, read-only; Applications' "Open" on what was sent links here.
	version: z.string().optional().catch(undefined),
	// Opens the assistant on a conversation ("new" for a fresh one).
	assistant: z.string().optional().catch(undefined),
	// Fills the assistant's composer. Never sent without the user pressing Send: anyone can make a link.
	ask: z.string().max(2_000).optional().catch(undefined),
	// Prepare for next step keeps the application clicked, even when a base resume serves several jobs.
	applicationId: z.string().optional().catch(undefined),
	// The file a resume was just imported from; Write says what came in until it's dismissed.
	imported: z.string().max(255).optional().catch(undefined),
});

export const Route = createFileRoute("/builder/$resumeId")({
	component: RouteComponent,
	pendingComponent: EditorPending,
	validateSearch: searchSchema,
	beforeLoad: ({ context, location }) => {
		if (!context.session) throw redirect({ to: "/auth/login", search: { callbackURL: location.href }, replace: true });
		return { session: context.session };
	},
	loader: async ({ params, context }) => {
		// The page canvas and the preview are chunks of their own, otherwise fetched one after another only once the editor
		// has rendered: start them with the resume, so the first page can draw as soon as its PDF is ready.
		void import("./-components/page-canvas");
		void import("@/features/resume/preview/preview.browser");

		const resume = await context.queryClient.ensureQueryData(
			orpc.resume.getById.queryOptions({ input: { id: params.resumeId } }),
		);

		return { name: resume.name };
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? [{ title: `${loaderData.name} - Reactive Resume` }, createNoindexFollowMeta()]
			: [createNoindexFollowMeta()],
	}),
});

function RouteComponent() {
	const { resumeId } = Route.useParams();
	const { data: resume } = useSuspenseQuery(orpc.resume.getById.queryOptions({ input: { id: resumeId } }));
	const initializeResumeStore = useResumeStore((state) => state.initialize);
	const mergeResumeMetadata = useResumeStore((state) => state.mergeResumeMetadata);
	const isReady = useResumeStore((state) => state.isReady);
	const initializedResumeId = useResumeStore((state) => state.resumeId);
	const isInitialized = isReady && initializedResumeId === resumeId;
	const name = useResumeStore((state) =>
		state.resume && state.resume.id === resumeId ? state.resume.name : resume.name,
	);

	useResumeCleanup();
	useBuilderResumeUpdateSubscription();

	useEffect(() => {
		document.title = `${name} - Reactive Resume`;
	}, [name]);

	useEffect(() => {
		if (isInitialized) return;
		initializeResumeStore(resume);
	}, [initializeResumeStore, isInitialized, resume]);

	useEffect(() => {
		mergeResumeMetadata(resume);
	}, [
		mergeResumeMetadata,
		resume.id,
		resume.name,
		resume.slug,
		resume.tags,
		resume.isLocked,
		resume.isPublic,
		resume.showDownloadButtons,
		resume.hasPassword,
		resume.updatedAt,
		resume,
	]);

	if (!isInitialized) return <EditorPending />;

	return <EditorShell />;
}
