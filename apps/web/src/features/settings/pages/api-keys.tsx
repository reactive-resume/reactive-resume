import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { BookOpenIcon, KeyIcon, LinkSimpleIcon, PlusIcon, TrashSimpleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { Separator } from "@reactive-resume/ui/components/separator";
import { toast } from "@reactive-resume/ui/components/toast";
import { useDialogStore } from "@/dialogs/store";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";

export function ApiKeysSettingsPage() {
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const openDialog = useDialogStore((state) => state.openDialog);

	const { data: apiKeys = [] } = useQuery({
		queryKey: ["auth", "api-keys"],
		queryFn: () => authClient.apiKey.list(),
		select: ({ data }) => {
			if (!data) return [];

			return data.apiKeys
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
				.filter((key) => !key.expiresAt || key.expiresAt.getTime() > Date.now());
		},
	});

	const onDelete = async (id: string) => {
		const confirmation = await confirm(t`Are you sure you want to delete this API key?`, {
			description: t`Once deleted, the key can no longer access your data. This cannot be undone.`,
			confirmText: t({
				comment: "API key deletion confirmation dialog confirm action in settings",
				message: "Delete",
			}),
			cancelText: t({
				comment: "API key deletion confirmation dialog cancel action in settings",
				message: "Cancel",
			}),
		});

		if (!confirmation) return;

		const toastId = toast.add({ type: "loading", description: t`Deleting your API key...` });

		const { error } = await authClient.apiKey.delete({ keyId: id });

		if (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(
					error,
					t({
						comment: "Fallback toast when deleting an API key fails",
						message: "Failed to delete the API key. Please try again.",
					}),
				),
				id: toastId,
			});
			return;
		}

		toast.add({ type: "success", description: t`The API key has been deleted.`, id: toastId });
		void queryClient.invalidateQueries({ queryKey: ["auth", "api-keys"] });
	};

	return (
		<div className="grid max-w-xl gap-6">
			<div className="flex items-start gap-4 rounded-md border bg-popover p-6">
				<div className="rounded-md bg-primary/10 p-2.5">
					<BookOpenIcon className="text-primary" size={24} />
				</div>

				<div className="flex-1 space-y-2">
					<h3 className="font-semibold">
						<Trans>How do I use the API?</Trans>
					</h3>

					<p className="text-muted-foreground leading-relaxed">
						<Trans>
							The API documentation shows how to connect Reactive Resume to your own applications. It covers the
							endpoints, the request format, and authentication.
						</Trans>
					</p>

					<Button
						variant="link"
						nativeButton={false}
						render={
							<a href="https://docs.rxresu.me/api-reference" target="_blank" rel="noopener noreferrer">
								<LinkSimpleIcon />
								<Trans>API Reference</Trans>
							</a>
						}
					/>
				</div>
			</div>

			<Separator />

			<div>
				<Button
					variant="outline"
					className="h-auto w-full py-3"
					onClick={() => openDialog("api-key.create", undefined)}
				>
					<PlusIcon />
					<Trans>Create a new API key</Trans>
				</Button>

				{apiKeys.map((key) => (
					<div key={key.id} className="flex items-center gap-x-4 py-4">
						<KeyIcon />

						<div className="flex-1 space-y-1">
							<p className="font-mono text-xs">{key.start}...</p>
							<div className="text-muted-foreground text-xs">
								{key.expiresAt ? (
									<Trans>Expires on {key.expiresAt.toLocaleDateString()}</Trans>
								) : (
									<Trans>Never expires</Trans>
								)}
							</div>
						</div>

						<Button size="icon" variant="ghost" onClick={() => onDelete(key.id)}>
							<TrashSimpleIcon />
						</Button>
					</div>
				))}
			</div>
		</div>
	);
}
