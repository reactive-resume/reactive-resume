import { t, plural } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { daysLeft, destructionCounts, documentHref } from "./model";
import { CollectionState, DocumentPlaceholders } from "./shared";
import { getAccountScope } from "@/auth/session";
import { deletePermanently, restore, useTrash, useToday, useDataBackend, type TrashRef } from "@/data";
import {
	Button,
	Dialog,
	DocThumb,
	ListRow,
	Monogram,
	PushScreen,
	RowLink,
	SectionHeading,
	SwipeRow,
	haptic,
	showToast,
	useRowMotion,
	PageSubtitle,
} from "@/ui";

type TrashItem = { ref: TrashRef; name: string };

export function TrashScreen() {
	const { scope } = useDataBackend();
	return <ScopedTrashScreen key={scope} />;
}

function ScopedTrashScreen() {
	const query = useTrash();
	const { scope } = useDataBackend();
	const { now } = useToday();
	const cache = useQueryClient();
	const router = useRouter();
	const motion = useRowMotion();
	const busy = useRef(false);
	const [selection, setSelection] = useState<TrashItem | null>(null);
	const [confirmation, setConfirmation] = useState<TrashItem[] | null>(null);
	const [error, setError] = useState<string>();
	const documents = query.documents.data ?? [];
	const applications = query.applications.data?.items ?? [];
	const allApplicationsLoaded = applications.length === (query.applications.data?.total ?? 0);
	const all: TrashItem[] = [
		...documents.map((doc) => ({ ref: { id: doc.id, type: doc.type }, name: doc.name })),
		...applications.map((app) => ({
			ref: { id: app.id, type: "application" as const, trashedAt: app.trashedAt },
			name: `${app.company} · ${app.role}`,
		})),
	];
	const counts = destructionCounts(confirmation?.map((item) => item.ref) ?? []);
	const countCopy = [
		counts.documents ? plural(counts.documents, { one: "# document", other: "# documents" }) : "",
		counts.applications ? plural(counts.applications, { one: "# application", other: "# applications" }) : "",
	]
		.filter(Boolean)
		.join(t` and `);
	const restoreItem = async (item: TrashItem) => {
		if (busy.current || getAccountScope() !== scope) return;
		busy.current = true;
		try {
			await restore(item.ref);
			if (getAccountScope() !== scope) return;
			haptic("success");
			setSelection(null);
			await cache.invalidateQueries();
			showToast({
				message: t`Restored “${item.name}”`,
				action: {
					label: t`Open`,
					onPress: () => {
						if (getAccountScope() === scope) router.push(documentHref(item.ref));
					},
				},
			});
		} catch {
			if (getAccountScope() !== scope) return;
			setError(t`Couldn't restore the item. Try again.`);
			haptic("error");
		} finally {
			busy.current = false;
		}
	};
	const remove = async () => {
		if (!confirmation || busy.current || getAccountScope() !== scope) return;
		busy.current = true;
		let removed = 0;
		try {
			// Never call emptyTrash here: it could include new items the confirmation did not count.
			for (const item of confirmation) {
				if (getAccountScope() !== scope) return;
				await deletePermanently(item.ref);
				removed++;
			}
			if (getAccountScope() !== scope) return;
			setConfirmation(null);
			showToast({ message: t`Deleted permanently` });
		} catch {
			if (getAccountScope() !== scope) return;
			setConfirmation(null);
			setError(t`Couldn't delete every item. Refresh Trash before trying again.`);
		} finally {
			if (removed && getAccountScope() === scope) haptic("warning");
			await cache.invalidateQueries();
			busy.current = false;
		}
	};
	const restoreButton = (item: TrashItem) => (
		<RowLink
			label={t`Restore`}
			onPress={() => {
				void restoreItem(item);
			}}
		/>
	);
	const row = (item: TrashItem, secondary: string, leading: React.ReactNode, last: boolean) => (
		<Animated.View
			key={`${item.ref.type}-${item.ref.id}`}
			exiting={motion.foldOut}
			{...(motion.layoutShift ? { layout: motion.layoutShift } : {})}
			style={{ overflow: "hidden" }}
		>
			<SwipeRow
				start={{
					key: "purge",
					label: t`Delete permanently`,
					icon: "trash",
					tone: "danger",
					slides: false,
					onCommit: () => setConfirmation([item]),
				}}
			>
				<ListRow
					wrapTitle
					wrapSecondary
					title={item.name}
					secondary={secondary}
					leading={leading}
					trailing={restoreButton(item)}
					onPress={() => setSelection(item)}
					last={last}
					boxHidden={last}
					testID={`trash-${item.ref.id}`}
				/>
			</SwipeRow>
		</Animated.View>
	);
	return (
		<View style={{ flex: 1 }}>
			<PushScreen
				title={t`Trash`}
				subtitle={
					<PageSubtitle status>{t`Documents go after 30 days; applications stay until you delete them.`}</PageSubtitle>
				}
				barEnd={
					<Button
						label={t`Empty`}
						size="sm"
						tone="dangerGhost"
						disabled={
							!all.length ||
							!allApplicationsLoaded ||
							query.documents.isPending ||
							query.applications.isPending ||
							query.documents.isError ||
							query.applications.isError
						}
						onPress={() => setConfirmation(all)}
					/>
				}
			>
				{!allApplicationsLoaded ? (
					<CollectionState message={t`Empty Trash isn't available until all applications are loaded.`} />
				) : null}
				{query.documents.isError || query.applications.isError ? (
					<CollectionState
						message={t`Couldn't load Trash. Try again.`}
						action={t`Retry`}
						onPress={() => {
							void query.documents.refetch();
							void query.applications.refetch();
						}}
					/>
				) : null}
				{error ? <CollectionState message={error} action={t`Dismiss`} onPress={() => setError(undefined)} /> : null}
				{query.documents.isPending || query.applications.isPending ? (
					<DocumentPlaceholders />
				) : !all.length ? (
					<CollectionState
						message={t`Trash is empty. Documents stay here for 30 days; applications until you delete them.`}
					/>
				) : (
					<>
						<SectionHeading title={t`Documents`} first count={String(documents.length)} />
						{documents.map((doc, index) => {
							const item = { ref: { type: doc.type, id: doc.id }, name: doc.name };
							const days = daysLeft(doc.trashedAt ?? now, now);
							const kind = doc.type === "resume" ? t`Resume` : t`Cover letter`;
							return row(
								item,
								t`${kind} · ${days} days left`,
								<DocThumb letter={doc.type === "letter"} />,
								index === documents.length - 1,
							);
						})}
						<SectionHeading title={t`Applications`} count={String(applications.length)} />
						{applications.map((app, index) =>
							row(
								{
									ref: { type: "application", id: app.id, trashedAt: app.trashedAt },
									name: `${app.company} · ${app.role}`,
								},
								t`Kept until you delete it`,
								<Monogram letters={app.company.slice(0, 2).toUpperCase()} />,
								index === applications.length - 1,
							),
						)}
					</>
				)}
			</PushScreen>
			<Dialog
				open={!!selection}
				onClose={() => setSelection(null)}
				title={selection?.name ?? ""}
				actions={
					selection
						? [
								{
									label: t`Restore`,
									tone: "primary",
									onPress: () => {
										void restoreItem(selection);
									},
								},
								{
									label: t`Delete permanently…`,
									tone: "ghostDanger",
									onPress: () => {
										setConfirmation([selection]);
										setSelection(null);
									},
								},
								{ label: t`Cancel`, tone: "secondary", onPress: () => setSelection(null) },
							]
						: []
				}
			/>
			<Dialog
				open={!!confirmation}
				onClose={() => {
					if (!busy.current) setConfirmation(null);
				}}
				title={t`Delete ${countCopy} permanently?`}
				message={t`They can't be restored.`}
				actions={[
					{
						label: t`Delete permanently`,
						tone: "danger",
						onPress: () => {
							void remove();
						},
					},
					{
						label: t`Cancel`,
						tone: "secondary",
						onPress: () => {
							if (!busy.current) setConfirmation(null);
						},
					},
				]}
			/>
		</View>
	);
}
