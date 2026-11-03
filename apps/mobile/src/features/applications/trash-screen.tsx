import type { RouterOutput } from "@/api/client";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { applicationError } from "./error";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { routes } from "@/routes";
import { Banner, Button, Card, ConfirmDialog, Screen, Text, showToast, useTheme } from "@/ui";

type TrashedApplication = RouterOutput["applications"]["listTrash"]["items"][number];

export function ApplicationTrashScreen() {
	const { t } = useLingui();
	const { space } = useTheme();
	const router = useRouter();
	const session = useSession();
	const scope = getAccountScope();
	const [offset, setOffset] = useState(0);
	const [removing, setRemoving] = useState<TrashedApplication | null>(null);
	const queryClient = useQueryClient();
	const options = orpc.applications.listTrash.queryOptions({
		input: { limit: 100, offset },
		context: { scope: scope ?? undefined },
	});
	const list = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server, scope],
		enabled: session.status === "signed-in",
	});
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.career.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.documents.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.agent.key() }),
		]);
	const restore = useMutation({
		mutationFn: (input: { id: string; trashedAt: Date }) =>
			client.applications.restore(input, { context: { scope: scope ?? undefined } }),
		onSuccess: () => {
			if (scope === getAccountScope()) showToast({ message: t`Restored` });
		},
		onSettled: refresh,
	});
	const purge = useMutation({
		mutationFn: (input: { id: string; trashedAt: Date }) =>
			client.applications.purge(input, { context: { scope: scope ?? undefined } }),
		onSuccess: () => {
			if (scope === getAccountScope()) {
				setRemoving(null);
				showToast({ message: t`Application deleted` });
			}
		},
		onSettled: refresh,
	});
	const busy = restore.isPending || purge.isPending;
	const page = list.data;
	if (page && offset > 0 && offset >= page.total) setOffset(Math.max(0, Math.floor((page.total - 1) / 100) * 100));
	return (
		<Screen onRefresh={refresh}>
			<Stack.Screen options={{ title: t`Trash` }} />
			<View style={{ flexDirection: "row", gap: space.s2 }}>
				<Button variant="ghost" label={t`Documents`} onPress={() => router.replace(routes.trash())} />
				<Text variant="title" accessibilityRole="header">{t`Applications`}</Text>
			</View>
			<Text>{t`Applications stay in Trash until you delete them permanently.`}</Text>
			{list.isError ? (
				<Banner
					tone="danger"
					message={applicationError(list.error)}
					action={{ label: t`Retry`, onPress: () => void list.refetch() }}
				/>
			) : list.isPending ? (
				<Text>{t`Loading…`}</Text>
			) : page?.items.length === 0 ? (
				<Text>{t`Trash is empty`}</Text>
			) : (
				page?.items.map((application) => (
					<Card key={application.id} style={{ gap: space.s2 }}>
						<Text variant="title">
							{application.role} · {application.company}
						</Text>
						<Button
							label={t`Restore`}
							disabled={busy || list.isFetching}
							onPress={() => restore.mutate({ id: application.id, trashedAt: application.trashedAt })}
						/>
						<Button
							variant="danger"
							label={t`Delete permanently…`}
							disabled={busy || list.isFetching}
							onPress={() => setRemoving(application)}
						/>
					</Card>
				))
			)}
			{restore.isError || purge.isError ? (
				<Banner tone="danger" message={applicationError(restore.error ?? purge.error)} />
			) : null}
			<View style={{ flexDirection: "row", gap: space.s2 }}>
				<Button
					variant="ghost"
					label={t`Previous`}
					disabled={busy || list.isFetching || offset === 0}
					onPress={() => setOffset(Math.max(0, offset - 100))}
				/>
				<Button
					variant="ghost"
					label={t`Next`}
					disabled={busy || list.isFetching || offset + 100 >= (page?.total ?? 0)}
					onPress={() => setOffset(offset + 100)}
				/>
			</View>
			<ConfirmDialog
				open={removing !== null}
				title={t`Delete this application?`}
				message={t`“${removing?.role} · ${removing?.company}” and its timeline are deleted permanently. Linked resumes and letters are kept.`}
				confirmLabel={t`Hold to delete`}
				cancelLabel={t`Keep in Trash`}
				destructive
				hold
				onCancel={() => {
					if (!busy) setRemoving(null);
				}}
				onConfirm={() => {
					if (removing && !busy && scope === getAccountScope())
						purge.mutate({ id: removing.id, trashedAt: removing.trashedAt });
				}}
			/>
		</Screen>
	);
}
