import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { splitBlocks, replaceBlockText } from "@reactive-resume/resume/proposals";
import { useDocumentId, useLetterDocument, DocumentState } from "../builder/share/document";
import { LetterDocument } from "../builder/shared/document";
import { useLetterStore, letterFieldFocus, useApplication, useResume } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { PushScreen, IconButton, Text, SectionHeading, ListRow, type as typeScale, useTheme, Touch } from "@/ui";

export function LetterScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const query = useLetterDocument(id);
	const document = query.data;
	const store = useLetterStore();
	const { colors } = useTheme();
	const visit = useRef(0);
	const [editing, setEditing] = useState<number>();
	const resume = useResume(document?.sourceResumeId ?? "");
	const application = useApplication(document?.sourceApplicationId ?? "");
	const ready = store.document?.id === id;
	const status = {
		text: store.locked
			? t`Locked`
			: store.status === "saving"
				? t`Saving…`
				: store.status === "offline"
					? t`Offline · Changes kept on this device`
					: t`Saved · to the hiring team at ${document?.recipientCompany ?? ""}`,
		onUndo: store.undo,
		onRedo: store.redo,
		canUndo: ready && store.canUndo,
		canRedo: ready && store.canRedo,
	};
	return (
		<>
			<LetterDocument id={id} />
			<PushScreen
				title={STORYBOARD ? t`Lumen cover letter` : (document?.name ?? t`Cover letter`)}
				status={status}
				docked
				barEnd={
					<>
						<IconButton
							icon="sparkle"
							label={t`Assistant`}
							disabled={!document?.sourceResumeId}
							onPress={() => document?.sourceResumeId && router.push(`/builder/${document.sourceResumeId}/assistant`)}
						/>
						{/* The document menu: the library's actions sheet handles letters (D2). */}
						<IconButton
							icon="dots-three"
							label={t`More`}
							onPress={() => router.push(`/documents/${id}/actions?type=letter`)}
						/>
					</>
				}
			>
				<DocumentState
					loading={query.isPending}
					error={query.isError}
					retry={() => void query.refetch()}
					height={292}
				/>
				{document && (
					<>
						<View style={{ paddingTop: 28, paddingHorizontal: 24, gap: 16 }}>
							<Text variant="prose">{document.greeting ?? ""}</Text>
							{splitBlocks(document.content).map((block, index) => (
								<View key={index}>
									{editing === index ? (
										<TextInput
											accessibilityLabel={t`Letter paragraph ${index + 1}`}
											value={block.text}
											autoFocus
											multiline
											caretHidden={STORYBOARD}
											onFocus={letterFieldFocus.onFocus}
											onBlur={() => {
												letterFieldFocus.onBlur();
												setEditing(undefined);
											}}
											onChangeText={(value) =>
												store.update(
													(d) => {
														const current = splitBlocks(d.content)[index];
														if (current)
															d.content = d.content.replace(current.html, () => replaceBlockText(current.html, value));
													},
													{ coalesceKey: `letter-${id}-${index}-${visit.current}`, sameStep: true },
												)
											}
											style={[typeScale.prose, { padding: 0, color: colors.ink, includeFontPadding: false }]}
										/>
									) : (
										<Touch
											feedback="none"
											accessibilityLabel={block.text}
											onPress={
												ready && !store.locked && /^<p>[^<]*<\/p>$/.test(block.html)
													? () => {
															visit.current++;
															setEditing(index);
														}
													: undefined
											}
										>
											<Text variant="prose">{block.text}</Text>
										</Touch>
									)}
								</View>
							))}
						</View>
						{store.status === "error" && (
							<View style={{ margin: 24 }}>
								<Text
									color="dangerText"
									accessibilityRole="alert"
								>{t`Couldn't save. Your text is kept on this device.`}</Text>
								<ListRow title={t`Try again`} onPress={store.retry} />
							</View>
						)}
						<SectionHeading title={t`Details`} />
						<ListRow
							title={t`Resume`}
							secondary={resume.data?.name}
							trailing="caret"
							onPress={document.sourceResumeId ? () => router.push(`/builder/${document.sourceResumeId}`) : undefined}
						/>
						<ListRow
							title={t`Application`}
							secondary={application.data ? `${application.data.company} · ${application.data.role}` : undefined}
							trailing="caret"
							onPress={
								document.sourceApplicationId
									? () => router.push(`/applications/${document.sourceApplicationId}`)
									: undefined
							}
						/>
						<ListRow title={t`Recipient`} secondary={document.recipient ?? undefined} trailing="caret" last boxHidden />
					</>
				)}
			</PushScreen>
		</>
	);
}
