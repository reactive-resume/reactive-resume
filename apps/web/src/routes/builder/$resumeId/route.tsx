import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import z from "zod";
import { toast } from "@reactive-resume/ui/components/toast";
import { EditorPending } from "./-components/editor-pending";
import { EditorShell } from "./-components/editor-shell";
import { useBuilderResumeUpdateSubscription, useResumeCleanup, useResumeStore } from "@/features/resume/builder/draft";
import { EDITOR_MODES } from "@/features/resume/editor/store";
import { orpc } from "@/libs/orpc/client";
import { getPageTitle, createNoindexFollowMeta } from "@/libs/seo";

const searchSchema = z.object({
	// Write is the default and stays out of the URL.
	mode: z.enum(EDITOR_MODES).optional().catch(undefined),
	checkTab: z.enum(["issues", "match", "writing"]).optional().catch(undefined),
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

		const resume = await context.queryClient
			.ensureQueryData(orpc.resume.getById.queryOptions({ input: { id: params.resumeId } }))
			.catch((error: unknown) => {
				// A stale or mistyped link: Documents, saying why, rather than an error page whose Try again can't help.
				if (error instanceof ORPCError && error.code === "NOT_FOUND") {
					return null;
				}
				throw error;
			});

		return resume ? { name: resume.name } : null;
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? [{ title: getPageTitle(loaderData.name) }, createNoindexFollowMeta()]
			: [createNoindexFollowMeta()],
	}),
});

function RouteComponent() {
	return Route.useLoaderData() ? <ResumeEditor /> : <UnavailableResume />;
}

function UnavailableResume() {
	const navigate = Route.useNavigate();
	const notified = useRef(false);
	useEffect(() => {
		let active = true;
		// The destination explanation waits for the root toaster's sibling mount effect.
		queueMicrotask(() => {
			if (!active || notified.current) return;
			notified.current = true;
			toast.add({ type: "error", description: t`That resume isn't available. It may have been deleted.` });
			void navigate({ to: "/dashboard", replace: true });
		});
		return () => {
			active = false;
		};
	}, [navigate]);
	return null;
}

function ResumeEditor() {
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
		document.title = getPageTitle(name);
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
