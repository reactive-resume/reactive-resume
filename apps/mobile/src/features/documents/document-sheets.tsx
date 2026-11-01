import type { DocumentSummary } from "./filter";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { changedTags, documentRef, sharedTags } from "./filter";
import { useNewDocuments } from "./new-documents";
import { useDocumentOperations } from "./queries";
import { client, orpc } from "@/api/client";
import { useSession } from "@/auth/session";
import { AddApplicationSheet } from "@/features/applications/add-sheet";
import { shareDocumentPdf } from "@/features/share/files";
import { routes } from "@/routes";
import { Banner, Button, ChipInput, ListRow, Sheet, Skeleton, Text, TextField, useTheme } from "@/ui";

export type DocumentSheet =
	| { kind: "menu" | "rename" | "link"; documents: [DocumentSummary] }
	| { kind: "tags" | "sharing" | "lock"; documents: DocumentSummary[] };

type DocumentSheetsProps = {
	value: DocumentSheet;
	onClose: () => void;
	onChange: (value: DocumentSheet) => void;
	onSelect: (document: DocumentSummary) => void;
};

export function DocumentSheets({ value, onClose, onChange, onSelect }: DocumentSheetsProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { space } = useTheme();
	const session = useSession();
	const operations = useDocumentOperations();
	const first = value.documents[0];
	const [name, setName] = useState(first?.name ?? "");
	const shared = sharedTags(value.documents);
	const [tags, setTags] = useState(shared);
	const [addingJob, setAddingJob] = useState(false);
	const options = orpc.applications.listSummary.queryOptions({ input: {} });
	const applications = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: value.kind === "link" && session.status === "signed-in",
	});
	const execute = async (task: () => Promise<unknown>) => {
		if (await operations.run(task)) onClose();
	};
	const targets = value.documents.filter((document) => !document.isLocked);
	const titles = {
		menu: t`Document options`,
		rename: t`Rename`,
		tags: t`Tags`,
		link: t`Link to application`,
		sharing: t`Sharing`,
		lock: t`Lock editing`,
	};
	const submitted =
		first?.type === "letter" &&
		applications.data?.some((item) => item.coverLetterId === first.id && item.sentCoverLetterVersionId);
	const link = (applicationId: string | null) =>
		first && void execute(() => client.documents.linkApplication({ ...documentRef(first), applicationId }));
	const move = (kind: "rename" | "tags" | "link") => first && onChange({ kind, documents: [first] });
	return (
		<Sheet
			open
			onClose={() => {
				if (!operations.busy) onClose();
			}}
			title={titles[value.kind]}
			detents={[0.5, 0.9]}
		>
			<View style={{ paddingHorizontal: space.s4, gap: space.s3 }}>
				{operations.error && <Banner tone="danger" message={operations.error} />}
				{value.documents.some((document) => document.isLocked) && value.kind !== "menu" && value.kind !== "lock" && (
					<Banner tone="warn" message={t`Locked documents were skipped. Unlock them first.`} />
				)}
				{value.kind === "menu" && first && (
					<>
						<Text variant="title">{first.name}</Text>
						<ListRow
							title={t`Open`}
							leading="arrow-square-out"
							disabled={operations.busy}
							onPress={() => {
								onClose();
								useNewDocuments.getState().markOpened(first);
								router.push(first.type === "resume" ? routes.builder(first.id) : routes.letter(first.id));
							}}
						/>
						<ListRow
							title={t`Download PDF`}
							leading="file-pdf"
							disabled={operations.busy}
							onPress={() => void execute(() => shareDocumentPdf(first.type, first.id, first.name))}
						/>
						<ListRow
							title={t`Select`}
							leading="check-square"
							disabled={operations.busy}
							onPress={() => {
								onSelect(first);
								onClose();
							}}
						/>
						<ListRow
							title={t`Rename`}
							leading="pencil-simple"
							disabled={first.isLocked || operations.busy}
							onPress={() => move("rename")}
						/>
						<ListRow
							title={t`Duplicate`}
							leading="copy"
							disabled={operations.busy}
							onPress={() =>
								void execute(async () => {
									const id =
										first.type === "resume"
											? await client.resume.duplicate({
													id: first.id,
													name: t`${first.name} (copy)`.slice(0, 100),
													tags: first.tags,
												})
											: (await client.coverLetters.duplicate({ id: first.id })).id;
									useNewDocuments.getState().markNew({ id, type: first.type });
								})
							}
						/>
						{first.type === "resume" && (
							<ListRow
								title={t`Write a letter…`}
								leading="envelope-simple"
								disabled={operations.busy}
								onPress={() => {
									onClose();
									router.push({ pathname: "/new", params: { sourceResumeId: first.id } });
								}}
							/>
						)}
						{first.type === "resume" && (
							<ListRow
								title={t`Copy for a job…`}
								leading="briefcase"
								disabled={operations.busy}
								onPress={() => {
									onClose();
									router.push({ pathname: "/new", params: { step: "copy", sourceResumeId: first.id } });
								}}
							/>
						)}
						<ListRow
							title={t`Link to application…`}
							leading="briefcase"
							disabled={first.isLocked || operations.busy}
							onPress={() => move("link")}
						/>
						<ListRow
							title={t`Tags…`}
							leading="tag"
							disabled={first.isLocked || operations.busy}
							onPress={() => move("tags")}
						/>
						{first.type === "resume" && (
							<ListRow
								title={t`Sharing`}
								leading="globe"
								disabled={operations.busy}
								onPress={() => {
									onClose();
									router.push(routes.builder(first.id, "share"));
								}}
							/>
						)}
						<ListRow
							title={first.isLocked ? t`Unlock` : t`Lock editing`}
							leading={first.isLocked ? "lock-open" : "lock"}
							disabled={operations.busy}
							onPress={() =>
								void execute(() => client.documents.setLocked({ ...documentRef(first), isLocked: !first.isLocked }))
							}
						/>
						<ListRow
							title={t`Move to Trash`}
							leading="trash"
							destructive
							disabled={first.isLocked || operations.busy}
							onPress={() =>
								void operations.trash([first]).then((success) => {
									if (success) onClose();
								})
							}
						/>
					</>
				)}
				{value.kind === "rename" && first && (
					<>
						<TextField
							label={t`Name`}
							value={name}
							onChangeText={setName}
							maxLength={100}
							editable={!operations.busy}
							autoFocus
						/>
						<Button
							label={t`Save`}
							loading={operations.busy}
							disabled={!name.trim() || first.isLocked}
							onPress={() => void execute(() => client.documents.rename({ ...documentRef(first), name: name.trim() }))}
						/>
					</>
				)}
				{value.kind === "tags" && (
					<>
						<Text color="ink2">{t`Shows shared tags. Add or remove tags without changing each document's other tags.`}</Text>
						<View pointerEvents={operations.busy ? "none" : "auto"}>
							<ChipInput label={t`Tags`} values={tags} onChange={setTags} />
						</View>
						<Button
							label={t`Save`}
							loading={operations.busy}
							disabled={
								!targets.length ||
								tags.length > 20 ||
								tags.some((tag) => tag.length > 40) ||
								targets.some((document) => changedTags(document, shared, tags).length > 20)
							}
							onPress={() =>
								void execute(() =>
									operations.batch(
										value.documents,
										(document) =>
											client.documents.setTags({ ...documentRef(document), tags: changedTags(document, shared, tags) }),
										{ applies: (document) => !document.isLocked },
									),
								)
							}
						/>
						<Text variant="caption" color="ink3">{t`Up to 20 tags per document, 40 characters per tag.`}</Text>
					</>
				)}
				{value.kind === "link" && (
					<>
						{submitted && (
							<Text color="ink2">{t`This letter is recorded as sent. Its application link stays with that submission.`}</Text>
						)}
						{applications.isPending && <Skeleton height={space.s12} />}
						{applications.isError && (
							<Banner
								tone="danger"
								message={t`Couldn't load applications.`}
								action={{ label: t`Retry`, onPress: () => void applications.refetch() }}
							/>
						)}
						{applications.data
							?.filter((application) => application.status !== "closed")
							.map((application) => (
								<ListRow
									key={application.id}
									title={application.role}
									subtitle={
										first?.type === "letter" &&
										application.sentCoverLetterVersionId &&
										application.coverLetterId !== first.id
											? `${application.company} · ${t`Letter already sent`}`
											: application.company
									}
									selected={first?.application?.id === application.id}
									disabled={
										operations.busy ||
										Boolean(submitted) ||
										first?.isLocked ||
										Boolean(
											first?.type === "letter" &&
											application.sentCoverLetterVersionId &&
											application.coverLetterId !== first.id,
										)
									}
									onPress={() => link(application.id)}
								/>
							))}
						{applications.isSuccess && !applications.data.some((application) => application.status !== "closed") && (
							<Text color="ink2">{t`No applications yet.`}</Text>
						)}
						<Button
							label={t`Add a job…`}
							icon="plus"
							variant="secondary"
							disabled={operations.busy || first?.isLocked}
							onPress={() => setAddingJob(true)}
						/>
						{addingJob && <AddApplicationSheet onClose={() => setAddingJob(false)} onAdded={(id) => link(id)} />}
						{first?.application && (
							<Button
								label={t`Unlink`}
								variant="secondary"
								disabled={operations.busy || first.isLocked}
								onPress={() => link(null)}
							/>
						)}
					</>
				)}
				{value.kind === "sharing" && (
					<>
						<Text color="ink2">{t`Letters have no public link. Locked resumes keep their current visibility.`}</Text>
						{[true, false].map((isPublic) => (
							<Button
								key={String(isPublic)}
								label={isPublic ? t`Public link on` : t`Public link off`}
								variant="secondary"
								loading={operations.busy}
								onPress={() =>
									void execute(() =>
										operations.batch(
											value.documents,
											(document) => client.resume.update({ id: document.id, isPublic }),
											{
												applies: (document) => document.type === "resume" && !document.isLocked,
												alreadyDone: (document) => document.isPublic === isPublic,
											},
										),
									)
								}
							/>
						))}
					</>
				)}
				{value.kind === "lock" &&
					[true, false].map((isLocked) => (
						<Button
							key={String(isLocked)}
							label={isLocked ? t`Lock editing` : t`Unlock`}
							variant="secondary"
							loading={operations.busy}
							onPress={() =>
								void execute(() =>
									operations.batch(
										value.documents,
										(document) => client.documents.setLocked({ ...documentRef(document), isLocked }),
										{ alreadyDone: (document) => document.isLocked === isLocked },
									),
								)
							}
						/>
					))}
				<Button label={t`Close`} variant="ghost" disabled={operations.busy} onPress={onClose} />
			</View>
		</Sheet>
	);
}
