import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { PageHeader } from "@/components/layout/page-header";
import { LibraryError } from "@/features/documents/library-error";
import { PageNavigation } from "@/features/documents/page-navigation";
import { useConfirm } from "@/hooks/use-confirm";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type TrashedApplication = RouterOutput["applications"]["listTrash"]["items"][number];

export function ApplicationTrashPage() {
	const [offset, setOffset] = useState(0);
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const list = useQuery(orpc.applications.listTrash.queryOptions({ input: { limit: 100, offset } }));
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.career.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.documents.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.agent.key() }),
		]);
	const restore = useMutation({
		...orpc.applications.restore.mutationOptions(),
		onSuccess: () => toast.add({ description: t`Restored` }),
		onError: (error) => toastError(error, t`Couldn't update the application. Try again.`),
		onSettled: refresh,
	});
	const purge = useMutation({
		...orpc.applications.purge.mutationOptions(),
		onSuccess: () => toast.add({ description: t`Application deleted` }),
		onError: (error) => toastError(error, t`Couldn't delete the application. Try again.`),
		onSettled: refresh,
	});
	const busy = restore.isPending || purge.isPending;
	const remove = async (application: TrashedApplication) => {
		if (busy || list.isFetching) return;
		if (
			await confirm(t`Delete this application?`, {
				description: t`“${application.role} · ${application.company}” and its timeline are deleted permanently. Linked resumes and letters are kept.`,
				confirmText: t`Hold to delete`,
				cancelText: t`Keep in Trash`,
				hold: true,
			})
		)
			purge.mutate({ id: application.id, trashedAt: application.trashedAt });
	};
	const page = list.data;
	if (page && offset > 0 && offset >= page.total) setOffset(Math.max(0, Math.floor((page.total - 1) / 100) * 100));
	return (
		<div className="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<PageHeader
				title={<Trans>Trash</Trans>}
				description={<Trans>Applications stay in Trash until you delete them permanently.</Trans>}
			/>
			{list.isError ? (
				<LibraryError retrying={list.isFetching} onRetry={() => void list.refetch()} />
			) : list.isPending ? (
				<p role="status">
					<Trans>Loading…</Trans>
				</p>
			) : page?.items.length === 0 ? (
				<div className="grid justify-items-center gap-2 py-16 text-center">
					<Icon name="trash" size={28} className="text-ink-3" />
					<p className="font-display text-[22px] leading-7">
						<Trans>Trash is empty</Trans>
					</p>
				</div>
			) : (
				<ul className="divide-y divide-line">
					{page?.items.map((application) => (
						<li key={application.id} className="flex flex-wrap items-center gap-3 py-3">
							<span className="min-w-0 flex-1">
								{application.role} · {application.company}
							</span>
							<Button
								disabled={busy || list.isFetching}
								onClick={() => restore.mutate({ id: application.id, trashedAt: application.trashedAt })}
							>
								<Trans>Restore</Trans>
							</Button>
							<Button variant="ghost" disabled={busy || list.isFetching} onClick={() => void remove(application)}>
								<Trans>Delete permanently…</Trans>
							</Button>
						</li>
					))}
				</ul>
			)}
			<PageNavigation offset={offset} total={page?.total ?? 0} busy={busy || list.isFetching} onChange={setOffset} />
		</div>
	);
}
