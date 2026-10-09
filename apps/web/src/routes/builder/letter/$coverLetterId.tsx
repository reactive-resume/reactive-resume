import { t } from "@lingui/core/macro";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useBlocker } from "@tanstack/react-router";
import { useEffect } from "react";
import z from "zod";
import { toast } from "@reactive-resume/ui/components/toast";
import { LetterShell } from "./-components/letter-shell";
import { useLetterEditorStore } from "@/features/letters/store";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";

const searchSchema = z.object({
	// Write is the default and stays out of the URL. Letters have no Check.
	mode: z.enum(["write", "design"]).optional().catch(undefined),
	// Opens History on this version, read-only; Applications' "Open" on what was sent links here.
	version: z.string().optional().catch(undefined),
	// Opens the assistant on a conversation ("new" for a fresh one), or on a question to send (⌘K Ask).
	assistant: z.string().optional().catch(undefined),
	ask: z.string().max(2_000).optional().catch(undefined),
	applicationId: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/builder/letter/$coverLetterId")({
	component: RouteComponent,
	validateSearch: searchSchema,
	beforeLoad: ({ context, location }) => {
		if (!context.session) throw redirect({ to: "/auth/login", search: { callbackURL: location.href }, replace: true });
		return { session: context.session };
	},
	loader: async ({ params, context }) => {
		// Always fetched fresh: linked details come from the resume as it reads now.
		const letter = await context.queryClient.fetchQuery({
			...orpc.coverLetters.getById.queryOptions({ input: { id: params.coverLetterId } }),
			staleTime: 0,
		});
		return { name: letter.name };
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? [{ title: `${loaderData.name} - Reactive Resume` }, createNoindexFollowMeta()]
			: [createNoindexFollowMeta()],
	}),
});

function RouteComponent() {
	const { coverLetterId } = Route.useParams();
	const queryClient = useQueryClient();
	const { data: letter } = useSuspenseQuery(orpc.coverLetters.getById.queryOptions({ input: { id: coverLetterId } }));
	const loaded = useLetterEditorStore((state) => state.letter?.id === coverLetterId);
	useBlocker({
		shouldBlockFn: async ({ next }) => {
			if ("coverLetterId" in next.params && next.params.coverLetterId === coverLetterId) return false;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const saved = await Promise.race([
				useLetterEditorStore.getState().flush(),
				new Promise<boolean>((resolve) => {
					timeout = setTimeout(() => resolve(false), 10_000);
				}),
			]);
			clearTimeout(timeout);
			if (!saved)
				toast.add({ type: "error", description: t`Couldn't save your changes. Try again before continuing.` });
			return !saved;
		},
		enableBeforeUnload: false,
	});

	// The editor owns the letter from here; later refetches don't overwrite what's being typed.
	useEffect(() => {
		if (useLetterEditorStore.getState().letter?.id !== letter.id) useLetterEditorStore.getState().load(letter);
	}, [letter]);

	// Leaving saves what's pending, then lets lists (Documents, Applications) catch up.
	useEffect(
		() => () => {
			const sessionId = useLetterEditorStore.getState().sessionId;
			void useLetterEditorStore
				.getState()
				.flush()
				.then((saved) => {
					if (!saved) return;
					const state = useLetterEditorStore.getState();
					if (state.letter?.id === coverLetterId && state.sessionId === sessionId) state.reset();
					void queryClient.invalidateQueries({ queryKey: orpc.coverLetters.key() });
					void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
					void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
				});
		},
		[coverLetterId, queryClient],
	);

	if (!loaded) return null;

	return <LetterShell />;
}
