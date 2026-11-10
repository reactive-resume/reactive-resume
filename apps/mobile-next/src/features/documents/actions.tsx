import { t } from "@lingui/core/macro";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { editedLabel } from "./display";
import { documentHref, parseDocumentTags } from "./model";
import { CollectionState, DocumentPlaceholders, useTrashDocument } from "./shared";
import { getAccountScope, useSession } from "@/auth/session";
import { useAccount, useDataActions, useDataBackend, useDocuments, useLetter, useResume, useToday } from "@/data";
import { pageRenderer } from "@/render/page-renderer";
import {
	Button,
	IconTile,
	ListRow,
	SheetScreen,
	SheetScrollView,
	Spinner,
	Text,
	TextField,
	haptic,
	showToast,
} from "@/ui";

export function DocumentActionsScreen() {
	const { scope } = useDataBackend();
	return <ScopedDocumentActionsScreen key={scope} />;
}

function ScopedDocumentActionsScreen() {
	const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
	const documents = useDocuments();
	const document = documents.data?.find((row) => row.id === id && (!type || row.type === type));
	const resume = useResume(document?.type === "resume" ? id : "");
	const letter = useLetter(document?.type === "letter" ? id : "");
	const account = useAccount();
	const session = useSession();
	const { scope, backend } = useDataBackend();
	const active = useRef(false);
	useFocusEffect(
		useCallback(() => {
			active.current = true;
			return () => {
				active.current = false;
			};
		}, []),
	);
	const router = useRouter();
	const { now } = useToday();
	const actions = useDataActions();
	const trash = useTrashDocument();
	const [more, setMore] = useState(false);
	const [editing, setEditing] = useState<"name" | "tags" | null>(null);
	const [value, setValue] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [sharing, setSharing] = useState(false);
	const navigate = (href: string) => router.replace(href);
	const share = async () => {
		if (!document || sharing) return;
		setSharing(true);
		try {
			const revision = document.type === "resume" ? resume.data?.updatedAt.toISOString() : letter.data?.revision;
			if (revision === undefined) throw new Error("Document not ready.");
			const rendered = await pageRenderer.render({ kind: document.type, id, revision });
			if (!active.current || getAccountScope() !== scope) return;
			if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable.");
			await Sharing.shareAsync(rendered.pdfFile, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
		} catch {
			if (active.current && getAccountScope() === scope) {
				setError(t`Couldn't share the PDF. Try again.`);
				haptic("error");
			}
		} finally {
			setSharing(false);
		}
	};
	const copyLink = async () => {
		if (!document?.isPublic || !document.slug || !account.data?.username) {
			setError(t`Turn on the public link in Share first.`);
			return;
		}
		try {
			await Clipboard.setStringAsync(
				`${session.server}/${encodeURIComponent(account.data.username)}/${encodeURIComponent(document.slug)}`,
			);
			showToast({ message: t`Link copied to clipboard` });
		} catch {
			setError(t`Couldn't copy the public link. Try again.`);
		}
	};
	const save = async () => {
		if (!document || (editing === "name" && !value.trim()) || saving) return;
		const tags = parseDocumentTags(value);
		if (editing === "tags" && !tags) {
			setError(t`Use up to 20 tags, with no more than 40 characters each.`);
			return;
		}
		setSaving(true);
		try {
			if (editing === "name")
				await actions.write("documents", "documents.rename", { type: document.type, id, name: value.trim() });
			else
				await actions.write("documents", "documents.setTags", {
					type: document.type,
					id,
					tags: tags ?? [],
				});
			setEditing(null);
			setError(undefined);
		} catch {
			setError(t`Couldn't save your changes. Try again.`);
		} finally {
			setSaving(false);
		}
	};
	return (
		<SheetScreen height={640} title={document?.name ?? t`Document actions`} step={more ? "more" : "actions"}>
			{documents.isPending ? (
				<DocumentPlaceholders />
			) : !document ? (
				<CollectionState
					message={t`Couldn't load the document. Try again.`}
					action={t`Retry`}
					onPress={() => {
						void documents.refetch();
					}}
				/>
			) : (
				<SheetScrollView>
					<View style={{ paddingHorizontal: 24, flexDirection: "row" }}>
						<Text variant="body" color="ink3">
							{document.type === "resume" ? t`Resume` : t`Cover letter`}
							{" · "}
							{backend.kind === "fake" && id === "resume-lead"
								? t`edited 3 Oct`
								: editedLabel(document.editedAt, now).toLocaleLowerCase()}
						</Text>
					</View>
					{error ? <CollectionState message={error} /> : null}
					{editing ? (
						<View style={{ padding: 24, gap: 20 }}>
							<TextField
								label={editing === "name" ? t`Name` : t`Tags`}
								value={value}
								onChangeText={setValue}
								autoFocus
								maxLength={editing === "name" ? 100 : 819}
								onSubmitEditing={() => {
									void save();
								}}
							/>
							<Button
								label={saving ? t`Saving…` : t`Save`}
								disabled={saving || (editing === "name" && !value.trim())}
								onPress={() => {
									void save();
								}}
							/>
							<Button label={t`Cancel`} onPress={() => setEditing(null)} />
						</View>
					) : more ? (
						<>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Select several`}
								leading={<IconTile icon="check-square" />}
								onPress={() => navigate("/documents?select=1")}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Copy for a job…`}
								leading={<IconTile icon="copy" />}
								onPress={() => navigate(`/applications/new?resumeId=${id}`)}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Link to an application…`}
								leading={<IconTile icon="link-simple" />}
								onPress={() => navigate(`/applications?documentId=${id}`)}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Write a letter…`}
								leading={<IconTile icon="envelope-simple" />}
								onPress={() => navigate(`/new?kind=letter&resumeId=${id}`)}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Tags…`}
								leading={<IconTile icon="tag" />}
								onPress={() => {
									setEditing("tags");
									setValue(document.tags.join(", "));
								}}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Copy public link`}
								leading={<IconTile icon="link-simple" />}
								onPress={() => {
									void copyLink();
								}}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={document.isLocked ? t`Unlock editing` : t`Lock editing`}
								leading={<IconTile icon="lock-simple" />}
								onPress={() => setError(t`Lock editing is not available yet.`)}
								last
							/>
						</>
					) : (
						<>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Open`}
								leading={<IconTile icon="pencil-simple" />}
								onPress={() => navigate(documentHref(document))}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Tailor for a job…`}
								secondary={t`Makes a copy linked to an application`}
								leading={<IconTile icon="sparkle" accent />}
								onPress={() => navigate(`/applications/new?resumeId=${id}`)}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Duplicate`}
								leading={<IconTile icon="copy" />}
								onPress={() => setError(t`Duplicate is not available yet.`)}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Rename`}
								leading={<IconTile icon="text-aa" />}
								onPress={() => {
									setEditing("name");
									setValue(document.name);
								}}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={sharing ? t`Preparing…` : t`Share PDF`}
								leading={sharing ? <Spinner /> : <IconTile icon="share-network" />}
								onPress={() => {
									void share();
								}}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`More…`}
								secondary={t`Select, link, letter, tags, lock`}
								leading={<IconTile icon="dots-three" />}
								onPress={() => setMore(true)}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Move to Trash`}
								danger
								leading={<IconTile icon="trash" />}
								onPress={() => {
									void trash(document).then((done) => {
										if (done) router.back();
									});
								}}
								last
							/>
						</>
					)}
				</SheetScrollView>
			)}
		</SheetScreen>
	);
}
