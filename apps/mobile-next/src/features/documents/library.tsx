import type { Document } from "./model";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { documentDetail } from "./display";
import {
	AccountAvatar,
	CollectionState,
	DocumentPlaceholders,
	DocumentThumbnail,
	useOpenDocument,
	useTrashDocument,
} from "./shared";
import { useDocuments, useTrash, useToday, useDataBackend } from "@/data";
import {
	Button,
	Checkbox,
	IconButton,
	ListRow,
	SectionHeading,
	SwipeRow,
	TabScreen,
	TextLink,
	haptic,
	useRowMotion,
} from "@/ui";

export function LibraryScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ select?: string; q?: string }>();
	const query = typeof params.q === "string" ? params.q : "";
	const documents = useDocuments({ q: query });
	const trash = useTrash();
	const { now } = useToday();
	const { backend } = useDataBackend();
	const open = useOpenDocument();
	const trashDocument = useTrashDocument();
	const rowMotion = useRowMotion();
	const [selecting, setSelecting] = useState(params.select === "1");
	const [selected, setSelected] = useState<string[]>([]);
	const [failedSwipes, setFailedSwipes] = useState<Record<string, number>>({});
	const toggle = (id: string) =>
		setSelected((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
	const row = (document: Document, index: number, count: number) => {
		let secondary = documentDetail(document, now);
		// Fixture lacks these edited dates and the linked-job baseline drawn in D1.
		if (backend.kind === "fake") {
			if (document.id === "resume-lead") secondary = t`Edited 3 Oct`;
			if (document.id === "resume-lumen") secondary = t`Edited yesterday · For Lumen`;
			if (document.id === "letter-1") secondary = t`Edited 30 Oct`;
		}
		return (
			<Animated.View
				key={document.id}
				exiting={rowMotion.foldOut}
				{...(rowMotion.layoutShift ? { layout: rowMotion.layoutShift } : {})}
				style={{ overflow: "hidden" }}
			>
				<SwipeRow
					key={failedSwipes[document.id] ?? 0}
					start={{
						key: "trash",
						label: t`Move to Trash`,
						icon: "trash",
						tone: "danger",
						onCommit: () => {
							void trashDocument(document, true).then((done) => {
								if (!done)
									setFailedSwipes((failures) => ({ ...failures, [document.id]: (failures[document.id] ?? 0) + 1 }));
							});
						},
					}}
				>
					<ListRow
						wrapTitle
						wrapSecondary
						title={document.name}
						secondary={secondary}
						leading={
							selecting ? (
								<Checkbox value={selected.includes(document.id)} interactive={false} />
							) : (
								<DocumentThumbnail document={document} />
							)
						}
						trailing="caret"
						last={index === count - 1}
						onPress={() => (selecting ? toggle(document.id) : void open(document))}
						onLongPress={() => router.push(`/documents/${document.id}/actions?type=${document.type}`)}
						testID={`document-${document.id}`}
					/>
				</SwipeRow>
			</Animated.View>
		);
	};
	const resumes = documents.data?.filter((doc) => doc.type === "resume") ?? [];
	const letters = documents.data?.filter((doc) => doc.type === "letter") ?? [];
	return (
		<TabScreen
			title={t`Documents`}
			avatar={<AccountAvatar />}
			refreshing={documents.isRefetching}
			onRefresh={() => {
				void documents.refetch();
			}}
			actions={
				<>
					<IconButton icon="magnifying-glass" label={t`Search`} onPress={() => router.push("/search")} />
					<IconButton icon="plus" label={t`New`} onPress={() => router.push("/new")} />
				</>
			}
		>
			{documents.isError ? (
				<CollectionState
					message={t`Couldn't load your documents. Try again.`}
					action={t`Retry`}
					onPress={() => {
						void documents.refetch();
					}}
				/>
			) : null}
			{documents.isPending ? (
				<>
					<SectionHeading title={t`Resumes`} first />
					<DocumentPlaceholders />
					<SectionHeading title={t`Cover letters`} />
					<DocumentPlaceholders count={2} />
				</>
			) : documents.data?.length ? (
				<>
					<SectionHeading title={t`Resumes`} count={String(resumes.length)} first />
					{resumes.map((doc, index) => row(doc, index, resumes.length))}
					<SectionHeading title={t`Cover letters`} count={String(letters.length)} />
					{letters.map((doc, index) => row(doc, index, letters.length))}
					<View style={{ paddingHorizontal: 24, paddingTop: 32, flexDirection: "row", gap: 28, alignItems: "center" }}>
						<TextLink
							label={selecting ? t`Done` : t`Select`}
							icon="check-square"
							color="ink3"
							onPress={() => {
								setSelecting(!selecting);
								setSelected([]);
							}}
						/>
						<TextLink
							label={t`Trash · ${trash.documents.data?.length ?? 0}`}
							icon="trash"
							color="ink3"
							onPress={() => router.push("/trash")}
						/>
					</View>
					{selecting && selected.length > 0 ? (
						<View style={{ padding: 24 }}>
							<Button
								label={t`Move to Trash`}
								onPress={() => {
									void (async () => {
										let moved = false;
										for (const doc of documents.data.filter((item) => selected.includes(item.id)))
											moved = (await trashDocument(doc, true)) || moved;
										if (moved) haptic("light");
										setSelected([]);
									})();
								}}
							/>
						</View>
					) : null}
				</>
			) : !documents.isError ? (
				<CollectionState
					message={query ? t`No matching documents` : t`Import or create a resume`}
					action={query ? t`Clear filters` : t`New`}
					onPress={() => (query ? router.replace("/documents") : router.push("/new"))}
				/>
			) : null}
		</TabScreen>
	);
}
