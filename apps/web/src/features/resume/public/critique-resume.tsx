import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { toast } from "@reactive-resume/ui/components/toast";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { CritiqueOverlay } from "./critique-overlay";

const critiqueRoute = getRouteApi("/$username/$slug/critique");

export function CritiqueResumeRoute() {
	const { username, slug } = critiqueRoute.useParams();
	const queryClient = useQueryClient();

	const viewQueryOptions = orpc.resume.critique.getCritiqueView.queryOptions({ input: { username, slug } });
	const { data: view } = useQuery(viewQueryOptions);

	const invalidate = () => queryClient.invalidateQueries({ queryKey: viewQueryOptions.queryKey });
	const onMutationError = (error: unknown) => {
		toast.add({
			type: "error",
			description: getReadableErrorMessage(
				error,
				t({
					comment: "Fallback toast when a critique comment action fails unexpectedly",
					message: "Something went wrong. Please try again.",
				}),
			),
		});
	};

	const { mutateAsync: addComment } = useMutation(
		orpc.resume.critique.addComment.mutationOptions({ onSuccess: invalidate, onError: onMutationError }),
	);
	const { mutateAsync: updateOwnComment } = useMutation(
		orpc.resume.critique.updateOwnComment.mutationOptions({ onSuccess: invalidate, onError: onMutationError }),
	);
	const { mutateAsync: deleteOwnComment } = useMutation(
		orpc.resume.critique.deleteOwnComment.mutationOptions({ onSuccess: invalidate, onError: onMutationError }),
	);

	if (!view) return <LoadingScreen />;

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
			<header className="text-center">
				<h1 className="font-semibold text-2xl tracking-tight">{view.data.basics.name || view.name}</h1>
				<p className="text-muted-foreground">
					<Trans>Commenting as {view.displayName}</Trans>
				</p>
			</header>

			<main id="main-content" className="w-full bg-white">
				<CritiqueOverlay
					data={view.data}
					publicResume={{ username, slug }}
					comments={view.comments}
					onAdd={async (input) => {
						await addComment({ username, slug, ...input });
					}}
					onEdit={async (commentId, body) => {
						await updateOwnComment({ username, slug, commentId, body });
					}}
					onDelete={async (commentId) => {
						await deleteOwnComment({ username, slug, commentId });
					}}
				/>
			</main>
		</div>
	);
}
